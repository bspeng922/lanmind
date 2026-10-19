//! Live, workspace-scoped file shares. Absolute paths and grants stay on the owner.
//! All remote access is confined to open directory capabilities. Writable shares
//! allow creation only; existing files are never replaced or removed remotely.
use super::*;
use cap_std::fs::{Dir, OpenOptions as CapOptions};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

const PAGE_SIZE: usize = 200;
const CHUNK_SIZE: usize = 256 * 1024;
const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024 * 1024;
const MAX_WIRE_LINE: u64 = 2 * 1024 * 1024;
type ShareResult<T> = Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedRoot {
    pub id: String,
    pub name: String,
    pub is_directory: bool,
    pub writable: bool,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedRoot {
    id: String,
    path: PathBuf,
    writable: bool,
}

struct Root {
    saved: SavedRoot,
    dir: Dir,
    identity: same_file::Handle,
    file_name: Option<String>,
}

fn failure(code: &str) -> String {
    format!("SHARE_{code}")
}
fn io<T>(result: std::io::Result<T>) -> ShareResult<T> {
    result.map_err(|error| {
        failure(match error.kind() {
            ErrorKind::NotFound => "NOT_FOUND",
            ErrorKind::AlreadyExists => "EXISTS",
            ErrorKind::PermissionDenied => "DENIED",
            _ => "IO",
        })
    })
}

fn valid_name(name: &str) -> ShareResult<()> {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.len() > 255
        || name.ends_with([' ', '.'])
        || name.starts_with(".lanmind-")
        || name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err(failure("PATH"));
    }
    Ok(())
}

fn relative_path(path: &str) -> ShareResult<PathBuf> {
    if path.is_empty() {
        return Ok(PathBuf::new());
    }
    if path.len() > 16_384 {
        return Err(failure("PATH"));
    }
    let mut result = PathBuf::new();
    for name in path.split('/') {
        valid_name(name)?;
        result.push(name);
    }
    Ok(result)
}

fn is_link(metadata: &cap_std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use cap_std::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

impl Root {
    fn open(saved: SavedRoot) -> ShareResult<Self> {
        let metadata = io(std::fs::symlink_metadata(&saved.path))?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(failure("PATH"));
            }
        }
        if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
            return Err(failure("PATH"));
        }
        let file_name = if metadata.is_file() {
            Some(
                saved
                    .path
                    .file_name()
                    .and_then(|v| v.to_str())
                    .ok_or_else(|| failure("PATH"))?
                    .to_string(),
            )
        } else {
            None
        };
        valid_name(
            saved
                .path
                .file_name()
                .and_then(|v| v.to_str())
                .ok_or_else(|| failure("PATH"))?,
        )?;
        let directory = if file_name.is_some() {
            saved.path.parent().ok_or_else(|| failure("PATH"))?
        } else {
            &saved.path
        };
        let dir = io(Dir::open_ambient_dir(
            directory,
            cap_std::ambient_authority(),
        ))?;
        let identity = io(same_file::Handle::from_path(&saved.path))?;
        Ok(Self {
            saved,
            dir,
            identity,
            file_name,
        })
    }

    fn check_root(&self) -> ShareResult<()> {
        if io(std::fs::canonicalize(&self.saved.path))? != self.saved.path
            || io(same_file::Handle::from_path(&self.saved.path))? != self.identity
        {
            return Err(failure("ROOT_CHANGED"));
        }
        let metadata = io(std::fs::symlink_metadata(&self.saved.path))?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(failure("ROOT_CHANGED"));
            }
        }
        if metadata.file_type().is_symlink() {
            return Err(failure("ROOT_CHANGED"));
        }
        Ok(())
    }

    fn resolve(&self, path: &str) -> ShareResult<PathBuf> {
        self.check_root()?;
        let relative = relative_path(path)?;
        if let Some(name) = &self.file_name {
            if !path.is_empty() {
                return Err(failure("PATH"));
            }
            return Ok(PathBuf::from(name));
        }
        let mut current = PathBuf::new();
        for component in relative.components() {
            current.push(component.as_os_str());
            let metadata = io(self.dir.symlink_metadata(&current))?;
            if is_link(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
                return Err(failure("PATH"));
            }
        }
        Ok(if path.is_empty() {
            PathBuf::from(".")
        } else {
            relative
        })
    }

    fn open_file(&self, path: &str) -> ShareResult<cap_std::fs::File> {
        let file = io(self.dir.open(self.resolve(path)?))?;
        if self.file_name.is_some() {
            let identity = io(same_file::Handle::from_file(
                io(file.try_clone())?.into_std(),
            ))?;
            if identity != self.identity {
                return Err(failure("ROOT_CHANGED"));
            }
        }
        Ok(file)
    }

    fn view(&self, local: bool) -> SharedRoot {
        SharedRoot {
            id: self.saved.id.clone(),
            name: self
                .saved
                .path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            is_directory: self.file_name.is_none(),
            writable: self.saved.writable && self.file_name.is_none(),
            available: self.check_root().is_ok(),
            local_path: local.then(|| self.saved.path.to_string_lossy().into()),
        }
    }
}

