//! App-wide built-in module switches. Business data and workspace boundaries stay intact.
use crate::{db::Database, AppState};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager, State};

const SETTING: &str = "featureModulesV1";
pub type FeatureState = BTreeMap<String, bool>;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    pub id: String,
    pub commands: Vec<String>,
    #[serde(default)]
    pub command_prefixes: Vec<String>,
}
pub fn definitions() -> &'static Vec<Definition> {
    static CATALOG: OnceLock<Vec<Definition>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let mut items: Vec<Definition> =
            serde_json::from_str(include_str!("../../src/modules/catalog.json"))
                .expect("module catalog");
        items.push(
            serde_json::from_str(include_str!("../../plugins/optical-transfer/manifest.json"))
                .expect("optical manifest"),
        );
        items.push(serde_json::from_str(include_str!("../../plugins/password-vault/manifest.json")).expect("vault manifest"));
        items
    })
}
pub fn command_feature(command: &str) -> Option<&'static str> {
    definitions()
        .iter()
        .find(|item| {
            item.commands.iter().any(|name| name == command)
                || item
                    .command_prefixes
                    .iter()
                    .any(|prefix| command.starts_with(prefix))
        })
        .map(|item| item.id.as_str())
}
pub fn entity_feature(entity: &str) -> Option<&'static str> {
    match entity {
        "chat_message" | "chat_group" | "group_announcement" => Some("chat"),
        "wiki_document" => Some("wiki"),
        _ => None,
    }
}

