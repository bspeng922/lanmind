//! Administrator-managed membership. Discovery publishes device public keys;
//! targeted grants carry credentials encrypted for that device. Membership
//! changes are signed by a workspace management key held only by managers.
use crate::{db::Database, models::{Workspace, WorkspaceMember}};
use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::{aead::{Aead, KeyInit, Payload}, ChaCha20Poly1305, Nonce};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand::RngCore;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

fn bytes32(encoded: &str) -> Result<[u8; 32], String> {
    STANDARD.decode(encoded).map_err(|_| "无效的工作区凭据".to_string())?
        .try_into().map_err(|_| "无效的工作区凭据".into())
}
fn random_key() -> [u8; 32] { let mut key = [0; 32]; rand::rngs::OsRng.fill_bytes(&mut key); key }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MemberControl {
    pub workspace_id: String,
    pub user_id: String,
    pub role: String,
    pub active: bool,
    pub issuer_id: String,
    pub version: i64,
    authority: String,
    signature: String,
}
impl MemberControl {
    fn body(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(&(&self.workspace_id, &self.user_id, &self.role, self.active,
            &self.issuer_id, self.version, &self.authority)).map_err(|e| e.to_string())
    }
    fn verify(&self, expected: &str) -> Result<(), String> {
        if self.authority != expected || !matches!(self.role.as_str(), "owner" | "admin" | "member" | "guest") {
            return Err("工作区成员授权校验失败".into());
        }
        verify(expected, &self.body()?, &self.signature)
    }
}

