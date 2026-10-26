//! Project file HTTP sharing service and local file storage.
//!
//! CALLING SPEC:
//!     let server = FileServer::start(storage_root, preferred_port).await?;
//!     let port = server.port();
//!     let file_path = server.file_path(project_id, file_id);
//!     server.stop().await;

use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use crate::db::Database;
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct FileServerState {
    pub storage_root: PathBuf,
    pub db: Arc<Mutex<Database>>,
}

#[allow(dead_code)]
pub struct FileServer {
    port: u16,
    cancellation: CancellationToken,
    storage_root: PathBuf,
}

impl FileServer {
    pub async fn start(storage_root: PathBuf, preferred_port: u16, db: Arc<Mutex<Database>>) -> Result<Self, String> {
        migrate_legacy_files(&storage_root, &db)?;
        tokio::fs::create_dir_all(&storage_root)
            .await
            .map_err(|e| format!("无法创建文件存储根目录: {e}"))?;

        let cancellation = CancellationToken::new();
        let state = Arc::new(FileServerState {
            storage_root: storage_root.clone(),
            db,
        });

        let app = Router::new()
            .route("/api/health", get(health_handler))
            .route(
                "/api/projects/{project_id}/files/{file_id}/raw",
                get(serve_raw_file).options(options_handler),
            )
            .route(
                "/api/projects/{project_id}/files/{file_id}/preview",
                get(serve_file_preview).options(options_handler),
            )
            .with_state(state);

        // Try preferred port first, fallback to ephemeral port 0
        let listener = match tokio::net::TcpListener::bind(("0.0.0.0", preferred_port)).await {
            Ok(l) => l,
            Err(_) => tokio::net::TcpListener::bind(("0.0.0.0", 0))
                .await
                .map_err(|e| format!("无法启动局域网文件服务: {e}"))?,
        };

        let local_addr = listener
            .local_addr()
            .map_err(|e| format!("无法获取文件服务监听端口: {e}"))?;
        let port = local_addr.port();

        let cancel_child = cancellation.child_token();
        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async move { cancel_child.cancelled_owned().await })
            .await;
        });

        Ok(Self {
            port,
            cancellation,
            storage_root,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    #[allow(dead_code)]
    pub fn storage_root(&self) -> &Path {
        &self.storage_root
    }

    pub fn file_path(&self, workspace_id: &str, project_id: &str, file_id: &str) -> PathBuf {
        scoped_file_path(&self.storage_root, workspace_id, project_id, file_id)
    }

    #[allow(dead_code)]
    pub async fn stop(&self) {
        self.cancellation.cancel();
    }
}

fn migrate_legacy_files(root: &Path, db: &Arc<Mutex<Database>>) -> Result<(),String> {
    let db=db.lock().map_err(|e| e.to_string())?;
    let records:Vec<(String,String,String,String)>=db.conn.prepare("SELECT workspace_id,project_id,id,sha256 FROM project_files WHERE deleted=0").map_err(|e| e.to_string())?
        .query_map([],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|e| e.to_string())?.collect::<Result<_,_>>().map_err(|e| e.to_string())?;
    for (workspace,project,file,sha256) in records {
        let old=root.join(sanitize_filename(&project)).join(sanitize_filename(&file));
        let target=scoped_file_path(root,&workspace,&project,&file);
        if target.exists() || !old.exists() { continue; }
        if crate::network::sha256_file(&old)?!=sha256 { return Err(format!("文件迁移校验失败: {file}")); }
        if let Some(parent)=target.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        std::fs::copy(&old,&target).map_err(|e| e.to_string())?;
        if crate::network::sha256_file(&target)?!=sha256 { return Err(format!("文件迁移校验失败: {file}")); }
        // Original files remain in the migration backup, outside the HTTP route.
    }
    db.save_local_setting("workspaceFilesV2","1")
}

pub fn scoped_file_path(root: &Path, workspace: &str, project: &str, file: &str) -> PathBuf {
    root.parent().unwrap_or(root).join("workspaces").join(sanitize_filename(workspace))
        .join("projects").join(sanitize_filename(project)).join(sanitize_filename(file))
}

// HMAC-SHA256: capability signatures bind workspace, user, file and expiry.
fn signature(secret: &str, message: &str) -> String {
    use sha2::{Digest, Sha256};
    let key = Sha256::digest(secret.as_bytes());
    let mut inner = [0x36u8;64]; let mut outer = [0x5cu8;64];
    for (i,b) in key.iter().enumerate() { inner[i]^=b; outer[i]^=b; }
    let inner_hash=Sha256::new().chain_update(inner).chain_update(message.as_bytes()).finalize();
    format!("{:x}",Sha256::new().chain_update(outer).chain_update(inner_hash).finalize())
}
pub fn authorize_url(db: &Database, url: &str, project: &str, file: &str) -> Result<String,String> {
    let ctx=db.workspace_context()?;
    let expires=chrono::Utc::now().timestamp()+600;
    let message=serde_json::to_string(&(&ctx.workspace_id,&ctx.user_id,project,file,expires)).map_err(|e| e.to_string())?;
    let mut url=reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("workspaceId",&ctx.workspace_id).append_pair("userId",&ctx.user_id)
        .append_pair("expires",&expires.to_string()).append_pair("signature",&signature(&db.workspace_token()?,&message));
    Ok(url.into())
}
fn authorized_path(state: &FileServerState, query: &RawFileQuery, project: &str, file: &str) -> Result<PathBuf,StatusCode> {
    use subtle::ConstantTimeEq;
    let db=state.db.lock().map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let ctx=db.workspace_context().map_err(|_| StatusCode::UNAUTHORIZED)?;
    let ws=query.workspace_id.as_deref().ok_or(StatusCode::UNAUTHORIZED)?;
    let user=query.user_id.as_deref().ok_or(StatusCode::UNAUTHORIZED)?;
    let expires=query.expires.ok_or(StatusCode::UNAUTHORIZED)?;
    if ws!=ctx.workspace_id || expires<chrono::Utc::now().timestamp() || expires>chrono::Utc::now().timestamp()+660 { return Err(StatusCode::UNAUTHORIZED); }
    let message=serde_json::to_string(&(ws,user,project,file,expires)).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let expected=signature(&db.workspace_token().map_err(|_| StatusCode::UNAUTHORIZED)?,&message);
    if !bool::from(expected.as_bytes().ct_eq(query.signature.as_deref().unwrap_or_default().as_bytes())) { return Err(StatusCode::UNAUTHORIZED); }
    if !db.projects(Some(user)).map_err(|_| StatusCode::FORBIDDEN)?.iter().any(|p| p.id==project) { return Err(StatusCode::FORBIDDEN); }
    let record=db.project_file_by_id(file).map_err(|_| StatusCode::NOT_FOUND)?.ok_or(StatusCode::NOT_FOUND)?;
    if record.project_id!=project { return Err(StatusCode::NOT_FOUND); }
    Ok(scoped_file_path(&state.storage_root,ws,project,file))
}

pub fn sanitize_filename(input: &str) -> String {
    let input=input.trim_end_matches([' ','.']);
    if input.is_empty() { return "_".into(); }
    input
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect()
}

pub fn guess_mime_type(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "txt" | "log" | "ini" | "conf" | "env" => "text/plain; charset=utf-8",
        "md" | "markdown" => "text/markdown; charset=utf-8",
        "json" | "json5" => "application/json; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "tsv" => "text/tab-separated-values; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "yaml" | "yml" => "text/yaml; charset=utf-8",
        "toml" => "text/plain; charset=utf-8",
        "js" | "mjs" | "cjs" => "application/javascript; charset=utf-8",
        "ts" | "tsx" | "jsx" => "text/plain; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "css" | "scss" | "less" => "text/css; charset=utf-8",
        "rs" | "py" | "java" | "kt" | "go" | "c" | "cpp" | "h" | "hpp" | "sh" | "ps1" | "bat"
        | "sql" => "text/plain; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "ogg" => "video/ogg",
        "mov" | "m4v" => "video/mp4",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "eot" => "application/vnd.ms-fontobject",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

async fn health_handler() -> &'static str {
    "OK"
}

async fn serve_raw_file(
    AxumPath((project_id, file_id)): AxumPath<(String, String)>,
    Query(query): Query<RawFileQuery>,
    headers: HeaderMap,
    State(state): State<Arc<FileServerState>>,
) -> Result<Response, StatusCode> {
    let file_path = authorized_path(&state,&query,&project_id,&file_id)?;

    if !file_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut file = tokio::fs::File::open(&file_path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let metadata = file
        .metadata()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Files are stored under an extensionless ID, so the caller supplies the
    // persisted MIME type. Keep the extension fallback for older callers.
    let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or_default();
    let mime = query.mime.as_deref().unwrap_or_else(|| guess_mime_type(ext));
    let total_size = metadata.len();
    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(|value| parse_byte_range(value, total_size))
        .transpose()?;

    if let Some((start, end)) = range {
        file.seek(SeekFrom::Start(start))
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let stream = ReaderStream::new(file.take(end - start + 1));
        let body = Body::from_stream(stream);
        let mut response = Response::new(body);
        *response.status_mut() = StatusCode::PARTIAL_CONTENT;
        set_common_file_headers(&mut response, mime, end - start + 1);
        response.headers_mut().insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{total_size}"))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
        );
        return Ok(response);
    }

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let mut response = Response::new(body);
    set_common_file_headers(&mut response, mime, total_size);

    Ok(response)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all="camelCase")]
