//! Only package-owned, hash-verified images are exposed to the trusted host UI.
use super::package::{digest, Manifest};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{fs, io::Read, path::Path};

const MAX_ICON_BYTES: u64 = 128 * 1024;

pub(super) fn data_url(release: &Path, manifest: &Manifest) -> Option<String> {
    let metadata = fs::symlink_metadata(release).ok()?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return None;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return None;
        }
    }
    let root = release.canonicalize().ok()?;
    [
        ("icon.svg", "image/svg+xml"),
        ("icon.png", "image/png"),
        ("icon.webp", "image/webp"),
        ("icon.jpg", "image/jpeg"),
        ("icon.jpeg", "image/jpeg"),
        ("icon.ico", "image/x-icon"),
    ]
    .into_iter()
    .find_map(|(name, mime)| {
        let expected = manifest.files.get(name)?;
        let path = release.join(name);
        let metadata = fs::symlink_metadata(&path).ok()?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_ICON_BYTES
            || path.canonicalize().ok()?.parent() != Some(root.as_path())
        {
            return None;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return None;
            }
        }
        let mut bytes = Vec::new();
        fs::File::open(path)
            .ok()?
            .take(MAX_ICON_BYTES + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        if bytes.is_empty() || bytes.len() as u64 > MAX_ICON_BYTES || digest(&bytes) != *expected {
            return None;
        }
        Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    })
}
