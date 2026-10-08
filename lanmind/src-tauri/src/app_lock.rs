use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, SaltString},
    Argon2, PasswordHasher, PasswordVerifier,
};
use serde::Serialize;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

pub const STATE_EVENT: &str = "app-lock://state";

#[derive(Clone)]
pub struct AppLockConfig {
    pub enabled: bool,
    pub idle_minutes: u32,
    pub password_hash: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLockStatus {
    pub revision: u64,
    pub enabled: bool,
    pub idle_minutes: u32,
    pub password_configured: bool,
    pub locked: bool,
}

struct LockState {
    config: AppLockConfig,
    last_activity: Instant,
    locked: bool,
    revision: u64,
}

impl LockState {
    fn status(&self) -> AppLockStatus {
        AppLockStatus {
            revision: self.revision,
            enabled: self.config.enabled,
            idle_minutes: self.config.idle_minutes,
            password_configured: !self.config.password_hash.is_empty(),
            locked: self.locked,
        }
    }
    fn expire(&mut self, now: Instant) -> bool {
        if self.config.enabled
            && !self.locked
            && now.saturating_duration_since(self.last_activity)
                >= Duration::from_secs(self.config.idle_minutes as u64 * 60)
        {
            self.locked = true;
            self.revision += 1;
            return true;
        }
        false
    }
}

pub struct AppLockRuntime(Mutex<LockState>);

impl AppLockRuntime {
    pub fn new(config: AppLockConfig) -> Self {
        // A restart must not bypass an existing interface lock.
        let locked = config.enabled;
        Self(Mutex::new(LockState {
            config,
            last_activity: Instant::now(),
            locked,
            revision: 0,
        }))
    }
    pub fn config(&self) -> Result<AppLockConfig, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "锁定状态暂时不可用")?
            .config
            .clone())
    }
    pub fn status(&self) -> Result<AppLockStatus, String> {
        Ok(self.0.lock().map_err(|_| "锁定状态暂时不可用")?.status())
    }
    pub fn tick(&self) -> Result<Option<AppLockStatus>, String> {
        self.tick_at(Instant::now())
    }
    fn tick_at(&self, now: Instant) -> Result<Option<AppLockStatus>, String> {
        let mut state = self.0.lock().map_err(|_| "锁定状态暂时不可用")?;
        Ok(state.expire(now).then(|| state.status()))
    }
    pub fn activity(&self) -> Result<AppLockStatus, String> {
        self.activity_at(Instant::now())
    }
    fn activity_at(&self, now: Instant) -> Result<AppLockStatus, String> {
        let mut state = self.0.lock().map_err(|_| "锁定状态暂时不可用")?;
        // Check elapsed time before accepting the first input after suspension.
        state.expire(now);
        if !state.locked {
            state.last_activity = now;
        }
        Ok(state.status())
    }
    pub fn configure(
        &self,
        config: AppLockConfig,
        expected_hash: &str,
        save: impl FnOnce(&AppLockConfig) -> Result<(), String>,
    ) -> Result<AppLockStatus, String> {
        let mut state = self.0.lock().map_err(|_| "锁定状态暂时不可用")?;
        state.expire(Instant::now());
        if state.locked {
            return Err("请先解锁程序界面".into());
        }
        if state.config.password_hash != expected_hash {
            return Err("锁定配置已更新，请重新操作".into());
        }
        save(&config)?;
        state.config = config;
        state.last_activity = Instant::now();
        state.revision += 1;
        Ok(state.status())
    }
    pub fn lock(&self) -> Result<AppLockStatus, String> {
        let mut state = self.0.lock().map_err(|_| "锁定状态暂时不可用")?;
        if state.config.password_hash.is_empty() {
            return Err("请先设置解锁密码".into());
        }
        if !state.locked {
            state.locked = true;
            state.revision += 1;
        }
        Ok(state.status())
    }
    pub fn unlock(&self, password: &str) -> Result<AppLockStatus, String> {
        let hash = self.config()?.password_hash;
        if !verify_password(password, &hash) {
            return Err("解锁密码不正确".into());
        }
        let mut state = self.0.lock().map_err(|_| "锁定状态暂时不可用")?;
        // Configuration changes during password verification cannot bypass a new hash.
        if state.config.password_hash != hash {
            return Err("密码已更新，请重新输入".into());
        }
        state.locked = false;
        state.last_activity = Instant::now();
        state.revision += 1;
        Ok(state.status())
    }
}

pub fn prepare_config(
    previous: &AppLockConfig,
    enabled: bool,
    idle_minutes: u32,
    password: Option<&str>,
    current_password: Option<&str>,
) -> Result<AppLockConfig, String> {
    if !(1..=1440).contains(&idle_minutes) {
        return Err("自动锁定时间必须为 1 到 1440 分钟".into());
    }
    if !previous.password_hash.is_empty()
        && !verify_password(current_password.unwrap_or(""), &previous.password_hash)
    {
        return Err("当前解锁密码不正确".into());
    }
    let password_hash = match password.filter(|value| !value.is_empty()) {
        Some(password) => hash_password(password)?,
        None => previous.password_hash.clone(),
    };
    if enabled && password_hash.is_empty() {
        return Err("启用自动锁定前请设置解锁密码".into());
    }
    Ok(AppLockConfig {
        enabled,
        idle_minutes,
        password_hash,
    })
}

pub fn prepare_password_clear(previous: &AppLockConfig, current_password: Option<&str>) -> Result<AppLockConfig, String> {
    // Clearing is a configuration change too: authenticate before removing the hash.
    let mut config = prepare_config(previous, false, previous.idle_minutes, None, current_password)?;
    config.password_hash.clear();
    Ok(config)
}

