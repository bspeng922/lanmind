use super::*;
use serde_json::json;
use std::path::Path;

fn task(title: &str, user: &str) -> serde_json::Value {
    json!({"title":title,"description":"","priority":"P2","status":"todo","dueDate":null,"recurrence":null,"reminderTime":null,"assigneeId":user,"projectId":null,"isShared":false,"sharedWith":[],"subtasks":[],"tags":[]})
}
fn database() -> Database {
    Database::open(Path::new(":memory:")).unwrap()
}

#[test]
fn workspace_boundaries_cover_known_ids_relationships_logs_and_private_modules() {
    let db = database();
    let user = db.current_user_id().unwrap();
    let a = db.workspace_context().unwrap();
    let secret_a = db.workspace_token().unwrap();
    let project = db
        .create_project(
            json!({"name":"Same name","description":"","color":"#123456"}),
            &user,
        )
        .unwrap();
    let work = db
        .create_task(task("A private task", &user), &user)
        .unwrap();
    let comment = db
        .create_task_comment(&work.id, "A comment", &user)
        .unwrap();
    let states_a = db.states(&user).unwrap();
    db.save_chat_message(json!({"senderId":user,"senderName":"Me","receiverId":null,"groupId":null,"type":"text","content":"A chat","fileUrl":null,"fileName":null,"fileSize":null})).unwrap();
    db.save_private_data("wiki",&json!({"documents":[{"id":"page-a","workspaceId":a.workspace_id,"title":"A wiki","content":"secret","projectId":null,"parentId":null,"favorite":true}],"selectedId":"page-a","expandedIds":[]})).unwrap();
    db.save_private_data("ai",&json!({"index":{"conversations":[{"id":"conversation-a","title":"A AI"}]},"messages":{"conversation-a":[{"id":"message-a","role":"user","content":"secret"}]}})).unwrap();
    let b = db.create_workspace("Same name", None, None, &user).unwrap();
    db.switch_workspace(&b.id, &user).unwrap();
    assert_ne!(db.workspace_token().unwrap(), secret_a);
    assert!(db.tasks(None).unwrap().is_empty());
    assert!(db.projects(None).unwrap().is_empty());
    assert!(db.task_comments(&work.id, &user).is_err());
    assert!(db
        .update_task(&work.id, json!({"title":"forged"}), &user)
        .is_err());
    assert!(!db.delete_task(&work.id, &user).unwrap_or(false));
    assert!(db.project_files(&project.id).is_err());
    assert!(db.read_private_data("wiki").unwrap().is_none());
    assert!(db.read_private_data("ai").unwrap().is_none());
    assert!(db.chat_messages(&user, None).unwrap().is_empty());
    assert!(db.local_directory().unwrap().units.is_empty());
    assert!(db.sync_operations(0).unwrap().0.is_empty());
    let states_b = db.states(&user).unwrap();
    assert!(states_b
        .iter()
        .all(|state| states_a.iter().all(|old| old.id != state.id)));
    for patch in [
        json!({"projectId":project.id}),
        json!({"parentTaskId":work.id}),
        json!({"stateId":states_a[0].id}),
        json!({"workspaceId":a.workspace_id}),
    ] {
        let mut input = task("invalid reference", &user);
        input
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        assert!(db.create_task(input, &user).is_err());
    }
    assert!(db.tasks(None).unwrap().is_empty());
    assert!(db.state_by_id(&states_a[0].id).unwrap().is_none());
    assert!(db.validate_workspace_context(&a).is_err());
    db.switch_workspace(&a.workspace_id, &user).unwrap();
    assert!(db.validate_workspace_context(&a).is_err()); // ABA switch also invalidates requests.
    assert_eq!(db.workspace_token().unwrap(), secret_a);
    assert_eq!(db.tasks(None).unwrap()[0].title, "A private task");
    assert_eq!(db.task_comments(&work.id, &user).unwrap()[0].id, comment.id);
    assert_eq!(
        db.read_private_data("wiki").unwrap().unwrap()["documents"][0]["favorite"],
        true
    );
    assert_eq!(
        db.read_private_data("ai").unwrap().unwrap()["messages"]["conversation-a"][0]["content"],
        "secret"
    );
}