struct Upload {
    share_id: String,
    path: String,
    parent: Dir,
    temp: String,
    name: String,
    file: cap_std::fs::File,
    received: u64,
    size: u64,
    sha256: String,
    hasher: Sha256,
    touched: Instant,
}
impl Drop for Upload {
    fn drop(&mut self) {
        let _ = self.parent.remove_file(&self.temp);
    }
}

#[derive(Default)]
struct ShareState {
    saved: Vec<SavedRoot>,
    roots: HashMap<String, Root>,
    uploads: HashMap<String, Upload>,
}
pub struct SharedFiles {
    db: Arc<Mutex<Database>>,
    scope: crate::workspace_scope::WorkspaceContext,
    state: Mutex<ShareState>,
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ShareRequest {
    Roots,
    List {
        share_id: String,
        path: String,
        offset: usize,
    },
    Stat {
        share_id: String,
        path: String,
    },
    Read {
        share_id: String,
        path: String,
        version: String,
        offset: u64,
    },
    BeginUpload {
        share_id: String,
        path: String,
        name: String,
        size: u64,
        sha256: String,
    },
    Write {
        upload_id: String,
        offset: u64,
        data: String,
    },
    Finish {
        upload_id: String,
    },
    Abort {
        upload_id: String,
    },
    Mkdir {
        share_id: String,
        path: String,
        name: String,
    },
}

impl SharedFiles {
    pub fn new(db: Arc<Mutex<Database>>) -> ShareResult<Self> {
        let database = db.lock().map_err(|_| failure("IO"))?;
        let scope = database.workspace_context()?;
        let key = Self::settings_key(&scope);
        let saved: Vec<SavedRoot> = database
            .setting(&key)?
            .map(|s| serde_json::from_str(&s))
            .transpose()
            .map_err(|_| failure("IO"))?
            .unwrap_or_default();
        drop(database);
        let roots = saved
            .iter()
            .filter_map(|s| Root::open(s.clone()).ok().map(|r| (s.id.clone(), r)))
            .collect();
        Ok(Self {
            db,
            scope,
            state: Mutex::new(ShareState {
                saved,
                roots,
                uploads: HashMap::new(),
            }),
            jobs: Mutex::new(HashMap::new()),
        })
    }
    fn settings_key(scope: &crate::workspace_scope::WorkspaceContext) -> String {
        format!("lanFileShares:{}:{}", scope.workspace_id, scope.user_id)
    }
    fn active(&self) -> ShareResult<()> {
        self.db
            .lock()
            .map_err(|_| failure("IO"))?
            .validate_workspace_context(&self.scope)
            .map_err(|_| failure("WORKSPACE"))
    }
    fn save(&self, saved: &[SavedRoot]) -> ShareResult<()> {
        let db = self.db.lock().map_err(|_| failure("IO"))?;
        db.validate_workspace_context(&self.scope)
            .map_err(|_| failure("WORKSPACE"))?;
        db.save_local_setting(
            &Self::settings_key(&self.scope),
            &serde_json::to_string(saved).map_err(|_| failure("IO"))?,
        )
    }
    pub fn local_roots(&self) -> ShareResult<Vec<SharedRoot>> {
        self.active()?;
        let state = self.state.lock().map_err(|_| failure("IO"))?;
        Ok(state
            .saved
            .iter()
            .map(|s| {
                state
                    .roots
                    .get(&s.id)
                    .map(|r| r.view(true))
                    .unwrap_or_else(|| SharedRoot {
                        id: s.id.clone(),
                        name: s
                            .path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into(),
                        is_directory: false,
                        writable: s.writable,
                        available: false,
                        local_path: Some(s.path.to_string_lossy().into()),
                    })
            })
            .collect())
    }
    pub fn add(&self, path: &Path) -> ShareResult<Vec<SharedRoot>> {
        self.active()?;
        // Explicit selection is normalized once; all later operations verify the root identity.
        let saved = SavedRoot {
            id: Uuid::new_v4().to_string(),
            path: io(std::fs::canonicalize(path))?,
            writable: false,
        };
        let root = Root::open(saved.clone())?;
        let mut state = self.state.lock().map_err(|_| failure("IO"))?;
        if state.saved.len() >= 100 {
            return Err(failure("LIMIT"));
        }
        if state.saved.iter().any(|s| s.path == saved.path) {
            return Err(failure("EXISTS"));
        }
        let mut next = state.saved.clone();
        next.push(saved.clone());
        self.save(&next)?;
        state.saved = next;
        state.roots.insert(saved.id, root);
        drop(state);
        self.local_roots()
    }
    pub fn update(&self, id: &str, writable: Option<bool>) -> ShareResult<Vec<SharedRoot>> {
        self.active()?;
        let mut state = self.state.lock().map_err(|_| failure("IO"))?;
        let mut next = state.saved.clone();
        let index = next
            .iter()
            .position(|s| s.id == id)
            .ok_or_else(|| failure("NOT_FOUND"))?;
        if let Some(writable) = writable {
            if !state.roots.get(id).is_some_and(|r| r.file_name.is_none()) {
                return Err(failure("DENIED"));
            }
            next[index].writable = writable;
        } else {
            next.remove(index);
        }
        self.save(&next)?;
        state.saved = next;
        if let Some(writable) = writable {
            state.roots.get_mut(id).unwrap().saved.writable = writable;
        } else {
            state.roots.remove(id);
        }
        state.uploads.retain(|_, upload| upload.share_id != id);
        drop(state);
        self.local_roots()
    }