pub async fn while_ai_enabled<T>(
    state: &AppState,
    operation: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let cancel = state.ai.legacy_cancellation()?;
    state
        .db
        .lock()
        .map_err(|_| "STORAGE_UNAVAILABLE")?
        .require_feature("ai")?;
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("FEATURE_DISABLED:ai".into()),
        result = operation => result,
    }
}
impl Database {
    pub fn feature_modules(&self) -> Result<FeatureState, String> {
        let stored: FeatureState = self
            .setting(SETTING)?
            .map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))
            .transpose()?
            .unwrap_or_default();
        Ok(definitions()
            .iter()
            .map(|item| {
                (
                    item.id.clone(),
                    stored.get(&item.id).copied().unwrap_or(true),
                )
            })
            .collect())
    }
    pub fn feature_enabled(&self, id: &str) -> bool {
        self.feature_modules()
            .ok()
            .and_then(|items| items.get(id).copied())
            .unwrap_or(false)
    }
    pub fn require_feature(&self, id: &str) -> Result<(), String> {
        if self.feature_enabled(id) {
            Ok(())
        } else {
            Err(format!("FEATURE_DISABLED:{id}"))
        }
    }
    pub(crate) fn set_feature_enabled(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<FeatureState, String> {
        let mut items = self.feature_modules()?;
        let flag = items.get_mut(id).ok_or("UNKNOWN_FEATURE")?;
        *flag = enabled;
        self.save_local_setting(
            SETTING,
            &serde_json::to_string(&items).map_err(|e| e.to_string())?,
        )?;
        Ok(items)
    }
}
#[tauri::command]
pub fn get_feature_modules(state: State<AppState>) -> Result<FeatureState, String> {
    state
        .db
        .lock()
        .map_err(|_| "STORAGE_UNAVAILABLE")?
        .feature_modules()
}
#[tauri::command]
pub fn set_feature_module_enabled(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    enabled: bool,
) -> Result<FeatureState, String> {
    if crate::app_interface_locked(&app) {
        return Err("APP_LOCKED".into());
    }
    let items = state
        .db
        .lock()
        .map_err(|_| "STORAGE_UNAVAILABLE")?
        .set_feature_enabled(&id, enabled)?;
    if !enabled {
        match id.as_str() {
            "vault" => crate::vault::lock(&app),
            "ai" => state.ai.cancel_all(),
            "wiki" => state.ai.wiki_polish.cancel_matching(|_, _| true),
            "chat" => {
                crate::screenshot::cancel(&app);
                let scope = state
                    .db
                    .lock()
                    .map_err(|_| "STORAGE_UNAVAILABLE")?
                    .workspace_context()?;
                crate::update_tray_unread_status(
                    app.clone(),
                    app.state::<AppState>(),
                    Vec::new(),
                    scope,
                )?;
                if let Ok(mut pending) = state.pending_notifications.lock() {
                    pending.retain(|item| item["kind"] != "message" && item["feature"] != "chat");
                }
                if let Some(window) = app.get_webview_window("tray-unread") {
                    let _ = window.hide();
                }
            }
            "optical" => {
                if let Some(window) = app.get_webview_window("optical-transfer") {
                    let _ = window.destroy();
                }
                crate::optical::deactivate();
            }
            _ => {}
        }
    }
    app.emit("features://changed", &items)
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_covers_plugin_commands_without_claiming_task_sync() {
        assert_eq!(command_feature("optical_cache_write"), Some("optical"));
        assert_eq!(command_feature("send_chat_message"), Some("chat"));
        assert_eq!(command_feature("ai_api"), Some("ai"));
        assert_eq!(command_feature("save_wiki_changes"), Some("wiki"));
        assert_eq!(command_feature("sync_now"), None);
        assert_eq!(command_feature("create_task"), None);
    }
    #[test]
    fn switches_are_local_persistent_and_keep_business_data() {
        let db = Database::open(std::path::Path::new(":memory:")).unwrap();
        assert!(db
            .feature_modules()
            .unwrap()
            .values()
            .all(|enabled| *enabled));
        db.set_feature_enabled("chat", false).unwrap();
        assert!(db.require_feature("chat").is_err());
        assert!(db.feature_enabled("wiki"));
        assert!(db.set_feature_enabled("unknown", false).is_err());
        db.set_feature_enabled("chat", true).unwrap();
        assert!(db.require_feature("chat").is_ok());
    }

    #[test]
    fn disabling_chat_preserves_history_and_task_sync_across_workspaces() {
        use serde_json::json;
        let db = Database::open(std::path::Path::new(":memory:")).unwrap();
        let user = db.current_user_id().unwrap();
        let original = db.workspace_context().unwrap();
        let task = db.create_task(json!({"title":"Core task","description":"","priority":"P2","status":"todo","dueDate":null,"recurrence":"none","assigneeId":user,"creatorId":user,"isShared":false,"sharedWith":[],"tags":[],"subtasks":[]}), &user).unwrap();
        let message = db.save_chat_message(json!({"senderId":user,"senderName":"Me","receiverId":null,"groupId":null,"type":"text","content":"Preserve this history"})).unwrap();
        let operations = db.sync_operations_for_user(&user).unwrap();
        let mut incoming = operations
            .iter()
            .find(|op| op.entity_type == "chat_message")
            .unwrap()
            .clone();
        incoming.id = uuid::Uuid::new_v4().to_string();
        db.set_feature_enabled("chat", false).unwrap();
        assert!(db
            .apply_operation(&incoming)
            .unwrap_err()
            .starts_with("FEATURE_DISABLED:"));
        let outgoing = db.sync_operations_for_user(&user).unwrap();
        assert!(outgoing
            .iter()
            .all(|op| entity_feature(&op.entity_type) != Some("chat")));
        assert!(outgoing
            .iter()
            .any(|op| op.entity_type == "task" && op.entity_id == task.id));
        let next = db
            .create_workspace("Other workspace", None, None, &user)
            .unwrap();
        db.switch_workspace(&next.id, &user).unwrap();
        assert!(!db.feature_enabled("chat"));
        db.switch_workspace(&original.workspace_id, &user).unwrap();
        db.set_feature_enabled("chat", true).unwrap();
        assert!(db
            .chat_messages(&user, None)
            .unwrap()
            .iter()
            .any(|item| item.id == message.id));
        assert!(db
            .tasks(Some(&user))
            .unwrap()
            .iter()
            .any(|item| item.id == task.id));
    }

    #[test]
    fn module_choices_survive_reopening_the_database() {
        let path =
            std::env::temp_dir().join(format!("lanmind-features-{}.sqlite", uuid::Uuid::new_v4()));
        {
            let db = Database::open(&path).unwrap();
            db.set_feature_enabled("optical", false).unwrap();
        }
        {
            let db = Database::open(&path).unwrap();
            assert!(!db.feature_enabled("optical"));
            assert!(db.feature_enabled("ai"));
        }
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn stopping_ai_cancels_active_generation_and_allows_a_fresh_generation() {
        let runtime = crate::ai_runtime::AiRuntime::default();
        let original = runtime.legacy_cancellation().unwrap();
        let child = original.child_token();
        runtime.cancel_all();
        assert!(original.is_cancelled());
        assert!(child.is_cancelled());
        assert!(!runtime.legacy_cancellation().unwrap().is_cancelled());
    }
}