pub(crate) fn verify(public: &str, body: &[u8], signature: &str) -> Result<(), String> {
    let key = VerifyingKey::from_bytes(&bytes32(public)?).map_err(|_| "无效的设备签名公钥")?;
    let signature = STANDARD.decode(signature).map_err(|_| "设备签名校验失败")?;
    let signature = Signature::from_slice(&signature).map_err(|_| "设备签名校验失败")?;
    key.verify_strict(body, &signature).map_err(|_| "设备签名校验失败".into())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MemberDelivery {
    workspace: Workspace,
    control: MemberControl,
    sender_control: Option<MemberControl>,
    member_controls: Vec<MemberControl>,
    members: Vec<WorkspaceMember>,
    token: Option<String>,
    management_secret: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MembershipPacket {
    kind: String,
    pub sender_id: String,
    pub recipient_id: String,
    ephemeral_key: String,
    nonce: String,
    payload: String,
    signature: String,
}
impl MembershipPacket {
    fn body(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(&(&self.kind, &self.sender_id, &self.recipient_id,
            &self.ephemeral_key, &self.nonce, &self.payload)).map_err(|e| e.to_string())
    }
    fn cipher(shared: [u8; 32]) -> Result<ChaCha20Poly1305, String> {
        if shared == [0; 32] { return Err("无效的设备加密公钥".into()); }
        let key = Sha256::digest([b"lanmind-membership-v1:".as_slice(), &shared].concat());
        Ok(ChaCha20Poly1305::new(&key))
    }
}

impl Database {
    pub(crate) fn workspace_member_candidates(&self, operator: &str) -> Result<Vec<crate::models::User>, String> {
        let workspace = self.workspace_record()?;
        if workspace.owner_id != operator && !self.workspace_members(&workspace.id)?.iter().any(|m| m.user_id == operator && m.role == "admin" && m.status == "member") {
            return Err("只有工作区所有者或管理员可以添加成员".into());
        }
        let members = self.workspace_members(&workspace.id)?;
        Ok(self.users()?.into_iter().filter(|user| !members.iter().any(|m| m.user_id == user.id && m.status == "member")).collect())
    }

    fn workspace_secret_directory(&self) -> Result<std::path::PathBuf, String> {
        if let Some(path) = self.conn.path().filter(|path| !path.is_empty() && *path != ":memory:") {
            return Ok(std::path::Path::new(path).parent().unwrap_or(std::path::Path::new(".")).to_path_buf());
        }
        #[cfg(test)] {
            static DIRECTORY: std::sync::OnceLock<tempfile::TempDir> = std::sync::OnceLock::new();
            return Ok(DIRECTORY.get_or_init(|| {
                let directory = tempfile::tempdir().expect("test key directory");
                crate::local_password::protect("initialize", directory.path()).expect("test key initialization");
                directory
            }).path().to_path_buf());
        }
        #[cfg(not(test))] { Err("工作区凭据需要持久化数据库".into()) }
    }
    fn protect_workspace_secret(&self, value: &str) -> Result<String, String> {
        crate::local_password::protect(value, &self.workspace_secret_directory()?)
    }
    fn reveal_workspace_secret(&self, value: &str) -> Result<String, String> {
        crate::local_password::reveal(value, &self.workspace_secret_directory()?)
    }
    pub(crate) fn install_workspace_membership(&self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS workspace_device_keys(
            user_id TEXT PRIMARY KEY NOT NULL,signing_secret TEXT NOT NULL,encryption_secret TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workspace_known_devices(user_id TEXT PRIMARY KEY NOT NULL,
            signing_public TEXT NOT NULL,encryption_public TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workspace_management_keys(workspace_id TEXT PRIMARY KEY NOT NULL,
            public_key TEXT NOT NULL,protected_secret TEXT);
            CREATE TABLE IF NOT EXISTS workspace_member_controls(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,
            version INTEGER NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id));
        ").map_err(|e| e.to_string())?;
        let user = self.current_user_id()?;
        let exists: bool = self.conn.query_row("SELECT EXISTS(SELECT 1 FROM workspace_device_keys WHERE user_id=?)", [&user], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !exists {
            self.conn.execute("INSERT INTO workspace_device_keys VALUES(?,?,?)", params![user,
                self.protect_workspace_secret(&STANDARD.encode(random_key()))?, self.protect_workspace_secret(&STANDARD.encode(random_key()))?]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn device_secrets(&self) -> Result<(SigningKey, StaticSecret), String> {
        let (signing, encryption): (String, String) = self.conn.query_row(
            "SELECT signing_secret,encryption_secret FROM workspace_device_keys WHERE user_id=?", [self.current_user_id()?],
            |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
        Ok((SigningKey::from_bytes(&bytes32(&self.reveal_workspace_secret(&signing)?)?), StaticSecret::from(bytes32(&self.reveal_workspace_secret(&encryption)?)?)))
    }

    pub(crate) fn device_public_keys(&self) -> Result<(String, String), String> {
        let (signing, encryption) = self.device_secrets()?;
        Ok((STANDARD.encode(signing.verifying_key().to_bytes()), STANDARD.encode(PublicKey::from(&encryption).to_bytes())))
    }
    pub(crate) fn sign_device_message(&self, body: &[u8]) -> Result<String, String> {
        Ok(STANDARD.encode(self.device_secrets()?.0.sign(body).to_bytes()))
    }
    pub(crate) fn remember_device_keys(&self, user: &str, signing: &str, encryption: &str) -> Result<(), String> {
        bytes32(signing)?; bytes32(encryption)?;
        let previous: Option<(String, String)> = self.conn.query_row("SELECT signing_public,encryption_public FROM workspace_known_devices WHERE user_id=?",
            [user], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|e| e.to_string())?;
        if previous.is_some_and(|old| old != (signing.into(), encryption.into())) { return Err("设备身份已变化，请重新核实设备".into()); }
        self.conn.execute("INSERT OR IGNORE INTO workspace_known_devices VALUES(?,?,?)", params![user, signing, encryption]).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub(crate) fn verify_device_message(&self, user: &str, body: &[u8], signature: &str) -> Result<(), String> {
        let public: String = self.conn.query_row("SELECT signing_public FROM workspace_known_devices WHERE user_id=?", [user], |r| r.get(0)).map_err(|_| "尚未验证此设备身份")?;
        verify(&public, body, signature)
    }

    fn management_key(&self, workspace: &Workspace) -> Result<SigningKey, String> {
        let existing: Option<String> = self.conn.query_row("SELECT protected_secret FROM workspace_management_keys WHERE workspace_id=?",
            [&workspace.id], |r| r.get(0)).optional().map_err(|e| e.to_string())?.flatten();
        if let Some(secret) = existing { return Ok(SigningKey::from_bytes(&bytes32(&self.reveal_workspace_secret(&secret)?)?)); }
        if workspace.owner_id != self.current_user_id()? { return Err("请等待工作区所有者同步管理授权".into()); }
        let key = SigningKey::from_bytes(&random_key());
        self.conn.execute("INSERT INTO workspace_management_keys VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET public_key=excluded.public_key,protected_secret=excluded.protected_secret",
            params![workspace.id, STANDARD.encode(key.verifying_key().to_bytes()), self.protect_workspace_secret(&STANDARD.encode(key.to_bytes()))?]).map_err(|e| e.to_string())?;
        Ok(key)
    }

    pub(crate) fn sign_member_control(&self, workspace: &Workspace, user: &str, role: &str, active: bool, operator: &str) -> Result<MemberControl, String> {
        let key = self.management_key(workspace)?;
        let previous: i64 = self.conn.query_row("SELECT COALESCE(MAX(version),0) FROM workspace_member_controls WHERE workspace_id=?", [&workspace.id], |r| r.get(0)).map_err(|e| e.to_string())?;
        let mut control = MemberControl { workspace_id: workspace.id.clone(), user_id: user.into(), role: role.into(), active,
            issuer_id: operator.into(), version: previous.max(chrono::Utc::now().timestamp_millis()) + 1,
            authority: STANDARD.encode(key.verifying_key().to_bytes()), signature: String::new() };
        control.signature = STANDARD.encode(key.sign(&control.body()?).to_bytes());
        self.store_member_control(&control)?;
        Ok(control)
    }

    fn store_member_control(&self, control: &MemberControl) -> Result<(), String> {
        self.conn.execute("INSERT INTO workspace_member_controls VALUES(?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET version=excluded.version,payload_json=excluded.payload_json WHERE excluded.version>workspace_member_controls.version",
            params![control.workspace_id, control.user_id, control.version, serde_json::to_string(control).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(crate) fn apply_member_control(&self, control: &MemberControl) -> Result<(), String> {
        let public: String = self.conn.query_row("SELECT public_key FROM workspace_management_keys WHERE workspace_id=?", [&control.workspace_id], |r| r.get(0)).map_err(|_| "工作区成员授权校验失败")?;
        control.verify(&public)?;
        let owner: String = self.conn.query_row("SELECT owner_id FROM workspaces WHERE id=?", [&control.workspace_id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if control.user_id == owner || control.role == "owner" { return Err("不能修改或移除工作区所有者".into()); }
        let current: i64 = self.conn.query_row("SELECT version FROM workspace_member_controls WHERE workspace_id=? AND user_id=?",
            params![control.workspace_id, control.user_id], |r| r.get(0)).optional().map_err(|e| e.to_string())?.unwrap_or(0);
        if current >= control.version { return Ok(()); }
        self.store_member_control(control)?;
        if control.active {
            let now = chrono::Utc::now().to_rfc3339();
            self.conn.execute("INSERT INTO workspace_members VALUES(?,?,?,'member',?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,status='member',reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by",
                params![control.workspace_id, control.user_id, control.role, now, now, control.issuer_id]).map_err(|e| e.to_string())?;
        } else {
            self.conn.execute("DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?", params![control.workspace_id, control.user_id]).map_err(|e| e.to_string())?;
        }
        if control.user_id == self.current_user_id()? && (!control.active || control.role != "admin") {
            self.conn.execute("UPDATE workspace_management_keys SET protected_secret=NULL WHERE workspace_id=?", [&control.workspace_id]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Retried on discovery even while another workspace is active. A removed
    /// member receives only their signed revocation, with no workspace secret.
    pub(crate) fn membership_packets_for(&self, recipient: &str) -> Result<Vec<MembershipPacket>, String> {
        let current_user = self.current_user_id()?;
        let recipient_key: String = self.conn.query_row("SELECT encryption_public FROM workspace_known_devices WHERE user_id=?", [recipient], |r| r.get(0)).map_err(|e| e.to_string())?;
        let ids = self.conn.prepare("SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=? AND m.status='member' AND m.role IN ('owner','admin')")
            .map_err(|e| e.to_string())?.query_map([&current_user], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for id in ids {
            let workspace: Workspace = self.conn.query_row("SELECT id,name,slug,logo,description,timezone,owner_id,created_at,updated_at FROM workspaces WHERE id=?", [&id], |r| Ok(Workspace {
                id:r.get(0)?,name:r.get(1)?,slug:r.get(2)?,logo:r.get(3)?,description:r.get(4)?,timezone:r.get(5)?,owner_id:r.get(6)?,created_at:r.get(7)?,updated_at:r.get(8)?,
            })).map_err(|e| e.to_string())?;
            let members = self.workspace_members(&id)?;
            let existing: Option<String> = self.conn.query_row("SELECT payload_json FROM workspace_member_controls WHERE workspace_id=? AND user_id=?", params![id, recipient], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
            let control = if let Some(raw) = existing { serde_json::from_str::<MemberControl>(&raw).map_err(|e| e.to_string())? }
            else if let Some(member) = members.iter().find(|m| m.user_id == recipient && m.user_id != workspace.owner_id) {
                // Upgrade existing admitted members without turning discovery
                // into a join path. Only the owning device can initialize keys.
                if workspace.owner_id != current_user { continue; }
                self.sign_member_control(&workspace, recipient, &member.role, true, &current_user)?
            } else { continue; };
            let token = if control.active { Some(self.conn.query_row("SELECT token FROM workspace_credentials WHERE workspace_id=?", [&id], |r| r.get(0)).map_err(|e| e.to_string())?) } else { None };
            let management_secret = if control.active && control.role == "admin" { Some(STANDARD.encode(self.management_key(&workspace)?.to_bytes())) } else { None };
            let sender_control = if current_user != workspace.owner_id {
                let raw: String = self.conn.query_row("SELECT payload_json FROM workspace_member_controls WHERE workspace_id=? AND user_id=?", params![id, current_user], |r| r.get(0)).map_err(|e| e.to_string())?;
                Some(serde_json::from_str(&raw).map_err(|e| e.to_string())?)
            } else { None };
            let member_controls = self.conn.prepare("SELECT payload_json FROM workspace_member_controls WHERE workspace_id=?")
                .map_err(|e| e.to_string())?.query_map([&id], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?
                .map(|row| serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())).collect::<Result<Vec<MemberControl>, String>>()?;
            let delivery = MemberDelivery { workspace, control, sender_control, member_controls, members, token, management_secret };
            let secret = StaticSecret::from(random_key());
            let shared = secret.diffie_hellman(&PublicKey::from(bytes32(&recipient_key)?)).to_bytes();
            let mut nonce = [0; 12]; rand::rngs::OsRng.fill_bytes(&mut nonce);
            let mut packet = MembershipPacket { kind:"workspaceMembership".into(), sender_id: current_user.clone(), recipient_id: recipient.into(),
                ephemeral_key:STANDARD.encode(PublicKey::from(&secret).to_bytes()), nonce:STANDARD.encode(nonce), payload:String::new(), signature:String::new() };
            let aad = format!("{}:{}", packet.sender_id, packet.recipient_id);
            packet.payload = STANDARD.encode(MembershipPacket::cipher(shared)?.encrypt(Nonce::from_slice(&nonce), Payload {
                msg:&serde_json::to_vec(&delivery).map_err(|e| e.to_string())?, aad:aad.as_bytes(),
            }).map_err(|_| "无法加密工作区邀请")?);
            packet.signature = self.sign_device_message(&packet.body()?)?;
            result.push(packet);
        }
        Ok(result)
    }

    /// Returns the newly available workspace. Receiving never changes the
    /// current scope; a revocation switches only when its workspace is active.
    pub(crate) fn receive_membership_packet(&self, packet: &MembershipPacket) -> Result<Option<Workspace>, String> {
        if packet.kind != "workspaceMembership" || packet.recipient_id != self.current_user_id()? || packet.payload.len() > 512 * 1024 {
            return Err("工作区邀请接收者不匹配".into());
        }
        self.verify_device_message(&packet.sender_id, &packet.body()?, &packet.signature)?;
        let shared = self.device_secrets()?.1.diffie_hellman(&PublicKey::from(bytes32(&packet.ephemeral_key)?)).to_bytes();
        let nonce = STANDARD.decode(&packet.nonce).map_err(|_| "无效的工作区邀请")?;
        if nonce.len() != 12 { return Err("无效的工作区邀请".into()); }
        let ciphertext = STANDARD.decode(&packet.payload).map_err(|_| "无效的工作区邀请")?;
        let aad = format!("{}:{}", packet.sender_id, packet.recipient_id);
        let body = MembershipPacket::cipher(shared)?.decrypt(Nonce::from_slice(&nonce), Payload { msg:&ciphertext, aad:aad.as_bytes() }).map_err(|_| "工作区邀请认证失败")?;
        let delivery: MemberDelivery = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
        let control = &delivery.control;
        if control.user_id != packet.recipient_id || control.workspace_id != delivery.workspace.id || control.role == "owner" {
            return Err("工作区邀请接收者不匹配".into());
        }
        if self.workspace_is_dissolved(&control.workspace_id)? { return Err("工作区已解散".into()); }
        let public: Option<String> = self.conn.query_row("SELECT public_key FROM workspace_management_keys WHERE workspace_id=?", [&control.workspace_id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
        control.verify(public.as_deref().unwrap_or(&control.authority))?;
        // A roster alone cannot establish the sender's management rights: an
        // ordinary member can copy another recipient's valid grant from sync.
        if packet.sender_id != delivery.workspace.owner_id {
            let sender = delivery.sender_control.as_ref().ok_or("工作区成员授权校验失败")?;
            sender.verify(&control.authority)?;
            if sender.workspace_id != control.workspace_id || sender.user_id != packet.sender_id || !sender.active || sender.role != "admin" {
                return Err("工作区成员授权校验失败".into());
            }
            let latest: Option<(i64, String)> = self.conn.query_row("SELECT version,payload_json FROM workspace_member_controls WHERE workspace_id=? AND user_id=?", params![control.workspace_id, packet.sender_id], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|e| e.to_string())?;
            if let Some((version, raw)) = latest {
                let latest: MemberControl = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
                if version > sender.version || !latest.active || latest.role != "admin" { return Err("工作区成员授权校验失败".into()); }
            }
        }
        if !delivery.members.iter().any(|m| m.user_id == packet.sender_id && m.workspace_id == control.workspace_id && m.status == "member" && matches!(m.role.as_str(),"owner"|"admin")) {
            return Err("只有工作区所有者或管理员可以添加成员".into());
        }
        // The device signature binds the complete roster and credentials, not
        // just the membership certificate, to the trusted sending manager.
        let old: i64 = self.conn.query_row("SELECT version FROM workspace_member_controls WHERE workspace_id=? AND user_id=?", params![control.workspace_id, control.user_id], |r| r.get(0)).optional().map_err(|e| e.to_string())?.unwrap_or(0);
        if old >= control.version { return Ok(None); }
        self.workspace_transaction("receive_workspace_membership", || {
            let existing: Option<String> = self.conn.query_row("SELECT owner_id FROM workspaces WHERE id=?", [&control.workspace_id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
            if existing.as_ref().is_some_and(|owner| *owner != delivery.workspace.owner_id) { return Err("工作区所有者不匹配".into()); }
            if !control.active && existing.is_none() {
                self.conn.execute("INSERT OR IGNORE INTO workspace_management_keys VALUES(?,?,NULL)", params![control.workspace_id,control.authority]).map_err(|e| e.to_string())?;
                self.store_member_control(control)?;
                return Ok(None);
            }
            let ws = &delivery.workspace;
            if control.active {
                let token = delivery.token.as_deref().filter(|s| !s.is_empty()).ok_or("工作区凭据缺失")?;
                self.conn.execute("INSERT OR IGNORE INTO workspaces VALUES(?,?,?,?,?,?,?,?,?)", params![ws.id,ws.name,ws.slug,ws.logo,ws.description,ws.timezone,ws.owner_id,ws.created_at,ws.updated_at]).map_err(|e| e.to_string())?;
                self.conn.execute("INSERT INTO workspace_credentials VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET token=excluded.token", params![ws.id,token]).map_err(|e| e.to_string())?;
                for member in &delivery.members {
                    if member.workspace_id != ws.id || member.user_id == control.user_id { continue; }
                    // A roster snapshot must never restore a user whose newer
                    // signed removal was already observed on this device.
                    self.conn.execute("INSERT OR IGNORE INTO workspace_members SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM workspace_member_controls WHERE workspace_id=?1 AND user_id=?2)", params![member.workspace_id,member.user_id,member.role,member.status,member.requested_at,member.reviewed_at,member.reviewed_by]).map_err(|e| e.to_string())?;
                }
            }
            let secret = if control.active && control.role == "admin" {
                let secret = delivery.management_secret.as_ref().ok_or("工作区管理授权缺失")?;
                if STANDARD.encode(SigningKey::from_bytes(&bytes32(secret)?).verifying_key().to_bytes()) != control.authority { return Err("工作区成员授权校验失败".into()); }
                Some(self.protect_workspace_secret(secret)?)
            } else { None };
            self.conn.execute("INSERT INTO workspace_management_keys VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET protected_secret=excluded.protected_secret", params![ws.id,control.authority,secret]).map_err(|e| e.to_string())?;
            for other in &delivery.member_controls {
                if other.workspace_id != ws.id { return Err("工作区成员授权校验失败".into()); }
                if other.user_id != control.user_id { self.apply_member_control(other)?; }
            }
            self.apply_member_control(control)?;
            if !control.active && self.workspace_context()?.workspace_id == ws.id {
                let user = self.current_user_id()?;
                let next = match self.list_workspaces()?.into_iter().find(|w| w.id != ws.id) {
                    Some(next) => next,
                    None => self.create_workspace("我的工作区", None, None, &user)?,
                };
                self.switch_workspace(&next.id, &user)?;
            }
            Ok(if control.active && existing.is_none() { Some(ws.clone()) } else { None })
        })
    }
}

#[cfg(test)]
#[path = "workspace_membership_tests.rs"]
mod tests;