    fn root<'a>(state: &'a ShareState, id: &str, write: bool) -> ShareResult<&'a Root> {
        let root = state.roots.get(id).ok_or_else(|| failure("NOT_FOUND"))?;
        root.check_root()?;
        if write && (!root.saved.writable || root.file_name.is_some()) {
            return Err(failure("READ_ONLY"));
        }
        Ok(root)
    }
    fn check_upload(state: &ShareState, upload: &Upload) -> ShareResult<()> {
        let root = Self::root(state, &upload.share_id, true)?;
        let parent = io(root.dir.open_dir(root.resolve(&upload.path)?))?;
        let original = io(same_file::Handle::from_file(
            io(upload.parent.try_clone())?.into_std_file(),
        ))?;
        let current = io(same_file::Handle::from_file(parent.into_std_file()))?;
        if original != current {
            return Err(failure("ROOT_CHANGED"));
        }
        Ok(())
    }
    pub(super) fn clear_uploads(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.uploads.clear();
        }
    }
    pub fn request(&self, request: ShareRequest) -> ShareResult<Value> {
        let mut state = self.state.lock().map_err(|_| failure("IO"))?;
        // Serialize the filesystem operation with workspace changes. Lock order
        // matches add/update (share state, then database).
        let database = self.db.lock().map_err(|_| failure("IO"))?;
        database
            .validate_workspace_context(&self.scope)
            .map_err(|_| failure("WORKSPACE"))?;
        state
            .uploads
            .retain(|_, upload| upload.touched.elapsed() < Duration::from_secs(900));
        match request {
            ShareRequest::Roots => {
                Ok(json!({"roots":state.roots.values().map(|r| r.view(false)).collect::<Vec<_>>()}))
            }
            ShareRequest::List {
                share_id,
                path,
                offset,
            } => {
                let root = Self::root(&state, &share_id, false)?;
                let directory = root.resolve(&path)?;
                if root.file_name.is_some() {
                    return Err(failure("PATH"));
                }
                let mut items = Vec::new();
                for entry in io(root.dir.read_dir(directory))? {
                    let entry = io(entry)?;
                    let name = entry
                        .file_name()
                        .into_string()
                        .map_err(|_| failure("PATH"))?;
                    if name.starts_with(".lanmind-") {
                        continue;
                    }
                    let metadata = io(root.dir.symlink_metadata(if path.is_empty() {
                        name.clone()
                    } else {
                        format!("{path}/{name}")
                    }))?;
                    if is_link(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
                        continue;
                    }
                    items.push(json!({"name":name,"path":if path.is_empty(){name.clone()}else{format!("{path}/{name}")},"isDirectory":metadata.is_dir(),"size":metadata.len()}));
                    if items.len() > 100_000 {
                        return Err(failure("LIMIT"));
                    }
                }
                items.sort_by(|a, b| {
                    b["isDirectory"]
                        .as_bool()
                        .cmp(&a["isDirectory"].as_bool())
                        .then_with(|| a["name"].as_str().cmp(&b["name"].as_str()))
                });
                let total = items.len();
                // Keep deep paths below the encrypted response frame limit.
                let page_size = PAGE_SIZE.min(900_000 / (path.len() + 1024)).max(1);
                Ok(
                    json!({"entries":items.into_iter().skip(offset).take(page_size).collect::<Vec<_>>(),"total":total}),
                )
            }
            ShareRequest::Stat { share_id, path } => {
                let root = Self::root(&state, &share_id, false)?;
                let mut file = root.open_file(&path)?;
                let metadata = io(file.metadata())?;
                if !metadata.is_file() || metadata.len() > MAX_FILE_SIZE {
                    return Err(failure("LIMIT"));
                }
                let version = version(&metadata)?;
                let sha256 = hash_reader(&mut file)?;
                if version != self::version(&io(file.metadata())?)? {
                    return Err(failure("CHANGED"));
                }
                Ok(json!({"size":metadata.len(),"sha256":sha256,"version":version}))
            }
            ShareRequest::Read {
                share_id,
                path,
                version: expected,
                offset,
            } => {
                let root = Self::root(&state, &share_id, false)?;
                let mut file = root.open_file(&path)?;
                let metadata = io(file.metadata())?;
                if !metadata.is_file() || metadata.len() > MAX_FILE_SIZE || offset > metadata.len()
                {
                    return Err(failure("LIMIT"));
                }
                if version(&metadata)? != expected {
                    return Err(failure("CHANGED"));
                }
                io(file.seek(SeekFrom::Start(offset)))?;
                let mut buffer = vec![0; CHUNK_SIZE.min((metadata.len() - offset) as usize)];
                io(file.read_exact(&mut buffer))?;
                if version(&io(file.metadata())?)? != expected {
                    return Err(failure("CHANGED"));
                }
                Ok(json!({"data":base64::engine::general_purpose::STANDARD.encode(buffer)}))
            }
            ShareRequest::Mkdir {
                share_id,
                path,
                name,
            } => {
                valid_name(&name)?;
                let root = Self::root(&state, &share_id, true)?;
                let parent = io(root.dir.open_dir(root.resolve(&path)?))?;
                io(parent.create_dir(name))?;
                Ok(json!({}))
            }
            ShareRequest::BeginUpload {
                share_id,
                path,
                name,
                size,
                sha256,
            } => {
                valid_name(&name)?;
                if size > MAX_FILE_SIZE
                    || state.uploads.len() >= 8
                    || sha256.len() != 64
                    || !sha256.bytes().all(|b| b.is_ascii_hexdigit())
                {
                    return Err(failure("LIMIT"));
                }
                let root = Self::root(&state, &share_id, true)?;
                let parent = io(root.dir.open_dir(root.resolve(&path)?))?;
                if parent.symlink_metadata(&name).is_ok() {
                    return Err(failure("EXISTS"));
                }
                let id = Uuid::new_v4().to_string();
                let temp = format!(".lanmind-upload-{id}.part");
                let file =
                    io(parent.open_with(&temp, CapOptions::new().write(true).create_new(true)))?;
                state.uploads.insert(
                    id.clone(),
                    Upload {
                        share_id,
                        path,
                        parent,
                        temp,
                        name,
                        file,
                        received: 0,
                        size,
                        sha256,
                        hasher: Sha256::new(),
                        touched: Instant::now(),
                    },
                );
                Ok(json!({"uploadId":id}))
            }
            ShareRequest::Write {
                upload_id,
                offset,
                data,
            } => {
                let upload = state
                    .uploads
                    .get(&upload_id)
                    .ok_or_else(|| failure("NOT_FOUND"))?;
                Self::check_upload(&state, upload)?;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .map_err(|_| failure("INVALID"))?;
                let upload = state.uploads.get_mut(&upload_id).unwrap();
                if bytes.is_empty()
                    || bytes.len() > CHUNK_SIZE
                    || offset != upload.received
                    || offset + bytes.len() as u64 > upload.size
                {
                    return Err(failure("INVALID"));
                }
                io(upload.file.write_all(&bytes))?;
                upload.hasher.update(&bytes);
                upload.received += bytes.len() as u64;
                upload.touched = Instant::now();
                Ok(json!({}))
            }
            ShareRequest::Finish { upload_id } => {
                let upload = state
                    .uploads
                    .get(&upload_id)
                    .ok_or_else(|| failure("NOT_FOUND"))?;
                Self::check_upload(&state, upload)?;
                let upload = state.uploads.remove(&upload_id).unwrap();
                if upload.received != upload.size
                    || format!("{:x}", upload.hasher.clone().finalize()) != upload.sha256
                {
                    return Err(failure("CHECKSUM"));
                }
                io(upload.file.sync_all())?;
                // Atomic no-clobber commit, including files created locally during upload.
                io(upload
                    .parent
                    .hard_link(&upload.temp, &upload.parent, &upload.name))?;
                Ok(json!({}))
            }
            ShareRequest::Abort { upload_id } => {
                state.uploads.remove(&upload_id);
                Ok(json!({}))
            }
        }
    }
}

