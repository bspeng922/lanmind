//! Explicit Wiki shares and immutable workspace-owned attachments.
use crate::db::Database;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

pub(crate) fn references_asset(content: &str, name: &str) -> bool {
    let decoded_content = crate::web_server::percent_decode_str(content);
    let content = decoded_content.as_str();
    let encoded: String = name
        .as_bytes()
        .iter()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(b) {
                (*b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    [name, encoded.as_str()].iter().any(|name| {
        content
            .match_indices(&format!("assets/{name}"))
            .any(|(start, matched)| {
                content[start + matched.len()..]
                    .chars()
                    .next()
                    .is_none_or(|c| c.is_whitespace() || ")]\"'<>?#".contains(c))
            })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn page(db: &Database, id: &str, parent: Option<&str>, content: &str, user: &str) {
        db.write_wiki_page(
            &json!({"id":id,"title":id,"parentId":parent,"content":content}),
            None,
            user,
        )
        .unwrap();
    }
    #[test]
    fn shares_select_existing_pages_and_respect_revocation_and_workspace() {
        let db = Database::open(Path::new(":memory:")).unwrap();
        let user = db.current_user_id().unwrap();
        page(&db, "root", None, "root", &user);
        page(&db, "child", Some("root"), "child", &user);
        page(&db, "private", None, "private", &user);
        let single = db.create_wiki_share("root", false, &user).unwrap();
        let one = single["shareId"].as_str().unwrap();
        assert_eq!(db.shared_wiki_pages(one, &user).unwrap().len(), 1);
        let tree = db.create_wiki_share("root", true, &user).unwrap();
        let token = tree["shareId"].as_str().unwrap();
        page(&db, "future-child", Some("root"), "new", &user);
        assert_eq!(db.shared_wiki_pages(token, &user).unwrap().len(), 2);
        assert!(db.shared_wiki_pages(token, "other-user").is_err());
        let original = db.workspace_context().unwrap().workspace_id;
        let other = db.create_workspace("Other", None, None, &user).unwrap();
        db.switch_workspace(&other.id, &user).unwrap();
        assert!(db.shared_wiki_pages(token, &user).is_err());
        db.switch_workspace(&original, &user).unwrap();
        db.revoke_wiki_share(token, &user).unwrap();
        assert!(db.shared_wiki_pages(token, &user).is_err());
        assert_eq!(db.shared_wiki_pages(one, &user).unwrap().len(), 1);
    }
    #[test]
    fn assets_are_immutable_scoped_and_share_access_requires_a_reference() {
        let db = Database::open(Path::new(":memory:")).unwrap();
        let user = db.current_user_id().unwrap();
        let dir = std::env::temp_dir().join(format!("wiki-assets-{}", uuid::Uuid::new_v4()));
        db.store_wiki_asset(&dir, "image.png", b"first", &user)
            .unwrap();
        db.store_wiki_asset(&dir, "image.png", b"first", &user)
            .unwrap();
        assert!(db
            .store_wiki_asset(&dir, "image.png", b"replacement", &user)
            .is_err());
        page(&db, "root", None, "![x](assets/image.png)", &user);
        page(&db, "other", None, "private", &user);
        let a = db.create_wiki_share("root", false, &user).unwrap();
        let b = db.create_wiki_share("other", false, &user).unwrap();
        assert!(db
            .wiki_asset_path(
                &dir,
                "image.png",
                &user,
                Some(a["shareId"].as_str().unwrap())
            )
            .is_ok());
        assert!(db
            .wiki_asset_path(
                &dir,
                "image.png",
                &user,
                Some(b["shareId"].as_str().unwrap())
            )
            .is_err());
        assert!(db
            .wiki_asset_path(&dir, "image.png", "other-user", None)
            .is_err());
        let workspace = db.create_workspace("Other", None, None, &user).unwrap();
        db.switch_workspace(&workspace.id, &user).unwrap();
        assert!(db.wiki_asset_path(&dir, "image.png", &user, None).is_err());
        db.store_wiki_asset(&dir, "image.png", b"second workspace", &user)
            .unwrap();
        assert_eq!(
            std::fs::read(db.wiki_asset_path(&dir, "image.png", &user, None).unwrap()).unwrap(),
            b"second workspace"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn legacy_migration_preserves_paths_and_quarantines_unknown_files() {
        let db = Database::open(Path::new(":memory:")).unwrap();
        let user = db.current_user_id().unwrap();
        let dir = std::env::temp_dir().join(format!("wiki-legacy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("old (1).png"), b"legacy").unwrap();
        std::fs::write(dir.join("unowned.png"), b"private").unwrap();
        page(&db, "root", None, "![x](assets/old%20%281%29.png)", &user);
        db.migrate_legacy_wiki_assets(&dir).unwrap();
        assert_eq!(
            std::fs::read(
                db.wiki_asset_path(&dir, "old (1).png", &user, None)
                    .unwrap()
            )
            .unwrap(),
            b"legacy"
        );
        assert!(db
            .wiki_asset_path(&dir, "unowned.png", &user, None)
            .is_err());
        // A guessed filename added after migration cannot claim an old file.
        page(&db, "guess", None, "![x](assets/unowned.png)", &user);
        db.migrate_legacy_wiki_assets(&dir).unwrap();
        assert!(db
            .wiki_asset_path(&dir, "unowned.png", &user, None)
            .is_err());
        assert!(dir.join("unowned.png").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn attachment_matching_does_not_accept_a_filename_prefix() {
        assert!(!references_asset(
            "[private](assets/public.png.secret)",
            "public.png"
        ));
        assert!(references_asset(
            "![x](assets/中文%20%281%29.png)",
            "中文 (1).png"
        ));
    }
}

impl Database {
    pub(crate) fn install_wiki_access(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS wiki_shares (
            workspace_id TEXT NOT NULL, token TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
            root_id TEXT NOT NULL, page_ids TEXT NOT NULL, include_descendants INTEGER NOT NULL,
            created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS wiki_assets (
            workspace_id TEXT NOT NULL, name TEXT NOT NULL, file_id TEXT NOT NULL UNIQUE,
            owner_id TEXT NOT NULL, PRIMARY KEY(workspace_id,name));",
            )
            .map_err(|e| e.to_string())
    }

    pub(crate) fn create_wiki_share(
        &self,
        id: &str,
        descendants: bool,
        user: &str,
    ) -> Result<Value, String> {
        self.wiki_page(id, user)?;
        let pages = self.wiki_pages(user)?;
        let mut selected = HashSet::from([id.to_string()]);
        if descendants {
            loop {
                let before = selected.len();
                for p in &pages {
                    if p["parentId"]
                        .as_str()
                        .is_some_and(|parent| selected.contains(parent))
                    {
                        if let Some(id) = p["id"].as_str() {
                            selected.insert(id.to_string());
                        }
                    }
                }
                if before == selected.len() {
                    break;
                }
            }
        }
        let mut ids: Vec<_> = selected.into_iter().collect();
        ids.sort();
        let token = uuid::Uuid::new_v4().to_string();
        let created = chrono::Utc::now().to_rfc3339();
        let ws = self.workspace_context()?.workspace_id;
        self.conn
            .execute(
                "INSERT INTO wiki_shares VALUES(?,?,?,?,?,?,?)",
                params![
                    ws,
                    token,
                    user,
                    id,
                    json!(ids).to_string(),
                    descendants,
                    created
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(
            json!({"shareId":token,"rootId":id,"includeDescendants":descendants,"createdAt":created}),
        )
    }

    pub(crate) fn wiki_shares(&self, id: &str, user: &str) -> Result<Vec<Value>, String> {
        let ws = self.workspace_context()?.workspace_id;
        let mut stmt = self.conn.prepare("SELECT token,include_descendants,created_at FROM wiki_shares WHERE workspace_id=? AND owner_id=? AND root_id=? ORDER BY created_at").map_err(|e|e.to_string())?;
        let rows = stmt.query_map(params![ws,user,id], |r| Ok(json!({"shareId":r.get::<_,String>(0)?,"rootId":id,"includeDescendants":r.get::<_,bool>(1)?,"createdAt":r.get::<_,String>(2)?}))).map_err(|e|e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub(crate) fn revoke_wiki_share(&self, token: &str, user: &str) -> Result<(), String> {
        self.conn.execute("DELETE FROM wiki_shares WHERE workspace_id=active_workspace_id() AND token=? AND owner_id=?",params![token,user]).map_err(|e|e.to_string())?;
        Ok(())
    }

    pub(crate) fn shared_wiki_pages(&self, token: &str, user: &str) -> Result<Vec<Value>, String> {
        let (root, raw): (String,String) = self.conn.query_row("SELECT root_id,page_ids FROM wiki_shares WHERE workspace_id=active_workspace_id() AND token=? AND owner_id=?",params![token,user],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|"Wiki share is unavailable".to_string())?;
        self.wiki_page(&root, user)?;
        let ids: HashSet<String> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let mut pages: Vec<_> = self
            .wiki_pages(user)?
            .into_iter()
            .filter(|p| p["id"].as_str().is_some_and(|id| ids.contains(id)))
            .collect();
        for p in &mut pages {
            if !p["parentId"].as_str().is_some_and(|id| ids.contains(id)) {
                p["parentId"] = Value::Null;
            }
            p["favorite"] = json!(false);
        }
        Ok(pages)
    }

    pub(crate) fn store_wiki_asset(
        &self,
        root: &Path,
        name: &str,
        bytes: &[u8],
        user: &str,
    ) -> Result<String, String> {
        self.require_feature("wiki")?;
        let name = crate::web_server::wiki_asset_name(name).ok_or("Invalid asset name")?;
        if bytes.len() > 50 * 1024 * 1024 {
            return Err("Wiki attachment exceeds 50 MB".into());
        }
        let ws = self.workspace_context()?.workspace_id;
        let existing: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT file_id,owner_id FROM wiki_assets WHERE workspace_id=? AND name=?",
                params![ws, name],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((file, owner)) = existing {
            if (owner == user || self.wiki_asset_path(root, name, user, None).is_ok())
                && std::fs::read(root.join("scoped").join(file))
                    .is_ok_and(|current| current == bytes)
            {
                return Ok(format!("assets/{name}"));
            }
            return Err("Attachment name already exists; use a new name".into());
        }
        std::fs::create_dir_all(root.join("scoped")).map_err(|e| e.to_string())?;
        let file = uuid::Uuid::new_v4().to_string();
        let path = root.join("scoped").join(&file);
        use std::io::Write;
        let result = (|| {
            let mut dest = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|e| e.to_string())?;
            dest.write_all(bytes).map_err(|e| e.to_string())?;
            self.conn
                .execute(
                    "INSERT INTO wiki_assets VALUES(?,?,?,?)",
                    params![ws, name, file, user],
                )
                .map_err(|e| e.to_string())?;
            Ok(format!("assets/{name}"))
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(path);
        }
        result
    }

    pub(crate) fn wiki_asset_path(
        &self,
        root: &Path,
        name: &str,
        user: &str,
        share: Option<&str>,
    ) -> Result<PathBuf, String> {
        self.require_feature("wiki")?;
        if self.workspace_context()?.user_id != user {
            return Err("Wiki attachment is unavailable".into());
        }
        let name = crate::web_server::wiki_asset_name(name).ok_or("Invalid asset name")?;
        let pages = match share {
            Some(token) => self.shared_wiki_pages(token, user)?,
            None => self.wiki_pages(user)?,
        };
        let referenced = pages
            .iter()
            .any(|p| references_asset(p["content"].as_str().unwrap_or(""), name));
        let record: Option<(String,String)> = self.conn.query_row("SELECT file_id,owner_id FROM wiki_assets WHERE workspace_id=active_workspace_id() AND name=?",params![name],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
        match record {
            Some((file, owner)) if referenced || (share.is_none() && owner == user) => {
                Ok(root.join("scoped").join(file))
            }
            _ => Err("Wiki attachment is unavailable".into()),
        }
    }

    /// Only pre-existing, unambiguous document references may claim a legacy file.
    /// Unreferenced files and browser-only history stay private for reconciliation.
    pub(crate) fn migrate_legacy_wiki_assets(&self, root: &Path) -> Result<(), String> {
        if self.setting("wikiAssetOwnershipV1")?.is_some() {
            return Ok(());
        }
        let mut stmt = self
            .conn
            .prepare("SELECT workspace_id,payload_json FROM wiki_documents WHERE deleted=0")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if let Ok(files) = std::fs::read_dir(root) {
            for file in files.flatten().filter(|f| f.path().is_file()) {
                let name = file.file_name().to_string_lossy().to_string();
                let workspaces: HashSet<_> = rows
                    .iter()
                    .filter(|(_, raw)| {
                        serde_json::from_str::<Value>(raw).ok().is_some_and(|p| {
                            references_asset(p["content"].as_str().unwrap_or(""), &name)
                        })
                    })
                    .map(|(ws, _)| ws.clone())
                    .collect();
                if workspaces.len() != 1 {
                    continue;
                }
                let ws = workspaces.into_iter().next().unwrap();
                let id = uuid::Uuid::new_v4().to_string();
                std::fs::create_dir_all(root.join("scoped")).map_err(|e| e.to_string())?;
                std::fs::copy(file.path(), root.join("scoped").join(&id))
                    .map_err(|e| e.to_string())?;
                self.conn
                    .execute(
                        "INSERT OR IGNORE INTO wiki_assets VALUES(?,?,?,'')",
                        params![ws, name, id],
                    )
                    .map_err(|e| e.to_string())?;
            }
        }
        self.conn
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('wikiAssetOwnershipV1','1')",
                [],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
