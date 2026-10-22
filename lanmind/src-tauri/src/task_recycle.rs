//! Recoverable task lifecycle. Family mutations and their sync payload commit together.
use super::*;

impl Database {
    pub(crate) fn install_task_recycle(&self) -> Result<(), String> {
        for column in [
            "deleted_at",
            "deleted_by",
            "expires_at",
            "deletion_id",
            "deletion_batch",
            "purged_at",
        ] {
            self.ensure_column("tasks", column, "TEXT")?;
        }
        self.ensure_column("tasks", "deletion_version", "INTEGER NOT NULL DEFAULT 0")?;
        self.conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_tasks_recycle ON tasks(workspace_id,deleted,expires_at,deleted_at);").map_err(|e| e.to_string())?;
        // Unknown historical deletion dates receive a full migration grace period.
        let now = Utc::now();
        let original = self.active_workspace.read().map_err(|e| e.to_string())?.clone();
        self.workspace_transaction("task_recycle_migration", || {
            let scopes: Vec<String> = self.conn
                .prepare("SELECT DISTINCT workspace_id FROM tasks WHERE deleted=1 AND deletion_id IS NULL ORDER BY workspace_id")
                .map_err(|e| e.to_string())?
                .query_map([], |row| row.get(0)).map_err(|e| e.to_string())?
                .collect::<Result<_, _>>().map_err(|e| e.to_string())?;
            // Honor each task's workspace so migration never bypasses the
            // same isolation triggers that protect normal task updates.
            for scope in scopes {
                *self.active_workspace.write().map_err(|e| e.to_string())? = scope.clone();
                self.conn.execute("UPDATE tasks SET deleted_at=COALESCE((SELECT timestamp FROM sync_operations o WHERE o.workspace_id=tasks.workspace_id AND o.entity_type='task' AND o.entity_id=tasks.id AND o.action='delete' ORDER BY o.version DESC LIMIT 1),?),deleted_by=(SELECT node_id FROM sync_operations o WHERE o.workspace_id=tasks.workspace_id AND o.entity_type='task' AND o.entity_id=tasks.id AND o.action='delete' ORDER BY o.version DESC LIMIT 1),expires_at=?,deletion_id='legacy-'||id,deletion_batch='legacy-'||id WHERE workspace_id=? AND deleted=1 AND deletion_id IS NULL", params![now.to_rfc3339(), (now + Duration::days(30)).to_rfc3339(), scope]).map_err(|e| e.to_string())?;
            }
            *self.active_workspace.write().map_err(|e| e.to_string())? = original;
            Ok(())
        })
    }

    pub(super) fn recycle_task(&self, id: &str) -> Result<(Task, Value, bool), String> {
        self.recycle_task_record(id, false)
    }

    fn recycle_task_record(&self, id: &str, summary: bool) -> Result<(Task, Value, bool), String> {
        let content = if summary {
            "json_set(payload_json,'$.description','','$.attachments',json('[]'),'$.subtasks',json('[]'))"
        } else {
            "payload_json"
        };
        self.conn.query_row(&format!("SELECT {content},deletion_id,deletion_batch,deleted_at,deleted_by,expires_at,purged_at,version,deleted,deletion_version FROM tasks WHERE workspace_id=active_workspace_id() AND id=?"), params![id], |row| {
            Ok((row.get::<_,String>(0)?, json!({"deletionId": row.get::<_,Option<String>>(1)?, "batchId": row.get::<_,Option<String>>(2)?, "deletedAt": row.get::<_,Option<String>>(3)?, "deletedBy": row.get::<_,Option<String>>(4)?, "expiresAt": row.get::<_,Option<String>>(5)?, "purgedAt": row.get::<_,Option<String>>(6)?, "version": row.get::<_,i64>(7)?, "deletionVersion": row.get::<_,i64>(9)?}), row.get::<_,bool>(8)?))
        }).optional().map_err(|e| e.to_string())?.ok_or_else(|| "任务不存在或已清理".to_string()).and_then(|(raw, meta, deleted)| {
            let mut task: Task = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            task.version = meta["version"].as_i64().unwrap_or(task.version);
            Ok((task,meta,deleted))
        })
    }

    pub(super) fn recycle_visible(&self, task: &Task, user: &str) -> bool {
        if self.require_workspace_member(user).is_err() {
            return false;
        }
        if let Some(project) = &task.project_id {
            if self.require_project_read(project, user).is_err() {
                return false;
            }
        }
        self.can_read_task(task, user)
    }

    fn recycle_can_purge(&self, task: &Task, user: &str) -> bool {
        if self.require_workspace_member(user).is_err() {
            return false;
        }
        match &task.project_id {
            None => task.creator_id == user,
            Some(id) => self.projects(None).unwrap_or_default().iter().find(|p| &p.id == id)
                .map(|p| p.created_by == user || p.admins.iter().any(|u| u == user))
                .unwrap_or_else(|| self.conn.query_row("SELECT created_by FROM projects WHERE workspace_id=active_workspace_id() AND id=?",params![id],|r| r.get::<_,String>(0)).ok().as_deref() == Some(user)),
        }
    }

    pub(crate) fn task_is_purged(&self, id: &str) -> Result<bool, String> {
        self.conn.query_row("SELECT EXISTS(SELECT 1 FROM tasks WHERE workspace_id=active_workspace_id() AND id=? AND purged_at IS NOT NULL)", params![id],|r|r.get(0)).map_err(|e| e.to_string())
    }

    pub fn trash_task(
        &self,
        id: &str,
        user: &str,
        with_children: bool,
        expected: Option<i64>,
    ) -> Result<Value, String> {
        self.trash_task_with_attachments(id, user, with_children, expected, None)
    }

