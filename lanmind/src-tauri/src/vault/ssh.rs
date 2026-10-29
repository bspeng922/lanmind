use super::model::Entry;
use ssh_key::{Algorithm, HashAlg, LineEnding, PrivateKey, PublicKey};

pub fn validate(entry: &mut Entry) -> Result<(), String> {
    let public = if !entry.private_key.trim().is_empty() {
        let mut private = PrivateKey::from_openssh(&entry.private_key).map_err(|_| "VAULT_SSH")?;
        if private.is_encrypted() {
            private = private
                .decrypt(entry.key_passphrase.as_bytes())
                .map_err(|_| "VAULT_SSH_PASSWORD")?;
        }
        let public = private.public_key().clone();
        if !entry.public_key.trim().is_empty() {
            let supplied = PublicKey::from_openssh(&entry.public_key).map_err(|_| "VAULT_SSH")?;
            if supplied.key_data() != public.key_data() {
                return Err("VAULT_SSH_MISMATCH".into());
            }
        }
        public
    } else {
        PublicKey::from_openssh(&entry.public_key).map_err(|_| "VAULT_SSH")?
    };
    if !matches!(
        public.algorithm(),
        Algorithm::Ed25519 | Algorithm::Rsa { .. }
    ) {
        return Err("VAULT_SSH".into());
    }
    entry.public_key = public.to_openssh().map_err(|_| "VAULT_SSH")?;
    entry.fingerprint = public.fingerprint(HashAlg::Sha256).to_string();
    entry.algorithm = public.algorithm().to_string();
    Ok(())
}
pub fn generate(passphrase: &str) -> Result<serde_json::Value, String> {
    let private =
        PrivateKey::random(&mut rand::rngs::OsRng, Algorithm::Ed25519).map_err(|_| "VAULT_SSH")?;
    let public = private.public_key().to_openssh().map_err(|_| "VAULT_SSH")?;
    let fingerprint = private
        .public_key()
        .fingerprint(HashAlg::Sha256)
        .to_string();
    let private = if passphrase.is_empty() {
        private
    } else {
        private
            .encrypt(&mut rand::rngs::OsRng, passphrase.as_bytes())
            .map_err(|_| "VAULT_SSH")?
    };
    let text = private
        .to_openssh(LineEnding::LF)
        .map_err(|_| "VAULT_SSH")?;
    Ok(
        serde_json::json!({"publicKey":public,"privateKey":text.as_str(),"fingerprint":fingerprint,"algorithm":"ssh-ed25519"}),
    )
}
