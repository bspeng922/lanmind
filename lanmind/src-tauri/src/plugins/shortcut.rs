//! Desktop shortcut creation and CLI launch-argument parsing for installed web plugins.
use super::package::{digest, directory, fail, io, valid_hash, Result};
use super::Installed;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

pub const LAUNCH_ARG: &str = "--open-plugin";
const MAX_ICON_BYTES: u64 = 128 * 1024;
const MAX_ICO_PNG_BYTES: usize = 512 * 1024;
const PLUGIN_ICON_NAMES: [&str; 6] = [
    "icon.svg",
    "icon.png",
    "icon.webp",
    "icon.jpg",
    "icon.jpeg",
    "icon.ico",
];

fn valid_plugin_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 256
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.' | b':'))
}

/// Extracts a validated plugin key from CLI arguments (`--open-plugin <key>` or `--open-plugin=<key>`).
pub fn extract_launch_plugin_arg<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut iter = args.into_iter();
    while let Some(raw) = iter.next() {
        let arg = raw.as_ref();
        if arg == LAUNCH_ARG {
            if let Some(next) = iter.next() {
                let candidate = next.as_ref().trim();
                if valid_plugin_key(candidate) {
                    return Some(candidate.to_string());
                }
            }
        } else if let Some(rest) = arg.strip_prefix(&format!("{LAUNCH_ARG}=")) {
            let candidate = rest.trim();
            if valid_plugin_key(candidate) {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

/// Sanitizes a plugin display name into a safe cross-platform shortcut file stem.
pub fn sanitize_shortcut_name(name: &str, fallback_id: &str) -> String {
    let clean = |input: &str| -> String {
        let filtered: String = input
            .chars()
            .map(|c| {
                if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                    ' '
                } else {
                    c
                }
            })
            .collect();
        let collapsed = filtered.split_whitespace().collect::<Vec<_>>().join(" ");
        let trimmed = collapsed.trim_matches(|c: char| c == '.' || c.is_whitespace());
        trimmed.chars().take(64).collect()
    };

    let primary = clean(name);
    if !primary.is_empty() {
        return primary;
    }
    let secondary = clean(fallback_id);
    if !secondary.is_empty() {
        return secondary;
    }
    "LanMind Plugin".into()
}

/// Checks whether a byte slice starts with a valid Windows ICO header containing at least one image.
pub fn is_valid_ico(bytes: &[u8]) -> bool {
    if bytes.len() < 22 || bytes.len() as u64 > MAX_ICON_BYTES {
        return false;
    }
    bytes[0..4] == [0, 0, 1, 0] && u16::from_le_bytes([bytes[4], bytes[5]]) >= 1
}

/// Wraps a valid PNG payload (1..=256 px per side) into a Vista+ single-entry ICO container so
/// Windows `.lnk` shortcuts can display plugin icons natively.
pub fn png_to_ico(png: &[u8]) -> Option<Vec<u8>> {
    const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if png.len() < 24 || png.len() > MAX_ICO_PNG_BYTES || png[..8] != PNG_MAGIC {
        return None;
    }
    if &png[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes([png[16], png[17], png[18], png[19]]);
    let height = u32::from_be_bytes([png[20], png[21], png[22], png[23]]);
    if width == 0 || height == 0 || width > 256 || height > 256 {
        return None;
    }
    let w_byte = if width == 256 { 0 } else { width as u8 };
    let h_byte = if height == 256 { 0 } else { height as u8 };
    let size = u32::try_from(png.len()).ok()?;

    let mut ico = Vec::with_capacity(22 + png.len());
    // ICONDIR (6 bytes)
    ico.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
    // ICONDIRENTRY (16 bytes)
    ico.push(w_byte);
    ico.push(h_byte);
    ico.push(0); // color count
    ico.push(0); // reserved
    ico.extend_from_slice(&1u16.to_le_bytes()); // color planes
    ico.extend_from_slice(&32u16.to_le_bytes()); // bits per pixel
    ico.extend_from_slice(&size.to_le_bytes()); // bytes in resource
    ico.extend_from_slice(&22u32.to_le_bytes()); // offset to PNG payload
    ico.extend_from_slice(png);
    Some(ico)
}

fn plugin_declares_icon(plugin: &Installed) -> bool {
    PLUGIN_ICON_NAMES
        .iter()
        .any(|name| plugin.manifest.files.contains_key(*name))
}

fn read_verified_release_file(release: &Path, name: &str, expected_hash: &str) -> Option<Vec<u8>> {
    let root = release.canonicalize().ok()?;
    let path = release.join(name);
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() == 0
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
    if bytes.is_empty() || bytes.len() as u64 > MAX_ICON_BYTES || digest(&bytes) != expected_hash {
        return None;
    }
    Some(bytes)
}

pub(crate) fn prepare_shortcut_icon(
    root: &Path,
    plugin: &Installed,
    rendered_icon_png: Option<&[u8]>,
) -> Option<PathBuf> {
    if !valid_hash(&plugin.sha256) || !plugin_declares_icon(plugin) {
        return None;
    }
    let release = root.join("releases").join(&plugin.sha256);
    let ico_bytes = plugin
        .manifest
        .files
        .get("icon.ico")
        .and_then(|expected| read_verified_release_file(&release, "icon.ico", expected))
        .filter(|bytes| is_valid_ico(bytes))
        .or_else(|| rendered_icon_png.and_then(png_to_ico))
        .or_else(|| {
            plugin
                .manifest
                .files
                .get("icon.png")
                .and_then(|expected| read_verified_release_file(&release, "icon.png", expected))
                .and_then(|png| png_to_ico(&png))
        })?;

    let dir = root.join("shortcut-icons");
    directory(&dir).ok()?;
    let icon_path = dir.join(format!("{}.ico", plugin.sha256));
    fs::write(&icon_path, ico_bytes).ok()?;
    Some(icon_path)
}

#[cfg(target_os = "linux")]
fn prepare_linux_shortcut_icon(
    root: &Path,
    plugin: &Installed,
    rendered_icon_png: Option<&[u8]>,
) -> Option<PathBuf> {
    if !valid_hash(&plugin.sha256) || !plugin_declares_icon(plugin) {
        return None;
    }
    let release = root.join("releases").join(&plugin.sha256);
    let dir = root.join("shortcut-icons");
    directory(&dir).ok()?;
    if let Some(png) = rendered_icon_png.filter(|b| png_to_ico(b).is_some()) {
        let icon_path = dir.join(format!("{}.png", plugin.sha256));
        fs::write(&icon_path, png).ok()?;
        return Some(icon_path);
    }
    for (name, ext) in [("icon.png", "png"), ("icon.svg", "svg")] {
        if let Some(expected) = plugin.manifest.files.get(name) {
            if let Some(bytes) = read_verified_release_file(&release, name, expected) {
                let icon_path = dir.join(format!("{}.{ext}", plugin.sha256));
                fs::write(&icon_path, bytes).ok()?;
                return Some(icon_path);
            }
        }
    }
    None
}

#[cfg(windows)]
fn notify_shell_icon_updated(path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_UPDATEITEM, SHCNF_PATHW};
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        SHChangeNotify(
            SHCNE_UPDATEITEM as i32,
            SHCNF_PATHW,
            wide.as_ptr().cast(),
            core::ptr::null(),
        );
    }
}

pub fn create_desktop_shortcut(
    root: &Path,
    plugin: &Installed,
    locale: &str,
    rendered_icon_png: Option<&[u8]>,
) -> Result<PathBuf> {
    if !plugin.enabled || !plugin.available {
        return Err(fail("DISABLED"));
    }
    if !plugin.manifest.compatible() {
        return Err(fail("INCOMPATIBLE"));
    }
    if !valid_plugin_key(&plugin.plugin_key) || !valid_hash(&plugin.sha256) {
        return Err(fail("ARGUMENTS"));
    }

    let exe = io(std::env::current_exe())?;
    let name = sanitize_shortcut_name(&plugin.manifest.name(locale), &plugin.manifest.id);
    let description = format!("LanMind · {}", plugin.manifest.name(locale));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let work_dir = exe
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let prepared_icon = prepare_shortcut_icon(root, plugin, rendered_icon_png);
        let icon_location = prepared_icon
            .as_ref()
            .map(|path| format!("{},0", path.to_string_lossy()))
            .unwrap_or_else(|| format!("{},0", exe.to_string_lossy()));
        let arguments = format!("{LAUNCH_ARG} \"{}\"", plugin.plugin_key);

        // All dynamic values are supplied exclusively via environment variables to avoid shell escaping issues.
        const PS_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($desktop)) { throw 'DESKTOP_UNAVAILABLE' }
$lnkPath = Join-Path $desktop ($env:LM_SHORTCUT_NAME + '.lnk')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = $env:LM_TARGET
$shortcut.Arguments = $env:LM_ARGS
$shortcut.WorkingDirectory = $env:LM_WORKDIR
$shortcut.IconLocation = $env:LM_ICON
$shortcut.Description = $env:LM_DESC
$shortcut.Save()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Write($lnkPath)
"#;

        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                PS_SCRIPT,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .env("LM_SHORTCUT_NAME", &name)
            .env("LM_TARGET", exe.to_string_lossy().as_ref())
            .env("LM_ARGS", &arguments)
            .env("LM_WORKDIR", &work_dir)
            .env("LM_ICON", &icon_location)
            .env("LM_DESC", &description)
            .output()
            .map_err(|_| fail("IO"))?;

        if !output.status.success() {
            return Err(fail("IO"));
        }
        let created = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if created.is_empty() {
            return Err(fail("IO"));
        }
        let created_path = PathBuf::from(created);
        if let Some(icon_path) = prepared_icon.as_deref() {
            notify_shell_icon_updated(icon_path);
        }
        notify_shell_icon_updated(&created_path);
        return Ok(created_path);
    }

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        let home = std::env::var_os("HOME").ok_or_else(|| fail("IO"))?;
        let desktop = PathBuf::from(home).join("Desktop");
        directory(&desktop)?;
        let path = desktop.join(format!("{name}.desktop"));
        let exec_cmd = format!(
            "\"{}\" {LAUNCH_ARG} \"{}\"",
            exe.to_string_lossy().replace('"', "\\\""),
            plugin.plugin_key
        );
        let icon_line = prepare_linux_shortcut_icon(root, plugin, rendered_icon_png)
            .map(|p| format!("Icon={}\n", p.to_string_lossy()))
            .unwrap_or_default();
        let content = format!(
            "[Desktop Entry]\nType=Application\nName={name}\nComment={description}\nExec={exec_cmd}\n{icon_line}Terminal=false\n"
        );
        io(fs::write(&path, content))?;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o755));
        return Ok(path);
    }

    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::PermissionsExt;
        let home = std::env::var_os("HOME").ok_or_else(|| fail("IO"))?;
        let desktop = PathBuf::from(home).join("Desktop");
        directory(&desktop)?;
        let path = desktop.join(format!("{name}.command"));
        let escaped_exe = exe.to_string_lossy().replace('\'', "'\\''");
        let content = format!(
            "#!/bin/sh\nnohup '{escaped_exe}' {LAUNCH_ARG} '{}' >/dev/null 2>&1 &\n",
            plugin.plugin_key
        );
        io(fs::write(&path, content))?;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o755));
        return Ok(path);
    }

    #[allow(unreachable_code)]
    {
        let _ = (root, description);
        Err(fail("IO"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_launch_plugin_arg_in_both_forms() {
        assert_eq!(
            extract_launch_plugin_arg(["LanMind.exe", "--open-plugin", "unsigned/hello"]),
            Some("unsigned/hello".into())
        );
        assert_eq!(
            extract_launch_plugin_arg(["LanMind.exe", "--open-plugin=abc123/tool-1"]),
            Some("abc123/tool-1".into())
        );
        assert_eq!(
            extract_launch_plugin_arg(["LanMind.exe", "--open-plugin", "bad;rm -rf /"]),
            None
        );
        assert_eq!(
            extract_launch_plugin_arg(["LanMind.exe", "--autostart"]),
            None
        );
    }

    #[test]
    fn sanitizes_shortcut_filename_safely() {
        assert_eq!(
            sanitize_shortcut_name("Hello: 工具 / v1?*", "hello-tool"),
            "Hello 工具 v1"
        );
        assert_eq!(sanitize_shortcut_name("...", "my-plugin"), "my-plugin");
        assert_eq!(sanitize_shortcut_name("", ""), "LanMind Plugin");
    }

    #[test]
    fn wraps_valid_png_into_ico_header() {
        let mut fake_png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        fake_png.extend_from_slice(&13u32.to_be_bytes());
        fake_png.extend_from_slice(b"IHDR");
        fake_png.extend_from_slice(&64u32.to_be_bytes());
        fake_png.extend_from_slice(&64u32.to_be_bytes());
        fake_png.extend_from_slice(&[8, 6, 0, 0, 0]);

        let ico = png_to_ico(&fake_png).expect("valid PNG should wrap to ICO");
        assert_eq!(&ico[0..6], &[0, 0, 1, 0, 1, 0]);
        assert_eq!(ico[6], 64);
        assert_eq!(ico[7], 64);
        assert_eq!(u32::from_le_bytes([ico[14], ico[15], ico[16], ico[17]]) as usize, fake_png.len());
        assert_eq!(u32::from_le_bytes([ico[18], ico[19], ico[20], ico[21]]), 22);
        assert_eq!(&ico[22..], fake_png.as_slice());

        assert!(png_to_ico(b"not-a-png").is_none());

        // 256x256 encodes width/height as 0 in ICO directory entry
        let mut png256 = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        png256.extend_from_slice(&13u32.to_be_bytes());
        png256.extend_from_slice(b"IHDR");
        png256.extend_from_slice(&256u32.to_be_bytes());
        png256.extend_from_slice(&256u32.to_be_bytes());
        png256.extend_from_slice(&[8, 6, 0, 0, 0]);
        let ico256 = png_to_ico(&png256).expect("256x256 PNG should wrap to ICO");
        assert_eq!(ico256[6], 0);
        assert_eq!(ico256[7], 0);

        // >256px PNGs must be rejected so Windows Shell never gets an invalid ICO
        let mut png512 = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        png512.extend_from_slice(&13u32.to_be_bytes());
        png512.extend_from_slice(b"IHDR");
        png512.extend_from_slice(&512u32.to_be_bytes());
        png512.extend_from_slice(&512u32.to_be_bytes());
        png512.extend_from_slice(&[8, 6, 0, 0, 0]);
        assert!(png_to_ico(&png512).is_none());
    }

    #[test]
    fn prepares_ico_from_rasterized_svg_icon_and_ignores_undeclared_icons() {
        use super::super::package::{Manifest, SignedMetadata};
        use std::collections::BTreeMap;

        let dir = tempfile::tempdir().unwrap();
        let sha = "a".repeat(64);
        let release = dir.path().join("releases").join(&sha);
        fs::create_dir_all(&release).unwrap();
        let svg = b"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'></svg>";
        fs::write(release.join("icon.svg"), svg).unwrap();

        let mut rendered_png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        rendered_png.extend_from_slice(&13u32.to_be_bytes());
        rendered_png.extend_from_slice(b"IHDR");
        rendered_png.extend_from_slice(&256u32.to_be_bytes());
        rendered_png.extend_from_slice(&256u32.to_be_bytes());
        rendered_png.extend_from_slice(&[8, 6, 0, 0, 0]);

        let make_plugin = |files: BTreeMap<String, String>| Installed {
            plugin_key: "unsigned/hello".into(),
            publisher_id: "unsigned".into(),
            manifest: Manifest {
                schema_version: 1,
                runtime: "web".into(),
                id: "hello".into(),
                version: "1.0.0".into(),
                name: BTreeMap::from([("zh-CN".into(), "示例插件".into())]),
                description: BTreeMap::new(),
                default_locale: "zh-CN".into(),
                min_host_version: "0.2.0".into(),
                sdk_version: 1,
                entry: "index.html".into(),
                capabilities: vec![],
                files,
            },
            metadata: SignedMetadata {
                manifest: "{}".into(),
                public_key: String::new(),
                signature: String::new(),
            },
            sha256: sha.clone(),
            previous_sha256: None,
            size_bytes: 128,
            enabled: true,
            shared: false,
            available: true,
            installed_at: "2026-01-01T00:00:00Z".into(),
        };

        // Plugin with icon.svg uses the host-rasterized PNG to build its .ico
        let svg_plugin = make_plugin(BTreeMap::from([("icon.svg".into(), digest(svg))]));
        let icon_path = prepare_shortcut_icon(dir.path(), &svg_plugin, Some(&rendered_png))
            .expect("svg plugin should generate shortcut .ico");
        assert!(icon_path.exists());
        let written = fs::read(&icon_path).unwrap();
        assert!(is_valid_ico(&written));
        assert_eq!(&written[22..], rendered_png.as_slice());

        // Plugin with NO icon file in manifest does not accept arbitrary rendered bytes
        let iconless = make_plugin(BTreeMap::new());
        assert!(prepare_shortcut_icon(dir.path(), &iconless, Some(&rendered_png)).is_none());
    }
}