#[test]
fn foreign_operations_and_id_collision_are_rejected_without_partial_writes() {
    let db = database();
    let user = db.current_user_id().unwrap();
    let a = db.workspace_context().unwrap();
    let original = db.create_task(task("A", &user), &user).unwrap();
    let operation = db
        .sync_operations(0)
        .unwrap()
        .0
        .into_iter()
        .find(|op| op.entity_type == "task")
        .unwrap();
    let b = db.create_workspace("B", None, None, &user).unwrap();
    db.switch_workspace(&b.id, &user).unwrap();
    assert!(db.apply_operation(&operation).is_err());
    let mut forged = operation.clone();
    forged.workspace_id = Some(b.id.clone());
    assert!(db.apply_operation(&forged).is_err()); // Payload still belongs to A.
    forged.payload["workspaceId"] = b.id.clone().into();
    assert!(db.apply_operation(&forged).is_err()); // The globally known ID cannot overwrite A.
    assert!(db.sync_operations(0).unwrap().0.is_empty());
    db.switch_workspace(&a.workspace_id, &user).unwrap();
    assert_eq!(db.tasks(None).unwrap()[0].id, original.id);
}

#[test]
fn cross_workspace_import_copies_ids_and_preserves_parent_relationships() {
    let db = database();
    let user = db.current_user_id().unwrap();
    let parent = db.create_task(task("Parent", &user), &user).unwrap();
    let mut input = task("Child", &user);
    input["parentTaskId"] = parent.id.clone().into();
    let child = db.create_task(input, &user).unwrap();
    let archive = db.task_archive(&user).unwrap();
    let b = db.create_workspace("B", None, None, &user).unwrap();
    db.switch_workspace(&b.id, &user).unwrap();
    assert_eq!(
        db.import_task_archive(archive, &user)
            .unwrap()
            .imported_count,
        2
    );
    let tasks = db.tasks(None).unwrap();
    assert!(tasks.iter().all(|t| t.id != parent.id
        && t.id != child.id
        && t.workspace_id.as_deref() == Some(&b.id)));
    let copied_parent = tasks.iter().find(|t| t.title == "Parent").unwrap();
    assert_eq!(
        tasks
            .iter()
            .find(|t| t.title == "Child")
            .unwrap()
            .parent_task_id
            .as_deref(),
        Some(copied_parent.id.as_str())
    );
}

#[test]
fn user_data_is_private_and_wiki_favorites_are_not_shared() {
    let db = database();
    let original = db.current_user_id().unwrap();
    let ws = db.workspace_context().unwrap().workspace_id;
    db.save_private_data("wiki",&json!({"documents":[{"id":"shared-page","title":"Shared","parentId":null,"projectId":null,"favorite":true}],"selectedId":"shared-page","expandedIds":[]})).unwrap();
    db.save_private_data(
        "ai",
        &json!({"index":{"conversations":[{"id":"private-conversation"}]},"messages":{}}),
    )
    .unwrap();
    db.conn.execute("INSERT INTO workspace_members VALUES(?,'another-user','member','member','2026-01-01',NULL,NULL)",params![ws]).unwrap();
    db.set_current_user("another-user").unwrap();
    let wiki = db.read_private_data("wiki").unwrap().unwrap();
    assert_eq!(wiki["documents"][0]["title"], "Shared");
    assert_eq!(wiki["documents"][0]["favorite"], false);
    assert!(db.read_private_data("ai").unwrap().is_none());
    db.set_current_user(&original).unwrap();
}

