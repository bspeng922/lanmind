//! Serverless LAN transport.
//!
//! UDP broadcast/multicast discovers peers; short-lived TCP connections carry
//! encrypted operation batches and resumable file chunks. Workspace data and
//! cross-workspace LAN chat use separate cryptographic channel contexts.

use crate::db::Database;
use crate::models::{ChatMessage, FileOffer};
use crate::models::{NetworkStatus, PeerInfo, SyncOperation};
use base64::Engine;
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Key, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, ErrorKind, Read, Seek, SeekFrom, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const DISCOVERY_PORT: u16 = 45991;
const DISCOVERY_MULTICAST_ADDRESS: Ipv4Addr = Ipv4Addr::new(239, 255, 45, 91);
const PROTOCOL_VERSION: u8 = 1;
// Workspace operations use the shared workspace secret. LAN chat must remain
// reachable across workspaces, so it is sealed with a separate LAN context.
const WORKSPACE_CHANNEL: &str = "workspace";
const LAN_CHAT_CHANNEL: &str = "lan-chat";
const LAN_TRANSPORT_CONTEXT: &str = "lanmind-lan-chat-transport-v1";
const PEER_ONLINE_TIMEOUT_SECS: i64 = 10;
const FILE_CHUNK_SIZE: usize = 1024 * 1024;
const FILE_FRAME_OVERHEAD: usize = 12 + 16;