fn version(metadata: &cap_std::fs::Metadata) -> ShareResult<String> {
    Ok(format!(
        "{}:{}",
        metadata.len(),
        io(metadata.modified())?
            .into_std()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map_err(|_| failure("IO"))?
            .as_nanos()
    ))
}
fn hash_reader(reader: &mut impl Read) -> ShareResult<String> {
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; CHUNK_SIZE];
    loop {
        let count = io(reader.read(&mut buffer))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Share requests reuse the authenticated workspace channel, with bounded frames
/// and a persistent connection for directory downloads and multi-chunk uploads.
pub(super) fn serve(
    stream: TcpStream,
    first: ShareRequest,
    shares: Arc<SharedFiles>,
    key: [u8; 32],
    stopped: Arc<AtomicBool>,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
    struct Cleanup {
        shares: Arc<SharedFiles>,
        ids: Vec<String>,
    }
    impl Drop for Cleanup {
        fn drop(&mut self) {
            if let Ok(mut state) = self.shares.state.lock() {
                for id in &self.ids {
                    state.uploads.remove(id);
                }
            }
        }
    }
    let mut cleanup = Cleanup {
        shares: shares.clone(),
        ids: Vec::new(),
    };
    let mut connection = BufReader::new(stream);
    let mut request = first;
    loop {
        if stopped.load(Ordering::Acquire) {
            return;
        }
        let result = shares.request(request);
        let (value, error) = match result {
            Ok(value) => (value, None),
            Err(error) => (Value::Null, Some(error)),
        };
        if let Some(id) = value["uploadId"].as_str() {
            cleanup.ids.push(id.to_string());
        }
        let response = WireMessage::ShareResponse { value, error };
        if send_message_line(connection.get_mut(), &response, &key).is_err() {
            return;
        }
        match receive_message_line(&mut connection, &key) {
            Ok(WireMessage::ShareRequest {
                sender_workspace_id,
                request: next,
            }) if sender_workspace_id == shares.scope.workspace_id => request = next,
            _ => return,
        }
    }
}
fn send_message_line(
    stream: &mut TcpStream,
    message: &WireMessage,
    key: &[u8; 32],
) -> ShareResult<()> {
    let line = seal_message(message, key, WORKSPACE_CHANNEL)?;
    io(stream.write_all(line.as_bytes()))?;
    io(stream.write_all(b"\n"))
}
fn receive_message_line(
    reader: &mut BufReader<TcpStream>,
    key: &[u8; 32],
) -> ShareResult<WireMessage> {
    let mut line = String::new();
    io(reader.take(MAX_WIRE_LINE + 1).read_line(&mut line))?;
    if line.len() as u64 > MAX_WIRE_LINE || !line.ends_with('\n') {
        return Err(failure("UNAVAILABLE"));
    }
    let (message, _, channel) =
        open_message(line.trim(), key).map_err(|_| failure("UNAVAILABLE"))?;
    if channel != WORKSPACE_CHANNEL {
        return Err(failure("DENIED"));
    }
    Ok(message)
}

struct Client {
    reader: BufReader<TcpStream>,
    key: [u8; 32],
    workspace_id: String,
    stopped: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
}
impl Client {
    fn check(&self) -> ShareResult<()> {
        if self.stopped.load(Ordering::Acquire) {
            return Err(failure("WORKSPACE"));
        }
        if self.cancel.load(Ordering::Acquire) {
            return Err(failure("CANCELLED"));
        }
        Ok(())
    }
    fn call(&mut self, request: ShareRequest) -> ShareResult<Value> {
        self.check()?;
        send_message_line(
            self.reader.get_mut(),
            &WireMessage::ShareRequest {
                sender_workspace_id: self.workspace_id.clone(),
                request,
            },
            &self.key,
        )?;
        let response = receive_message_line(&mut self.reader, &self.key)?;
        self.check()?;
        match response {
            WireMessage::ShareResponse { value, error: None } => Ok(value),
            WireMessage::ShareResponse {
                error: Some(error), ..
            } => Err(error),
            _ => Err(failure("UNAVAILABLE")),
        }
    }
}

impl NetworkRuntime {
    fn share_client(&self, user_id: &str, cancel: Arc<AtomicBool>) -> ShareResult<Client> {
        if self.stopped.load(Ordering::Acquire) {
            return Err(failure("WORKSPACE"));
        }
        let peer = self
            .snapshot()
            .peers
            .into_iter()
            .find(|p| p.user_id == user_id)
            .ok_or_else(|| failure("OFFLINE"))?;
        let address = format!("{}:{}", peer.address, peer.port)
            .parse()
            .map_err(|_| failure("OFFLINE"))?;
        let stream = TcpStream::connect_timeout(&address, Duration::from_secs(5))
            .map_err(|_| failure("OFFLINE"))?;
        io(stream.set_read_timeout(Some(Duration::from_secs(60))))?;
        io(stream.set_write_timeout(Some(Duration::from_secs(30))))?;
        Ok(Client {
            reader: BufReader::new(stream),
            key: self.workspace_key,
            workspace_id: self.workspace_id.clone(),
            stopped: self.stopped.clone(),
            cancel,
        })
    }
    pub fn list_shared_roots(&self, user_id: &str) -> ShareResult<Value> {
        self.share_client(user_id, Arc::new(AtomicBool::new(false)))?
            .call(ShareRequest::Roots)
    }
    pub fn list_shared_entries(
        &self,
        user_id: &str,
        share_id: String,
        path: String,
        offset: usize,
    ) -> ShareResult<Value> {
        self.share_client(user_id, Arc::new(AtomicBool::new(false)))?
            .call(ShareRequest::List {
                share_id,
                path,
                offset,
            })
    }
    pub fn create_shared_directory(
        &self,
        user_id: &str,
        share_id: String,
        path: String,
        name: String,
    ) -> ShareResult<()> {
        self.share_client(user_id, Arc::new(AtomicBool::new(false)))?
            .call(ShareRequest::Mkdir {
                share_id,
                path,
                name,
            })
            .map(|_| ())
    }
    fn job(&self, id: &str) -> ShareResult<Job<'_>> {
        let mut jobs = self.shares.jobs.lock().map_err(|_| failure("IO"))?;
        if jobs.contains_key(id) || jobs.len() >= 4 {
            return Err(failure("BUSY"));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        jobs.insert(id.into(), cancel.clone());
        Ok(Job {
            shares: &self.shares,
            id: id.into(),
            cancel,
        })
    }
    pub fn cancel_share_transfer(&self, id: &str) -> ShareResult<()> {
        if let Some(cancel) = self.shares.jobs.lock().map_err(|_| failure("IO"))?.get(id) {
            cancel.store(true, Ordering::Release);
        }
        Ok(())
    }
    fn share_progress(&self, id: &str, name: &str, received: u64, total: u64) {
        let _ = self.app.emit("share://progress", json!({"workspaceId":self.workspace_id,"transferId":id,"name":name,"received":received,"total":total}));
    }
    pub fn upload_shared_file(
        &self,
        user_id: &str,
        share_id: String,
        path: String,
        source: &Path,
        transfer_id: &str,
    ) -> ShareResult<()> {
        let job = self.job(transfer_id)?;
        let mut file = io(File::open(source))?;
        let metadata = io(file.metadata())?;
        if !metadata.is_file() || metadata.len() > MAX_FILE_SIZE {
            return Err(failure("LIMIT"));
        }
        let name = source
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| failure("PATH"))?
            .to_string();
        let mut hasher = Sha256::new();
        let mut buffer = vec![0; CHUNK_SIZE];
        loop {
            if job.cancel.load(Ordering::Acquire) {
                return Err(failure("CANCELLED"));
            }
            if self.stopped.load(Ordering::Acquire) {
                return Err(failure("WORKSPACE"));
            }
            let count = io(file.read(&mut buffer))?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        let sha256 = format!("{:x}", hasher.finalize());
        let mut client = self.share_client(user_id, job.cancel.clone())?;
        io(file.seek(SeekFrom::Start(0)))?;
        let response = client.call(ShareRequest::BeginUpload {
            share_id,
            path,
            name: name.clone(),
            size: metadata.len(),
            sha256,
        })?;
        let upload_id = response["uploadId"]
            .as_str()
            .ok_or_else(|| failure("INVALID"))?
            .to_string();
        let result = (|| {
            let mut offset = 0;
            let mut buffer = vec![0; CHUNK_SIZE];
            self.share_progress(transfer_id, &name, 0, metadata.len());
            loop {
                client.check()?;
                let count = io(file.read(&mut buffer))?;
                if count == 0 {
                    break;
                }
                client.call(ShareRequest::Write {
                    upload_id: upload_id.clone(),
                    offset,
                    data: base64::engine::general_purpose::STANDARD.encode(&buffer[..count]),
                })?;
                offset += count as u64;
                self.share_progress(transfer_id, &name, offset, metadata.len());
            }
            client
                .call(ShareRequest::Finish {
                    upload_id: upload_id.clone(),
                })
                .map(|_| ())
        })();
        if result.is_err() {
            // Cancellation does not suppress cleanup of the remote temporary file.
            client.cancel = Arc::new(AtomicBool::new(false));
            let _ = client.call(ShareRequest::Abort { upload_id });
        }
        result
    }
    pub fn download_shared(
        &self,
        user_id: &str,
        share_id: &str,
        path: &str,
        name: &str,
        directory: bool,
        destination: &Path,
        transfer_id: &str,
    ) -> ShareResult<()> {
        valid_name(name)?;
        relative_path(path)?;
        let job = self.job(transfer_id)?;
        let mut client = self.share_client(user_id, job.cancel.clone())?;
        if directory {
            download_directory(
                &mut client,
                user_id,
                share_id,
                path,
                name,
                destination,
                &|name, received, total| self.share_progress(transfer_id, name, received, total),
            )?;
        } else {
            let parent_path = io(std::fs::canonicalize(
                destination.parent().ok_or_else(|| failure("PATH"))?,
            ))?;
            let parent = io(Dir::open_ambient_dir(
                parent_path,
                cap_std::ambient_authority(),
            ))?;
            let file_name = destination
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| failure("PATH"))?;
            valid_name(file_name)?;
            download_one(
                &mut client,
                share_id,
                path,
                &parent,
                file_name,
                &|name, received, total| self.share_progress(transfer_id, name, received, total),
            )?;
        }
        Ok(())
    }
}

