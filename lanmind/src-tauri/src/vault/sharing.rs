use super::{
    crypto::{self, Sealed},
    model::*,
    storage::{self, Runtime},
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicInfo {
    pub version: u32,
    pub user_id: String,
    pub key_id: String,
    pub public_key: String,
    pub fingerprint: String,
    pub signature: String,
}
impl PublicInfo {
    pub fn body(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(&(
            "lanmind-vault-public-v1",
            self.version,
            &self.user_id,
            &self.key_id,
            &self.public_key,
            &self.fingerprint,
        ))
        .map_err(|_| "VAULT_SHARE".into())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    pub version: u32,
    pub share_id: String,
    pub workspace_id: String,
    pub sender_id: String,
    pub recipient_id: String,
    pub key_id: String,
    pub ephemeral_key: String,
    pub data: Sealed,
    pub signature: String,
}
impl Envelope {
    fn aad(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(&(
            "lanmind-vault-share-v1",
            self.version,
            &self.share_id,
            &self.workspace_id,
            &self.sender_id,
            &self.recipient_id,
            &self.key_id,
            &self.ephemeral_key,
        ))
        .map_err(|_| "VAULT_SHARE".into())
    }
    pub fn body(&self) -> Result<Vec<u8>, String> {
        let mut unsigned = self.clone();
        unsigned.signature.clear();
        serde_json::to_vec(&unsigned).map_err(|_| "VAULT_SHARE".into())
    }
}
fn bytes32(value: &str) -> Result<[u8; 32], String> {
    let bytes = B64.decode(value).map_err(|_| "VAULT_SHARE")?;
    bytes.try_into().map_err(|_| "VAULT_SHARE".into())
}
fn public(secret: &str) -> Result<PublicKey, String> {
    let raw = Zeroizing::new(bytes32(secret)?);
    Ok(PublicKey::from(&StaticSecret::from(*raw)))
}
fn key_id(public: &PublicKey) -> String {
    format!("{:x}", Sha256::digest(public.as_bytes()))
}
fn derive(
    secret: &StaticSecret,
    public: &PublicKey,
    aad: &[u8],
) -> Result<Zeroizing<[u8; 32]>, String> {
    let shared = secret.diffie_hellman(public);
    if !shared.was_contributory() {
        return Err("VAULT_SHARE".into());
    }
    let mut key = Zeroizing::new([0; 32]);
    Hkdf::<Sha256>::new(Some(b"lanmind-vault-share-v1"), shared.as_bytes())
        .expand(aad, key.as_mut())
        .map_err(|_| "VAULT_SHARE")?;
    Ok(key)
}
impl Runtime {
    pub fn publish_key(&self, expected: u64, db: &crate::db::Database) -> Result<(), String> {
        self.with(expected,|conn,_key,c|{
            let public=public(&c.share_secret)?;let kid=key_id(&public);
            let mut info=PublicInfo{version:1,user_id:db.current_user_id()?,key_id:kid.clone(),public_key:B64.encode(public.as_bytes()),fingerprint:format!("SHA256:{}",B64.encode(Sha256::digest(public.as_bytes()))),signature:String::new()};
            info.signature=db.sign_device_message(&info.body()?)?;
            conn.execute_batch("CREATE TABLE IF NOT EXISTS public_info(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL)").map_err(|_|"VAULT_STORAGE")?;
            conn.execute("INSERT OR REPLACE INTO public_info VALUES(1,?)",[serde_json::to_string(&info).map_err(|_|"VAULT_SHARE")?]).map_err(|_|"VAULT_STORAGE")?;Ok(())
        })
    }
    pub fn public_info(&self) -> Result<PublicInfo, String> {
        if !self.path.is_file() {
            return Err("VAULT_UNINITIALIZED".into());
        }
        let conn = rusqlite::Connection::open_with_flags(
            &self.path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|_| "VAULT_STORAGE")?;
        let text: String = conn
            .query_row("SELECT payload FROM public_info WHERE id=1", [], |r| {
                r.get(0)
            })
            .map_err(|_| "VAULT_UNINITIALIZED")?;
        serde_json::from_str(&text).map_err(|_| "VAULT_SHARE".into())
    }
    pub fn share(
        &self,
        payload: Value,
        expected: u64,
        db: &crate::db::Database,
    ) -> Result<Value, String> {
        let info: PublicInfo = storage::parse(payload["recipient"].clone())?;
        if payload["userId"] != info.user_id {
            return Err("VAULT_RECIPIENT".into());
        }
        verify_public(db, &info)?;
        let scope = db.workspace_context()?;
        db.require_workspace_member(&info.user_id)?;
        if info.user_id == scope.user_id {
            return Err("VAULT_RECIPIENT".into());
        }
        if payload["verifiedFingerprint"] != info.fingerprint {
            return Err("VAULT_VERIFY_FINGERPRINT".into());
        }
        self.with(expected,|_conn,_key,c|{
            let source=c.entries.iter().find(|e|e.id==payload["id"]&&e.deleted_at.is_none()).ok_or("VAULT_NOT_FOUND")?;
            let mut entry=Entry{name:source.name.clone(),kind:source.kind.clone(),urls:source.urls.clone(),username:source.username.clone(),..Entry::default()};
            if source.kind=="login"&&payload["includePassword"]==true{entry.password=source.password.clone();}
            if source.kind=="ssh"{entry.public_key=source.public_key.clone();entry.fingerprint=source.fingerprint.clone();entry.algorithm=source.algorithm.clone();}
            let secret=StaticSecret::random_from_rng(rand::rngs::OsRng);
            let mut envelope=Envelope{version:1,share_id:id(),workspace_id:scope.workspace_id.clone(),sender_id:scope.user_id.clone(),recipient_id:info.user_id.clone(),key_id:info.key_id.clone(),ephemeral_key:B64.encode(PublicKey::from(&secret).as_bytes()),data:Sealed{nonce:String::new(),ciphertext:String::new()},signature:String::new()};
            let aad=envelope.aad()?;let key=derive(&secret,&PublicKey::from(bytes32(&info.public_key)?),&aad)?;
            let raw=Zeroizing::new(serde_json::to_vec(&entry).map_err(|_|"VAULT_SHARE")?);
            envelope.data=crypto::seal(&key,&raw,&aad)?;envelope.signature=db.sign_device_message(&envelope.body()?)?;
            Ok(json!({"senderId":scope.user_id,"receiverId":info.user_id,"groupId":null,"type":"vault_share","content":serde_json::to_string(&envelope).map_err(|_|"VAULT_SHARE")?}))
        })
    }
    pub fn receive(
        &self,
        payload: Value,
        expected: u64,
        db: &crate::db::Database,
        save: bool,
    ) -> Result<Value, String> {
        let message_id = storage::text(&payload, "messageId")?;
        let user = db.current_user_id()?;
        let message = db.get_chat_message_for_vault(message_id, &user)?;
        let envelope: Envelope =
            serde_json::from_str(&message.content).map_err(|_| "VAULT_SHARE")?;
        validate_message(
            db,
            &serde_json::to_value(&message).map_err(|_| "VAULT_SHARE")?,
        )?;
        if envelope.recipient_id != user {
            return Err("VAULT_RECIPIENT".into());
        }
        self.with(expected, |conn, key, c| {
            let pubkey = public(&c.share_secret)?;
            if envelope.key_id != key_id(&pubkey) {
                return Err("VAULT_SHARE_KEY".into());
            }
            let secret = StaticSecret::from(*Zeroizing::new(bytes32(&c.share_secret)?));
            let aad = envelope.aad()?;
            let shared = derive(
                &secret,
                &PublicKey::from(bytes32(&envelope.ephemeral_key)?),
                &aad,
            )?;
            let raw = crypto::open(&shared, &envelope.data, &aad)?;
            let mut entry: Entry = serde_json::from_slice(&raw).map_err(|_| "VAULT_SHARE")?;
            if !entry.private_key.is_empty() || !entry.key_passphrase.is_empty() {
                return Err("VAULT_SHARE".into());
            }
            entry.folder_id = payload["folderId"].as_str().map(str::to_string);
            storage::validate_entry(&mut entry, &c.folders)?;
            if !entry.private_key.is_empty() || !entry.key_passphrase.is_empty() {
                return Err("VAULT_SHARE".into());
            }
            if save {
                if c.entries
                    .iter()
                    .any(|e| e.source_share_id.as_deref() == Some(&envelope.share_id))
                {
                    return Err("VAULT_SHARE_IMPORTED".into());
                }
                entry.id = id();
                entry.revision = 1;
                entry.created_at = now();
                entry.updated_at = now();
                entry.source_share_id = Some(envelope.share_id.clone());
                c.entries.push(entry.clone());
                storage::write(conn, key, c)?;
                Ok(entry.summary())
            } else {
                serde_json::to_value(&entry).map_err(|_| "VAULT_SHARE".into())
            }
        })
    }
}
pub fn verify_public(db: &crate::db::Database, info: &PublicInfo) -> Result<(), String> {
    if info.version != 1 {
        return Err("VAULT_SHARE".into());
    }
    let key = PublicKey::from(bytes32(&info.public_key)?);
    if info.key_id != key_id(&key)
        || info.fingerprint != format!("SHA256:{}", B64.encode(Sha256::digest(key.as_bytes())))
    {
        return Err("VAULT_SHARE".into());
    }
    db.verify_device_message(&info.user_id, &info.body()?, &info.signature)
        .map_err(|_| "VAULT_SHARE_IDENTITY".into())
}
pub fn validate_message(db: &crate::db::Database, message: &Value) -> Result<(), String> {
    let content = storage::text(message, "content")?;
    if content.len() > 256 * 1024 || message["groupId"].as_str().is_some() {
        return Err("VAULT_SHARE".into());
    }
    let envelope: Envelope = serde_json::from_str(content).map_err(|_| "VAULT_SHARE")?;
    if envelope.version != 1
        || message["senderId"] != envelope.sender_id
        || message["receiverId"] != envelope.recipient_id
        || envelope.workspace_id != db.workspace_context()?.workspace_id
        || envelope.share_id.is_empty()
    {
        return Err("VAULT_RECIPIENT".into());
    }
    db.require_workspace_member(&envelope.sender_id)?;
    db.require_workspace_member(&envelope.recipient_id)?;
    // Local signatures can be verified against the local device's own public key.
    if envelope.sender_id == db.current_user_id()? {
        let public = db.device_public_keys()?.0;
        crate::workspace_membership::verify(&public, &envelope.body()?, &envelope.signature)
            .map_err(|_| "VAULT_SHARE_IDENTITY".into())
    } else {
        db.verify_device_message(&envelope.sender_id, &envelope.body()?, &envelope.signature)
            .map_err(|_| "VAULT_SHARE_IDENTITY".into())
    }
}
impl crate::db::Database {
    pub(crate) fn save_vault_share(
        &self,
        message: Value,
        recipient: &PublicInfo,
    ) -> Result<crate::models::ChatMessage, String> {
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|_| "VAULT_STORAGE")?;
        let saved = self.save_chat_message(message)?;
        self.save_local_setting(
            &format!("vaultVerified:{}", recipient.user_id),
            &serde_json::to_string(recipient).map_err(|_| "VAULT_SHARE")?,
        )?;
        tx.commit().map_err(|_| "VAULT_STORAGE")?;
        Ok(saved)
    }
    pub(crate) fn get_chat_message_for_vault(
        &self,
        id: &str,
        user: &str,
    ) -> Result<crate::models::ChatMessage, String> {
        self.require_workspace_member(user)?;
        let message:crate::models::ChatMessage=self.conn.query_row("SELECT payload_json FROM chat_messages WHERE workspace_id=active_workspace_id() AND id=?",[id],|r|r.get::<_,String>(0)).map_err(|_|"VAULT_NOT_FOUND").and_then(|raw|serde_json::from_str(&raw).map_err(|_|"VAULT_SHARE"))?;
        if message.message_type != "vault_share"
            || message.receiver_id.as_deref() != Some(user)
            || message.group_id.is_some()
        {
            return Err("VAULT_RECIPIENT".into());
        }
        Ok(message)
    }
}