#[test]
fn configuration_templates_and_local_removal_do_not_cross_workspaces() {
    let db = database();
    let user = db.current_user_id().unwrap();
    let a = db.workspace_context().unwrap();
    db.save_llm_config(json!({"apiKey":"A-secret","modelName":"A-model"}))
        .unwrap();
    db.add_template(json!({"id":"custom-a","name":"A template"}))
        .unwrap();
    assert!(db.add_template(json!({"id":"tpl-business"})).is_err());
    let b = db.create_workspace("B", None, None, &user).unwrap();
    db.switch_workspace(&b.id, &user).unwrap();
    assert_ne!(db.llm_config().unwrap().api_key, "A-secret");
    assert!(!db
        .templates()
        .unwrap()
        .iter()
        .any(|t| t["id"] == "custom-a"));
    let task_b = db.create_task(task("B survives", &user), &user).unwrap();
    db.conn.execute("INSERT INTO workspace_join_requests(id,workspace_id,workspace_name,user_id,user_name,status,requested_at) VALUES('old-request',?,'A',?,'Me','pending','2026-01-01')",params![a.workspace_id,user]).unwrap();
    assert!(db
        .workspace_join_request_user("old-request")
        .unwrap()
        .is_none());
    db.delete_workspace(&a.workspace_id, &user).unwrap();
    assert_eq!(
        db.conn
            .query_row(
                "SELECT COUNT(*) FROM workspace_join_requests WHERE workspace_id=?",
                params![a.workspace_id],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(db.tasks(None).unwrap()[0].id, task_b.id);
    assert!(!db
        .sync_operations(0)
        .unwrap()
        .0
        .iter()
        .any(|op| op.entity_type == "workspace" && op.action == "delete"));
}

#[test]
fn private_chat_and_audit_payloads_are_hidden_from_other_workspace_members() {
    let db = database();
    let me = db.current_user_id().unwrap();
    let mut other = db.users().unwrap()[0].clone();
    other.id = "other-member".into();
    db.upsert_user(&other).unwrap();
    db.request_workspace_membership(&other.id, None).unwrap();
    let mut third = other.clone();
    third.id = "third-member".into();
    db.upsert_user(&third).unwrap();
    db.request_workspace_membership(&third.id, None).unwrap();
    let private = db
        .create_task(task("Other user's private task", &other.id), &other.id)
        .unwrap();
    db.save_chat_message(json!({"senderId":other.id,"senderName":"Other","receiverId":third.id,"groupId":null,"type":"file","content":"Private","fileUrl":"zhiyu-file://node/private-transfer","fileName":"secret.txt","fileSize":"1 KB"})).unwrap();
    assert!(db.chat_messages(&me, None).unwrap().is_empty());
    assert!(!db.can_read_chat_file("private-transfer", &me).unwrap());
    assert!(db
        .can_read_chat_file("private-transfer", &third.id)
        .unwrap());
    let audit = db.audit_operations_for_user(&me).unwrap();
    assert!(!audit
        .iter()
        .any(|op| op.entity_id == private.id || op.entity_type == "chat_message"));
    let page = db.sync_logs_page_for_user(1, 20, None, &me).unwrap();
    assert_eq!(page.records.total as usize, audit.len());
    assert!(!page
        .records
        .items
        .iter()
        .any(|op| op.entity_id == private.id));
    // Every newer operation remains reachable once the history exceeds 5,000.
    for n in 0..5001 {
        db.log_operation(
            "task",
            &private.id,
            "update",
            json!({"title":n}),
            &other.id,
            None,
        )
        .unwrap();
    }
    db.log_operation(
        "user_profile",
        &me,
        "update",
        json!({"id":me,"nickname":"Latest"}),
        &me,
        None,
    )
    .unwrap();
    assert!(db
        .audit_operations_for_user(&me)
        .unwrap()
        .iter()
        .any(|op| op.payload["nickname"] == "Latest"));
}

#[test]
fn legacy_multi_workspace_migration_preserves_ownership_history_backup_and_quarantine() {
    use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
    let root = std::env::temp_dir().join(format!(
        "lanmind-workspace-migration-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let source_path = root.join("source.sqlite");
    let source = Database::open(&source_path).unwrap();
    let user = source.current_user_id().unwrap();
    let a = source.workspace_context().unwrap().workspace_id;
    let project_a = source
        .create_project(
            json!({"name":"A","description":"","color":"#123456"}),
            &user,
        )
        .unwrap();
    let task_a = source
        .create_task(task("A personal", &user), &user)
        .unwrap();
    source
        .create_task_comment(&task_a.id, "Comment retained", &user)
        .unwrap();
    source.save_chat_message(json!({"senderId":user,"senderName":"Me","receiverId":null,"groupId":null,"type":"text","content":"Unknown legacy origin"})).unwrap();
    let b = source.create_workspace("B", None, None, &user).unwrap();
    source.switch_workspace(&b.id, &user).unwrap();
    let project_b = source
        .create_project(
            json!({"name":"B","description":"","color":"#654321"}),
            &user,
        )
        .unwrap();
    let mut input = task("B project task", &user);
    input["projectId"] = project_b.id.clone().into();
    let task_b = source.create_task(input, &user).unwrap();
    let token_b = source.workspace_token().unwrap();
    let legacy_path = root.join("legacy.sqlite");
    std::fs::copy(
        format!("{}.workspace-v2.bak", source_path.display()),
        &legacy_path,
    )
    .unwrap();
    let legacy = Connection::open(&legacy_path).unwrap();
    // v1 added explicit project ownership before task ownership existed.
    legacy
        .execute_batch("ALTER TABLE projects ADD COLUMN workspace_id TEXT;")
        .unwrap();
    // Copy only columns present in the old schema, removing new payload metadata.
    for table in [
        "users",
        "workspaces",
        "workspace_members",
        "projects",
        "tasks",
        "task_comments",
        "chat_messages",
        "sync_operations",
    ] {
        let cols: Vec<String> = legacy
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap()
            .query_map([], |r| r.get(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let names = cols.join(",");
        let mut stmt = source
            .conn
            .prepare(&format!("SELECT {names} FROM {table}"))
            .unwrap();
        let rows = stmt
            .query_map([], |r| {
                (0..cols.len())
                    .map(|i| r.get::<_, SqlValue>(i))
                    .collect::<Result<Vec<_>, _>>()
            })
            .unwrap();
        for row in rows {
            let mut row = row.unwrap();
            if let Some(index) = cols.iter().position(|c| c == "payload_json") {
                if let SqlValue::Text(raw) = &row[index] {
                    let mut value: serde_json::Value = serde_json::from_str(raw).unwrap();
                    if let Some(map) = value.as_object_mut() {
                        map.remove("workspaceId");
                    }
                    row[index] = SqlValue::Text(value.to_string());
                }
            }
            legacy
                .execute(
                    &format!(
                        "INSERT OR REPLACE INTO {table}({names}) VALUES({})",
                        vec!["?"; cols.len()].join(",")
                    ),
                    params_from_iter(row),
                )
                .unwrap();
        }
    }
    legacy
        .execute(
            "UPDATE settings SET value=? WHERE key='workspaceId'",
            params![a],
        )
        .unwrap();
    legacy.execute("INSERT INTO task_comments(id,task_id,payload_json,author_id,created_at,updated_at,deleted) VALUES('orphan','missing-task','{}',?,'2026-01-01','2026-01-01',0)", params![user]).unwrap();
    let history: Vec<(String, String)> = legacy
        .prepare("SELECT id,payload_json FROM sync_operations ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    drop(legacy);
    let migrated = Database::open(&legacy_path).unwrap();
    assert_eq!(migrated.tasks(None).unwrap()[0].id, task_a.id);
    assert_eq!(migrated.projects(None).unwrap()[0].id, project_a.id);
    let counts: serde_json::Value = serde_json::from_str(
        &migrated
            .setting("workspaceMigrationQuarantine")
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(counts["chat_messages"], 1);
    assert_eq!(
        migrated
            .conn
            .query_row(
                "SELECT COUNT(*) FROM workspace_quarantine WHERE source_table='task_comments'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    let actual: Vec<(String, String)> = migrated
        .conn
        .prepare("SELECT id,payload_json FROM sync_operations ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(actual, history);
    migrated.switch_workspace(&b.id, &user).unwrap();
    let tasks = migrated.tasks(None).unwrap();
    assert_eq!(tasks[0].id, task_b.id);
    assert_eq!(tasks[0].workspace_id.as_deref(), Some(b.id.as_str()));
    assert!(migrated
        .state_by_id(tasks[0].state_id.as_deref().unwrap())
        .unwrap()
        .is_some());
    let migrated_token_b = migrated.workspace_token().unwrap();
    assert!(!migrated_token_b.is_empty());
    assert_ne!(migrated_token_b, token_b); // Old formats had no token registered for B.
    let backup_path = format!("{}.workspace-v2.bak", legacy_path.display());
    let backup = std::fs::read(&backup_path).unwrap();
    drop(migrated);
    let reopened = Database::open(&legacy_path).unwrap();
    assert_eq!(reopened.workspace_token().unwrap(), migrated_token_b);
    assert_eq!(reopened.tasks(None).unwrap()[0].id, task_b.id);
    assert_eq!(std::fs::read(backup_path).unwrap(), backup);
    assert_eq!(
        reopened
            .conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        0
    );
    drop(reopened);
    drop(source);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn reopening_early_workspace_database_backfills_missing_payload_metadata() {
    let root =
        std::env::temp_dir().join(format!("lanmind-workspace-reopen-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("database.sqlite");
    let db = Database::open(&path).unwrap();
    let user = db.current_user_id().unwrap();
    let a = db.workspace_context().unwrap();
    let project = db
        .create_project(
            json!({"name":"A","description":"","color":"#123456"}),
            &user,
        )
        .unwrap();
    let mut input = task("A project task", &user);
    input["projectId"] = project.id.clone().into();
    let work_a = db.create_task(input, &user).unwrap();
    let comment = db
        .create_task_comment(&work_a.id, "Keep comment", &user)
        .unwrap();
    db.save_chat_message(json!({"senderId":user,"senderName":"Me","receiverId":null,"groupId":null,"type":"text","content":"Keep chat"})).unwrap();
    let b = db.create_workspace("B", None, None, &user).unwrap();
    db.switch_workspace(&b.id, &user).unwrap();
    let work_b = db
        .create_task(task("B personal task", &user), &user)
        .unwrap();
    let before = db.workspace_context().unwrap();
    let history: Vec<(String, String)> = db
        .conn
        .prepare("SELECT id,payload_json FROM sync_operations ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    // Early v2 builds had scoped columns and the migration flag, but left
    // historical payloads unstamped. Later state migrations touch these rows.
    db.conn.execute_batch("DROP TRIGGER tasks_json_UPDATE_scope; DELETE FROM settings WHERE key IN ('workspaceStateIdsV2','workspacePayloadMetadataV2');").unwrap();
    for ws in [&a.workspace_id, &b.id] {
        *db.active_workspace.write().unwrap() = ws.clone();
        for table in [
            "tasks",
            "task_comments",
            "task_assignment_notifications",
            "chat_messages",
            "chat_groups",
            "group_announcements",
        ] {
            db.conn.execute(&format!("UPDATE {table} SET payload_json=json_remove(payload_json,'$.workspaceId') WHERE workspace_id=?"), params![ws]).unwrap();
        }
    }
    *db.active_workspace.write().unwrap() = a.workspace_id.clone();
    db.conn
        .execute(
            "UPDATE tasks SET state_id=NULL WHERE id=?",
            params![work_a.id],
        )
        .unwrap();
    *db.active_workspace.write().unwrap() = before.workspace_id.clone();
    db.install_workspace_relations().unwrap();
    drop(db);

    for _ in 0..2 {
        let reopened = Database::open(&path).unwrap();
        assert_eq!(reopened.workspace_context().unwrap(), before);
        assert_eq!(reopened.tasks(None).unwrap()[0].id, work_b.id);
        for table in [
            "tasks",
            "task_comments",
            "task_assignment_notifications",
            "chat_messages",
            "chat_groups",
            "group_announcements",
        ] {
            assert_eq!(reopened.conn.query_row(&format!("SELECT COUNT(*) FROM {table} WHERE json_extract(payload_json,'$.workspaceId') IS NOT workspace_id"), [], |r| r.get::<_,i64>(0)).unwrap(), 0);
        }
        let actual: Vec<(String, String)> = reopened
            .conn
            .prepare("SELECT id,payload_json FROM sync_operations ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(actual, history);
        // The payload guard is still enforced after compatibility backfill.
        assert!(reopened.conn.execute("UPDATE tasks SET payload_json=json_remove(payload_json,'$.workspaceId') WHERE id=?", params![work_b.id]).is_err());
    }
    let reopened = Database::open(&path).unwrap();
    reopened.switch_workspace(&a.workspace_id, &user).unwrap();
    assert_eq!(reopened.tasks(None).unwrap()[0].id, work_a.id);
    assert_eq!(
        reopened.task_comments(&work_a.id, &user).unwrap()[0].id,
        comment.id
    );
    assert_eq!(
        reopened.chat_messages(&user, None).unwrap()[0].content,
        "Keep chat"
    );
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn external_authorization_survives_restart_and_mcp_reauthorization_rotates_the_token() {
    let root = std::env::temp_dir().join(format!("lanmind-auth-restart-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("database.sqlite");
    let db = Database::open(&path).unwrap();
    let a = db.workspace_context().unwrap();
    let token_a = db.save_mcp_config(true, 45992).unwrap().token;
    let b = db.create_workspace("B", None, None, &a.user_id).unwrap();
    db.switch_workspace(&b.id, &a.user_id).unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    assert_eq!(db.external_authorization("mcp").unwrap(), a);
    assert_eq!(db.external_authorization("web").unwrap(), a);
    assert!(db
        .validate_workspace_context(&db.external_authorization("mcp").unwrap())
        .is_err());
    assert_eq!(db.mcp_config().unwrap().token, token_a);
    let rebound = db.save_mcp_config(true, 45992).unwrap();
    assert_ne!(rebound.token, token_a);
    assert_eq!(
        db.external_authorization("mcp").unwrap(),
        db.workspace_context().unwrap()
    );
    assert_eq!(db.external_authorization("web").unwrap(), a);
    db.save_web_config(&db.web_config().unwrap()).unwrap();
    assert_eq!(
        db.external_authorization("web").unwrap(),
        db.workspace_context().unwrap()
    );
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn wiki_parent_permissions_and_cycles_are_enforced_in_the_database() {
    let db = database();
    let user = db.current_user_id().unwrap();
    let project = db
        .create_project(
            json!({"name":"Private","description":"","color":"#123456"}),
            &user,
        )
        .unwrap();
    db.save_private_data(
        "wiki",
        &json!({"documents":[
            {"id":"parent","title":"Restricted","parentId":null,"projectId":project.id},
            {"id":"child","title":"Inherits access","parentId":"parent","projectId":null}
        ]}),
    )
    .unwrap();
    let ws = db.workspace_context().unwrap().workspace_id;
    db.conn.execute("INSERT INTO workspace_members VALUES(?,'other','member','member','2026-01-01',NULL,NULL)", params![ws]).unwrap();
    db.set_current_user("other").unwrap();
    assert!(db.read_private_data("wiki").unwrap().is_none());
    assert!(!db
        .sync_operations_for_user("other")
        .unwrap()
        .iter()
        .any(|op| op.entity_type == "wiki_document"));
    assert!(db.save_private_data("wiki", &json!({"documents":[{"id":"child","title":"Hijacked","parentId":null,"projectId":null}]})).is_err());
    db.set_current_user(&user).unwrap();
    assert!(db
        .save_private_data(
            "wiki",
            &json!({"documents":[
                {"id":"parent","title":"Restricted","parentId":"child","projectId":project.id},
                {"id":"child","title":"Cycle","parentId":"parent","projectId":null}
            ]})
        )
        .is_err());
    assert_eq!(
        db.read_private_data("wiki").unwrap().unwrap()["documents"][1]["title"],
        "Inherits access"
    );
}
