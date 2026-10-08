//! Recoverable local access password. Never included in web status or task exports.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::Path;

pub fn protect(password: &str, data_dir: &Path) -> Result<String, String> {
    Ok(STANDARD.encode(protect_bytes(password.as_bytes(), data_dir)?))
}

pub fn reveal(protected: &str, data_dir: &Path) -> Result<String, String> {
    let bytes = STANDARD.decode(protected).map_err(|_| "保存的访问密码格式无效")?;
    String::from_utf8(reveal_bytes(&bytes, data_dir)?).map_err(|_| "保存的访问密码编码无效".into())
}

#[cfg(windows)]
fn transform(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // DPAPI scopes the encrypted value to the current Windows user. Both calls
    // allocate output with LocalAlloc; copy it and free it before returning.
    unsafe {
        let ok = if encrypt {
            CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        } else {
            CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        };
        if ok == 0 {
            return Err(format!("无法{}访问密码：{}", if encrypt { "保存" } else { "读取" }, std::io::Error::last_os_error()));
        }
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData.cast());
        Ok(result)
    }
}

#[cfg(windows)]
fn protect_bytes(bytes: &[u8], _data_dir: &Path) -> Result<Vec<u8>, String> { transform(bytes, true) }
#[cfg(windows)]
fn reveal_bytes(bytes: &[u8], _data_dir: &Path) -> Result<Vec<u8>, String> { transform(bytes, false) }

// Other desktop platforms use a private per-installation key file. Reading a
// password never creates or replaces a missing key.
#[cfg(not(windows))]
fn cipher(data_dir: &Path, create: bool) -> Result<chacha20poly1305::ChaCha20Poly1305, String> {
    use chacha20poly1305::KeyInit;
    use rand::RngCore;
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let path = data_dir.join("web-password.key");
    if create {
        let mut key = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut key);
        match std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path) {
            Ok(mut file) => file.write_all(&key).map_err(|e| e.to_string())?,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    let key = std::fs::read(path).map_err(|_| "无法读取本机密码密钥")?;
    chacha20poly1305::ChaCha20Poly1305::new_from_slice(&key).map_err(|_| "本机密码密钥无效".into())
}

#[cfg(not(windows))]
fn protect_bytes(bytes: &[u8], data_dir: &Path) -> Result<Vec<u8>, String> {
    use chacha20poly1305::{aead::Aead, Nonce};
    use rand::RngCore;
    let mut nonce = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher(data_dir, true)?.encrypt(Nonce::from_slice(&nonce), bytes).map_err(|_| "无法保存访问密码")?;
    Ok([nonce.to_vec(), encrypted].concat())
}

#[cfg(not(windows))]
fn reveal_bytes(bytes: &[u8], data_dir: &Path) -> Result<Vec<u8>, String> {
    use chacha20poly1305::{aead::Aead, Nonce};
    if bytes.len() < 28 { return Err("保存的访问密码格式无效".into()); }
    cipher(data_dir, false)?.decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..]).map_err(|_| "无法读取访问密码".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_password_survives_reload_and_rejects_tampering() {
        let dir = std::env::temp_dir().join(format!("lanmind-password-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let password = "网络伺服-password-123";
        let protected = protect(password, &dir).unwrap();
        assert!(!protected.contains(password));
        let file = dir.join("protected.txt");
        std::fs::write(&file, &protected).unwrap();
        assert_eq!(reveal(&std::fs::read_to_string(file).unwrap(), &dir).unwrap(), password);
        let mut bytes = STANDARD.decode(protected).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        assert!(reveal(&STANDARD.encode(bytes), &dir).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