struct RawFileQuery {
    workspace_id: Option<String>, user_id: Option<String>, expires: Option<i64>, signature: Option<String>,
    mime: Option<String>,
}

fn set_common_file_headers(response: &mut Response, mime: &str, content_length: u64) {
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&content_length.to_string())
            .unwrap_or(HeaderValue::from_static("0")),
    );
    response
        .headers_mut()
        .insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("*"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Range, Content-Length, Accept-Ranges"),
    );
}

async fn options_handler() -> impl IntoResponse {
    let mut response = Response::new(Body::empty());
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("*"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Range, Content-Length, Accept-Ranges"),
    );
    response
}

fn parse_byte_range(value: &str, total_size: u64) -> Result<(u64, u64), StatusCode> {
    if total_size == 0 {
        return Err(StatusCode::RANGE_NOT_SATISFIABLE);
    }
    let value = value
        .strip_prefix("bytes=")
        .ok_or(StatusCode::RANGE_NOT_SATISFIABLE)?;
    let first = value.split(',').next().unwrap_or_default().trim();
    let (start_text, end_text) = first
        .split_once('-')
        .ok_or(StatusCode::RANGE_NOT_SATISFIABLE)?;

    let (start, end) = if start_text.is_empty() {
        let suffix = end_text
            .parse::<u64>()
            .map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?
            .min(total_size);
        (total_size - suffix, total_size - 1)
    } else {
        let start = start_text
            .parse::<u64>()
            .map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?;
        if start >= total_size {
            return Err(StatusCode::RANGE_NOT_SATISFIABLE);
        }
        let end = if end_text.is_empty() {
            total_size - 1
        } else {
            end_text
                .parse::<u64>()
                .map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?
                .min(total_size - 1)
        };
        (start, end)
    };

    if start > end {
        return Err(StatusCode::RANGE_NOT_SATISFIABLE);
    }
    Ok((start, end))
}

