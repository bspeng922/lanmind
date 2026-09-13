//! Project file HTTP sharing service and local file storage.
//!
//! CALLING SPEC:
//!     let server = FileServer::start(storage_root, preferred_port).await?;
//!     let port = server.port();
//!     let file_path = server.file_path(project_id, file_id);
//!     server.stop().await;

use axum::{
    body::Body,
    extract::{Path as AxumPath, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct FileServerState {
    pub storage_root: PathBuf,
}

#[allow(dead_code)]
pub struct FileServer {
    port: u16,
    cancellation: CancellationToken,
    storage_root: PathBuf,
}

impl FileServer {
    pub async fn start(storage_root: PathBuf, preferred_port: u16) -> Result<Self, String> {
        tokio::fs::create_dir_all(&storage_root)
            .await
            .map_err(|e| format!("无法创建文件存储根目录: {e}"))?;

        let cancellation = CancellationToken::new();
        let state = Arc::new(FileServerState {
            storage_root: storage_root.clone(),
        });

        let app = Router::new()
            .route("/api/health", get(health_handler))
            .route(
                "/api/projects/{project_id}/files/{file_id}/raw",
                get(serve_raw_file),
            )
            .route(
                "/api/projects/{project_id}/files/{file_id}/preview",
                get(serve_file_preview),
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

    pub fn file_path(&self, project_id: &str, file_id: &str) -> PathBuf {
        let clean_proj = sanitize_filename(project_id);
        let clean_file = sanitize_filename(file_id);
        self.storage_root.join(clean_proj).join(clean_file)
    }

    #[allow(dead_code)]
    pub async fn stop(&self) {
        self.cancellation.cancel();
    }
}

pub fn sanitize_filename(input: &str) -> String {
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
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        _ => "application/octet-stream",
    }
}

async fn health_handler() -> &'static str {
    "OK"
}

async fn serve_raw_file(
    AxumPath((project_id, file_id)): AxumPath<(String, String)>,
    State(state): State<Arc<FileServerState>>,
) -> Result<Response, StatusCode> {
    let file_path = state
        .storage_root
        .join(sanitize_filename(&project_id))
        .join(sanitize_filename(&file_id));

    if !file_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let file = tokio::fs::File::open(&file_path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let metadata = file
        .metadata()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default();
    let mime = guess_mime_type(ext);

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let mut response = Response::new(body);
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&metadata.len().to_string())
            .unwrap_or(HeaderValue::from_static("0")),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );

    Ok(response)
}

async fn serve_file_preview(
    AxumPath((project_id, file_id)): AxumPath<(String, String)>,
    State(state): State<Arc<FileServerState>>,
) -> Result<Response, StatusCode> {
    let file_path = state
        .storage_root
        .join(sanitize_filename(&project_id))
        .join(sanitize_filename(&file_id));

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
