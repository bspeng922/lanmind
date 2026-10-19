//! File access is rooted in open directory capabilities, never in model supplied absolute paths.
use crate::{ai_types::*, workspace_scope::WorkspaceContext};
use cap_std::fs::{Dir, OpenOptions};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct RootGrant {
    pub id: String,
    pub scope: WorkspaceContext,
    pub path: PathBuf,
    pub dir: Arc<Dir>,
    pub create: bool,
}
impl RootGrant {
    pub fn view(&self) -> Value {
        json!({"id":self.id,"path":self.path.to_string_lossy(),"allowCreate":self.create,"expires":"app_exit"})
    }
    fn check(&self, relative: &str) -> AiResult<PathBuf> {
        let path = safe_relative(relative)?;
        // Reject junctions/symlinks as well as escapes; cap-std enforces confinement on open/rename.
        let ambient = std::fs::symlink_metadata(&self.path)?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if ambient.file_attributes() & 0x400 != 0 {
                return Err(AiError::new(
                    "ROOT_CHANGED",
                    "授权目录已被替换为链接，请重新授权",
                ));
            }
        }
        let original = same_file::Handle::from_file(self.dir.try_clone()?.into_std_file())?;
        if ambient.file_type().is_symlink()
            || std::fs::canonicalize(&self.path)? != self.path
            || original != same_file::Handle::from_path(&self.path)?
        {
            return Err(AiError::new("ROOT_CHANGED", "授权目录已改变，请重新授权"));
        }
        let mut current = PathBuf::new();
        for component in path.components() {
            current.push(component.as_os_str());
            match self.dir.symlink_metadata(&current) {
                Ok(m) if reparse(&m) => {
                    return Err(AiError::new("PATH_DENIED", "不允许访问链接或重解析目录"))
                }
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
                Err(e) => return Err(e.into()),
            }
        }
        Ok(path)
    }
    pub fn read_bytes(&self, relative: &str, max: u64) -> AiResult<Vec<u8>> {
        let path = self.check(relative)?;
        let file = self.dir.open(path)?;
        if !file.metadata()?.is_file() || file.metadata()?.len() > max {
            return Err(AiError::new("FILE_LIMIT", "文件类型不支持或大小超出限制"));
        }
        let mut bytes = Vec::new();
        file.take(max + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > max {
            return Err(AiError::new("FILE_LIMIT", "文件大小超出限制"));
        }
        Ok(bytes)
    }
    pub fn read(&self, relative: &str) -> AiResult<Value> {
        let bytes = self.read_bytes(relative, 20_000_000)?;
        let fingerprint = hash(&bytes);
        let text = crate::ai_documents::extract(relative, &bytes)?;
        Ok(json!({"path":relative,"sha256":fingerprint,"content":text,"untrusted":true}))
    }
    pub fn list(&self, relative: &str) -> AiResult<Value> {
        self.check("root-check")?;
        let path = if relative.is_empty() {
            PathBuf::from(".")
        } else {
            self.check(relative)?
        };
        let mut items = Vec::new();
        for entry in self.dir.read_dir(path)?.take(501) {
            if items.len() == 500 {
                return Ok(json!({"items":items,"truncated":true}));
            }
            let entry = entry?;
            let metadata = entry.metadata()?;
            items.push(json!({"name":entry.file_name().to_string_lossy(),"directory":metadata.is_dir(),"symlink":entry.file_type()?.is_symlink(),"size":metadata.len()}));
        }
        Ok(json!({"items":items,"truncated":false}))
    }
    pub fn search(&self, keyword: &str) -> AiResult<Value> {
        self.check("root-check")?;
        if keyword.is_empty() || keyword.len() > 500 {
            return Err(AiError::new("INVALID_ARGUMENTS", "搜索词不能为空或过长"));
        }
        let mut pending = vec![(String::new(), 0)];
        let mut visited = 0;
        let mut matches = Vec::new();
        while let Some((path, depth)) = pending.pop() {
            if depth > 8 {
                continue;
            }
            for entry in self
                .dir
                .read_dir(if path.is_empty() { "." } else { &path })?
            {
                visited += 1;
                if visited > 5000 || matches.len() >= 100 {
                    return Ok(json!({"items":matches,"truncated":true}));
                }
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.')
                    || matches!(name.as_str(), "node_modules" | "target" | "vendor")
                {
                    continue;
                }
                let relative = if path.is_empty() {
                    name
                } else {
                    format!("{path}/{name}")
                };
                let ft = entry.file_type()?;
                if ft.is_symlink() {
                    continue;
                }
                if ft.is_dir() {
                    pending.push((relative, depth + 1));
                    continue;
                }
                if let Ok(bytes) = self.read_bytes(&relative, 1_000_000) {
                    if let Ok(text) = String::from_utf8(bytes) {
                        let lines=text.lines().enumerate().filter(|(_,line)|line.to_lowercase().contains(&keyword.to_lowercase())).take(5).map(|(n,line)|json!({"line":n+1,"text":line.chars().take(400).collect::<String>()})).collect::<Vec<_>>();
                        if !lines.is_empty() {
                            matches.push(json!({"path":relative,"matches":lines}));
                        }
                    }
                }
            }
        }
        Ok(json!({"items":matches,"truncated":false}))
    }
    pub fn preview(&self, path: &str, bytes: &[u8], expected: Option<&str>) -> AiResult<Value> {
        let relative = self.check(path)?;
        if bytes.len() > 20_000_000 {
            return Err(AiError::new("FILE_LIMIT", "单次写入最多 20 MB"));
        }
        let existing = match self.dir.symlink_metadata(&relative) {
            Ok(m) => {
                if !m.is_file() {
                    return Err(AiError::new("PATH_DENIED", "目标不是普通文件"));
                }
                Some(self.read_bytes(path, 20_000_000)?)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.into()),
        };
        let before = existing.as_ref().map(hash);
        if before.as_deref() != expected {
            return Err(AiError::new(
                "FILE_CONFLICT",
                "文件已变化；请重新读取并使用最新的 sha256。创建文件时 expectedHash 必须为空",
            ));
        }
        Ok(
            json!({"rootId":self.id,"path":path,"action":if before.is_some(){"modify"}else{"create"},"beforeHash":before,"afterHash":hash(bytes),"before":existing.as_ref().and_then(|b|std::str::from_utf8(b).ok()).map(|s|s.chars().take(12000).collect::<String>()),"after":std::str::from_utf8(bytes).ok().map(|s|s.chars().take(12000).collect::<String>()),"size":bytes.len()}),
        )
    }
    pub fn write(
        &self,
        path: &str,
        bytes: &[u8],
        expected: Option<&str>,
        backup_dir: &Path,
    ) -> AiResult<Value> {
        let preview = self.preview(path, bytes, expected)?;
        let relative = self.check(path)?;
        let backup = if expected.is_some() {
            let old = self.read_bytes(path, 20_000_000)?;
            use base64::Engine;
            let protected =
                crate::ai_secrets::protect(&base64::engine::general_purpose::STANDARD.encode(old))?;
            let backup_id = id("backup");
            std::fs::create_dir_all(backup_dir)?;
            std::fs::write(backup_dir.join(&backup_id), protected)?;
            Some(backup_id)
        } else {
            None
        };
        let temp = relative
            .parent()
            .unwrap_or(Path::new(""))
            .join(id(".lanmind"));
        let mut installed = false;
        let result = (|| -> AiResult<()> {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            let mut file = self.dir.open_with(&temp, &options)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            self.preview(path, bytes, expected)?;
            if expected.is_none() {
                // Hard-link installation is atomic and refuses an independently created target.
                self.dir.hard_link(&temp, &self.dir, &relative)?;
                installed = true;
                self.dir.remove_file(&temp)?;
            } else {
                self.dir.rename(&temp, &self.dir, &relative)?;
                installed = true;
            }
            if hash(self.read_bytes(path, 20_000_000)?) != hash(bytes) {
                return Err(AiError::new(
                    "OUTCOME_UNKNOWN",
                    "写入后的文件内容已改变，请人工核查",
                ));
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = self.dir.remove_file(&temp);
            if installed {
                return Err(AiError::new(
                    "OUTCOME_UNKNOWN",
                    "文件可能已写入，但无法完成写后核查，请检查目标文件",
                ));
            }
        }
        result?;
        Ok(
            json!({"artifact":true,"rootId":self.id,"rootPath":self.path.to_string_lossy(),"path":path,"beforeHash":expected,"afterHash":preview["afterHash"],"backupId":backup,"bytes":bytes.len()}),
        )
    }
    pub fn mkdir(&self, path: &str) -> AiResult<Value> {
        let relative = self.check(path)?;
        self.dir.create_dir(relative)?;
        Ok(json!({"created":path}))
    }
    pub fn restore(
        &self,
        path: &str,
        posthash: &str,
        backup_id: &str,
        backup_dir: &Path,
    ) -> AiResult<Value> {
        if !backup_id.starts_with("backup-")
            || !backup_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err(AiError::new("INVALID_ARGUMENTS", "无效备份"));
        }
        let protected = std::fs::read_to_string(backup_dir.join(backup_id))?;
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(crate::ai_secrets::reveal(&protected)?)
            .map_err(|_| AiError::new("INVALID_DATA", "备份损坏"))?;
        self.write(path, &bytes, Some(posthash), backup_dir)
    }
}
fn reparse(metadata: &cap_std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use cap_fs_ext::OsMetadataExt;
        return metadata.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}
pub fn safe_relative(raw: &str) -> AiResult<PathBuf> {
    let path = Path::new(raw);
    if raw.is_empty()
        || raw.len() > 1024
        || raw.contains([':', '\0'])
        || raw.starts_with(['\\', '/'])
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(AiError::new("PATH_DENIED", "只允许授权目录内的相对路径"));
    }
    for part in raw.split(['/', '\\']) {
        let device = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty()
            || part == ".."
            || part == "."
            || part.ends_with([' ', '.'])
            || matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (device.starts_with("COM") || device.starts_with("LPT"))
                && device.len() == 4
                && device.as_bytes()[3].is_ascii_digit()
        {
            return Err(AiError::new("PATH_DENIED", "路径包含不允许的名称"));
        }
    }
    Ok(path.to_path_buf())
}
#[derive(Default)]
pub struct FileRoots {
    roots: Mutex<HashMap<String, RootGrant>>,
}
impl FileRoots {
    pub fn grant(&self, scope: WorkspaceContext, path: &str, create: bool) -> AiResult<Value> {
        let path = std::fs::canonicalize(path)?;
        if !path.is_dir() || path.parent().is_none() {
            return Err(AiError::new("PATH_DENIED", "请选择具体的工作目录"));
        }
        let dir = Arc::new(Dir::open_ambient_dir(&path, cap_std::ambient_authority())?);
        let grant = RootGrant {
            id: id("root"),
            scope,
            path,
            dir,
            create,
        };
        let view = grant.view();
        self.roots
            .lock()
            .map_err(|_| "目录授权不可用")?
            .insert(grant.id.clone(), grant);
        Ok(view)
    }
    pub fn list(&self, scope: &WorkspaceContext) -> AiResult<Vec<Value>> {
        Ok(self
            .roots
            .lock()
            .map_err(|_| "目录授权不可用")?
            .values()
            .filter(|r| same_scope(&r.scope, scope))
            .map(RootGrant::view)
            .collect())
    }
    pub fn get(&self, scope: &WorkspaceContext, id: &str) -> AiResult<RootGrant> {
        self.roots
            .lock()
            .map_err(|_| "目录授权不可用")?
            .get(id)
            .filter(|r| same_scope(&r.scope, scope))
            .cloned()
            .ok_or_else(|| AiError::new("ROOT_NOT_AUTHORIZED", "目录授权已失效，请重新选择"))
    }
    pub fn revoke(&self, scope: &WorkspaceContext, id: &str) -> AiResult<()> {
        self.get(scope, id)?;
        self.roots.lock().map_err(|_| "目录授权不可用")?.remove(id);
        Ok(())
    }
    pub fn clear(&self) {
        if let Ok(mut roots) = self.roots.lock() {
            roots.clear();
        }
    }
}
pub fn same_scope(a: &WorkspaceContext, b: &WorkspaceContext) -> bool {
    a.workspace_id == b.workspace_id && a.user_id == b.user_id && a.revision == b.revision
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_path_variants_are_rejected() {
        for path in [
            "../secret",
            "C:\\secret",
            "a:b",
            "\\\\host\\x",
            "a/../../b",
            "CON.txt",
            "a/NUL",
            "a.",
            "a/../b",
            "a//b",
        ] {
            assert!(safe_relative(path).is_err(), "{path}");
        }
        assert!(safe_relative("notes/总结.md").is_ok());
    }
    #[cfg(windows)]
    #[test]
    fn create_conflict_modify_and_restore_check_real_content() {
        let directory = tempfile::tempdir().unwrap();
        let backups = tempfile::tempdir().unwrap();
        let grants = FileRoots::default();
        let scope = WorkspaceContext {
            workspace_id: "w".into(),
            user_id: "u".into(),
            revision: 1,
        };
        let view = grants
            .grant(scope.clone(), directory.path().to_str().unwrap(), true)
            .unwrap();
        let root = grants.get(&scope, view["id"].as_str().unwrap()).unwrap();
        root.write("note.txt", b"original", None, backups.path())
            .unwrap();
        assert!(root
            .write("note.txt", b"duplicate", None, backups.path())
            .is_err());
        let before = hash(b"original");
        root.preview("note.txt", b"planned", Some(&before)).unwrap();
        std::fs::write(directory.path().join("note.txt"), "external edit").unwrap();
        assert_eq!(
            root.write("note.txt", b"planned", Some(&before), backups.path())
                .unwrap_err()
                .code,
            "FILE_CONFLICT"
        );
        let result = root
            .write(
                "note.txt",
                b"planned",
                Some(&hash(b"external edit")),
                backups.path(),
            )
            .unwrap();
        assert_eq!(root.read("note.txt").unwrap()["content"], "planned");
        root.restore(
            "note.txt",
            result["afterHash"].as_str().unwrap(),
            result["backupId"].as_str().unwrap(),
            backups.path(),
        )
        .unwrap();
        assert_eq!(root.read("note.txt").unwrap()["content"], "external edit");
        assert!(root
            .restore(
                "note.txt",
                result["afterHash"].as_str().unwrap(),
                result["backupId"].as_str().unwrap(),
                backups.path()
            )
            .is_err());
        let other = WorkspaceContext {
            revision: 2,
            ..scope.clone()
        };
        assert!(grants.get(&other, &root.id).is_err());
        grants.revoke(&scope, &root.id).unwrap();
        assert!(grants.get(&scope, &root.id).is_err());
    }
    #[test]
    fn directory_capabilities_reject_escape_and_link_targets() {
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "private").unwrap();
        let grants = FileRoots::default();
        let scope = WorkspaceContext {
            workspace_id: "w".into(),
            user_id: "u".into(),
            revision: 1,
        };
        let view = grants
            .grant(scope.clone(), directory.path().to_str().unwrap(), false)
            .unwrap();
        let root = grants.get(&scope, view["id"].as_str().unwrap()).unwrap();
        assert!(root.read("../secret.txt").is_err());
        #[cfg(windows)]
        let linked =
            std::os::windows::fs::symlink_dir(outside.path(), directory.path().join("linked"));
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(outside.path(), directory.path().join("linked"));
        if linked.is_ok() {
            assert_eq!(
                root.read("linked/secret.txt").unwrap_err().code,
                "PATH_DENIED"
            );
        }
    }
}