pub fn hash_password(password: &str) -> Result<String, String> {
    if !(8..=128).contains(&password.chars().count()) {
        return Err("解锁密码长度必须为 8 到 128 个字符".into());
    }
    Argon2::default()
        .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
        .map(|hash| hash.to_string())
        .map_err(|e| format!("无法保存解锁密码：{e}"))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    if password.chars().count() > 128 {
        return false;
    }
    PasswordHash::new(hash).ok().is_some_and(|hash| {
        Argon2::default()
            .verify_password(password.as_bytes(), &hash)
            .is_ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config(enabled: bool) -> AppLockConfig {
        AppLockConfig {
            enabled,
            idle_minutes: 5,
            password_hash: hash_password("correct password").unwrap(),
        }
    }

    #[test]
    fn disabled_idle_never_locks() {
        let runtime = AppLockRuntime::new(config(false));
        assert!(runtime
            .tick_at(Instant::now() + Duration::from_secs(86400))
            .unwrap()
            .is_none());
        assert!(!runtime.status().unwrap().locked);
    }
    #[test]
    fn startup_and_idle_require_the_correct_password() {
        let runtime = AppLockRuntime::new(config(true));
        assert!(runtime.status().unwrap().locked);
        assert!(runtime.unlock("incorrect").is_err());
        runtime.unlock("correct password").unwrap();
        let now = Instant::now();
        runtime.activity_at(now).unwrap();
        assert!(runtime
            .tick_at(now + Duration::from_secs(299))
            .unwrap()
            .is_none());
        assert!(
            runtime
                .tick_at(now + Duration::from_secs(300))
                .unwrap()
                .unwrap()
                .locked
        );
        assert!(
            runtime
                .activity_at(now + Duration::from_secs(301))
                .unwrap()
                .locked
        );
        assert!(runtime.configure(config(false), "", |_| Ok(())).is_err());
        assert!(!runtime.unlock("correct password").unwrap().locked);
    }
    #[test]
    fn input_resets_idle_but_cannot_bypass_an_expired_deadline() {
        let runtime = AppLockRuntime::new(config(true));
        runtime.unlock("correct password").unwrap();
        let now = Instant::now();
        runtime.activity_at(now).unwrap();
        runtime.activity_at(now + Duration::from_secs(250)).unwrap();
        assert!(runtime
            .tick_at(now + Duration::from_secs(500))
            .unwrap()
            .is_none());
        assert!(
            runtime
                .activity_at(now + Duration::from_secs(550))
                .unwrap()
                .locked
        );
    }
    #[test]
    fn password_hashes_reject_invalid_lengths_and_preserve_spaces() {
        assert!(hash_password("short").is_err());
        let hash = hash_password("  password  ").unwrap();
        assert!(verify_password("  password  ", &hash));
        assert!(!verify_password("password", &hash));
        assert!(!verify_password("anything", "invalid"));
    }

    #[test]
    fn failed_configuration_does_not_change_runtime_and_revisions_order_transitions() {
        let runtime = AppLockRuntime::new(config(false));
        let before = runtime.status().unwrap();
        let hash = runtime.config().unwrap().password_hash;
        assert!(runtime
            .configure(config(true), "outdated hash", |_| Ok(()))
            .is_err());
        assert!(runtime
            .configure(config(true), &hash, |_| Err("database unavailable".into()))
            .is_err());
        assert_eq!(runtime.status().unwrap(), before);
        let enabled = runtime.configure(config(true), &hash, |_| Ok(())).unwrap();
        assert!(enabled.enabled && !enabled.locked);
        assert!(enabled.revision > before.revision);
        let locked = runtime.lock().unwrap();
        assert!(locked.revision > enabled.revision);
        assert_eq!(runtime.activity().unwrap().revision, locked.revision);
        assert!(runtime.unlock("correct password").unwrap().revision > locked.revision);
    }

    #[test]
    fn clearing_password_requires_verification_and_disables_locking() {
        for enabled in [false, true] {
            let previous = config(enabled);
            assert!(prepare_password_clear(&previous, None).is_err());
            assert!(prepare_password_clear(&previous, Some("incorrect")).is_err());
            let cleared = prepare_password_clear(&previous, Some("correct password")).unwrap();
            assert!(!cleared.enabled);
            assert!(cleared.password_hash.is_empty());
            assert_eq!(cleared.idle_minutes, previous.idle_minutes);
            let runtime = AppLockRuntime::new(cleared);
            assert!(!runtime.status().unwrap().locked);
            assert!(runtime.lock().is_err());
            assert!(runtime.unlock("correct password").is_err());
        }
    }

    #[test]
    fn disabling_or_changing_password_requires_current_password_verification() {
        let previous = config(true);
        assert!(prepare_config(&previous, false, 5, None, None).is_err());
        assert!(
            prepare_config(&previous, true, 5, Some("new password"), Some("incorrect")).is_err()
        );
        let disabled =
            prepare_config(&previous, false, 12, None, Some("correct password")).unwrap();
        assert!(!disabled.enabled);
        assert_eq!(disabled.idle_minutes, 12);
        assert_eq!(disabled.password_hash, previous.password_hash);
        let changed = prepare_config(
            &previous,
            true,
            5,
            Some("new password"),
            Some("correct password"),
        )
        .unwrap();
        assert!(verify_password("new password", &changed.password_hash));
        assert!(!verify_password("correct password", &changed.password_hash));
        let empty = AppLockConfig {
            enabled: false,
            idle_minutes: 5,
            password_hash: String::new(),
        };
        assert!(prepare_config(&empty, true, 5, None, None).is_err());
        assert!(prepare_config(&empty, true, 0, Some("new password"), None).is_err());
        assert!(prepare_config(&empty, true, 1441, Some("new password"), None).is_err());
    }
}
