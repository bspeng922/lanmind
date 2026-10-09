use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;
use crate::db::Database;
use tauri::{AppHandle, Emitter, Manager};
tokio::task_local! { pub static REQUEST_LOCALE: String; }

pub fn text(key: &str) -> &'static str {
    let locale = REQUEST_LOCALE.try_with(Clone::clone).unwrap_or_else(|_| "zh-CN".into());
    resources()[&locale]["reports"][key].as_str().or_else(|| resources()["zh-CN"]["reports"][key].as_str()).unwrap_or("")
}

pub fn format(key: &str, params: &[(&str, String)]) -> String {
    let mut result = text(key).to_string();
    for (name, value) in params { result = result.replace(&format!("{{{name}}}"), value); }
    result
}

fn resources() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/locales.json"))).expect("embedded locales"))
}

pub fn match_locale(language: &str) -> Option<String> {
    let language = language.replace('_', "-").to_lowercase();
    let locales = resources().as_object()?;
    for (code, _) in locales { if code.to_lowercase() == language { return Some(code.clone()); } }
    for (code, data) in locales {
        if data["meta"]["aliases"].as_array().is_some_and(|aliases| aliases.iter().filter_map(Value::as_str).any(|alias| language == alias.to_lowercase() || language.starts_with(&format!("{}-", alias.to_lowercase())))) { return Some(code.clone()); }
    }
    None
}

pub fn resolve(preference: &str) -> String {
    if preference != "system" { return match_locale(preference).unwrap_or_else(|| "zh-CN".into()); }
    sys_locale::get_locales().find_map(|value| match_locale(&value)).unwrap_or_else(|| "zh-CN".into())
}

pub fn translate(locale: &str, namespace: &str, key: &str, params: &[(&str, String)]) -> String {
    fn lookup<'a>(data: &'a Value, key: &str) -> Option<&'a str> {
        if let Some(value) = data.get(key).and_then(Value::as_str) { return Some(value); }
        key.split('.').try_fold(data, |value, part| value.get(part)).and_then(Value::as_str)
    }
    let mut result = lookup(&resources()[locale][namespace], key).or_else(|| lookup(&resources()["zh-CN"][namespace], key)).unwrap_or(key).to_string();
    for (name, value) in params { result = result.replace(&format!("{{{{{name}}}}}"), value); }
    result
}

#[derive(Serialize)]
pub struct MessageDescriptor { pub code: String, pub params: serde_json::Map<String, Value> }

pub fn describe_message(message: &str) -> Option<MessageDescriptor> {
    static PATTERNS: OnceLock<Value> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| serde_json::from_str(include_str!("../../src/i18n/error-patterns.json")).expect("message patterns"));
    for pattern in patterns.as_array()? {
        let source = pattern["source"].as_str()?;
        let mut remaining = message;
        let mut template = source;
        let mut params = serde_json::Map::new();
        let mut positional = 0;
        let mut matches = true;
        while let Some(start) = template.find('{') {
            let Some(end) = template[start..].find('}').map(|value| value + start) else { matches = false; break; };
            let Some(rest) = remaining.strip_prefix(&template[..start]) else { matches = false; break; };
            let raw_name = &template[start + 1..end];
            let name = if raw_name.is_empty() { let name = format!("arg{positional}"); positional += 1; name } else { raw_name.to_string() };
            template = &template[end + 1..];
            let suffix = template.split('{').next().unwrap_or("");
            let position = if suffix.is_empty() { rest.len() } else if let Some(position) = rest.find(suffix) { position } else { matches = false; break; };
            params.insert(name, Value::String(rest[..position].to_string()));
            remaining = &rest[position..];
        }
        if matches && remaining == template {
            return Some(MessageDescriptor { code: pattern["key"].as_str()?.to_string(), params });
        }
    }
    None
}

pub fn localize_message(locale: &str, message: &str) -> String {
    let Some(descriptor) = describe_message(message) else { return message.to_string(); };
    let Some((namespace, key)) = descriptor.code.split_once(':') else { return message.to_string(); };
    let params = descriptor.params.iter().map(|(name, value)| (name.as_str(), value.as_str().unwrap_or_default().to_string())).collect::<Vec<_>>();
    translate(locale, namespace, key, &params)
}