#[derive(Clone)]
pub struct NetworkRuntime {
    pub node_id: String,
    pub device_id: String,
    pub workspace_id: String,
    pub user_id: String,
    pub listening_port: u16,
    peers: Arc<Mutex<HashMap<String, PeerInfo>>>,
    files: Arc<Mutex<HashMap<String, PathBuf>>>,
    app: AppHandle,
    workspace_key: [u8; 32],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryPacket {
    version: u8,
    workspace_id: String,
    node_id: String,
    #[serde(default)]
    device_id: String,
    user_id: String,
    display_name: String,
    tcp_port: u16,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileHeader {
    file_name: String,
    size_bytes: u64,
    sha256: String,
    offset: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct SecureEnvelope {
    #[serde(default)]
    channel: String,
    nonce: String,
    payload: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WireMessage {
    SyncRequest {
        sender_user_id: String,
        sender_workspace_id: String,
        operations: Vec<SyncOperation>,
    },
    SyncResponse {
        operations: Vec<SyncOperation>,
    },
    FileRequest {
        transfer_id: String,
        offset: u64,
    },
}

fn emit_incoming_chat(app: &AppHandle, operation: &SyncOperation) {
    if operation.entity_type == "chat_message" && operation.action == "create" {
        if let Ok(message) = serde_json::from_value::<ChatMessage>(operation.payload.clone()) {
            let _ = app.emit("chat://message", message);
        }
    }
}

pub fn start(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    workspace_id: String,
    workspace_token: String,
    user_id: String,
) -> NetworkRuntime {
    let device_id = hostname::get()
        .ok()
        .and_then(|name| name.into_string().ok())
        .unwrap_or_else(|| "desktop".into());
    let node_id = format!("{}@{}", user_id, device_id);
    let listener = TcpListener::bind("0.0.0.0:0").expect("无法启动局域网同步监听器");
    let tcp_port = listener.local_addr().map(|addr| addr.port()).unwrap_or(0);
    let peers = Arc::new(Mutex::new(HashMap::new()));
    let files = Arc::new(Mutex::new(HashMap::new()));
    let workspace_key = derive_workspace_key(&workspace_token);
    let runtime = NetworkRuntime {
        node_id: node_id.clone(),
        device_id,
        workspace_id: workspace_id.clone(),
        user_id: user_id.clone(),
        listening_port: tcp_port,
        peers: peers.clone(),
        files: files.clone(),
        app: app.clone(),
        workspace_key,
    };

    let server_app = app.clone();
    let server_db = db.clone();
    let server_workspace = workspace_id.clone();
    let server_files = files.clone();
    let server_key = workspace_key;
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = server_app.clone();
            let db = server_db.clone();
            let workspace = server_workspace.clone();
            let files = server_files.clone();
            thread::spawn(move || handle_connection(stream, app, db, workspace, files, server_key));
        }
    });

    let discovery_runtime = runtime.clone();
    let discovery_app = app.clone();
    let discovery_db = db.clone();
    thread::spawn(move || discovery_loop(discovery_app, discovery_db, discovery_runtime));
    runtime
}

fn discovery_loop(app: AppHandle, db: Arc<Mutex<Database>>, runtime: NetworkRuntime) {
    let sender = UdpSocket::bind("0.0.0.0:0").ok();
    if let Some(sender) = &sender {
        let _ = sender.set_broadcast(true);
        let _ = sender.set_multicast_ttl_v4(1);
        let _ = sender.set_multicast_loop_v4(false);
    }
    let receiver = UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)).ok();
    if let Some(receiver) = &receiver {
        let _ = receiver.set_read_timeout(Some(Duration::from_millis(500)));
        let _ = receiver.join_multicast_v4(&DISCOVERY_MULTICAST_ADDRESS, &Ipv4Addr::UNSPECIFIED);
    }
    let mut last_announcement = SystemTime::now() - Duration::from_secs(5);
    loop {
        if last_announcement.elapsed().unwrap_or_default() >= Duration::from_secs(3) {
            let display_name = db
                .lock()
                .ok()
                .and_then(|database| database.users().ok())
                .and_then(|users| {
                    users
                        .into_iter()
                        .find(|user| user.id == runtime.user_id)
                        .map(|user| user.nickname)
                })
                .unwrap_or_else(|| runtime.user_id.clone());
            let packet = DiscoveryPacket {
                version: PROTOCOL_VERSION,
                workspace_id: runtime.workspace_id.clone(),
                node_id: runtime.node_id.clone(),
                device_id: runtime.device_id.clone(),
                user_id: runtime.user_id.clone(),
                display_name,
                tcp_port: runtime.listening_port,
            };
            let bytes = serde_json::to_vec(&packet).unwrap_or_default();
            if let Some(sender) = &sender {
                let _ = sender.send_to(&bytes, ("255.255.255.255", DISCOVERY_PORT));
                let _ = sender.send_to(&bytes, (DISCOVERY_MULTICAST_ADDRESS, DISCOVERY_PORT));
            }
            last_announcement = SystemTime::now();
        }
        if let Some(receiver) = &receiver {
            let mut buffer = [0u8; 8192];
            if let Ok((length, addr)) = receiver.recv_from(&mut buffer) {
                if let Ok(peer) = serde_json::from_slice::<DiscoveryPacket>(&buffer[..length]) {
                    if peer.version == PROTOCOL_VERSION && peer.node_id != runtime.node_id {
                        let same_workspace = peer.workspace_id == runtime.workspace_id;
                        let last_seen = chrono::Utc::now().to_rfc3339();
                        if let Ok(database) = db.lock() {
                            let device_id = if peer.device_id.trim().is_empty() {
                                &peer.node_id
                            } else {
                                &peer.device_id
                            };
                            let _ = database.remember_lan_user(
                                &peer.user_id,
                                device_id,
                                &peer.display_name,
                                &addr.ip().to_string(),
                                &last_seen,
                            );
                        }
                        let peer_info = PeerInfo {
                            device_id: peer.node_id.clone(),
                            user_id: peer.user_id.clone(),
                            display_name: peer.display_name.clone(),
                            address: addr.ip().to_string(),
                            port: peer.tcp_port,
                            last_seen,
                        };
                        if let Ok(mut peers) = runtime.peers.lock() {
                            peers.insert(peer.node_id.clone(), peer_info);
                        }
                        let _ = app.emit("presence://changed", runtime.snapshot());
                        let db = db.clone();
                        let workspace = runtime.workspace_id.clone();
                        let app = app.clone();
                        let port = peer.tcp_port;
                        let ip = addr.ip();
                        let peer_user_id = peer.user_id.clone();
                        let sender_user_id = runtime.user_id.clone();
                        let key = runtime.workspace_key;
                        thread::spawn(move || {
                            sync_peer(
                                ip.to_string(),
                                port,
                                db,
                                workspace,
                                app,
                                sender_user_id,
                                peer_user_id,
                                key,
                                same_workspace,
                            )
                        });
                    }
                }
            }
        } else {
            thread::sleep(Duration::from_millis(500));
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    workspace: String,
    files: Arc<Mutex<HashMap<String, PathBuf>>>,
    workspace_key: [u8; 32],
) {
    let mut line = String::new();
    if BufReader::new(&stream).read_line(&mut line).is_err() {
        return;
    }
    let Ok((message, connection_key, channel)) = open_message(line.trim(), &workspace_key) else {
        return;
    };
    let mut incoming_count = 0;
    match message {
        WireMessage::SyncRequest {
            sender_user_id,
            sender_workspace_id,
            operations,
        } => {
            let same_workspace = sender_workspace_id == workspace && channel == WORKSPACE_CHANNEL;
            if let Ok(database) = db.lock() {
                for operation in &operations {
                    if !same_workspace
                        && !matches!(
                            operation.entity_type.as_str(),
                            "project"
                                | "task"
                                | "task_assignment"
                                | "user_profile"
                                | "chat_message"
                                | "chat_group"
                        )
                    {
                        continue;
                    }
                    if database.apply_operation(operation).unwrap_or(false) {
                        incoming_count += 1;
                        emit_incoming_chat(&app, operation);
                    }
                }
            }
            let outgoing = db
                .lock()
                .ok()
                .and_then(|db| {
                    if same_workspace {
                        db.sync_operations_for_user(&sender_user_id).ok()
                    } else {
                        db.lan_operations_for_user(&sender_user_id).ok()
                    }
                })
                .unwrap_or_default();
            let response = seal_message(
                &WireMessage::SyncResponse {
                    operations: outgoing,
                },
                &connection_key,
                &channel,
            )
            .unwrap_or_default();
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.write_all(b"\n");
        }
        WireMessage::FileRequest {
            transfer_id,
            offset,
        } => {
            if let Some(path) = files
                .lock()
                .ok()
                .and_then(|files| files.get(&transfer_id).cloned())
            {
                if let Ok(mut file) = File::open(&path) {
                    if let Ok(metadata) = file.metadata() {
                        let safe_offset = offset.min(metadata.len());
                        let sha256 = sha256_file(&path).unwrap_or_default();
                        let header = FileHeader {
                            file_name: path
                                .file_name()
                                .and_then(|name| name.to_str())
                                .unwrap_or("file")
                                .into(),
                            size_bytes: metadata.len(),
                            sha256,
                            offset: safe_offset,
                        };
                        if let Ok(header_json) = seal_file_header(&header, &connection_key) {
                            let _ = stream.write_all(header_json.as_bytes());
                            let _ = stream.write_all(b"\n");
                        }
                        let _ = file.seek(SeekFrom::Start(safe_offset));
                        let mut buffer = vec![0u8; FILE_CHUNK_SIZE];
                        loop {
                            let Ok(read) = file.read(&mut buffer) else {
                                break;
                            };
                            if read == 0 {
                                break;
                            };
                            if write_encrypted_file_chunk(
                                &mut stream,
                                &buffer[..read],
                                &connection_key,
                            )
                            .is_err()
                            {
                                break;
                            }
                        }
                    }
                }
            }
        }
        WireMessage::SyncResponse { .. } => {}
    }
    if incoming_count > 0 {
        let _ = app.emit(
            "sync://operation",
            serde_json::json!({"count":incoming_count}),
        );
    }
}

fn sync_peer(
    ip: String,
    port: u16,
    db: Arc<Mutex<Database>>,
    workspace: String,
    app: AppHandle,
    sender_user_id: String,
    peer_user_id: String,
    workspace_key: [u8; 32],
    same_workspace: bool,
) {
    let Ok(mut stream) = TcpStream::connect((ip.as_str(), port)) else {
        return;
    };
    let outgoing = db
        .lock()
        .ok()
        .and_then(|db| {
            if same_workspace {
                db.sync_operations_for_user(&peer_user_id).ok()
            } else {
                db.lan_operations_for_user(&peer_user_id).ok()
            }
        })
        .unwrap_or_default();
    let connection_key = if same_workspace {
        workspace_key
    } else {
        derive_lan_transport_key()
    };
    let channel = if same_workspace {
        WORKSPACE_CHANNEL
    } else {
        LAN_CHAT_CHANNEL
    };
    let request = seal_message(
        &WireMessage::SyncRequest {
            sender_user_id,
            sender_workspace_id: workspace,
            operations: outgoing,
        },
        &connection_key,
        channel,
    )
    .unwrap_or_default();
    let _ = stream.write_all(request.as_bytes());
    let _ = stream.write_all(b"\n");
    let mut line = String::new();
    if BufReader::new(&stream).read_line(&mut line).is_err() {
        return;
    }
    if let Ok((WireMessage::SyncResponse { operations }, _, _)) =
        open_message(line.trim(), &workspace_key)
    {
        let mut applied = 0;
        if let Ok(database) = db.lock() {
            for operation in &operations {
                if !same_workspace
                    && !matches!(
                        operation.entity_type.as_str(),
                        "project"
                            | "task"
                            | "task_assignment"
                            | "user_profile"
                            | "chat_message"
                            | "chat_group"
                    )
                {
                    continue;
                }
                if database.apply_operation(operation).unwrap_or(false) {
                    applied += 1;
                    emit_incoming_chat(&app, operation);
                }
            }
        }
        if applied > 0 {
            let _ = app.emit("sync://operation", serde_json::json!({"count":applied}));
        }
    }
}

impl NetworkRuntime {
    pub fn snapshot(&self) -> NetworkStatus {
        let now = chrono::Utc::now();
        NetworkStatus {
            node_id: self.node_id.clone(),
            workspace_id: self.workspace_id.clone(),
            listening_port: self.listening_port,
            peers: self
                .peers
                .lock()
                .map(|peers| {
                    peers
                        .values()
                        .filter(|peer| {
                            chrono::DateTime::parse_from_rfc3339(&peer.last_seen)
                                .map(|last_seen| {
                                    now.signed_duration_since(last_seen.with_timezone(&chrono::Utc))
                                        .num_seconds()
                                        <= PEER_ONLINE_TIMEOUT_SECS
                                })
                                .unwrap_or(false)
                        })
                        .cloned()
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    pub fn register_file(&self, path: &Path) -> Result<FileOffer, String> {
        let metadata = std::fs::metadata(path).map_err(|e| format!("无法读取文件: {e}"))?;
        const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024 * 1024;
        if metadata.len() > MAX_FILE_SIZE {
            return Err("单个文件不能超过 2GB".into());
        }
        let transfer_id = Uuid::new_v4().simple().to_string();
        let sha256 = sha256_file(path)?;
        self.files
            .lock()
            .map_err(|_| "文件传输状态不可用".to_string())?
            .insert(transfer_id.clone(), path.to_path_buf());
        let encoded_node =
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(self.node_id.as_bytes());
        Ok(FileOffer {
            transfer_id: transfer_id.clone(),
            source_node_id: self.node_id.clone(),
            file_name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("file")
                .into(),
            size_bytes: metadata.len(),
            sha256,
            url: format!("zhiyu-file://{encoded_node}/{transfer_id}"),
        })
    }

    pub fn download_file(&self, url: &str, destination: &Path) -> Result<String, String> {
        let raw = url
            .strip_prefix("zhiyu-file://")
            .ok_or_else(|| "无效的局域网文件地址".to_string())?;
        let (node_part, transfer_id) = raw
            .split_once('/')
            .ok_or_else(|| "文件地址缺少传输编号".to_string())?;
        let node_id = String::from_utf8(
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(node_part)
                .map_err(|_| "无效的文件源节点".to_string())?,
        )
        .map_err(|_| "无效的文件源节点".to_string())?;
        let peer = self
            .peers
            .lock()
            .map_err(|_| "节点列表不可用".to_string())?
            .get(&node_id)
            .cloned()
            .ok_or_else(|| "文件源节点当前不在线".to_string())?;
        let mut stream = TcpStream::connect((peer.address.as_str(), peer.port))
            .map_err(|e| format!("无法连接文件源: {e}"))?;
        let part_path = destination.with_extension(format!(
            "{}part",
            destination
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| format!("{ext}."))
                .unwrap_or_default()
        ));
        let offset = std::fs::metadata(&part_path)
            .map(|meta| meta.len())
            .unwrap_or(0);
        let connection_key = derive_lan_transport_key();
        let request = seal_message(
            &WireMessage::FileRequest {
                transfer_id: transfer_id.into(),
                offset,
            },
            &connection_key,
            LAN_CHAT_CHANNEL,
        )?;
        stream
            .write_all(request.as_bytes())
            .map_err(|e| e.to_string())?;
        stream.write_all(b"\n").map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(stream);
        let mut header_line = String::new();
        reader
            .read_line(&mut header_line)
            .map_err(|e| e.to_string())?;
        let header: FileHeader = open_file_header(header_line.trim(), &connection_key)?;
        if offset > header.size_bytes {
            return Err("本地断点超过源文件大小".into());
        }
        if header.offset != offset {
            return Err("文件源返回的断点位置不一致".into());
        }
        let mut output = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&part_path)
            .map_err(|e| e.to_string())?;
        let mut received = offset;
        while let Some(chunk) = read_encrypted_file_chunk(&mut reader, &connection_key)? {
            if received + chunk.len() as u64 > header.size_bytes {
                return Err("文件源返回的数据超过声明大小".into());
            }
            output.write_all(&chunk).map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            let _ = self.app.emit("transfer://progress", serde_json::json!({"transferId":transfer_id,"received":received,"total":header.size_bytes}));
        }
        drop(output);
        if received != header.size_bytes {
            return Err(format!(
                "文件传输未完成（{received}/{}）",
                header.size_bytes
            ));
        }
        if sha256_file(&part_path)? != header.sha256 {
            return Err("文件校验失败，已保留断点文件以便重试".into());
        }
        std::fs::rename(&part_path, destination).map_err(|e| e.to_string())?;
        Ok(destination.to_string_lossy().into())
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn write_encrypted_file_chunk<W: Write>(
    writer: &mut W,
    plaintext: &[u8],
    key: &[u8; 32],
) -> Result<(), String> {
    if plaintext.is_empty() || plaintext.len() > FILE_CHUNK_SIZE {
        return Err("文件分块大小无效".into());
    }
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let encrypted = ChaCha20Poly1305::new(Key::from_slice(key))
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|e| format!("文件分块加密失败: {e}"))?;
    let frame_size = nonce_bytes.len() + encrypted.len();
    let frame_size = u32::try_from(frame_size).map_err(|_| "文件分块过大".to_string())?;
    writer
        .write_all(&frame_size.to_be_bytes())
        .and_then(|_| writer.write_all(&nonce_bytes))
        .and_then(|_| writer.write_all(&encrypted))
        .map_err(|e| e.to_string())
}

fn read_encrypted_file_chunk<R: Read>(
    reader: &mut R,
    key: &[u8; 32],
) -> Result<Option<Vec<u8>>, String> {
    let mut size_bytes = [0u8; 4];
    let first = reader
        .read(&mut size_bytes[..1])
        .map_err(|e| e.to_string())?;
    if first == 0 {
        return Ok(None);
    }
    reader
        .read_exact(&mut size_bytes[1..])
        .map_err(|e| match e.kind() {
            ErrorKind::UnexpectedEof => "文件分块长度不完整".to_string(),
            _ => e.to_string(),
        })?;
    let frame_size = u32::from_be_bytes(size_bytes) as usize;
    if !(FILE_FRAME_OVERHEAD..=FILE_CHUNK_SIZE + FILE_FRAME_OVERHEAD).contains(&frame_size) {
        return Err("文件分块长度无效".into());
    }
    let mut frame = vec![0u8; frame_size];
    reader.read_exact(&mut frame).map_err(|e| e.to_string())?;
    let (nonce, encrypted) = frame.split_at(12);
    let plaintext = ChaCha20Poly1305::new(Key::from_slice(key))
        .decrypt(Nonce::from_slice(nonce), encrypted)
        .map_err(|_| "文件分块校验失败".to_string())?;
    if plaintext.is_empty() || plaintext.len() > FILE_CHUNK_SIZE {
        return Err("解密后的文件分块大小无效".into());
    }
    Ok(Some(plaintext))
}

fn derive_workspace_key(token: &str) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(token.as_bytes()).into()
}

fn derive_lan_transport_key() -> [u8; 32] {
    derive_workspace_key(LAN_TRANSPORT_CONTEXT)
}

fn seal_message(message: &WireMessage, key: &[u8; 32], channel: &str) -> Result<String, String> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            serde_json::to_vec(message)
                .map_err(|e| e.to_string())?
                .as_ref(),
        )
        .map_err(|e| format!("加密失败: {e}"))?;
    serde_json::to_string(&SecureEnvelope {
        channel: channel.into(),
        nonce: base64::engine::general_purpose::STANDARD.encode(nonce_bytes),
        payload: base64::engine::general_purpose::STANDARD.encode(encrypted),
    })
    .map_err(|e| e.to_string())
}

fn open_message(
    raw: &str,
    workspace_key: &[u8; 32],
) -> Result<(WireMessage, [u8; 32], String), String> {
    let envelope: SecureEnvelope = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let channel = if envelope.channel == LAN_CHAT_CHANNEL {
        LAN_CHAT_CHANNEL
    } else {
        WORKSPACE_CHANNEL
    };
    let key = if channel == LAN_CHAT_CHANNEL {
        derive_lan_transport_key()
    } else {
        *workspace_key
    };
    let nonce = base64::engine::general_purpose::STANDARD
        .decode(envelope.nonce)
        .map_err(|e| e.to_string())?;
    let payload = base64::engine::general_purpose::STANDARD
        .decode(envelope.payload)
        .map_err(|e| e.to_string())?;
    let decrypted = ChaCha20Poly1305::new(Key::from_slice(&key))
        .decrypt(Nonce::from_slice(&nonce), payload.as_ref())
        .map_err(|e| format!("解密失败: {e}"))?;
    let message = serde_json::from_slice(&decrypted).map_err(|e| e.to_string())?;
    Ok((message, key, channel.into()))
}

fn seal_file_header(header: &FileHeader, key: &[u8; 32]) -> Result<String, String> {
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let encrypted = ChaCha20Poly1305::new(Key::from_slice(key))
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            serde_json::to_vec(header)
                .map_err(|e| e.to_string())?
                .as_ref(),
        )
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&SecureEnvelope {
        channel: String::new(),
        nonce: base64::engine::general_purpose::STANDARD.encode(nonce_bytes),
        payload: base64::engine::general_purpose::STANDARD.encode(encrypted),
    })
    .map_err(|e| e.to_string())
}

