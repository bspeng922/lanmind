use super::{
    crypto::{self, Header, Sealed},
    model::*,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime},
};
use zeroize::Zeroizing;

pub struct Runtime {
    pub(crate) inner: Mutex<Session>,
    pub(crate) path: PathBuf,
}
pub(crate) struct Session {
    pub key: Option<Zeroizing<[u8; 32]>>,
    pub epoch: u64,
    pub last_activity: Instant,
    pub idle_minutes: u64,
    pub last_tick: Instant,
    pub scope: String,
    pub last_wall_tick: SystemTime,
    pub failures: u32,
    pub retry_at: Option<Instant>,
}
impl Session {
    fn new() -> Self {
        Self {
            key: None,
            epoch: 0,
            last_activity: Instant::now(),
            idle_minutes: 5,
            last_tick: Instant::now(),
            last_wall_tick: SystemTime::now(),
            scope: String::new(),
            failures: 0,
            retry_at: None,
        }
    }
    pub fn lock(&mut self) {
        self.key = None;
        self.epoch += 1;
    }
    pub fn expire(&mut self) -> bool {
        if self.key.is_some()
            && self.last_activity.elapsed() >= Duration::from_secs(self.idle_minutes * 60)
        {
            self.lock();
            return true;
        }
        false
    }
}
fn sql<T>(result: rusqlite::Result<T>) -> Result<T, String> {
    result.map_err(|_| "VAULT_STORAGE".into())
}
pub(crate) fn parse<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|_| "VAULT_INVALID".into())
}
pub(crate) fn text<'a>(payload: &'a Value, key: &str) -> Result<&'a str, String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| "VAULT_INVALID".into())
}
fn connect(path: &Path) -> Result<Connection, String> {
    let conn = sql(Connection::open(path))?;
    sql(conn.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS metadata(id INTEGER PRIMARY KEY CHECK(id=1),header TEXT NOT NULL,revision INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS vault_data(id INTEGER PRIMARY KEY CHECK(id=1),nonce TEXT NOT NULL,ciphertext TEXT NOT NULL);"))?;
    Ok(conn)
}
pub(crate) fn header(conn: &Connection) -> Result<Header, String> {
    let raw: String =
        sql(conn.query_row("SELECT header FROM metadata WHERE id=1", [], |r| r.get(0)))?;
    serde_json::from_str(&raw).map_err(|_| "VAULT_CORRUPT".into())
}
pub(crate) fn read(conn: &Connection, key: &[u8; 32]) -> Result<Zeroizing<Contents>, String> {
    let h = header(conn)?;
    let (nonce, ciphertext) = sql(conn.query_row(
        "SELECT nonce,ciphertext FROM vault_data WHERE id=1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ))?;
    let revision: u64 =
        sql(conn.query_row("SELECT revision FROM metadata WHERE id=1", [], |r| r.get(0)))?;
    let bytes = crypto::open(
        key,
        &Sealed { nonce, ciphertext },
        format!("lanmind-vault-data-v1:{}:{revision}", h.vault_id).as_bytes(),
    )?;
    serde_json::from_slice(&bytes)
        .map(Zeroizing::new)
        .map_err(|_| "VAULT_CORRUPT".into())
}
pub(crate) fn write(conn: &Connection, key: &[u8; 32], contents: &Contents) -> Result<(), String> {
    let h = header(conn)?;
    let revision: u64 =
        sql(conn.query_row("SELECT revision FROM metadata WHERE id=1", [], |r| r.get(0)))?;
    let bytes = Zeroizing::new(serde_json::to_vec(contents).map_err(|_| "VAULT_INVALID")?);
    if bytes.len() > 32 * 1024 * 1024
        || contents.entries.len() > 20000
        || contents.folders.len() > 5000
    {
        return Err("VAULT_FILE_SIZE".into());
    }
    let sealed = crypto::seal(
        key,
        &bytes,
        format!("lanmind-vault-data-v1:{}:{}", h.vault_id, revision + 1).as_bytes(),
    )?;
    let tx = sql(conn.unchecked_transaction())?;
    sql(tx.execute(
        "INSERT OR REPLACE INTO vault_data VALUES(1,?,?)",
        params![sealed.nonce, sealed.ciphertext],
    ))?;
    sql(tx.execute("UPDATE metadata SET revision=? WHERE id=1", [revision + 1]))?;
    sql(tx.commit())
}
impl Runtime {
    pub fn new(path: PathBuf) -> Self {
        Self {
            inner: Mutex::new(Session::new()),
            path,
        }
    }
    pub fn lock(&self) {
        if let Ok(mut session) = self.inner.lock() {
            session.lock();
        }
    }
    pub fn tick(&self, scope: &str, app_locked: bool) -> bool {
        let Ok(mut s) = self.inner.lock() else {
            return false;
        };
        let interrupted = s.last_tick.elapsed() > Duration::from_secs(10)
            || s.last_wall_tick
                .elapsed()
                .is_ok_and(|gap| gap > Duration::from_secs(10));
        s.last_tick = Instant::now();
        s.last_wall_tick = SystemTime::now();
        let changed = s.key.is_some()
            && (app_locked || interrupted || (!s.scope.is_empty() && s.scope != scope));
        s.scope = scope.into();
        if changed {
            s.lock();
        }
        s.expire() || changed
    }
    pub fn status(&self) -> Result<Value, String> {
        let mut s = self.inner.lock().map_err(|_| "VAULT_STORAGE")?;
        s.expire();
        Ok(
            json!({"configured":self.path.is_file(),"locked":s.key.is_none(),"sessionVersion":s.epoch,"idleMinutes":s.idle_minutes}),
        )
    }
    pub fn create(&self, password: &str) -> Result<Value, String> {
        if password.chars().count() < 12 {
            return Err("VAULT_MASTER_LENGTH".into());
        }
        let mut s = self.inner.lock().map_err(|_| "VAULT_STORAGE")?;
        if self.path.exists() {
            return Err("VAULT_EXISTS".into());
        }
        let parent = self.path.parent().ok_or("VAULT_STORAGE")?;
        std::fs::create_dir_all(parent).map_err(|_| "VAULT_STORAGE")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| "VAULT_STORAGE")?;
        }
        let temporary = parent.join(format!(".initializing-{}", id()));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "VAULT_STORAGE")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(|_| "VAULT_STORAGE")?;
        }
        drop(file);
        let key = crypto::random_key();
        let result = (|| {
            let conn = connect(&temporary)?;
            let h = crypto::wrap(password, id(), &key)?;
            let raw = serde_json::to_string(&h).map_err(|_| "VAULT_INVALID")?;
            sql(conn.execute("INSERT INTO metadata VALUES(1,?,0)", [raw]))?;
            let mut contents = Zeroizing::new(Contents::default());
            use base64::Engine;
            contents.share_secret =
                base64::engine::general_purpose::STANDARD.encode(crypto::random_key().as_ref());
            write(&conn, &key, &contents)?;
            drop(conn);
            std::fs::rename(&temporary, &self.path).map_err(|_| "VAULT_STORAGE".into())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
            return result.map(|_| Value::Null);
        }
        s.key = Some(key);
        s.epoch += 1;
        s.last_activity = Instant::now();
        s.failures = 0;
        drop(s);
        self.status()
    }
    pub fn unlock(&self, password: &str) -> Result<Value, String> {
        let mut s = self.inner.lock().map_err(|_| "VAULT_STORAGE")?;
        if s.retry_at.is_some_and(|at| at > Instant::now()) {
            return Err("VAULT_RETRY".into());
        }
        if !self.path.is_file() {
            return Err("VAULT_UNINITIALIZED".into());
        }
        let conn = connect(&self.path)?;
        let key = match crypto::unwrap(password, &header(&conn)?) {
            Ok(key) => key,
            Err(error) => {
                s.failures += 1;
                s.retry_at =
                    Some(Instant::now() + Duration::from_secs((1u64 << s.failures.min(5)).min(30)));
                return Err(error);
            }
        };
        let contents = read(&conn, &key)?;
        s.idle_minutes = contents.idle_minutes;
        s.key = Some(key);
        s.epoch += 1;
        s.last_activity = Instant::now();
        s.failures = 0;
        s.retry_at = None;
        drop(s);
        self.status()
    }
    pub(crate) fn with<T>(
        &self,
        expected: u64,
        operation: impl FnOnce(&Connection, &[u8; 32], &mut Contents) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut s = self.inner.lock().map_err(|_| "VAULT_STORAGE")?;
        s.expire();
        if s.epoch != expected {
            return Err("VAULT_LOCKED".into());
        }
        let key = s.key.as_ref().ok_or("VAULT_LOCKED")?;
        let conn = connect(&self.path)?;
        let mut contents = read(&conn, key)?;
        // Purge when the vault is next accessed; locked vaults never decrypt in a background task.
        let before = contents.entries.len();
        contents.entries.retain(|entry| {
            entry
                .deleted_at
                .as_ref()
                .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
                .is_none_or(|at| chrono::Utc::now().signed_duration_since(at).num_days() < 30)
        });
        if before != contents.entries.len() {
            write(&conn, key, &contents)?;
        }
        let result = operation(&conn, key, &mut contents);
        if result.is_ok() {
            s.idle_minutes = contents.idle_minutes;
        }
        result
    }
    pub fn activity(&self, expected: u64) -> Result<Value, String> {
        let mut s = self.inner.lock().map_err(|_| "VAULT_STORAGE")?;
        s.expire();
        if s.epoch != expected || s.key.is_none() {
            return Err("VAULT_LOCKED".into());
        }
        s.last_activity = Instant::now();
        drop(s);
        self.status()
    }
    pub fn destroy(&self, password: &str, expected: u64) -> Result<Value, String> {
        let mut s = self.inner.lock().map_err(|_| "VAULT_STORAGE")?;
        s.expire();
        if s.key.is_none() || s.epoch != expected {
            return Err("VAULT_LOCKED".into());
        }
        let conn = connect(&self.path)?;
        crypto::unwrap(password, &header(&conn)?)?;
        drop(conn);
        s.lock();
        std::fs::remove_file(&self.path).map_err(|_| "VAULT_FILE")?;
        drop(s);
        self.status()
    }
    pub fn execute(&self, action: &str, payload: Value, expected: u64) -> Result<Value, String> {
        self.with(expected, |conn,key,c| {
            let mut changed = false;
            let result = match action {
                "list" => json!({"entries":c.entries.iter().map(Entry::summary).collect::<Vec<_>>(),"folders":c.folders,"policy":c.policy,"idleMinutes":c.idle_minutes}),
                "search" => { let query=text(&payload,"query")?.to_lowercase(); json!(c.entries.iter().filter(|e| [&e.name,&e.username,&e.notes,&e.fingerprint].into_iter().chain(e.urls.iter()).any(|value|value.to_lowercase().contains(&query))).map(|e|e.id.clone()).collect::<Vec<_>>()) },
                "get" => { let entry = c.entries.iter().find(|e| e.id == payload["id"]).ok_or("VAULT_NOT_FOUND")?; serde_json::to_value(entry).map_err(|_| "VAULT_INVALID")? },
                "save" => {
                    let mut entry: Entry = parse(payload["entry"].clone())?;
                    validate_entry(&mut entry, &c.folders)?;
                    if entry.id.is_empty() { entry.id = id(); entry.created_at = now(); entry.revision = 0; entry.source_share_id = None; }
                    else { let old = c.entries.iter().find(|e| e.id == entry.id).ok_or("VAULT_NOT_FOUND")?;
                        if old.revision != entry.revision { return Err("VAULT_CONFLICT".into()); }
                        entry.created_at = old.created_at.clone(); entry.source_share_id = old.source_share_id.clone(); entry.deleted_at = old.deleted_at.clone();
                    }
                    entry.updated_at = now(); entry.revision += 1;
                    c.entries.retain(|e| e.id != entry.id); c.entries.push(entry.clone()); changed = true; entry.summary()
                },
                "clone" => {
                    let mut entry = c.entries.iter().find(|e| e.id == payload["id"] && e.deleted_at.is_none()).ok_or("VAULT_NOT_FOUND")?.clone();
                    entry.id = String::new(); entry.name.push_str(text(&payload,"suffix")?); entry.revision = 0; entry.source_share_id = None;
                    serde_json::to_value(&entry).map_err(|_| "VAULT_INVALID")?
                },
                "delete" | "restore" => {
                    let entry = c.entries.iter_mut().find(|e| e.id == payload["id"]).ok_or("VAULT_NOT_FOUND")?;
                    if payload["revision"].as_u64() != Some(entry.revision) { return Err("VAULT_CONFLICT".into()); }
                    entry.deleted_at = if action == "delete" { Some(now()) } else { None };
                    if entry.folder_id.as_ref().is_some_and(|id| !c.folders.iter().any(|f| &f.id == id)) { entry.folder_id = None; }
                    entry.revision += 1; entry.updated_at = now(); changed = true; Value::Null
                },
                "purge" => { let entry = c.entries.iter().find(|e| e.id == payload["id"] && e.deleted_at.is_some()).ok_or("VAULT_NOT_FOUND")?;
                    if payload["revision"].as_u64() != Some(entry.revision) { return Err("VAULT_CONFLICT".into()); }
                    c.entries.retain(|e| e.id != payload["id"]); changed = true; Value::Null },
                "toggleFavorite" => {
                    let id = text(&payload, "id")?;
                    let entry = c.entries.iter_mut().find(|e| e.id == id).ok_or("VAULT_NOT_FOUND")?;
                    entry.favorite = !entry.favorite;
                    entry.revision += 1;
                    entry.updated_at = now();
                    changed = true;
                    serde_json::to_value(entry.summary()).map_err(|_| "VAULT_INVALID")?
                },
                "move" => { let folder = payload["folderId"].as_str(); require_folder(folder,&c.folders)?;
                    let ids = payload["ids"].as_array().ok_or("VAULT_INVALID")?;
                    for entry in &mut c.entries { if ids.iter().any(|id| id == &entry.id) { entry.folder_id = folder.map(str::to_string); entry.revision += 1; entry.updated_at=now(); } }
                    changed = true; Value::Null },
                "saveFolder" => {
                    let mut folder: Folder = parse(payload["folder"].clone())?;
                    folder.name = folder.name.trim().to_string();
                    if folder.name.is_empty() || folder.name.len()>256 { return Err("VAULT_INVALID".into()); }
                    require_folder(folder.parent_id.as_deref(), &c.folders)?;
                    let mut ancestor = folder.parent_id.clone();
                    while let Some(ref parent) = ancestor { if parent == &folder.id { return Err("VAULT_FOLDER_CYCLE".into()); } ancestor = c.folders.iter().find(|f| &f.id == parent).and_then(|f| f.parent_id.clone()); }
                    if c.folders.iter().any(|f| f.id != folder.id && f.parent_id==folder.parent_id && f.name.to_lowercase()==folder.name.to_lowercase()) { return Err("VAULT_FOLDER_EXISTS".into()); }
                    if folder.id.is_empty() { folder.id=id(); } else if !c.folders.iter().any(|f| f.id==folder.id) { return Err("VAULT_NOT_FOUND".into()); }
                    c.folders.retain(|f|f.id!=folder.id); c.folders.push(folder.clone()); changed=true; json!(folder)
                },
                "deleteFolder" => {
                    let folder_id = text(&payload,"id")?;
                    if !c.folders.iter().any(|f| f.id==folder_id) { return Err("VAULT_NOT_FOUND".into()); }
                    let mut ids = vec![folder_id.to_string()];
                    loop { let next:Vec<_> = c.folders.iter().filter(|f| f.parent_id.as_ref().is_some_and(|p|ids.contains(p)) && !ids.contains(&f.id)).map(|f|f.id.clone()).collect(); if next.is_empty(){break;} ids.extend(next); }
                    for entry in &mut c.entries { if entry.folder_id.as_ref().is_some_and(|id|ids.contains(id)) { entry.folder_id=None; entry.revision+=1; entry.updated_at=now(); if payload["deleteEntries"]==true {entry.deleted_at=Some(now());} } }
                    c.folders.retain(|f|!ids.contains(&f.id)); changed=true; Value::Null
                },
                "settings" => {
                    let policy: PasswordPolicy = parse(payload["policy"].clone())?; super::generator::generate(&policy)?;
                    let idle=payload["idleMinutes"].as_u64().ok_or("VAULT_INVALID")?;
                    if ![1,5,15,30,60].contains(&idle) {return Err("VAULT_INVALID".into());}
                    c.policy=policy; c.idle_minutes=idle; changed=true; Value::Null
                },
                "generate" => json!(super::generator::generate(&parse(payload["policy"].clone())?)?),
                "generateSsh" => super::ssh::generate(payload["passphrase"].as_str().unwrap_or(""))?,
                "changePassword" => {
                    let password=text(&payload,"password")?;
                    if password.chars().count()<12 {return Err("VAULT_MASTER_LENGTH".into());}
                    crypto::unwrap(text(&payload,"currentPassword")?, &header(conn)?)?;
                    let h=crypto::wrap(password, header(conn)?.vault_id, key)?;
                    sql(conn.execute("UPDATE metadata SET header=? WHERE id=1",[serde_json::to_string(&h).map_err(|_|"VAULT_INVALID")?]))?;
                    Value::Null
                },
                _ => return Err("VAULT_INVALID".into()),
            };
            if changed { write(conn,key,c)?; } Ok(result)
        })
    }
}
pub(crate) fn require_folder(id: Option<&str>, folders: &[Folder]) -> Result<(), String> {
    if id.is_some_and(|id| !folders.iter().any(|f| f.id == id)) {
        Err("VAULT_NOT_FOUND".into())
    } else {
        Ok(())
    }
}
pub(crate) fn validate_entry(entry: &mut Entry, folders: &[Folder]) -> Result<(), String> {
    entry.name = entry.name.trim().to_string();
    entry.urls = entry
        .urls
        .iter()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
        .collect();
    if entry.name.is_empty()
        || entry.name.len() > 1024
        || entry.notes.len() > 1024 * 1024
        || entry.private_key.len() > 128 * 1024
    {
        return Err("VAULT_INVALID".into());
    }
    require_folder(entry.folder_id.as_deref(), folders)?;
    match entry.kind.as_str() {
        "login" => {
            entry.private_key.clear();
            entry.public_key.clear();
            entry.key_passphrase.clear();
            entry.fingerprint.clear();
            entry.algorithm.clear();
        }
        "ssh" => {
            super::ssh::validate(entry)?;
            entry.password.clear();
        }
        _ => return Err("VAULT_INVALID".into()),
    }
    Ok(())
}
