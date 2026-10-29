use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

#[derive(Clone, Serialize, Deserialize, Zeroize)]
#[serde(rename_all = "camelCase", default)]
pub struct Entry {
    pub id: String,
    pub revision: u64,
    pub kind: String,
    pub name: String,
    pub folder_id: Option<String>,
    pub favorite: bool,
    pub urls: Vec<String>,
    pub username: String,
    pub password: String,
    pub notes: String,
    pub public_key: String,
    pub private_key: String,
    pub key_passphrase: String,
    pub fingerprint: String,
    pub algorithm: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub source_share_id: Option<String>,
}
impl Default for Entry {
    fn default() -> Self {
        Self {
            id: String::new(),
            revision: 0,
            kind: "login".into(),
            name: String::new(),
            folder_id: None,
            favorite: false,
            urls: vec![],
            username: String::new(),
            password: String::new(),
            notes: String::new(),
            public_key: String::new(),
            private_key: String::new(),
            key_passphrase: String::new(),
            fingerprint: String::new(),
            algorithm: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            deleted_at: None,
            source_share_id: None,
        }
    }
}
impl Entry {
    pub fn summary(&self) -> serde_json::Value {
        serde_json::json!({"id": self.id, "revision": self.revision, "kind": self.kind, "name": self.name, "folderId": self.folder_id, "favorite": self.favorite, "urls": self.urls, "username": self.username, "fingerprint": self.fingerprint, "algorithm": self.algorithm, "createdAt": self.created_at, "updatedAt": self.updated_at, "deletedAt": self.deleted_at})
    }
}
#[derive(Clone, Serialize, Deserialize, Zeroize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, Zeroize)]
#[serde(rename_all = "camelCase", default)]
pub struct PasswordPolicy {
    pub length: usize,
    pub uppercase: bool,
    pub lowercase: bool,
    pub digits: bool,
    pub symbols: bool,
    pub symbol_chars: String,
    pub avoid_ambiguous: bool,
}
impl Default for PasswordPolicy {
    fn default() -> Self {
        Self {
            length: 20,
            uppercase: true,
            lowercase: true,
            digits: true,
            symbols: true,
            symbol_chars: "!@#$%^&*()-_=+[]{};:,.?".into(),
            avoid_ambiguous: true,
        }
    }
}
#[derive(Clone, Serialize, Deserialize, Zeroize)]
#[serde(rename_all = "camelCase", default)]
pub struct Contents {
    pub entries: Vec<Entry>,
    pub folders: Vec<Folder>,
    pub policy: PasswordPolicy,
    pub idle_minutes: u64,
    pub share_secret: String,
}
impl Default for Contents {
    fn default() -> Self {
        Self {
            entries: vec![],
            folders: vec![],
            policy: PasswordPolicy::default(),
            idle_minutes: 5,
            share_secret: String::new(),
        }
    }
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
