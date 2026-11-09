//! Signed packages and explicitly approved, unsigned static-source archives.
//! No installer, build command, or native code is executed.
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::{Read, Write},
    path::Path,
};
use tokio_util::sync::CancellationToken;

pub const MAX_PACKAGE: u64 = 100 * 1024 * 1024;
pub const MAX_UNPACKED: u64 = 300 * 1024 * 1024;
const MAX_METADATA: u64 = 256 * 1024;
pub const SIGNING_CONTEXT: &[u8] = b"lanmind-web-plugin-v1\0";
pub const CAPABILITIES: [&str; 4] = ["tasks.read", "tasks.write", "wiki.read", "wiki.write"];
pub type Result<T> = std::result::Result<T, String>;
pub fn fail(code: &str) -> String {
    format!("PLUGIN_{code}")
}
pub fn io<T>(value: std::io::Result<T>) -> Result<T> {
    value.map_err(|_| fail("IO"))
}
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u32,
    pub runtime: String,
    pub id: String,
    pub version: String,
    pub name: BTreeMap<String, String>,
    pub description: BTreeMap<String, String>,
    pub default_locale: String,
    pub min_host_version: String,
    pub sdk_version: u32,
    pub entry: String,
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub files: BTreeMap<String, String>,
}
impl Manifest {
    pub fn compatible(&self) -> bool {
        self.sdk_version == 1
            && semver::Version::parse(&self.min_host_version)
                .ok()
                .zip(semver::Version::parse(env!("CARGO_PKG_VERSION")).ok())
                .is_some_and(|(min, host)| host >= min)
    }
    pub fn name(&self, locale: &str) -> String {
        self.name
            .get(locale)
            .or_else(|| self.name.get(&self.default_locale))
            .cloned()
            .unwrap_or_else(|| self.id.clone())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedMetadata {
    /// Exact UTF-8 bytes signed by the publisher; never reserialize before verifying.
    pub manifest: String,
    pub public_key: String,
    pub signature: String,
}
impl SignedMetadata {
    pub fn is_signed(&self) -> bool {
        !self.public_key.is_empty() && !self.signature.is_empty()
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageSignature {
    pub public_key: String,
    pub signature: String,
}
#[derive(Clone, Debug)]
pub struct Verified {
    pub manifest: Manifest,
    pub metadata: SignedMetadata,
    pub publisher_id: String,
    pub plugin_key: String,
}

pub fn safe_relative(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 1024
        && value.split('/').all(|part| {
            let stem = part
                .split('.')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase();
            !part.is_empty()
                && part.len() <= 200
                && part != "."
                && part != ".."
                && !part.ends_with([' ', '.'])
                && !part
                    .chars()
                    .any(|c| c.is_control() || "\\:*?\"<>|".contains(c))
                && !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !(stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && matches!(stem.as_bytes()[3], b'0'..=b'9'))
        })
}
pub fn verify_metadata(metadata: &SignedMetadata) -> Result<Verified> {
    if metadata.manifest.len() as u64 > MAX_METADATA {
        return Err(fail("INVALID_PACKAGE"));
    }
    let public: [u8; 32] = STANDARD
        .decode(&metadata.public_key)
        .map_err(|_| fail("SIGNATURE"))?
        .try_into()
        .map_err(|_| fail("SIGNATURE"))?;
    let key = VerifyingKey::from_bytes(&public).map_err(|_| fail("SIGNATURE"))?;
    let signature = Signature::from_slice(
        &STANDARD
            .decode(&metadata.signature)
            .map_err(|_| fail("SIGNATURE"))?,
    )
    .map_err(|_| fail("SIGNATURE"))?;
    key.verify_strict(
        &[SIGNING_CONTEXT, metadata.manifest.as_bytes()].concat(),
        &signature,
    )
    .map_err(|_| fail("SIGNATURE"))?;
    validate_metadata(metadata, digest(&public))
}

/// Unsigned identity has its own namespace and can never replace a signed plugin.
/// Partially present or invalid signatures must still fail signed verification.
pub fn verify_install_metadata(metadata: &SignedMetadata) -> Result<Verified> {
    if metadata.public_key.is_empty() && metadata.signature.is_empty() {
        validate_metadata(metadata, "unsigned".into())
    } else {
        verify_metadata(metadata)
    }
}

fn validate_metadata(metadata: &SignedMetadata, publisher_id: String) -> Result<Verified> {
    if metadata.manifest.len() as u64 > MAX_METADATA {
        return Err(fail("INVALID_PACKAGE"));
    }
    let m: Manifest =
        serde_json::from_str(&metadata.manifest).map_err(|_| fail("INVALID_PACKAGE"))?;
    let mut paths = HashSet::new();
    let mut caps = HashSet::new();
    if m.schema_version != 2
        || m.runtime != "web"
        || m.id.is_empty()
        || m.id.len() > 100
        || !m
            .id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b".-_".contains(&c))
        || semver::Version::parse(&m.version).is_err()
        || semver::Version::parse(&m.min_host_version).is_err()
        || m.name
            .get(&m.default_locale)
            .is_none_or(|name| name.trim().is_empty())
        || m.name.values().any(|s| s.len() > 300)
        || m.description.values().any(|s| s.len() > 4000)
        || m.name.len() > 32
        || m.description.len() > 32
        || m.default_locale.len() > 30
        || !m.files.contains_key(&m.entry)
        || !m.entry.ends_with(".html")
        || m.files.len() > 5000
        || m.capabilities
            .iter()
            .any(|c| !CAPABILITIES.contains(&c.as_str()) || !caps.insert(c))
        || ["tasks", "wiki"].iter().any(|domain| {
            m.capabilities.contains(&format!("{domain}.write"))
                && !m.capabilities.contains(&format!("{domain}.read"))
        })
        || m.files.iter().any(|(p, hash)| {
            !safe_relative(p)
                || !valid_hash(hash)
                || matches!(
                    p.to_lowercase().as_str(),
                    "manifest.json" | "signature.json"
                )
                || !paths.insert(p.to_lowercase())
        })
    {
        return Err(fail("INVALID_PACKAGE"));
    }
    // Files and directories may not alias one another on any supported platform.
    for path in m.files.keys() {
        let mut parent = Path::new(path).parent();
        while let Some(p) = parent {
            if paths.contains(&p.to_string_lossy().to_lowercase()) {
                return Err(fail("INVALID_PACKAGE"));
            }
            parent = p.parent();
        }
    }
    Ok(Verified {
        plugin_key: format!("{publisher_id}/{}", m.id),
        publisher_id,
        manifest: m,
        metadata: metadata.clone(),
    })
}

pub fn file_digest(path: &Path) -> Result<String> {
    let mut file = io(fs::File::open(path))?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let n = io(file.read(&mut buffer))?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn zip_error(_: zip::result::ZipError) -> String {
    fail("INVALID_PACKAGE")
}
fn read_metadata<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<String> {
    let mut entry = zip.by_name(name).map_err(zip_error)?;
    if entry.size() > MAX_METADATA {
        return Err(fail("INVALID_PACKAGE"));
    }
    let mut data = String::new();
    io((&mut entry)
        .take(MAX_METADATA + 1)
        .read_to_string(&mut data))?;
    if data.len() as u64 > MAX_METADATA {
        return Err(fail("INVALID_PACKAGE"));
    }
    Ok(data)
}
pub fn inspect(
    path: &Path,
    destination: Option<&Path>,
    cancel: &CancellationToken,
) -> Result<Verified> {
    if io(fs::metadata(path))?.len() > MAX_PACKAGE {
        return Err(fail("PACKAGE_TOO_LARGE"));
    }
    let mut zip = zip::ZipArchive::new(io(fs::File::open(path))?).map_err(zip_error)?;
    // A present signature always takes the strict path; never downgrade a bad one.
    let signed = zip.by_name("signature.json").is_ok();
    drop(zip);
    if signed {
        inspect_signed(path, destination, cancel)
    } else {
        inspect_source(path, destination, cancel)
    }
}

pub fn require_install_approval(
    metadata: &SignedMetadata,
    hash: &str,
    expected: Option<&str>,
    allow_unsigned: bool,
) -> Result<()> {
    if expected.is_some_and(|expected| expected != hash) {
        return Err(fail("HASH"));
    }
    if !metadata.is_signed() && (!allow_unsigned || expected != Some(hash)) {
        return Err(fail("UNSIGNED_CONFIRMATION_REQUIRED"));
    }
    Ok(())
}

fn inspect_signed(
    path: &Path,
    destination: Option<&Path>,
    cancel: &CancellationToken,
) -> Result<Verified> {
    if io(fs::metadata(path))?.len() > MAX_PACKAGE {
        return Err(fail("PACKAGE_TOO_LARGE"));
    }
    let mut zip = zip::ZipArchive::new(io(fs::File::open(path))?).map_err(zip_error)?;
    if zip.len() > 5002 {
        return Err(fail("INVALID_PACKAGE"));
    }
    let manifest = read_metadata(&mut zip, "manifest.json")?;
    let sig: PackageSignature = serde_json::from_str(&read_metadata(&mut zip, "signature.json")?)
        .map_err(|_| fail("SIGNATURE"))?;
    let verified = verify_metadata(&SignedMetadata {
        manifest,
        public_key: sig.public_key,
        signature: sig.signature,
    })?;
    if zip.len() != verified.manifest.files.len() + 2 {
        return Err(fail("INVALID_PACKAGE"));
    }
    let mut seen = HashSet::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        if cancel.is_cancelled() {
            return Err(fail("CANCELLED"));
        }
        let mut entry = zip.by_index(i).map_err(zip_error)?;
        let name = entry.name().to_owned();
        if !safe_relative(&name)
            || !seen.insert(name.to_lowercase())
            || entry.is_dir()
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 != 0 && mode & 0o170000 != 0o100000)
        {
            return Err(fail("INVALID_PACKAGE"));
        }
        if name == "manifest.json" || name == "signature.json" {
            continue;
        }
        let expected = verified
            .manifest
            .files
            .get(&name)
            .ok_or_else(|| fail("INVALID_PACKAGE"))?;
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| fail("PACKAGE_TOO_LARGE"))?;
        if total > MAX_UNPACKED {
            return Err(fail("PACKAGE_TOO_LARGE"));
        }
        let mut output = if let Some(root) = destination {
            let path = root.join(&name);
            if let Some(parent) = path.parent() {
                io(fs::create_dir_all(parent))?;
            }
            Some(io(fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path))?)
        } else {
            None
        };
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        let mut size = 0;
        loop {
            if cancel.is_cancelled() {
                return Err(fail("CANCELLED"));
            }
            let n = io(entry.read(&mut buffer))?;
            if n == 0 {
                break;
            }
            size += n as u64;
            if size > entry.size() || size > MAX_UNPACKED {
                return Err(fail("PACKAGE_TOO_LARGE"));
            }
            hasher.update(&buffer[..n]);
            if let Some(file) = output.as_mut() {
                io(file.write_all(&buffer[..n]))?;
            }
        }
        if size != entry.size() || format!("{:x}", hasher.finalize()) != *expected {
            return Err(fail("HASH"));
        }
        if let Some(file) = output {
            io(file.sync_all())?;
        }
    }
    Ok(verified)
}