pub fn localize_dataset(locale: &str, dataset: &mut crate::db::ReportDataset) {
    for record in &mut dataset.records {
        for note in &mut record.event_notes { *note = localize_message(locale, note); }
    }
    for note in &mut dataset.data_notes { *note = localize_message(locale, note); }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocaleState { pub preference: String, pub locale: String }

impl Database {
    pub fn locale_settings(&self) -> Result<LocaleState, String> {
        let preference = self.setting("localePreference")?.filter(|value| value == "system" || resources().get(value).is_some()).unwrap_or_else(|| "system".into());
        let locale = resolve(&preference);
        Ok(LocaleState { preference, locale })
    }
    pub fn save_locale_preference(&self, preference: &str) -> Result<LocaleState, String> {
        if preference != "system" && resources().get(preference).is_none() { return Err("Unsupported locale".into()); }
        self.save_local_setting("localePreference", preference)?;
        self.locale_settings()
    }
}

pub fn app_locale(app: &AppHandle) -> String {
    app.try_state::<crate::AppState>().and_then(|state| state.db.lock().ok().and_then(|db| db.locale_settings().ok())).map(|state| state.locale).unwrap_or_else(|| resolve("system"))
}

pub fn update_native(app: &AppHandle, locale: &str) {
    for (label, key) in [("main", "titles.main"), ("quick-add", "titles.quickAdd"), ("notification", "titles.notification"), ("tray-unread", "titles.trayUnread"), ("desktop-calendar", "titles.calendar"), ("optical-transfer", "titles.optical")] {
        if let Some(window) = app.get_webview_window(label) { let _ = window.set_title(&translate(locale, "native", key, &[])); }
    }
    if let Some(tray) = app.tray_by_id("main-tray") {
        let unread = app.try_state::<crate::AppState>().and_then(|state| state.tray_unread.lock().ok().map(|users| users.iter().map(|user| translate(locale, "native", "tray.unread", &[("name", user.name.clone()), ("count", user.count.to_string())])).collect::<Vec<_>>()));
        let tooltip = unread.filter(|lines| !lines.is_empty()).map(|lines| lines.join("\n")).unwrap_or_else(|| translate(locale, "native", "tray.tooltip", &[]));
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

#[tauri::command]
pub fn get_locale_settings(app: AppHandle, state: tauri::State<crate::AppState>) -> Result<LocaleState, String> {
    let settings = state.db.lock().map_err(|_| "Database unavailable")?.locale_settings()?;
    update_native(&app, &settings.locale);
    crate::refresh_tray_locale(&app);
    Ok(settings)
}

#[tauri::command]
pub fn set_locale_preference(app: AppHandle, state: tauri::State<crate::AppState>, preference: String) -> Result<LocaleState, String> {
    let settings = state.db.lock().map_err(|_| "Database unavailable")?.save_locale_preference(&preference)?;
    update_native(&app, &settings.locale);
    crate::refresh_tray_locale(&app);
    let _ = app.emit("i18n://changed", &settings);
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn matches_variants_and_falls_back() { assert_eq!(match_locale("en_GB").as_deref(), Some("en-US")); assert_eq!(match_locale("zh-Hans").as_deref(), Some("zh-CN")); assert_eq!(match_locale("xx"), None); }
    #[test] fn shares_catalog_with_renderer() { assert_eq!(translate("en-US", "native", "tray.show", &[]), "Show main window"); assert_eq!(translate("xx", "native", "tray.show", &[]), "显示主界面"); }
    #[test]
    fn legacy_errors_have_stable_parameters_and_preserve_user_text() {
        let descriptor = describe_message("任务 中文任务 的标题不能为空").unwrap();
        assert_eq!(descriptor.code, "errors:taskTitleRequired");
        assert_eq!(descriptor.params["arg0"], "中文任务");
        assert_eq!(localize_message("en-US", "任务 中文任务 的标题不能为空"), "Task 中文任务 needs a title");
        assert_eq!(localize_message("en-US", "文件传输未完成（80/100）"), "File transfer incomplete (80/100)");
        assert_eq!(localize_message("en-US", "transport detail E123"), "transport detail E123");
    }
    #[test]
    fn locale_preference_persists_locally() {
        let path = std::env::temp_dir().join(format!("lanmind-locale-{}.sqlite", uuid::Uuid::new_v4()));
        {
            let db = Database::open(&path).unwrap();
            assert_eq!(db.locale_settings().unwrap().preference, "system");
            assert_eq!(db.save_locale_preference("en-US").unwrap().locale, "en-US");
            assert!(db.save_locale_preference("invalid").is_err());
        }
        {
            let db = Database::open(&path).unwrap();
            assert_eq!(db.locale_settings().unwrap().preference, "en-US");
        }
        let _ = std::fs::remove_file(path);
    }
    #[tokio::test]
    async fn concurrent_generation_languages_are_isolated() {
        let english = REQUEST_LOCALE.scope("en-US".into(), async {
            tokio::task::yield_now().await;
            text("runtime.dailyReport")
        });
        let chinese = REQUEST_LOCALE.scope("zh-CN".into(), async {
            tokio::task::yield_now().await;
            text("runtime.dailyReport")
        });
        assert_eq!(tokio::join!(english, chinese), ("Daily report", "日报"));
    }
}
