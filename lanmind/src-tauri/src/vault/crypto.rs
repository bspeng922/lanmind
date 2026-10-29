use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::{
    aead::{Aead, Payload},
    KeyInit, XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sealed {
    pub nonce: String,
    pub ciphertext: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    pub version: u32,
    pub vault_id: String,
    pub salt: String,
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
    pub wrapped_key: Sealed,
}
pub fn random_key() -> Zeroizing<[u8; 32]> {
    let mut key = Zeroizing::new([0; 32]);
    OsRng.fill_bytes(key.as_mut());
    key
}
pub fn derive(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(65536, 3, 1, Some(32)).map_err(|_| "VAULT_CRYPTO")?;
    let mut key = Zeroizing::new([0; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|_| "VAULT_CRYPTO")?;
    Ok(key)
}
pub fn seal(key: &[u8; 32], bytes: &[u8], aad: &[u8]) -> Result<Sealed, String> {
    let mut nonce = [0; 24];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = XChaCha20Poly1305::new(key.into())
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: bytes, aad })
        .map_err(|_| "VAULT_CRYPTO")?;
    Ok(Sealed {
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(ciphertext),
    })
}
pub fn open(key: &[u8; 32], sealed: &Sealed, aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    let nonce = B64.decode(&sealed.nonce).map_err(|_| "VAULT_CORRUPT")?;
    if nonce.len() != 24 {
        return Err("VAULT_CORRUPT".into());
    }
    let ciphertext = B64
        .decode(&sealed.ciphertext)
        .map_err(|_| "VAULT_CORRUPT")?;
    XChaCha20Poly1305::new(key.into())
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| "VAULT_CORRUPT".into())
}
pub fn wrap(password: &str, vault_id: String, key: &[u8; 32]) -> Result<Header, String> {
    let mut salt = [0; 16];
    OsRng.fill_bytes(&mut salt);
    let wrapping = derive(password, &salt)?;
    let wrapped_key = seal(
        &wrapping,
        key,
        format!("lanmind-vault-key-v1:{vault_id}").as_bytes(),
    )?;
    Ok(Header {
        version: 1,
        vault_id,
        salt: B64.encode(salt),
        memory_kib: 65536,
        iterations: 3,
        parallelism: 1,
        wrapped_key,
    })
}
pub fn unwrap(password: &str, header: &Header) -> Result<Zeroizing<[u8; 32]>, String> {
    if header.version != 1
        || header.memory_kib != 65536
        || header.iterations != 3
        || header.parallelism != 1
    {
        return Err("VAULT_FORMAT".into());
    }
    let salt = B64.decode(&header.salt).map_err(|_| "VAULT_CORRUPT")?;
    if salt.len() != 16 {
        return Err("VAULT_CORRUPT".into());
    }
    let wrapping = derive(password, &salt)?;
    let bytes = open(
        &wrapping,
        &header.wrapped_key,
        format!("lanmind-vault-key-v1:{}", header.vault_id).as_bytes(),
    )
    .map_err(|_| "VAULT_PASSWORD")?;
    let mut key = Zeroizing::new([0; 32]);
    if bytes.len() != 32 {
        return Err("VAULT_CORRUPT".into());
    }
    key.copy_from_slice(&bytes);
    Ok(key)
}