fn download_directory(
    client: &mut Client,
    user_id: &str,
    share_id: &str,
    path: &str,
    name: &str,
    destination: &Path,
    progress: &impl Fn(&str, u64, u64),
) -> ShareResult<()> {
    valid_name(name)?;
    relative_path(path)?;
    let destination = io(std::fs::canonicalize(destination))?;
    let parent = io(Dir::open_ambient_dir(
        destination,
        cap_std::ambient_authority(),
    ))?;
    let marker = format!("{user_id}:{share_id}:{path}");
    match parent.create_dir(name) {
        Ok(()) => {
            let target = io(parent.open_dir(name))?;
            io(target.write(".lanmind-download", marker.as_bytes()))?;
        }
        Err(e) if e.kind() == ErrorKind::AlreadyExists => {
            if is_link(&io(parent.symlink_metadata(name))?) {
                return Err(failure("PATH"));
            }
            let target = io(parent.open_dir(name))?;
            if target.read_to_string(".lanmind-download").ok().as_deref() != Some(&marker) {
                return Err(failure("EXISTS"));
            }
        }
        Err(e) => return Err(io::<()>(Err(e)).unwrap_err()),
    }
    let target = io(parent.open_dir(name))?;
    let mut pending = vec![(path.to_string(), String::new(), 0)];
    let mut visited = 0;
    while let Some((remote, local, depth)) = pending.pop() {
        if depth > 64 {
            return Err(failure("LIMIT"));
        }
        client.check()?;
        let mut offset = 0;
        loop {
            let listing = client.call(ShareRequest::List {
                share_id: share_id.into(),
                path: remote.clone(),
                offset,
            })?;
            let entries = listing["entries"]
                .as_array()
                .ok_or_else(|| failure("INVALID"))?;
            for entry in entries {
                visited += 1;
                if visited > 100_000 {
                    return Err(failure("LIMIT"));
                }
                let child_name = entry["name"].as_str().ok_or_else(|| failure("INVALID"))?;
                valid_name(child_name)?;
                let remote_child = join_relative(&remote, child_name);
                let local_child = join_relative(&local, child_name);
                if entry["isDirectory"].as_bool() == Some(true) {
                    match target.create_dir(&local_child) {
                        Ok(()) => (),
                        Err(e) if e.kind() == ErrorKind::AlreadyExists => (),
                        Err(e) => return Err(io::<()>(Err(e)).unwrap_err()),
                    }
                    ensure_local_path(&target, &local_child)?;
                    pending.push((remote_child, local_child, depth + 1));
                } else {
                    download_one(
                        client,
                        share_id,
                        &remote_child,
                        &target,
                        &local_child,
                        progress,
                    )?;
                }
            }
            offset += entries.len();
            if entries.is_empty()
                || offset as u64
                    >= listing["total"]
                        .as_u64()
                        .ok_or_else(|| failure("INVALID"))?
            {
                break;
            }
        }
    }
    client.check()?;
    io(target.remove_file(".lanmind-download"))?;
    Ok(())
}
struct Job<'a> {
    shares: &'a SharedFiles,
    id: String,
    cancel: Arc<AtomicBool>,
}
impl Drop for Job<'_> {
    fn drop(&mut self) {
        if let Ok(mut jobs) = self.shares.jobs.lock() {
            jobs.remove(&self.id);
        }
    }
}
fn join_relative(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.into()
    } else {
        format!("{parent}/{name}")
    }
}
fn ensure_local_path(dir: &Dir, path: &str) -> ShareResult<()> {
    let relative = relative_path(path)?;
    let mut current = PathBuf::new();
    for component in relative.components() {
        current.push(component.as_os_str());
        if is_link(&io(dir.symlink_metadata(&current))?) {
            return Err(failure("PATH"));
        }
    }
    Ok(())
}
fn download_one(
    client: &mut Client,
    share_id: &str,
    path: &str,
    target: &Dir,
    local: &str,
    progress: &impl Fn(&str, u64, u64),
) -> ShareResult<()> {
    let stat = client.call(ShareRequest::Stat {
        share_id: share_id.into(),
        path: path.into(),
    })?;
    let size = stat["size"]
        .as_u64()
        .filter(|s| *s <= MAX_FILE_SIZE)
        .ok_or_else(|| failure("LIMIT"))?;
    let sha256 = stat["sha256"]
        .as_str()
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| failure("INVALID"))?;
    let version = stat["version"].as_str().ok_or_else(|| failure("INVALID"))?;
    let relative = relative_path(local)?;
    let parent_path = local
        .rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("");
    if !parent_path.is_empty() {
        ensure_local_path(target, parent_path)?;
    }
    let parent = io(target.open_dir(if parent_path.is_empty() {
        "."
    } else {
        parent_path
    }))?;
    let name = relative.file_name().ok_or_else(|| failure("PATH"))?;
    if let Ok(metadata) = parent.symlink_metadata(name) {
        if is_link(&metadata) || !metadata.is_file() {
            return Err(failure("EXISTS"));
        }
        let mut existing = io(parent.open(name))?;
        if metadata.len() == size && hash_reader(&mut existing)? == sha256 {
            return Ok(());
        }
        return Err(failure("EXISTS"));
    }
    let temp = format!(
        ".lanmind-download-{:x}.part",
        Sha256::digest(format!("{}:{sha256}", local).as_bytes())
    );
    if let Ok(metadata) = parent.symlink_metadata(&temp) {
        if is_link(&metadata) || !metadata.is_file() {
            return Err(failure("PATH"));
        }
    }
    let mut file =
        io(parent.open_with(&temp, CapOptions::new().create(true).read(true).write(true)))?;
    let mut offset = io(file.metadata())?.len();
    if offset > size {
        io(file.set_len(0))?;
        offset = 0;
    }
    io(file.seek(SeekFrom::Start(offset)))?;
    progress(local, offset, size);
    while offset < size {
        let value = client.call(ShareRequest::Read {
            share_id: share_id.into(),
            path: path.into(),
            version: version.into(),
            offset,
        })?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(value["data"].as_str().ok_or_else(|| failure("INVALID"))?)
            .map_err(|_| failure("INVALID"))?;
        if bytes.is_empty() || bytes.len() > CHUNK_SIZE || offset + bytes.len() as u64 > size {
            return Err(failure("INVALID"));
        }
        io(file.write_all(&bytes))?;
        offset += bytes.len() as u64;
        progress(local, offset, size);
    }
    client.check()?;
    io(file.seek(SeekFrom::Start(0)))?;
    if hash_reader(&mut file)? != sha256 {
        drop(file);
        let _ = parent.remove_file(&temp);
        return Err(failure("CHECKSUM"));
    }
    io(file.sync_all())?;
    client.check()?;
    io(parent.hard_link(&temp, &parent, name))?;
    drop(file);
    io(parent.remove_file(&temp))?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ShareCommand {
    LocalRoots,
    Add {
        path: String,
    },
    Permission {
        share_id: String,
        writable: bool,
    },
    Remove {
        share_id: String,
    },
    Roots {
        user_id: String,
    },
    List {
        user_id: String,
        share_id: String,
        path: String,
        offset: usize,
    },
    Mkdir {
        user_id: String,
        share_id: String,
        path: String,
        name: String,
    },
    Upload {
        user_id: String,
        share_id: String,
        path: String,
        source: String,
        transfer_id: String,
    },
    Download {
        user_id: String,
        share_id: String,
        path: String,
        name: String,
        directory: bool,
        destination: String,
        transfer_id: String,
    },
    Cancel {
        transfer_id: String,
    },
}

