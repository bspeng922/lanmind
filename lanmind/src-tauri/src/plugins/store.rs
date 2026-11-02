use super::package::*;
use crate::{db::Database, workspace_scope::WorkspaceContext};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    #[serde(default)]
    pub previous_sha256: Option<String>,
    pub plugin_key: String,
    pub publisher_id: String,
    pub manifest: Manifest,
    pub metadata: SignedMetadata,
    pub sha256: String,
    pub size_bytes: u64,
    pub enabled: bool,
    pub shared: bool,
    pub available: bool,
    pub installed_at: String,
}
impl Database {
    pub(crate) fn initialize_plugins(&self) -> Result<()> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS plugin_installs(plugin_key TEXT PRIMARY KEY,record_json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS plugin_grants(plugin_key TEXT NOT NULL,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,capability TEXT NOT NULL,PRIMARY KEY(plugin_key,workspace_id,user_id,capability));
            CREATE TABLE IF NOT EXISTS plugin_storage(plugin_key TEXT NOT NULL,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,key TEXT NOT NULL,value_json TEXT NOT NULL,PRIMARY KEY(plugin_key,workspace_id,user_id,key));
            CREATE TABLE IF NOT EXISTS plugin_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,plugin_key TEXT NOT NULL,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,version TEXT NOT NULL,action TEXT NOT NULL,target TEXT,request_id TEXT NOT NULL,outcome TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS plugin_audit_scope ON plugin_audit(plugin_key,workspace_id,user_id,id);
            CREATE TRIGGER IF NOT EXISTS plugin_workspace_removed AFTER DELETE ON workspaces BEGIN
              DELETE FROM plugin_grants WHERE workspace_id=OLD.id;
              DELETE FROM plugin_storage WHERE workspace_id=OLD.id;
              DELETE FROM plugin_audit WHERE workspace_id=OLD.id;
            END;").map_err(|_| fail("STORAGE"))
    }
    pub(crate) fn installed_plugins(&self) -> Result<Vec<Installed>> {
        let mut stmt = self
            .conn
            .prepare("SELECT record_json FROM plugin_installs ORDER BY plugin_key")
            .map_err(|_| fail("STORAGE"))?;
        let records = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|_| fail("STORAGE"))?;
        records
            .map(|r| {
                serde_json::from_str(&r.map_err(|_| fail("STORAGE"))?).map_err(|_| fail("STORAGE"))
            })
            .collect()
    }
    pub(crate) fn installed_plugin(&self, key: &str) -> Result<Installed> {
        self.installed_plugins()?
            .into_iter()
            .find(|p| p.plugin_key == key)
            .ok_or_else(|| fail("NOT_INSTALLED"))
    }
    pub(crate) fn save_plugin(&self, plugin: &Installed) -> Result<()> {
        self.conn.execute("INSERT INTO plugin_installs VALUES(?,?) ON CONFLICT(plugin_key) DO UPDATE SET record_json=excluded.record_json",params![plugin.plugin_key,serde_json::to_string(plugin).map_err(|_| fail("STORAGE"))?]).map_err(|_| fail("STORAGE"))?;
        Ok(())
    }
    pub(crate) fn plugin_grants(&self, key: &str, scope: &WorkspaceContext) -> Result<Vec<String>> {
        self.validate_workspace_context(scope)?;
        let mut stmt = self.conn.prepare("SELECT capability FROM plugin_grants WHERE plugin_key=? AND workspace_id=? AND user_id=? ORDER BY capability").map_err(|_| fail("STORAGE"))?;
        let rows = stmt
            .query_map(params![key, scope.workspace_id, scope.user_id], |r| {
                r.get(0)
            })
            .map_err(|_| fail("STORAGE"))?;
        rows.collect::<std::result::Result<_, _>>()
            .map_err(|_| fail("STORAGE"))
    }
    pub(crate) fn plugin_audit(
        &self,
        plugin: &Installed,
        scope: &WorkspaceContext,
        action: &str,
        target: Option<&str>,
        request_id: &str,
        outcome: &str,
    ) -> Result<()> {
        self.conn.execute("INSERT INTO plugin_audit(plugin_key,workspace_id,user_id,version,action,target,request_id,outcome,created_at) VALUES(?,?,?,?,?,?,?,?,?)",params![plugin.plugin_key,scope.workspace_id,scope.user_id,plugin.manifest.version,action,target,request_id,outcome,chrono::Utc::now().to_rfc3339()]).map_err(|_| fail("STORAGE"))?;
        Ok(())
    }
    pub(crate) fn plugin_details(
        &self,
        key: &str,
        scope: &WorkspaceContext,
        offset: u64,
    ) -> Result<Value> {
        let grants = self.plugin_grants(key, scope)?;
        let mut stmt = self.conn.prepare("SELECT version,action,target,outcome,created_at FROM plugin_audit WHERE plugin_key=? AND workspace_id=? AND user_id=? ORDER BY id DESC LIMIT 50 OFFSET ?").map_err(|_| fail("STORAGE"))?;
        let rows=stmt.query_map(params![key,scope.workspace_id,scope.user_id,offset.min(100_000)], |r| Ok(json!({"version":r.get::<_,String>(0)?,"action":r.get::<_,String>(1)?,"target":r.get::<_,Option<String>>(2)?,"outcome":r.get::<_,String>(3)?,"createdAt":r.get::<_,String>(4)?}))).map_err(|_| fail("STORAGE"))?;
        let audit: Vec<Value> = rows
            .collect::<std::result::Result<_, _>>()
            .map_err(|_| fail("STORAGE"))?;
        Ok(json!({"grants":grants,"audit":audit,"offset":offset}))
    }
    pub(crate) fn plugin_storage_call(
        &self,
        key: &str,
        scope: &WorkspaceContext,
        method: &str,
        payload: &Value,
    ) -> Result<Value> {
        self.validate_workspace_context(scope)?;
        let name = payload["key"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 200)
            .ok_or_else(|| fail("ARGUMENTS"))?;
        match method {
            "storage.get" => {
                let raw:Option<String>=self.conn.query_row("SELECT value_json FROM plugin_storage WHERE plugin_key=? AND workspace_id=? AND user_id=? AND key=?",params![key,scope.workspace_id,scope.user_id,name],|r|r.get(0)).optional().map_err(|_| fail("STORAGE"))?;
                raw.map(|s| serde_json::from_str(&s).map_err(|_| fail("STORAGE")))
                    .unwrap_or(Ok(Value::Null))
            }
            "storage.set" => {
                let value = payload
                    .get("value")
                    .ok_or_else(|| fail("ARGUMENTS"))?
                    .to_string();
                if value.len() > 1024 * 1024 {
                    return Err(fail("STORAGE_LIMIT"));
                }
                let used:u64=self.conn.query_row("SELECT COALESCE(SUM(length(CAST(value_json AS BLOB))+length(CAST(key AS BLOB))),0) FROM plugin_storage WHERE plugin_key=? AND workspace_id=? AND user_id=? AND key<>?",params![key,scope.workspace_id,scope.user_id,name],|r|r.get(0)).map_err(|_|fail("STORAGE"))?;
                if used + value.len() as u64 + name.len() as u64 > 10 * 1024 * 1024 {
                    return Err(fail("STORAGE_LIMIT"));
                }
                self.conn.execute("INSERT INTO plugin_storage VALUES(?,?,?,?,?) ON CONFLICT(plugin_key,workspace_id,user_id,key) DO UPDATE SET value_json=excluded.value_json",params![key,scope.workspace_id,scope.user_id,name,value]).map_err(|_|fail("STORAGE"))?;
                Ok(Value::Null)
            }
            "storage.delete" => {
                self.conn.execute("DELETE FROM plugin_storage WHERE plugin_key=? AND workspace_id=? AND user_id=? AND key=?",params![key,scope.workspace_id,scope.user_id,name]).map_err(|_|fail("STORAGE"))?;
                Ok(Value::Null)
            }
            _ => Err(fail("METHOD")),
        }
    }
}
