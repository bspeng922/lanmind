//! Durable, workspace-authenticated dissolution notices survive business-data
//! removal and workspace switches. Discovery relays only the encrypted notice;
//! it never publishes a workspace credential or business records.
use crate::db::Database;
use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::{aead::{Aead, KeyInit, Payload}, ChaCha20Poly1305, Nonce};
use rand::RngCore;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DissolutionPacket {
    kind: String,
    version: u8,
    pub workspace_id: String,
    nonce: String,
    payload: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DissolutionNotice {
    workspace_id: String,
    owner_id: String,
    dissolved_at: String,
}

impl DissolutionPacket {
    fn cipher(token: &str) -> ChaCha20Poly1305 {
        let key = Sha256::digest(format!("lanmind-workspace-dissolution-v1:{token}"));
        ChaCha20Poly1305::new(&key)
    }

    fn seal(notice: &DissolutionNotice, token: &str) -> Result<Self, String> {
        let mut nonce = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce);
        let body = serde_json::to_vec(notice).map_err(|e| e.to_string())?;
        let payload = Self::cipher(token).encrypt(Nonce::from_slice(&nonce), Payload {
            msg: &body, aad: notice.workspace_id.as_bytes(),
        }).map_err(|_| "无法加密工作区解散记录".to_string())?;
        Ok(Self { kind: "workspaceDissolution".into(), version: 1,
            workspace_id: notice.workspace_id.clone(), nonce: STANDARD.encode(nonce),
            payload: STANDARD.encode(payload) })
    }

    fn open(&self, token: &str) -> Result<DissolutionNotice, String> {
        if self.kind != "workspaceDissolution" || self.version != 1 || self.payload.len() > 4096 {
            return Err("无效的工作区解散记录".into());
        }
        let nonce = STANDARD.decode(&self.nonce).map_err(|_| "无效的解散记录随机数")?;
        if nonce.len() != 12 { return Err("无效的解散记录随机数".into()); }
        let ciphertext = STANDARD.decode(&self.payload).map_err(|_| "无效的工作区解散记录")?;
        let body = Self::cipher(token).decrypt(Nonce::from_slice(&nonce), Payload {
            msg: &ciphertext, aad: self.workspace_id.as_bytes(),
        }).map_err(|_| "工作区解散记录认证失败".to_string())?;
        let notice: DissolutionNotice = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
        if notice.workspace_id != self.workspace_id || chrono::DateTime::parse_from_rfc3339(&notice.dissolved_at).is_err() {
            return Err("无效的工作区解散记录".into());
        }
        Ok(notice)
    }
}

impl Database {
    pub(crate) fn install_workspace_dissolutions(&self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS workspace_dissolutions (
            workspace_id TEXT PRIMARY KEY NOT NULL, packet_json TEXT NOT NULL
        );").map_err(|e| e.to_string())
    }

    pub(crate) fn workspace_is_dissolved(&self, workspace_id: &str) -> Result<bool, String> {
        self.conn.query_row("SELECT EXISTS(SELECT 1 FROM workspace_dissolutions WHERE workspace_id=?)",
            params![workspace_id], |r| r.get(0)).map_err(|e| e.to_string())
    }

    pub(crate) fn dissolution_packets(&self) -> Result<Vec<DissolutionPacket>, String> {
        let mut statement = self.conn.prepare("SELECT packet_json FROM workspace_dissolutions ORDER BY workspace_id").map_err(|e| e.to_string())?;
        let rows = statement.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        rows.map(|row| serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())).collect()
    }

    pub(crate) fn dissolve_workspace(&self, workspace_id: &str, operator: &str, confirmation_name: &str) -> Result<bool, String> {
        self.workspace_transaction("dissolve_workspace", || {
            if self.current_user_id()? != operator { return Err("请求用户与当前桌面会话身份不一致，请刷新后重试".into()); }
            let (name, owner): (String, String) = self.conn.query_row(
                "SELECT name,owner_id FROM workspaces WHERE id=?", params![workspace_id],
                |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|e| e.to_string())?.ok_or("工作区不存在")?;
            if owner != operator { return Err("只有工作区所有者可以解散工作区".into()); }
            if name != confirmation_name { return Err("工作区名称不匹配，请输入完整名称确认解散".into()); }
            let token: String = self.conn.query_row("SELECT token FROM workspace_credentials WHERE workspace_id=?",
                params![workspace_id], |r| r.get(0)).map_err(|e| e.to_string())?;
            let packet = DissolutionPacket::seal(&DissolutionNotice {
                workspace_id: workspace_id.into(), owner_id: owner, dissolved_at: chrono::Utc::now().to_rfc3339(),
            }, &token)?;
            self.apply_workspace_dissolution(&packet)
        })
    }

    pub(crate) fn apply_workspace_dissolution(&self, packet: &DissolutionPacket) -> Result<bool, String> {
        self.workspace_transaction("apply_workspace_dissolution", || {
            if self.workspace_is_dissolved(&packet.workspace_id)? { return Ok(false); }
            let credentials: Option<(String, String)> = self.conn.query_row(
                "SELECT w.owner_id,c.token FROM workspaces w JOIN workspace_credentials c ON c.workspace_id=w.id WHERE w.id=?",
                params![packet.workspace_id], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|e| e.to_string())?;
            let Some((owner, token)) = credentials else { return Ok(false); };
            let notice = packet.open(&token)?;
            if notice.owner_id != owner { return Err("只有工作区所有者可以解散工作区".into()); }

            // Persist the tombstone in the same transaction as the purge. It is
            // independent of sync_operations, which is removed with the workspace.
            self.conn.execute("INSERT INTO workspace_dissolutions(workspace_id,packet_json) VALUES(?,?)",
                params![packet.workspace_id, serde_json::to_string(packet).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
            if self.workspace_context()?.workspace_id == packet.workspace_id {
                let user = self.current_user_id()?;
                let next = self.list_workspaces()?.into_iter().find(|ws| ws.id != packet.workspace_id);
                let next = match next {
                    Some(next) => next,
                    None => {
                        let locale = crate::i18n::resolve(&self.setting("localePreference")?.unwrap_or_else(|| "system".into()));
                        let name = crate::i18n::translate(&locale, "settings", "workspaceSettings.personalWorkspace", &[]);
                        self.create_workspace(&name, None, None, &user)?
                    }
                };
                self.switch_workspace(&next.id, &user)?;
            }
            self.purge_workspace_records(&packet.workspace_id)?;
            Ok(true)
        })
    }
}

#[cfg(test)]
#[path = "workspace_dissolution_tests.rs"]
mod tests;
