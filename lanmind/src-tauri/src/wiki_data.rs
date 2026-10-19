//! Incremental Wiki writes shared by the editor, Agent and MCP.
use crate::db::Database;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

impl Database {
    pub(crate) fn wiki_pages(&self, user: &str) -> Result<Vec<Value>, String> {
        let ws = self.workspace_context()?.workspace_id;
        let mut stmt = self.conn.prepare("SELECT payload_json,version FROM wiki_documents WHERE workspace_id=? AND deleted=0 ORDER BY rowid").map_err(|e|e.to_string())?;
        let rows = stmt
            .query_map(params![ws], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut pages = Vec::new();
        for row in rows {
            let (raw, version) = row.map_err(|e| e.to_string())?;
            let mut p: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            if p["id"]
                .as_str()
                .is_some_and(|id| self.require_wiki_read(id, user).is_ok())
            {
                p["version"] = json!(version);
                pages.push(p);
            }
        }
        Ok(pages)
    }
    pub(crate) fn wiki_page(&self, id: &str, user: &str) -> Result<Value, String> {
        self.require_wiki_read(id, user)?;
        let ws = self.workspace_context()?.workspace_id;
        let (raw,version):(String,i64)=self.conn.query_row("SELECT payload_json,version FROM wiki_documents WHERE workspace_id=? AND id=? AND deleted=0",params![ws,id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|"文档不存在或无权读取".to_string())?;
        let mut page: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        page["version"] = json!(version);
        Ok(page)
    }
    pub(crate) fn write_wiki_page(
        &self,
        document: &Value,
        expected: Option<i64>,
        user: &str,
    ) -> Result<Value, String> {
        let ws = self.workspace_context()?.workspace_id;
        let id = document["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("文档 ID 无效")?;
        let previous:Option<(String,i64,i64)>=self.conn.query_row("SELECT payload_json,version,deleted FROM wiki_documents WHERE workspace_id=? AND id=?",params![ws,id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e|e.to_string())?;
        if document["workspaceId"].as_str().is_some_and(|id| id != ws) {
            return Err("文档工作区不一致".into());
        }
        match (&previous, expected) {
            (None, None) => {}
            (Some((_, v, 0)), Some(e)) if *v == e => {
                self.require_wiki_read(id, user)?;
            }
            _ => {
                return Err("VERSION_CONFLICT: 文档已更新或删除，请重新读取；本地草稿已保留".into())
            }
        }
        let mut p = serde_json::Map::new();
        for field in [
            "id",
            "title",
            "content",
            "parentId",
            "projectId",
            "sortOrder",
            "isLocked",
            "icon",
            "tags",
        ] {
            if let Some(value) = document.get(field) {
                p.insert(field.into(), value.clone());
            }
        }
        let mut p = Value::Object(p);
        p["title"] = json!(p["title"].as_str().unwrap_or("").trim());
        p["content"] = json!(p["content"].as_str().unwrap_or(""));
        let mut tags = Vec::new();
        if let Some(values) = p["tags"].as_array() {
            for value in values {
                if let Some(tag) = value.as_str().map(str::trim).filter(|tag| !tag.is_empty()) {
                    if !tags.iter().any(|existing| existing == tag) {
                        tags.push(tag.to_owned());
                    }
                }
            }
        }
        p["tags"] = json!(tags);
        if p["title"].as_str().unwrap().chars().count() > 500
            || p["content"].as_str().unwrap().chars().count() > 500_000
        {
            return Err("Wiki 标题最多 500 字符，正文最多 500000 字符".into());
        }
        if let Some(project) = p["projectId"].as_str() {
            self.require_project_read(project, user)?;
        }
        let mut cursor = p["parentId"].as_str().map(str::to_owned);
        let mut seen = std::collections::HashSet::from([id.to_owned()]);
        while let Some(parent) = cursor {
            if !seen.insert(parent.clone()) {
                return Err("文档父级关系存在循环".into());
            }
            let parent = self.wiki_page(&parent, user)?;
            cursor = parent["parentId"].as_str().map(str::to_owned);
        }
        let old = previous
            .as_ref()
            .map(|(raw, _, _)| serde_json::from_str::<Value>(raw).map_err(|e| e.to_string()))
            .transpose()?;
        if old.as_ref().is_some_and(|o| {
            o["isLocked"] == true && (o["title"] != p["title"] || o["content"] != p["content"])
        }) {
            return Err("文档已锁定，请先解锁".into());
        }
        let now = Utc::now().to_rfc3339();
        p["workspaceId"] = json!(ws);
        p["createdAt"] = old
            .as_ref()
            .and_then(|o| o.get("createdAt"))
            .cloned()
            .unwrap_or(json!(now));
        p["updatedAt"] = json!(now);
        p["favorite"] = json!(false);
        self.log_operation(
            "wiki_document",
            id,
            if old.is_some() { "update" } else { "create" },
            p.clone(),
            user,
            p["projectId"].as_str(),
        )?;
        let version = self
            .setting("localClock")?
            .unwrap_or_default()
            .parse::<i64>()
            .map_err(|e| e.to_string())?;
        self.conn.execute("INSERT INTO wiki_documents(workspace_id,id,project_id,payload_json,deleted,version) VALUES(?,?,?,?,0,?) ON CONFLICT(workspace_id,id) DO UPDATE SET project_id=excluded.project_id,payload_json=excluded.payload_json,deleted=0,version=excluded.version",params![ws,id,p["projectId"].as_str(),p.to_string(),version]).map_err(|e|e.to_string())?;
        p["version"] = json!(version);
        Ok(p)
    }
    pub(crate) fn save_wiki_changes(&self, payload: &Value, user: &str) -> Result<Value, String> {
        self.workspace_transaction("wiki_changes",||{
            let mut pages=Vec::new();
            let mut pending=payload["changes"].as_array().cloned().ok_or("缺少 changes")?;
            while !pending.is_empty() {
                let index=pending.iter().position(|change| {
                    let parent=change["document"]["parentId"].as_str();
                    !pending.iter().any(|other|other["document"]["id"].as_str()==parent&&parent.is_some())
                }).ok_or("文档父级关系存在循环")?;
                let change=pending.remove(index);
                let expected=change["expectedVersion"].as_i64();
                pages.push(self.write_wiki_page(&change["document"],expected,user)?);
            }
            let all_pages=self.wiki_pages(user)?;
            let mut deletions=payload["deletions"].as_array().cloned().unwrap_or_default();
            deletions.sort_by_key(|d| {
                let mut depth=0;let mut cursor=d["id"].as_str();
                while let Some(id)=cursor {depth+=1;cursor=all_pages.iter().find(|p|p["id"].as_str()==Some(id)).and_then(|p|p["parentId"].as_str());if depth>all_pages.len(){break;}}
                std::cmp::Reverse(depth)
            });
            for deletion in &deletions {
                let id=deletion["id"].as_str().ok_or("文档 ID 无效")?;let p=self.wiki_page(id,user)?;
                if p["version"].as_i64()!=deletion["expectedVersion"].as_i64(){return Err("VERSION_CONFLICT: 文档已更新，不能删除".into());}
                let children: i64=self.conn.query_row("SELECT COUNT(*) FROM wiki_documents WHERE workspace_id=active_workspace_id() AND deleted=0 AND json_extract(payload_json,'$.parentId')=?",[id],|r|r.get(0)).map_err(|e|e.to_string())?;
                if children>0 {return Err("请同时删除或移动子页面".into());}
                self.log_operation("wiki_document",id,"delete",json!({"id":id,"workspaceId":self.workspace_context()?.workspace_id}),user,p["projectId"].as_str())?;
                let version=self.setting("localClock")?.unwrap_or_default().parse::<i64>().map_err(|e|e.to_string())?;
                self.conn.execute("UPDATE wiki_documents SET deleted=1,version=? WHERE workspace_id=active_workspace_id() AND id=?",params![version,id]).map_err(|e|e.to_string())?;
            }
            if let Some(view)=payload.get("view"){self.save_private_data("wikiView",view)?;}
            Ok(json!({"documents":pages}))
        })
    }
}