fn source_asset(name: &str) -> bool {
    if name.split('/').any(|part| {
        matches!(
            part,
            ".git" | ".github" | "node_modules" | "target" | "tests"
        )
    }) {
        return false;
    }
    matches!(
        Path::new(name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "html"
            | "js"
            | "mjs"
            | "css"
            | "json"
            | "svg"
            | "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "avif"
            | "ico"
            | "woff"
            | "woff2"
            | "ttf"
            | "otf"
            | "wasm"
            | "mp3"
            | "ogg"
            | "wav"
            | "mp4"
            | "webm"
            | "txt"
    )
}

fn inspect_source(
    path: &Path,
    destination: Option<&Path>,
    cancel: &CancellationToken,
) -> Result<Verified> {
    let mut zip = zip::ZipArchive::new(io(fs::File::open(path))?).map_err(zip_error)?;
    if zip.len() > 5002 {
        return Err(fail("INVALID_PACKAGE"));
    }
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    let mut total = 0u64;
    for index in 0..zip.len() {
        if cancel.is_cancelled() {
            return Err(fail("CANCELLED"));
        }
        let entry = zip.by_index(index).map_err(zip_error)?;
        let name = entry.name().trim_end_matches('/').to_owned();
        let directory = entry.is_dir();
        if !safe_relative(&name)
            || !seen.insert(name.to_lowercase())
            || entry.unix_mode().is_some_and(|mode| {
                let kind = mode & 0o170000;
                kind != 0 && kind != if directory { 0o040000 } else { 0o100000 }
            })
        {
            return Err(fail("INVALID_PACKAGE"));
        }
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| fail("PACKAGE_TOO_LARGE"))?;
        if total > MAX_UNPACKED {
            return Err(fail("PACKAGE_TOO_LARGE"));
        }
        if !directory {
            entries.push((index, name));
        }
    }
    let manifest_name = if entries.iter().any(|(_, name)| name == "manifest.json") {
        "manifest.json".to_owned()
    } else {
        let candidates: Vec<_> = entries
            .iter()
            .filter(|(_, name)| name.ends_with("/manifest.json") && name.split('/').count() == 2)
            .collect();
        if candidates.len() != 1 {
            return Err(fail("INVALID_PACKAGE"));
        }
        candidates[0].1.clone()
    };
    let prefix = manifest_name
        .strip_suffix("manifest.json")
        .unwrap_or_default();
    if entries.iter().any(|(_, name)| !name.starts_with(prefix)) {
        return Err(fail("INVALID_PACKAGE"));
    }
    if entries
        .iter()
        .any(|(_, name)| name == &format!("{prefix}signature.json"))
    {
        return Err(fail("SIGNATURE"));
    }
    let mut manifest: Manifest = serde_json::from_str(&read_metadata(&mut zip, &manifest_name)?)
        .map_err(|_| fail("INVALID_PACKAGE"))?;
    let declared = manifest.files.clone();
    let mut inventory = BTreeMap::new();
    for (index, absolute) in entries {
        let relative = absolute
            .strip_prefix(prefix)
            .ok_or_else(|| fail("INVALID_PACKAGE"))?;
        if relative == "manifest.json"
            || (!declared.is_empty() && !declared.contains_key(relative))
            || (declared.is_empty() && !source_asset(relative))
        {
            continue;
        }
        let mut entry = zip.by_index(index).map_err(zip_error)?;
        let mut output = if let Some(root) = destination {
            let target = root.join(relative);
            if let Some(parent) = target.parent() {
                io(fs::create_dir_all(parent))?;
            }
            Some(io(fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target))?)
        } else {
            None
        };
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        let mut size = 0;
        loop {
            if cancel.is_cancelled() {
                return Err(fail("CANCELLED"));
            }
            let n = io(entry.read(&mut buffer))?;
            if n == 0 {
                break;
            }
            size += n as u64;
            if size > entry.size() || size > MAX_UNPACKED {
                return Err(fail("PACKAGE_TOO_LARGE"));
            }
            hasher.update(&buffer[..n]);
            if let Some(file) = output.as_mut() {
                io(file.write_all(&buffer[..n]))?;
            }
        }
        if size != entry.size() {
            return Err(fail("HASH"));
        }
        let hash = format!("{:x}", hasher.finalize());
        if declared
            .get(relative)
            .is_some_and(|expected| expected != &hash)
        {
            return Err(fail("HASH"));
        }
        if let Some(file) = output {
            io(file.sync_all())?;
        }
        inventory.insert(relative.to_owned(), hash);
    }
    if !inventory.contains_key(&manifest.entry) {
        return Err(fail("SOURCE_BUILD_REQUIRED"));
    }
    if !declared.is_empty() && declared.len() != inventory.len() {
        return Err(fail("HASH"));
    }
    manifest.files = inventory;
    verify_install_metadata(&SignedMetadata {
        manifest: serde_json::to_string(&manifest).map_err(|_| fail("INVALID_PACKAGE"))?,
        public_key: String::new(),
        signature: String::new(),
    })
}

/// App-managed paths are never allowed to traverse a symlink or Windows junction.
pub fn directory(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        if !parent.exists() {
            directory(parent)?;
        }
    }
    if path.exists() {
        let m = io(fs::symlink_metadata(path))?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if m.file_attributes() & 0x400 != 0 {
                return Err(fail("PATH"));
            }
        }
        if !m.is_dir() || m.file_type().is_symlink() {
            return Err(fail("PATH"));
        }
    } else {
        io(fs::create_dir(path))?;
    }
    Ok(())
}
pub fn remove_managed(root: &Path, target: &Path) -> Result<()> {
    if !target.exists() {
        return Ok(());
    }
    let root = io(root.canonicalize())?;
    let resolved = io(target.canonicalize())?;
    if resolved == root || !resolved.starts_with(&root) {
        return Err(fail("PATH"));
    }
    if resolved.is_dir() {
        io(fs::remove_dir_all(target))
    } else {
        io(fs::remove_file(target))
    }
}