    pub fn trash_task_with_attachments(
        &self,
        id: &str,
        user: &str,
        with_children: bool,
        expected: Option<i64>,
        legacy: Option<&Value>,
    ) -> Result<Value, String> {
        self.workspace_transaction("trash_task_family", || {
            self.require_workspace_member(user)?;
            let (task, meta, deleted) = self.recycle_task(id)?;
            if !self.recycle_visible(&task,user) || !self.can_write_task(&task,user) { return Err("没有删除该任务的权限".into()); }
            if deleted { return Ok(json!({"ids":[id],"batchId":meta["batchId"]})); }
            if expected.is_some_and(|v| v != task.version) { return Err("任务已变化，请刷新后重试".into()); }
            let all = self.tasks(None)?;
            let children: Vec<_> = all.iter().filter(|t| t.parent_task_id.as_deref()==Some(id)).cloned().collect();
            let archived = self.projects(None)?.iter().any(|p| task.project_id.as_deref()==Some(&p.id) && p.is_archived.unwrap_or(false));
            if archived { return Err("项目已归档，请先恢复项目".into()); }
            if children.iter().any(|c| !self.recycle_visible(c,user) || !self.can_write_task(c,user)) { return Err("没有处理子任务的权限，未删除任何任务".into()); }
            let now = Utc::now();
            let batch = format!("trash-{}",Uuid::new_v4().simple());
            let mut members=vec![task.clone()];
            if with_children { members.extend(children.clone()); }
            let mut detached=Vec::new();
            if !with_children {
                for mut child in children {
                    child.parent_task_id=None;
                    detached.push(child);
                }
            }
            let mut entries=Vec::new();
            if members.len() > 1000 { return Err("单次最多处理 1000 项任务".into()); }
            let deletion_version=self.setting("localClock")?.unwrap_or_default().parse::<i64>().unwrap_or(0)+1;
            for item in &mut members {
                // Older clients kept attachments in a workspace-scoped browser cache.
                // Import them in this transaction before the retained snapshot is written.
                if item.attachments.is_empty() {
                    if let Some(files)=legacy.and_then(|value|value.get(&item.id)) {
                        item.attachments=serde_json::from_value(files.clone()).map_err(|_|"历史附件数据无效")?;
                    }
                }
                let comments=self.conn.prepare("SELECT payload_json FROM task_comments WHERE workspace_id=active_workspace_id() AND task_id=? AND deleted=0").map_err(|e|e.to_string())?.query_map(params![item.id],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?.map(|r|serde_json::from_str::<Value>(&r.map_err(|e|e.to_string())?).map_err(|e|e.to_string())).collect::<Result<Vec<_>,_>>()?;
                entries.push(json!({"task":item,"comments":comments,"deletionId":format!("del-{}",Uuid::new_v4().simple()),"deletionVersion":deletion_version,"batchId":batch,"deletedAt":now.to_rfc3339(),"deletedBy":user,"expiresAt":(now+Duration::days(30)).to_rfc3339()}));
            }
            let payload=json!({"items":entries,"detached":detached});
            self.log_operation("task",id,"trash",payload.clone(),user,task.project_id.as_deref())?;
            let version: i64=self.setting("localClock")?.unwrap_or_default().parse().unwrap_or(0);
            self.apply_recycle_payload("trash",&payload,version,&now.to_rfc3339())?;
            Ok(json!({"ids":members.iter().map(|t|&t.id).collect::<Vec<_>>(),"batchId":batch}))
        })
    }

    pub fn list_trashed_tasks(
        &self,
        user: &str,
        query: &str,
        project: Option<&str>,
        page: i64,
    ) -> Result<Value, String> {
        self.require_workspace_member(user)?;
        self.cleanup_expired_tasks()?;
        let ids = self.conn.prepare("SELECT id FROM tasks WHERE workspace_id=active_workspace_id() AND deleted=1 AND purged_at IS NULL AND expires_at>? ORDER BY deleted_at DESC,id DESC").map_err(|e|e.to_string())?
            .query_map(params![Utc::now().to_rfc3339()],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        let projects = self.projects(None)?;
        let mut items = Vec::new();
        for id in ids {
            let (task, meta, _) = self.recycle_task_record(&id, true)?;
            let visible = self.recycle_visible(&task, user);
            let minimal = !visible
                && task.project_id.is_some()
                && !projects
                    .iter()
                    .any(|p| task.project_id.as_deref() == Some(&p.id))
                && self.recycle_can_purge(&task, user);
            if !visible && !minimal {
                continue;
            }
            if project.is_some_and(|p| {
                if p == "personal" {
                    task.project_id.is_some()
                } else {
                    task.project_id.as_deref() != Some(p)
                }
            }) {
                continue;
            }
            let archived = projects.iter().any(|p| {
                task.project_id.as_deref() == Some(&p.id) && p.is_archived.unwrap_or(false)
            });
            items.push(json!({"id":task.id,"title":task.title,"identifier":task.identifier,"projectId":task.project_id,"parentTaskId":task.parent_task_id,"meta":meta,"canRestore":visible && !archived && self.can_write_task(&task,user),"canPurge":self.recycle_can_purge(&task,user),"archived":archived,"minimal":minimal}));
        }
        let mut batches: HashMap<String, Vec<Value>> = HashMap::new();
        for item in &items {
            if item["canRestore"] == true {
                batches
                    .entry(item["meta"]["batchId"].as_str().unwrap_or("").into())
                    .or_default()
                    .push(json!({"id":item["id"],"deletionId":item["meta"]["deletionId"]}));
            }
        }
        for item in &mut items {
            item["batchSelection"] = json!(batches
                .get(item["meta"]["batchId"].as_str().unwrap_or(""))
                .cloned()
                .unwrap_or_default());
        }
        let needle = query.trim().to_lowercase();
        if !needle.is_empty() {
            items.retain(|item| {
                format!(
                    "{} {}",
                    item["title"].as_str().unwrap_or(""),
                    item["identifier"].as_str().unwrap_or("")
                )
                .to_lowercase()
                .contains(&needle)
            });
        }
        let total = items.len();
        let page = page.clamp(1, ((total as i64 + 49) / 50).max(1));
        Ok(
            json!({"items":items.into_iter().skip(((page-1)*50) as usize).take(50).collect::<Vec<_>>(),"total":total,"page":page,"pageSize":50}),
        )
    }

    pub fn trashed_task_detail(&self, id: &str, user: &str) -> Result<Value, String> {
        self.require_workspace_member(user)?;
        let (task, meta, deleted) = self.recycle_task(id)?;
        if !deleted
            || !meta["purgedAt"].is_null()
            || !self.recycle_visible(&task, user)
            || meta["expiresAt"]
                .as_str()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .is_none_or(|at| at <= Utc::now())
        {
            return Err("任务不存在、已过期或没有访问权限".into());
        }
        let comments=self.conn.prepare("SELECT payload_json FROM task_comments WHERE workspace_id=active_workspace_id() AND task_id=? AND deleted=0 ORDER BY created_at").map_err(|e|e.to_string())?.query_map(params![id],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?.map(|r| serde_json::from_str::<Value>(&r.map_err(|e|e.to_string())?).map_err(|e|e.to_string())).collect::<Result<Vec<_>,_>>()?;
        Ok(json!({"task":task,"meta":meta,"comments":comments}))
    }

    pub fn restore_trashed_tasks(
        &self,
        selection: &Value,
        user: &str,
        confirmed: bool,
    ) -> Result<Value, String> {
        self.workspace_transaction("restore_task_family", || {
            self.require_workspace_member(user)?;
            let selected=selection.as_array().filter(|s| !s.is_empty() && s.len()<=1000).ok_or("请选择要恢复的任务")?;
            let ids:HashSet<_>=selected.iter().filter_map(|s|s["id"].as_str()).collect();
            if ids.len()!=selected.len() { return Err("任务选择无效".into()); }
            let all=self.tasks(None)?;
            let projects=self.projects(None)?;
            let users:HashSet<_>=self.workspace_users()?.iter().map(|u|u.id.clone()).collect();
            let mut entries=Vec::new();
            let mut warnings=Vec::new();
            let mut batch=None;
            for item in selected {
                let id=item["id"].as_str().ok_or("任务选择无效")?;
                let (mut task,meta,deleted)=self.recycle_task(id)?;
                if !deleted || !meta["purgedAt"].is_null() || meta["deletionId"]!=item["deletionId"] { return Err("任务已恢复、清理或再次删除，请刷新后重试".into()); }
                if !self.recycle_visible(&task,user) || !self.can_write_task(&task,user) { return Err("没有恢复该任务的权限".into()); }
                let expires=DateTime::parse_from_rfc3339(meta["expiresAt"].as_str().unwrap_or("")).map_err(|_|"任务到期时间无效")?;
                if expires<=Utc::now() { return Err("任务已过期，无法恢复".into()); }
                if let Some(ref b)=batch { if b!=&meta["batchId"] { return Err("只能同时恢复同次删除的任务".into()); } } else { batch=Some(meta["batchId"].clone()); }
                if let Some(pid)=&task.project_id {
                    let p=projects.iter().find(|p| &p.id==pid).ok_or("原项目已删除，无法恢复")?;
                    if p.is_archived.unwrap_or(false) { return Err("请先取消项目归档后再恢复任务".into()); }
                    if !task.assignee_id.is_empty() && !(p.members.contains(&task.assignee_id)||p.admins.contains(&task.assignee_id)||p.created_by==task.assignee_id) {
                        task.assignee_id.clear(); warnings.push(json!({"id":id,"kind":"assignee"}));
                    }
                    let old=task.shared_with.len();
                    task.shared_with.retain(|u|p.members.contains(u)||p.admins.contains(u)||&p.created_by==u);
                    if old!=task.shared_with.len() { warnings.push(json!({"id":id,"kind":"sharing"})); }
                }
                if !task.assignee_id.is_empty() && !users.contains(&task.assignee_id) { task.assignee_id.clear(); warnings.push(json!({"id":id,"kind":"assignee"})); }
                if let Some(parent)=&task.parent_task_id {
                    if !ids.contains(parent.as_str()) && !all.iter().any(|p| &p.id==parent && p.project_id==task.project_id && self.recycle_visible(p,user)) {
                        task.parent_task_id=None; warnings.push(json!({"id":id,"kind":"parent"}));
                    }
                }
                let states=self.states_for_scope(task.project_id.as_deref(),Some(&task.creator_id))?;
                if !states.iter().any(|s| task.state_id.as_deref()==Some(&s.id)) {
                    let state=states.iter().find(|s|Some(&s.group)==task.state_group.as_ref() && s.is_default).or_else(||states.iter().find(|s|s.is_default)).ok_or("没有可用任务状态，请先配置状态")?;
                    task.state_id=Some(state.id.clone()); task.state_group=Some(state.group.clone());task.state_name=Some(state.name.clone()); warnings.push(json!({"id":id,"kind":"state"}));
                    if let Some(group)=StateGroup::parse(&state.group) {task.status=group.legacy_status().into();}
                }
                // A restored overdue reminder must never be delivered as a fresh reminder.
                if task.reminder_time.as_deref().and_then(parse_task_datetime).is_some_and(|at|at<=Local::now().naive_local()) {
                    task.reminder_time=None; warnings.push(json!({"id":id,"kind":"reminder"}));
                }
                task.updated_at=Utc::now().to_rfc3339();
                entries.push(json!({"task":task,"deletionId":meta["deletionId"],"deletionVersion":meta["deletionVersion"]}));
            }
            if !confirmed && !warnings.is_empty() { return Ok(json!({"needsConfirmation":true,"warnings":warnings})); }
            entries.sort_by_key(|e|!e["task"]["parentTaskId"].is_null());
            let first=&entries[0]["task"];
            let payload=json!({"items":entries});
            self.log_operation("task",first["id"].as_str().unwrap(),"restore",payload.clone(),user,first["projectId"].as_str())?;
            let version=self.setting("localClock")?.unwrap_or_default().parse().unwrap_or(0);
            self.apply_recycle_payload("restore",&payload,version,&Utc::now().to_rfc3339())?;
            Ok(json!({"needsConfirmation":false,"warnings":warnings,"ids":ids}))
        })
    }

    pub fn purge_trashed_tasks(&self, selection: &Value, user: &str) -> Result<Value, String> {
        self.workspace_transaction("purge_task_family", || {
            self.require_workspace_member(user)?;
            let selected = selection
                .as_array()
                .filter(|s| !s.is_empty() && s.len() <= 1000)
                .ok_or("请选择要清理的任务")?;
            let ids: HashSet<_> = selected.iter().filter_map(|s| s["id"].as_str()).collect();
            if ids.len() != selected.len() {
                return Err("任务选择无效".into());
            }
            let mut batch = None;
            let mut entries = Vec::new();
            for item in selected {
                let id = item["id"].as_str().ok_or("任务选择无效")?;
                let (task, meta, deleted) = self.recycle_task(id)?;
                if !deleted
                    || !meta["purgedAt"].is_null()
                    || meta["deletionId"] != item["deletionId"]
                {
                    return Err("任务已变化，请刷新后重试".into());
                }
                if !self.recycle_can_purge(&task, user) {
                    return Err("只有任务创建者或项目管理员可以彻底删除".into());
                }
                if let Some(ref b) = batch {
                    if b != &meta["batchId"] {
                        return Err("只能同时清理同次删除的任务".into());
                    }
                } else {
                    batch = Some(meta["batchId"].clone());
                }
                entries.push(self.purge_entry(task, meta));
            }
            let payload = json!({"items":entries});
            self.log_operation(
                "task",
                selected[0]["id"].as_str().unwrap(),
                "purge",
                payload.clone(),
                user,
                payload["items"][0]["task"]["projectId"].as_str(),
            )?;
            let version = self
                .setting("localClock")?
                .unwrap_or_default()
                .parse()
                .unwrap_or(0);
            self.apply_recycle_payload("purge", &payload, version, &Utc::now().to_rfc3339())?;
            Ok(json!({"success":true}))
        })
    }

    fn purge_entry(&self, mut task: Task, meta: Value) -> Value {
        task.title.clear();
        task.description.clear();
        task.attachments.clear();
        task.subtasks.clear();
        task.tags.clear();
        task.parent_task_id = None;
        task.reminder_time = None;
        task.recurrence = None;
        task.recurrence_rule = None;
        task.due_date = None;
        task.start_date = None;
        task.identifier = None;
        json!({"task":task,"deletionId":meta["deletionId"],"deletionVersion":meta["deletionVersion"],"batchId":meta["batchId"],"deletedAt":meta["deletedAt"],"deletedBy":meta["deletedBy"],"expiresAt":meta["expiresAt"]})
    }

    pub(crate) fn cleanup_expired_tasks(&self) -> Result<(), String> {
        let now = Utc::now();
        let scan_key = format!(
            "taskRecycleLastScan:{}",
            self.workspace_context()?.workspace_id
        );
        let last = self
            .setting(&scan_key)?
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        if now.timestamp() < last {
            self.save_local_setting(&scan_key, &now.timestamp().to_string())?;
            return Ok(());
        }
        if now.timestamp() - last < 300 {
            return Ok(());
        }
        // Give a large forward clock change one scan interval before destructive cleanup.
        if last > 0 && now.timestamp() - last > 172800 {
            self.save_local_setting(&scan_key, &now.timestamp().to_string())?;
            return Ok(());
        }
        let actor = self.current_user_id()?;
        if self.require_workspace_member(&actor).is_err() {
            return Ok(());
        }
        self.workspace_transaction("expire_task_recycle",|| {
            self.save_local_setting(&scan_key,&now.timestamp().to_string())?;
            let ids=self.conn.prepare("SELECT id FROM tasks WHERE workspace_id=active_workspace_id() AND deleted=1 AND purged_at IS NULL AND expires_at<=?").map_err(|e|e.to_string())?.query_map(params![now.to_rfc3339()],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
            for id in ids {
                let (task,meta,_)=self.recycle_task(&id)?;
                let project=task.project_id.clone();
                let payload=json!({"items":[self.purge_entry(task,meta)],"expired":true});
                self.log_operation("task",&id,"purge",payload.clone(),&actor,project.as_deref())?;
                let version=self.setting("localClock")?.unwrap_or_default().parse().unwrap_or(0);
                self.apply_recycle_payload("purge",&payload,version,&now.to_rfc3339())?;
            }
            Ok(())
        })
    }

    pub(crate) fn apply_task_recycle_operation(&self, op: &SyncOperation) -> Result<(), String> {
        self.require_workspace_member(&op.node_id)?;
        for entry in op.payload["items"].as_array().ok_or("回收站同步数据无效")? {
            let incoming: Task =
                serde_json::from_value(entry["task"].clone()).map_err(|e| e.to_string())?;
            let current = self.recycle_task(&incoming.id).ok();
            if current.as_ref().is_some_and(|(task, _, _)| {
                task.project_id != incoming.project_id || task.creator_id != incoming.creator_id
            }) {
                return Err("同步任务身份不一致".into());
            }
            let task = current.as_ref().map(|r| r.0.clone()).unwrap_or(incoming);
            let expired = op.payload["expired"] == true
                && current.as_ref().is_none_or(|(_, m, _)| {
                    m["expiresAt"] == entry["expiresAt"] && m["deletionId"] == entry["deletionId"]
                })
                && entry["expiresAt"]
                    .as_str()
                    .zip(Some(op.timestamp.as_str()))
                    .is_some_and(|(expiry, at)| expiry <= at);
            if op.action == "purge" {
                if !expired && !self.recycle_can_purge(&task, &op.node_id) {
                    return Err("没有清理该任务的权限".into());
                }
            } else if !self.recycle_visible(&task, &op.node_id)
                || !self.can_write_task(&task, &op.node_id)
            {
                return Err("没有操作该任务的权限".into());
            }
        }
        for value in op.payload["detached"].as_array().into_iter().flatten() {
            let child: Task = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
            let (current, _, deleted) = self.recycle_task(&child.id)?;
            if !deleted
                && current.version < op.version
                && (current.parent_task_id.as_deref() != Some(&op.entity_id)
                    || !self.recycle_visible(&current, &op.node_id)
                    || !self.can_write_task(&current, &op.node_id))
            {
                return Err("没有解除子任务关系的权限".into());
            }
        }
        self.apply_recycle_payload(&op.action, &op.payload, op.version, &op.timestamp)?;
        Ok(())
    }

    pub(crate) fn apply_recycle_payload(
        &self,
        action: &str,
        payload: &Value,
        version: i64,
        timestamp: &str,
    ) -> Result<(), String> {
        let entries = payload["items"].as_array().ok_or("回收站同步数据无效")?;
        for entry in entries {
            let mut task: Task =
                serde_json::from_value(entry["task"].clone()).map_err(|e| e.to_string())?;
            let existing = self.recycle_task(&task.id).ok();
            // Compare deletion generations, independently of later edit/restore versions.
            // A purge wins inside its generation; a newer deletion remains recoverable.
            let deletion_version = entry["deletionVersion"]
                .as_i64()
                .unwrap_or(if action == "trash" { version } else { 0 });
            let incoming_key = (deletion_version, entry["deletionId"].as_str().unwrap_or(""));
            if action == "restore"
                && !existing.as_ref().is_some_and(|(_, m, d)| {
                    *d && m["purgedAt"].is_null() && m["deletionId"] == entry["deletionId"]
                })
            {
                continue;
            }
            if let Some((_, meta, _)) = &existing {
                let current_key = (
                    meta["deletionVersion"].as_i64().unwrap_or(0),
                    meta["deletionId"].as_str().unwrap_or(""),
                );
                if action == "trash" && !meta["deletionId"].is_null() && incoming_key <= current_key
                {
                    continue;
                }
                if action == "purge" && incoming_key < current_key {
                    continue;
                }
            }
            if task.workspace_id.as_deref() != Some(self.workspace_context()?.workspace_id.as_str())
            {
                return Err("回收项不属于当前工作区".into());
            }
            task.version = version;
            let raw = serde_json::to_string(&task).map_err(|e| e.to_string())?;
            self.conn.execute("INSERT INTO tasks(id,payload_json,project_id,creator_id,assignee_id,updated_at,version,deleted,state_id,state_group,state_name,workspace_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,active_workspace_id()) ON CONFLICT(workspace_id,id) DO UPDATE SET payload_json=excluded.payload_json,version=excluded.version,updated_at=excluded.updated_at,deleted=excluded.deleted,state_id=excluded.state_id,state_group=excluded.state_group,state_name=excluded.state_name,assignee_id=excluded.assignee_id",params![task.id,raw,task.project_id,task.creator_id,task.assignee_id,task.updated_at,version,action!="restore",task.state_id,task.state_group,task.state_name]).map_err(|e|e.to_string())?;
            if action != "restore" {
                self.conn.execute("UPDATE tasks SET deletion_id=?,deletion_batch=?,deleted_at=?,deleted_by=?,expires_at=?,purged_at=?,deletion_version=? WHERE workspace_id=active_workspace_id() AND id=?",params![entry["deletionId"].as_str(),entry["batchId"].as_str(),entry["deletedAt"].as_str(),entry["deletedBy"].as_str(),entry["expiresAt"].as_str(),if action=="purge" {Some(timestamp)}else{None},deletion_version,task.id]).map_err(|e|e.to_string())?;
            }
            if action == "trash" {
                // A newer generation may arrive after an older generation was purged.
                // Its retained comment snapshot must follow the task snapshot as well.
                for value in entry["comments"].as_array().into_iter().flatten() {
                    let comment: TaskComment =
                        serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
                    if comment.task_id != task.id || comment.workspace_id != task.workspace_id {
                        return Err("回收项评论不属于该任务".into());
                    }
                    self.conn.execute("INSERT OR IGNORE INTO task_comments(id,task_id,payload_json,author_id,created_at,updated_at,deleted) VALUES(?,?,?,?,?,?,0)",params![comment.id,task.id,value.to_string(),comment.author_id,comment.created_at,comment.updated_at]).map_err(|e|e.to_string())?;
                }
            }
            if action == "purge" {
                self.conn.execute("DELETE FROM task_comments WHERE workspace_id=active_workspace_id() AND task_id=?",params![task.id]).map_err(|e|e.to_string())?;
                self.conn.execute("DELETE FROM task_assignment_notifications WHERE workspace_id=active_workspace_id() AND json_extract(payload_json,'$.taskId')=?",params![task.id]).map_err(|e|e.to_string())?;
                self.redact_task_history(&task.id)?;
            }
        }
        if action == "trash" {
            for value in payload["detached"].as_array().into_iter().flatten() {
                let child: Task =
                    serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
                self.conn.execute("UPDATE tasks SET payload_json=json_set(payload_json,'$.parentTaskId',NULL,'$.version',?,'$.updatedAt',?),version=?,updated_at=? WHERE workspace_id=active_workspace_id() AND id=? AND deleted=0 AND version<?",params![version,timestamp,version,timestamp,child.id,version]).map_err(|e|e.to_string())?;
            }
        }
        Ok(())
    }

    pub(crate) fn redact_task_history(&self, id: &str) -> Result<(), String> {
        // Keep operation IDs/versions for idempotency and cursors, remove recoverable content.
        self.conn.execute("UPDATE sync_operations SET action='redacted',payload_json=json_object('id',entity_id) WHERE workspace_id=active_workspace_id() AND ((entity_type='task' AND entity_id=? AND action NOT IN ('trash','restore','purge')) OR (entity_type IN ('task_comment','task_assignment') AND json_extract(payload_json,'$.taskId')=?))",params![id,id]).map_err(|e|e.to_string())?;
        let rows=self.conn.prepare("SELECT id,payload_json FROM sync_operations WHERE workspace_id=active_workspace_id() AND entity_type='task' AND action IN ('trash','restore')").map_err(|e|e.to_string())?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        for (op, raw) in rows {
            let mut p: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            for key in ["items", "detached"] {
                if let Some(items) = p[key].as_array_mut() {
                    items.retain(|e| {
                        e["task"]["id"].as_str().or_else(|| e["id"].as_str()) != Some(id)
                    });
                }
            }
            self.conn.execute("UPDATE sync_operations SET payload_json=? WHERE workspace_id=active_workspace_id() AND id=?",params![p.to_string(),op]).map_err(|e|e.to_string())?;
        }
        Ok(())
    }

    pub(super) fn recycle_activity_payload(&self, mut payload: Value, id: &str) -> Value {
        for key in ["items", "detached"] {
            if let Some(entries) = payload.get_mut(key).and_then(Value::as_array_mut) {
                entries.retain(|entry| {
                    entry["task"]["id"]
                        .as_str()
                        .or_else(|| entry["id"].as_str())
                        == Some(id)
                });
            }
        }
        payload
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Database, String, Task) {
        let db = Database::open(Path::new(":memory:")).unwrap();
        let user = db.current_user_id().unwrap();
        let task=db.create_task(json!({"title":"recycle secret","description":"preserved body","priority":"P2","status":"todo","assigneeId":user,"projectId":null,"isShared":false,"sharedWith":[],"subtasks":[],"tags":[],"attachments":[{"id":"file","name":"secret.txt","size":10,"type":"text/plain","dataUrl":"data:text/plain;base64,c2VjcmV0","addedAt":Utc::now().to_rfc3339()}]}),&user).unwrap();
        (db, user, task)
    }
    fn selection(db: &Database, id: &str) -> Value {
        let (_, meta, _) = db.recycle_task(id).unwrap();
        json!([{"id":id,"deletionId":meta["deletionId"]}])
    }
    fn child(db: &Database, user: &str, parent: &Task) -> Task {
        db.create_task(json!({"title":"child","description":"child body","parentTaskId":parent.id,"assigneeId":user,"priority":"P3","status":"todo","isShared":false,"sharedWith":[],"subtasks":[],"tags":[]}),user).unwrap()
    }
    fn legacy_trash(db: &Database, user: &str) -> Task {
        let task = db.create_task(json!({"title":"legacy deleted task","description":"preserved legacy content","priority":"P3","status":"todo","assigneeId":user,"isShared":false,"sharedWith":[],"subtasks":[],"tags":[]}), user).unwrap();
        // Older builds logged "delete" and kept only a tombstone, without
        // the metadata or payload produced by the current "trash" action.
        db.log_operation("task", &task.id, "delete", json!({"id":task.id,"workspaceId":db.workspace_context().unwrap().workspace_id}), user, None).unwrap();
        let version: i64 = db.setting("localClock").unwrap().unwrap().parse().unwrap();
        db.conn.execute("UPDATE tasks SET deleted=1,version=? WHERE workspace_id=active_workspace_id() AND id=?", params![version, task.id]).unwrap();
        task
    }
    #[test]
    fn task_recycle_legacy_migration_reopens_multiple_workspaces_without_changing_history() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("legacy-recycle.sqlite");
        let db = Database::open(&path).unwrap();
        let user = db.current_user_id().unwrap();
        let first_scope = db.workspace_context().unwrap().workspace_id;
        let first = legacy_trash(&db, &user);
        let second_scope = db.create_workspace("Other", Some("other"), Some("Asia/Shanghai"), &user).unwrap().id;
        db.switch_workspace(&second_scope, &user).unwrap();
        let second = legacy_trash(&db, &user);
        let existing = db.create_task(json!({"title":"already recycled","description":"preserved recycled content","priority":"P3","status":"todo","assigneeId":user,"isShared":false,"sharedWith":[],"subtasks":[],"tags":[]}), &user).unwrap();
        db.trash_task(&existing.id, &user, false, None).unwrap();
        let existing_meta = db.recycle_task(&existing.id).unwrap().1;
        db.switch_workspace(&first_scope, &user).unwrap();
        let context = db.workspace_context().unwrap();
        let clock = db.setting("localClock").unwrap();
        let history = |db: &Database| -> Vec<(String, String, i64)> {
            db.conn.prepare("SELECT id,payload_json,version FROM sync_operations ORDER BY id").unwrap()
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap()
                .collect::<Result<_, _>>().unwrap()
        };
        let original_history = history(&db);
        let tasks = |db: &Database| -> Vec<(String, String, i64)> {
            db.conn.prepare("SELECT id,payload_json,version FROM tasks ORDER BY id").unwrap()
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap()
                .collect::<Result<_, _>>().unwrap()
        };
        let original_tasks = tasks(&db);
        drop(db);

        let db = Database::open(&path).expect("legacy trash in inactive workspaces must not abort startup");
        assert_eq!(db.workspace_context().unwrap(), context);
        assert_eq!(db.setting("localClock").unwrap(), clock);
        assert_eq!(history(&db), original_history);
        assert_eq!(tasks(&db), original_tasks);
        let first_meta = db.recycle_task(&first.id).unwrap().1;
        assert_eq!(first_meta["deletionId"], format!("legacy-{}", first.id));
        assert_eq!(first_meta["deletedBy"], user);
        let expires = chrono::DateTime::parse_from_rfc3339(first_meta["expiresAt"].as_str().unwrap()).unwrap();
        assert!(expires.signed_duration_since(Utc::now()).num_days() >= 29);
        let recorded_date: String = db.conn.query_row("SELECT timestamp FROM sync_operations WHERE entity_id=? AND action='delete' ORDER BY version DESC LIMIT 1", params![first.id], |row| row.get(0)).unwrap();
        assert_eq!(first_meta["deletedAt"], recorded_date);
        assert!(db.conn.execute("UPDATE tasks SET deleted_at='forbidden' WHERE id=?", params![second.id]).is_err());
        db.switch_workspace(&second_scope, &user).unwrap();
        let second_meta = db.recycle_task(&second.id).unwrap().1;
        assert_eq!(second_meta["deletionId"], format!("legacy-{}", second.id));
        assert_eq!(db.recycle_task(&existing.id).unwrap().1, existing_meta);
        drop(db);

        let db = Database::open(&path).expect("reopening migrated trash must remain idempotent");
        assert_eq!(db.recycle_task(&second.id).unwrap().1, second_meta);
        db.switch_workspace(&first_scope, &user).unwrap();
        assert_eq!(db.recycle_task(&first.id).unwrap().1, first_meta);
        assert_eq!(history(&db), original_history);
    }
    #[test]
    fn task_recycle_legacy_migration_rolls_back_and_restores_workspace_after_failure() {
        let (db, user, _) = fixture();
        legacy_trash(&db, &user);
        let workspace = db.create_workspace("Other", Some("other"), Some("Asia/Shanghai"), &user).unwrap();
        db.switch_workspace(&workspace.id, &user).unwrap();
        legacy_trash(&db, &user);
        let context = db.workspace_context().unwrap();
        db.conn.execute_batch("CREATE TEMP TRIGGER reject_recycle_migration BEFORE UPDATE OF deletion_id ON tasks WHEN NEW.workspace_id=(SELECT MAX(workspace_id) FROM tasks WHERE deleted=1 AND deletion_id IS NULL) BEGIN SELECT RAISE(ABORT,'migration failure'); END;").unwrap();
        assert!(db.install_task_recycle().unwrap_err().contains("migration failure"));
        assert_eq!(db.workspace_context().unwrap(), context);
        assert_eq!(db.conn.query_row("SELECT COUNT(*) FROM tasks WHERE deleted=1 AND deletion_id IS NULL", [], |row| row.get::<_, i64>(0)).unwrap(), 2);
        db.conn.execute_batch("DROP TRIGGER reject_recycle_migration").unwrap();
        db.install_task_recycle().unwrap();
        assert_eq!(db.workspace_context().unwrap(), context);
        assert_eq!(db.conn.query_row("SELECT COUNT(*) FROM tasks WHERE deleted=1 AND deletion_id IS NULL", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
    }
    #[test]
    fn task_recycle_roundtrip_preserves_identity_content_and_comments() {
        let (db, user, task) = fixture();
        db.create_task_comment(&task.id, "kept comment", &user)
            .unwrap();
        db.trash_task(&task.id, &user, false, Some(task.version))
            .unwrap();
        assert!(!db
            .tasks(Some(&user))
            .unwrap()
            .iter()
            .any(|t| t.id == task.id));
        let detail = db.trashed_task_detail(&task.id, &user).unwrap();
        assert_eq!(detail["task"]["attachments"][0]["name"], "secret.txt");
        assert_eq!(detail["comments"].as_array().unwrap().len(), 1);
        db.restore_trashed_tasks(&selection(&db, &task.id), &user, true)
            .unwrap();
        let restored = db
            .tasks(Some(&user))
            .unwrap()
            .into_iter()
            .find(|t| t.id == task.id)
            .unwrap();
        assert_eq!(restored.identifier, task.identifier);
        assert_eq!(restored.description, task.description);
        assert_eq!(restored.attachments.len(), 1);
        assert!(restored.version > task.version);
        assert_eq!(
            db.list_trashed_tasks(&user, "", None, 1).unwrap()["total"],
            0
        );
    }
    #[test]
    fn task_recycle_default_detaches_children_without_relinking_on_restore() {
        let (db, user, parent) = fixture();
        let c = child(&db, &user, &parent);
        db.trash_task(&parent.id, &user, false, None).unwrap();
        let detached=db.tasks(None).unwrap().into_iter().find(|t|t.id==c.id).unwrap();
        assert_eq!(detached.version,db.recycle_task(&c.id).unwrap().0.version);
        assert!(db
            .tasks(None)
            .unwrap()
            .iter()
            .find(|t| t.id == c.id)
            .unwrap()
            .parent_task_id
            .is_none());
        db.restore_trashed_tasks(&selection(&db, &parent.id), &user, true)
            .unwrap();
        assert!(db
            .tasks(None)
            .unwrap()
            .iter()
            .find(|t| t.id == c.id)
            .unwrap()
            .parent_task_id
            .is_none());
        db.trash_task(&c.id,&user,false,Some(detached.version)).unwrap();
    }
    #[test]
    fn task_recycle_family_restores_atomically_with_parent_relationship() {
        let (db, user, parent) = fixture();
        let c = child(&db, &user, &parent);
        db.trash_task(&parent.id, &user, true, None).unwrap();
        let selected = json!([selection(&db, &parent.id)[0], selection(&db, &c.id)[0]]);
        assert_eq!(
            db.list_trashed_tasks(&user, "", None, 1).unwrap()["total"],
            2
        );
        db.restore_trashed_tasks(&selected, &user, true).unwrap();
        assert_eq!(
            db.tasks(None)
                .unwrap()
                .iter()
                .find(|t| t.id == c.id)
                .unwrap()
                .parent_task_id
                .as_deref(),
            Some(parent.id.as_str())
        );
    }
    #[test]
    fn task_recycle_child_restore_requires_confirmation_if_parent_missing() {
        let (db, user, parent) = fixture();
        let c = child(&db, &user, &parent);
        db.trash_task(&parent.id, &user, true, None).unwrap();
        let result = db
            .restore_trashed_tasks(&selection(&db, &c.id), &user, false)
            .unwrap();
        assert_eq!(result["needsConfirmation"], true);
        assert!(db.recycle_task(&c.id).unwrap().2);
        db.restore_trashed_tasks(&selection(&db, &c.id), &user, true)
            .unwrap();
        assert!(db
            .tasks(None)
            .unwrap()
            .iter()
            .find(|t| t.id == c.id)
            .unwrap()
            .parent_task_id
            .is_none());
    }
    #[test]
    fn task_recycle_stale_versions_and_deletion_cycles_are_rejected() {
        let (db, user, task) = fixture();
        assert!(db.trash_task(&task.id, &user, false, Some(-1)).is_err());
        assert!(!db.recycle_task(&task.id).unwrap().2);
        db.trash_task(&task.id, &user, false, None).unwrap();
        let old = selection(&db, &task.id);
        db.restore_trashed_tasks(&old, &user, true).unwrap();
        db.trash_task(&task.id, &user, false, None).unwrap();
        assert!(db.restore_trashed_tasks(&old, &user, true).is_err());
        assert!(db.purge_trashed_tasks(&old, &user).is_err());
    }
    #[test]
    fn task_recycle_purge_removes_content_history_and_blocks_replay() {
        let (db, user, task) = fixture();
        let create = db
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .find(|o| o.entity_id == task.id && o.action == "create")
            .unwrap();
        db.trash_task(&task.id, &user, false, None).unwrap();
        db.purge_trashed_tasks(&selection(&db, &task.id), &user)
            .unwrap();
        assert!(db.task_is_purged(&task.id).unwrap());
        assert!(db.trashed_task_detail(&task.id, &user).is_err());
        let logs = serde_json::to_string(&db.sync_operations(0).unwrap().0).unwrap();
        assert!(!logs.contains("recycle secret"));
        assert!(!logs.contains("preserved body"));
        assert!(!logs.contains("c2VjcmV0"));
        let mut replay = create;
        replay.id = "new-replay".into();
        replay.version = 999999;
        db.apply_operation(&replay).unwrap();
        assert!(db.task_is_purged(&task.id).unwrap());
        assert!(!db.tasks(None).unwrap().iter().any(|t| t.id == task.id));
    }
    #[test]
    fn task_recycle_expiration_blocks_restore_and_cleans_without_opening_bin() {
        let (db, user, task) = fixture();
        db.trash_task(&task.id, &user, false, None).unwrap();
        db.conn
            .execute(
                "UPDATE tasks SET expires_at='2000-01-01T00:00:00+00:00' WHERE id=?",
                params![task.id],
            )
            .unwrap();
        let sel = selection(&db, &task.id);
        assert!(db.restore_trashed_tasks(&sel, &user, true).is_err());
        db.save_local_setting(
            &format!(
                "taskRecycleLastScan:{}",
                db.workspace_context().unwrap().workspace_id
            ),
            "0",
        )
        .unwrap();
        db.tasks(None).unwrap();
        assert!(db.task_is_purged(&task.id).unwrap());
    }
    #[test]
    fn task_recycle_permissions_and_workspace_isolation() {
        let (db, user, task) = fixture();
        db.trash_task(&task.id, &user, false, None).unwrap();
        assert!(db.list_trashed_tasks("stranger", "", None, 1).is_err());
        assert!(db.trashed_task_detail(&task.id, "stranger").is_err());
        assert!(db
            .restore_trashed_tasks(&selection(&db, &task.id), "stranger", true)
            .is_err());
        let workspace = db
            .create_workspace("Other", Some("other"), Some("Asia/Shanghai"), &user)
            .unwrap();
        db.switch_workspace(&workspace.id, &user).unwrap();
        assert_eq!(
            db.list_trashed_tasks(&user, "", None, 1).unwrap()["total"],
            0
        );
    }
    #[test]
    fn task_recycle_failed_group_restore_rolls_back_every_task() {
        let (db, user, parent) = fixture();
        let c = child(&db, &user, &parent);
        db.trash_task(&parent.id, &user, true, None).unwrap();
        let selected = json!([selection(&db,&parent.id)[0],{"id":c.id,"deletionId":"wrong-cycle"}]);
        assert!(db.restore_trashed_tasks(&selected, &user, true).is_err());
        assert!(db.recycle_task(&parent.id).unwrap().2);
        assert!(db.recycle_task(&c.id).unwrap().2);
    }
    fn peer(source: &Database) -> Database {
        let target = Database::open(Path::new(":memory:")).unwrap();
        let ws = source.workspace_record().unwrap();
        let user = target.current_user_id().unwrap();
        target
            .conn
            .execute(
                "INSERT OR IGNORE INTO workspaces VALUES(?,?,?,?,?,?,?,?,?)",
                params![
                    ws.id,
                    ws.name,
                    ws.slug,
                    ws.logo,
                    ws.description,
                    ws.timezone,
                    ws.owner_id,
                    ws.created_at,
                    ws.updated_at
                ],
            )
            .unwrap();
        target.conn.execute("INSERT OR REPLACE INTO workspace_members VALUES(?,?,'member','member',?,NULL,NULL)",params![ws.id,user,Utc::now().to_rfc3339()]).unwrap();
        target.switch_workspace(&ws.id, &user).unwrap();
        for user in source.workspace_users().unwrap() {
            target.upsert_user(&user).unwrap();
            target.conn.execute("INSERT OR REPLACE INTO workspace_members VALUES(?,?,'member','member',?,NULL,NULL)",params![ws.id,user.id,Utc::now().to_rfc3339()]).unwrap();
        }
        for state in source.states(&source.current_user_id().unwrap()).unwrap() {
            target.insert_state(&state, false).unwrap();
        }
        target
    }
    #[test]
    fn task_recycle_sync_family_restore_and_duplicate_operations() {
        let (source, user, parent) = fixture();
        let c = child(&source, &user, &parent);
        let target = peer(&source);
        for op in source.sync_operations_for_user(&user).unwrap() {
            target.apply_operation(&op).unwrap();
        }
        source.trash_task(&parent.id, &user, true, None).unwrap();
        let trash = source
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .find(|o| o.action == "trash")
            .unwrap();
        assert!(target.apply_operation(&trash).unwrap());
        assert!(!target.apply_operation(&trash).unwrap());
        assert_eq!(
            target.list_trashed_tasks(&user, "", None, 1).unwrap()["total"],
            2
        );
        let selected = json!([
            selection(&source, &parent.id)[0],
            selection(&source, &c.id)[0]
        ]);
        source
            .restore_trashed_tasks(&selected, &user, true)
            .unwrap();
        let restore = source
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .find(|o| o.action == "restore")
            .unwrap();
        target.apply_operation(&restore).unwrap();
        assert_eq!(
            target
                .tasks(None)
                .unwrap()
                .iter()
                .find(|t| t.id == c.id)
                .unwrap()
                .parent_task_id
                .as_deref(),
            Some(parent.id.as_str())
        );
    }
    #[test]
    fn task_recycle_purge_sync_blocks_old_restore_and_scrubs_its_snapshot() {
        let (source, user, task) = fixture();
        let target = peer(&source);
        source.trash_task(&task.id, &user, false, None).unwrap();
        let selected = selection(&source, &task.id);
        let trash = source
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .find(|o| o.action == "trash")
            .unwrap();
        source
            .restore_trashed_tasks(&selected, &user, true)
            .unwrap();
        let restore = source
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .find(|o| o.action == "restore")
            .unwrap();
        target.apply_operation(&trash).unwrap();
        target.purge_trashed_tasks(&selected, &user).unwrap();
        let purge = target
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .find(|o| o.action == "purge")
            .unwrap();
        source.apply_operation(&purge).unwrap();
        target.apply_operation(&restore).unwrap();
        assert!(source.task_is_purged(&task.id).unwrap());
        assert!(target.task_is_purged(&task.id).unwrap());
        assert!(
            !serde_json::to_string(&target.sync_operations(0).unwrap().0)
                .unwrap()
                .contains("preserved body")
        );
    }
    #[test]
    fn task_recycle_new_peer_replays_only_purge_receipt_without_deleted_contents() {
        let (source, user, task) = fixture();
        let target = peer(&source);
        source.trash_task(&task.id, &user, false, None).unwrap();
        source
            .purge_trashed_tasks(&selection(&source, &task.id), &user)
            .unwrap();
        for op in source.sync_operations_for_user(&user).unwrap() {
            target.apply_operation(&op).unwrap();
        }
        assert!(target.task_is_purged(&task.id).unwrap());
        assert!(!target.tasks(None).unwrap().iter().any(|t| t.id == task.id));
        assert!(
            !serde_json::to_string(&target.sync_operations(0).unwrap().0)
                .unwrap()
                .contains("preserved body")
        );
    }

    #[test]
    fn task_recycle_old_cycle_purge_cannot_erase_a_new_deletion_in_either_sync_order() {
        let (source, user, task) = fixture();
        source
            .create_task_comment(&task.id, "retained across generations", &user)
            .unwrap();
        let first = peer(&source);
        let second = peer(&source);
        source.trash_task(&task.id, &user, false, None).unwrap();
        let old_selection = selection(&source, &task.id);
        let old_trash = source
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .find(|o| o.action == "trash")
            .unwrap();
        first.apply_operation(&old_trash).unwrap();
        second.apply_operation(&old_trash).unwrap();
        first.purge_trashed_tasks(&old_selection, &user).unwrap();
        let old_purge = first
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .find(|o| o.action == "purge")
            .unwrap();
        source
            .restore_trashed_tasks(&old_selection, &user, true)
            .unwrap();
        source.trash_task(&task.id, &user, false, None).unwrap();
        let new_selection = selection(&source, &task.id);
        let new_trash = source
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .filter(|o| o.action == "trash")
            .max_by_key(|o| o.version)
            .unwrap();
        first.apply_operation(&new_trash).unwrap();
        second.apply_operation(&new_trash).unwrap();
        second.apply_operation(&old_purge).unwrap();
        source.apply_operation(&old_purge).unwrap();
        for db in [&source, &first, &second] {
            assert!(!db.task_is_purged(&task.id).unwrap());
            assert_eq!(selection(db, &task.id), new_selection);
            assert_eq!(
                db.trashed_task_detail(&task.id, &user).unwrap()["comments"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
            assert_eq!(
                db.trashed_task_detail(&task.id, &user).unwrap()["task"]["description"],
                "preserved body"
            );
            db.restore_trashed_tasks(&new_selection, &user, true)
                .unwrap();
            assert!(db.tasks(None).unwrap().iter().any(|t| t.id == task.id));
        }
    }

    #[test]
    fn task_recycle_concurrent_deletions_choose_the_same_generation() {
        let (source, user, task) = fixture();
        let target = peer(&source);
        for op in source.sync_operations_for_user(&user).unwrap() {
            target.apply_operation(&op).unwrap();
        }
        source.trash_task(&task.id, &user, false, None).unwrap();
        target.trash_task(&task.id, &user, false, None).unwrap();
        let a = source
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .find(|o| o.action == "trash")
            .unwrap();
        let b = target
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .find(|o| o.action == "trash")
            .unwrap();
        source.apply_operation(&b).unwrap();
        target.apply_operation(&a).unwrap();
        assert_eq!(selection(&source, &task.id), selection(&target, &task.id));
    }

    #[test]
    fn task_recycle_legacy_attachments_are_migrated_atomically() {
        let (db, user, task) = fixture();
        db.update_task(&task.id, json!({"attachments":[]}), &user)
            .unwrap();
        let cached = json!({task.id.clone():task.attachments});
        db.trash_task_with_attachments(&task.id, &user, false, None, Some(&cached))
            .unwrap();
        assert_eq!(
            db.trashed_task_detail(&task.id, &user).unwrap()["task"]["attachments"][0]["id"],
            "file"
        );
        db.restore_trashed_tasks(&selection(&db, &task.id), &user, true)
            .unwrap();
        assert_eq!(db.tasks(None).unwrap()[0].attachments.len(), 1);
    }

    #[test]
    fn task_recycle_project_archive_permissions_and_departed_assignee() {
        let (db, user, task) = fixture();
        let other_db = Database::open(Path::new(":memory:")).unwrap();
        let mut other = other_db.users().unwrap().into_iter().next().unwrap();
        other.id = "recycle-member@test-device".into();
        db.upsert_user(&other).unwrap();
        db.conn
            .execute(
                "INSERT INTO workspace_members VALUES(?,?,'member','member',?,NULL,NULL)",
                params![
                    db.workspace_context().unwrap().workspace_id,
                    other.id,
                    Utc::now().to_rfc3339()
                ],
            )
            .unwrap();
        let project = db
            .create_project(
                json!({"name":"recycle project","members":[other.id]}),
                &user,
            )
            .unwrap();
        db.update_task(
            &task.id,
            json!({"projectId":project.id,"assigneeId":other.id}),
            &user,
        )
        .unwrap();
        db.trash_task(&task.id, &user, false, None).unwrap();
        let selected = selection(&db, &task.id);
        assert!(db.purge_trashed_tasks(&selected, &other.id).is_err());
        db.update_project(&project.id, json!({"isArchived":true}), &user)
            .unwrap();
        assert_eq!(
            db.list_trashed_tasks(&user, "", None, 1).unwrap()["items"][0]["canRestore"],
            false
        );
        assert!(db.restore_trashed_tasks(&selected, &user, true).is_err());
        db.update_project(
            &project.id,
            json!({"isArchived":false,"members":[user]}),
            &user,
        )
        .unwrap();
        assert_eq!(
            db.list_trashed_tasks(&other.id, "", None, 1).unwrap()["total"],
            0
        );
        let result = db.restore_trashed_tasks(&selected, &user, false).unwrap();
        assert_eq!(result["needsConfirmation"], true);
        assert!(result["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["kind"] == "assignee"));
        db.restore_trashed_tasks(&selected, &user, true).unwrap();
        assert!(db
            .tasks(None)
            .unwrap()
            .iter()
            .find(|t| t.id == task.id)
            .unwrap()
            .assignee_id
            .is_empty());
    }

    #[test]
    fn task_recycle_purged_comments_cannot_return_from_a_delayed_peer() {
        let (db, user, task) = fixture();
        db.create_task_comment(&task.id, "comment secret", &user)
            .unwrap();
        let mut comment = db
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .find(|o| o.entity_type == "task_comment")
            .unwrap();
        db.trash_task(&task.id, &user, false, None).unwrap();
        db.purge_trashed_tasks(&selection(&db, &task.id), &user)
            .unwrap();
        comment.id = "delayed-comment".into();
        comment.version += 100;
        assert!(db.apply_operation(&comment).unwrap());
        assert!(!db.apply_operation(&comment).unwrap());
        assert!(!serde_json::to_string(&db.sync_operations(0).unwrap().0)
            .unwrap()
            .contains("comment secret"));
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT COUNT(*) FROM task_comments WHERE task_id=?",
                    params![task.id],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }
}