async fn serve_file_preview(
    AxumPath((project_id, file_id)): AxumPath<(String, String)>,
    Query(query): Query<RawFileQuery>,
    State(state): State<Arc<FileServerState>>,
) -> Result<Response, StatusCode> {
    let file_path = authorized_path(&state,&query,&project_id,&file_id)?;

    if !file_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    use tokio::io::AsyncReadExt;
    let mut file = tokio::fs::File::open(&file_path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    const MAX_PREVIEW_BYTES: usize = 512 * 1024;
    let mut buffer = vec![0u8; MAX_PREVIEW_BYTES];
    let bytes_read = file
        .read(&mut buffer)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    buffer.truncate(bytes_read);
    let text = String::from_utf8_lossy(&buffer).to_string();

    let mut response = text.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn raw_preview_and_range_require_a_valid_workspace_capability() {
        let db=Arc::new(Mutex::new(Database::open(Path::new(":memory:")).unwrap()));
        let root=std::env::temp_dir().join(format!("lanmind-files-{}",uuid::Uuid::new_v4())).join("projects");
        let (workspace,project,file)={
            let db=db.lock().unwrap();let user=db.current_user_id().unwrap();let workspace=db.workspace_context().unwrap().workspace_id;
            let project=db.create_project(json!({"name":"Files"}),&user).unwrap();
            let file:crate::models::ProjectFileRecord=serde_json::from_value(json!({"workspaceId":workspace,"id":"file-a","projectId":project.id,"name":"a.txt","relativePath":"a.txt","sizeBytes":6,"mimeType":"text/plain","sha256":"unused","sourceNodeId":"local","sourceAddress":"127.0.0.1","sourceHttpPort":0,"uploadedBy":user,"uploadedAt":"2026-10-15","isLocal":true})).unwrap();
            db.insert_project_file(&file,false).unwrap();
            (workspace,project.id,file.id)
        };
        let server=FileServer::start(root.clone(),0,db.clone()).await.unwrap();
        let path=server.file_path(&workspace,&project,&file);
        tokio::fs::create_dir_all(path.parent().unwrap()).await.unwrap();tokio::fs::write(&path,b"secret").await.unwrap();
        let raw=format!("http://127.0.0.1:{}/api/projects/{project}/files/{file}/raw",server.port());
        let client=reqwest::Client::new();
        assert_eq!(client.get(&raw).send().await.unwrap().status(),StatusCode::UNAUTHORIZED);
        let authorized=authorize_url(&db.lock().unwrap(),&raw,&project,&file).unwrap();
        let range=client.get(&authorized).header(header::RANGE,"bytes=1-3").send().await.unwrap();
        assert_eq!(range.status(),StatusCode::PARTIAL_CONTENT);assert_eq!(range.text().await.unwrap(),"ecr");
        let preview=authorized.replace("/raw?","/preview?");
        assert_eq!(client.get(&preview).send().await.unwrap().text().await.unwrap(),"secret");
        {
            let db=db.lock().unwrap();let user=db.current_user_id().unwrap();let b=db.create_workspace("B",None,None,&user).unwrap();db.switch_workspace(&b.id,&user).unwrap();
        }
        for url in [&authorized,&preview] { assert_eq!(client.get(url).send().await.unwrap().status(),StatusCode::UNAUTHORIZED); }
        server.stop().await;
        let target=root.parent().unwrap().canonicalize().unwrap();assert!(target.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        tokio::fs::remove_dir_all(target).await.unwrap();
    }
}
