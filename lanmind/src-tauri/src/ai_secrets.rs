//! Model/MCP credentials are never part of configuration DTOs or sync data.
use crate::ai_types::{AiError, AiResult};

pub fn protect(value: &str) -> AiResult<String> {
    #[cfg(windows)]
    {
        let encrypted =
            crate::local_password::protect(value, std::path::Path::new("")).map_err(|_| {
                AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "无法使用系统密钥保护凭据")
            })?;
        if crate::local_password::reveal(&encrypted, std::path::Path::new(""))
            .ok()
            .as_deref()
            != Some(value)
        {
            return Err(AiError::new(
                "CREDENTIAL_STORE_UNAVAILABLE",
                "无法验证系统保护的凭据",
            ));
        }
        return Ok(format!("dpapi:{encrypted}"));
    }
    #[cfg(not(windows))]
    {
        use base64::Engine;
        use chacha20poly1305::{aead::Aead, KeyInit, Nonce};
        use rand::RngCore;
        // Keep only a small encryption key in the OS keyring. Large recovery
        // records and document backups remain encrypted in their owning file.
        let mut key = [0u8; 32];
        let mut nonce = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut key);
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let cipher = chacha20poly1305::ChaCha20Poly1305::new_from_slice(&key)
            .map_err(|_| AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "无法初始化凭据保护"))?;
        let encrypted = cipher
            .encrypt(Nonce::from_slice(&nonce), value.as_bytes())
            .map_err(|_| AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "无法加密凭据"))?;
        let encoded_key = base64::engine::general_purpose::STANDARD.encode(key);
        let name = crate::ai_types::id("credential");
        let entry = keyring::Entry::new("LanMind.AI", &name)
            .map_err(|_| AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "系统凭据库不可用"))?;
        entry.set_password(&encoded_key).map_err(|_| {
            AiError::new(
                "CREDENTIAL_STORE_UNAVAILABLE",
                "无法写入系统凭据库，请解锁后重试",
            )
        })?;
        if entry.get_password().ok().as_deref() != Some(encoded_key.as_str()) {
            let _ = entry.delete_credential();
            return Err(AiError::new(
                "CREDENTIAL_STORE_UNAVAILABLE",
                "无法验证系统凭据，请解锁后重试",
            ));
        }
        let mut sealed = nonce.to_vec();
        sealed.extend(encrypted);
        Ok(format!(
            "keyring-aead:{name}:{}",
            base64::engine::general_purpose::STANDARD.encode(sealed)
        ))
    }
}

pub fn reveal(reference: &str) -> AiResult<String> {
    #[cfg(windows)]
    {
        let encrypted = reference
            .strip_prefix("dpapi:")
            .ok_or_else(|| AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "凭据不属于当前系统"))?;
        return crate::local_password::reveal(encrypted, std::path::Path::new(""))
            .map_err(|_| AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "无法读取系统保护的凭据"));
    }
    #[cfg(not(windows))]
    {
        use base64::Engine;
        use chacha20poly1305::{aead::Aead, KeyInit, Nonce};
        if let Some(envelope) = reference.strip_prefix("keyring-aead:") {
            let (name, encoded) = envelope
                .split_once(':')
                .ok_or_else(|| AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "凭据格式无效"))?;
            let key = keyring::Entry::new("LanMind.AI", name)
                .and_then(|entry| entry.get_password())
                .map_err(|_| {
                    AiError::new(
                        "CREDENTIAL_STORE_UNAVAILABLE",
                        "无法读取系统凭据，请解锁后重试",
                    )
                })?;
            let decode = |value: &str| {
                base64::engine::general_purpose::STANDARD
                    .decode(value)
                    .map_err(|_| AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "凭据格式无效"))
            };
            let key = decode(&key)?;
            let sealed = decode(encoded)?;
            if sealed.len() < 28 {
                return Err(AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "凭据格式无效"));
            }
            let cipher = chacha20poly1305::ChaCha20Poly1305::new_from_slice(&key)
                .map_err(|_| AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "凭据密钥无效"))?;
            let bytes = cipher
                .decrypt(Nonce::from_slice(&sealed[..12]), &sealed[12..])
                .map_err(|_| AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "凭据校验失败"))?;
            return String::from_utf8(bytes)
                .map_err(|_| AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "凭据内容无效"));
        }
        let name = reference
            .strip_prefix("keyring:")
            .ok_or_else(|| AiError::new("CREDENTIAL_STORE_UNAVAILABLE", "凭据不属于当前系统"))?;
        keyring::Entry::new("LanMind.AI", name)
            .and_then(|entry| entry.get_password())
            .map_err(|_| {
                AiError::new(
                    "CREDENTIAL_STORE_UNAVAILABLE",
                    "无法读取系统凭据，请解锁后重试",
                )
            })
    }
}