fn open_file_header(raw: &str, key: &[u8; 32]) -> Result<FileHeader, String> {
    let envelope: SecureEnvelope = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let nonce = base64::engine::general_purpose::STANDARD
        .decode(envelope.nonce)
        .map_err(|e| e.to_string())?;
    let payload = base64::engine::general_purpose::STANDARD
        .decode(envelope.payload)
        .map_err(|e| e.to_string())?;
    let decrypted = ChaCha20Poly1305::new(Key::from_slice(key))
        .decrypt(Nonce::from_slice(&nonce), payload.as_ref())
        .map_err(|e| e.to_string())?;
    serde_json::from_slice(&decrypted).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn sync_request() -> WireMessage {
        WireMessage::SyncRequest {
            sender_user_id: "sender@test-device".into(),
            sender_workspace_id: "workspace-a".into(),
            operations: Vec::new(),
        }
    }

    #[test]
    fn message_channels_use_the_expected_transport_keys() {
        let workspace_key = derive_workspace_key("workspace-secret");
        let other_workspace_key = derive_workspace_key("other-workspace-secret");

        let workspace_envelope = seal_message(&sync_request(), &workspace_key, WORKSPACE_CHANNEL)
            .expect("workspace message should encrypt");
        let (_, opened_key, channel) = open_message(&workspace_envelope, &workspace_key)
            .expect("workspace message should decrypt with its workspace key");
        assert_eq!(opened_key, workspace_key);
        assert_eq!(channel, WORKSPACE_CHANNEL);
        assert!(open_message(&workspace_envelope, &other_workspace_key).is_err());

        let lan_key = derive_lan_transport_key();
        let lan_envelope = seal_message(&sync_request(), &lan_key, LAN_CHAT_CHANNEL)
            .expect("LAN chat message should encrypt");
        let (_, opened_key, channel) = open_message(&lan_envelope, &other_workspace_key)
            .expect("LAN chat message should not depend on a workspace key");
        assert_eq!(opened_key, lan_key);
        assert_eq!(channel, LAN_CHAT_CHANNEL);
    }

    #[test]
    fn encrypted_file_chunks_round_trip_and_reject_wrong_key() {
        let key = derive_workspace_key("workspace-secret");
        let wrong_key = derive_workspace_key("wrong-secret");
        let first = vec![0x5a; FILE_CHUNK_SIZE];
        let second = b"last chunk".to_vec();
        let mut wire = Vec::new();
        write_encrypted_file_chunk(&mut wire, &first, &key).expect("first chunk should encrypt");
        write_encrypted_file_chunk(&mut wire, &second, &key).expect("second chunk should encrypt");

        let mut reader = Cursor::new(&wire);
        assert_eq!(
            read_encrypted_file_chunk(&mut reader, &key)
                .expect("first chunk should decrypt")
                .expect("first chunk should exist"),
            first
        );
        assert_eq!(
            read_encrypted_file_chunk(&mut reader, &key)
                .expect("second chunk should decrypt")
                .expect("second chunk should exist"),
            second
        );
        assert!(read_encrypted_file_chunk(&mut reader, &key)
            .expect("stream end should be valid")
            .is_none());
        assert!(read_encrypted_file_chunk(&mut Cursor::new(&wire), &wrong_key).is_err());
    }

    #[test]
    fn sha256_is_computed_streamingly() {
        let path = std::env::temp_dir().join(format!("zhiyu-hash-{}.tmp", Uuid::new_v4()));
        std::fs::write(&path, b"abc").expect("test file should be created");
        let hash = sha256_file(&path).expect("hash should be computed");
        let _ = std::fs::remove_file(&path);
        assert_eq!(
            hash,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