#[tauri::command]
pub async fn lan_share(
    state: tauri::State<'_, crate::AppState>,
    workspace_context: crate::workspace_scope::WorkspaceContext,
    request: ShareCommand,
) -> ShareResult<Value> {
    let runtime = {
        let runtime = state.network.lock().map_err(|_| failure("IO"))?;
        crate::with_workspace_db(&state, &workspace_context, |_| Ok(()))?;
        runtime.clone()
    };
    tauri::async_runtime::spawn_blocking(move || {
        if runtime.stopped.load(Ordering::Acquire) {
            return Err(failure("WORKSPACE"));
        }
        match request {
            ShareCommand::LocalRoots => Ok(json!(runtime.shares.local_roots()?)),
            ShareCommand::Add { path } => Ok(json!(runtime.shares.add(Path::new(&path))?)),
            ShareCommand::Permission { share_id, writable } => {
                Ok(json!(runtime.shares.update(&share_id, Some(writable))?))
            }
            ShareCommand::Remove { share_id } => {
                Ok(json!(runtime.shares.update(&share_id, None)?))
            }
            ShareCommand::Roots { user_id } => runtime.list_shared_roots(&user_id),
            ShareCommand::List {
                user_id,
                share_id,
                path,
                offset,
            } => runtime.list_shared_entries(&user_id, share_id, path, offset),
            ShareCommand::Mkdir {
                user_id,
                share_id,
                path,
                name,
            } => {
                runtime.create_shared_directory(&user_id, share_id, path, name)?;
                Ok(Value::Null)
            }
            ShareCommand::Upload {
                user_id,
                share_id,
                path,
                source,
                transfer_id,
            } => {
                runtime.upload_shared_file(
                    &user_id,
                    share_id,
                    path,
                    Path::new(&source),
                    &transfer_id,
                )?;
                Ok(Value::Null)
            }
            ShareCommand::Download {
                user_id,
                share_id,
                path,
                name,
                directory,
                destination,
                transfer_id,
            } => {
                runtime.download_shared(
                    &user_id,
                    &share_id,
                    &path,
                    &name,
                    directory,
                    Path::new(&destination),
                    &transfer_id,
                )?;
                Ok(Value::Null)
            }
            ShareCommand::Cancel { transfer_id } => {
                runtime.cancel_share_transfer(&transfer_id)?;
                Ok(Value::Null)
            }
        }
    })
    .await
    .map_err(|_| failure("IO"))?
}

#[cfg(test)]
#[path = "shared_files_tests.rs"]
mod tests;
