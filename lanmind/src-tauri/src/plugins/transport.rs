use super::*;
use axum::{
    body::Body,
    extract::{Path as RoutePath, Query, State as HttpState},
    http::{header, StatusCode},
    response::Response,
    routing::get,
    Json, Router,
};
use rand::seq::SliceRandom;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub fn routes(rt: Arc<Runtime>) -> Router {
    Router::new()
        .route("/api/plugins/v1/catalog", get(catalog))
        .route("/api/plugins/v1/packages/{hash}", get(package_file))
        .with_state(rt)
}
#[derive(Default, Deserialize)]
struct Page {
    #[serde(default)]
    offset: usize,
}
async fn catalog(
    HttpState(rt): HttpState<Arc<Runtime>>,
    Query(page): Query<Page>,
) -> std::result::Result<Json<Catalog>, StatusCode> {
    let db = rt.db.lock().map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let enabled = db
        .setting("pluginSharingEnabled")
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .as_deref()
        != Some("false");
    let entries: Vec<_> = if enabled {
        db.installed_plugins()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
            .into_iter()
            .filter(|p| {
                p.shared && p.available && rt.package_path(&p.sha256).is_ok_and(|p| p.is_file())
            })
            .map(|p| CatalogPackage {
                metadata: p.metadata,
                sha256: p.sha256,
                size_bytes: p.size_bytes,
            })
            .collect()
    } else {
        Vec::new()
    };
    let end = page.offset.saturating_add(20);
    Ok(Json(Catalog {
        protocol_version: 1,
        next_offset: if end < entries.len() { Some(end) } else { None },
        items: entries.into_iter().skip(page.offset).take(20).collect(),
    }))
}
async fn package_file(
    HttpState(rt): HttpState<Arc<Runtime>>,
    RoutePath(hash): RoutePath<String>,
) -> std::result::Result<Response, StatusCode> {
    if !valid_hash(&hash) {
        return Err(StatusCode::NOT_FOUND);
    }
    let (path, size, cancel) = {
        let mut shares = rt
            .shares
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        let db = rt.db.lock().map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if db
            .setting("pluginSharingEnabled")
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
            .as_deref()
            == Some("false")
        {
            return Err(StatusCode::NOT_FOUND);
        }
        let p = db
            .installed_plugins()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
            .into_iter()
            .find(|p| p.sha256 == hash && p.shared && p.available)
            .ok_or(StatusCode::NOT_FOUND)?;
        (
            rt.package_path(&hash).map_err(|_| StatusCode::NOT_FOUND)?,
            p.size_bytes,
            shares
                .entry(hash.clone())
                .or_insert_with(CancellationToken::new)
                .child_token(),
        )
    };
    let metadata = tokio::fs::symlink_metadata(&path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() != size {
        return Err(StatusCode::NOT_FOUND);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(StatusCode::NOT_FOUND);
        }
    }
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let stream = futures_util::stream::unfold((file, cancel), |(mut file, cancel)| async move {
        let mut chunk = vec![0u8; 64 * 1024];
        let result = tokio::select! {biased;_ = cancel.cancelled()=>return None,result=file.read(&mut chunk)=>result};
        match result {
            Ok(0) => None,
            Ok(n) => {
                chunk.truncate(n);
                Some((Ok::<_, std::io::Error>(chunk), (file, cancel)))
            }
            Err(e) => Some((Err(e), (file, cancel))),
        }
    });
    Response::builder()
        .header(header::CONTENT_TYPE, "application/vnd.lanmind.plugin+zip")
        .header(header::CONTENT_LENGTH, size)
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from_stream(stream))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| fail("NETWORK"))
}

/// Tries an already shuffled list. Sources are resolved from native discovery,
/// never supplied as arbitrary URLs by the renderer or by package metadata.
pub(super) async fn retrieve(
    target: &MarketPackage,
    sources: &[Source],
    destination: &Path,
    cancel: &CancellationToken,
    mut progress: impl FnMut(&Source, u64, u64),
) -> Result<()> {
    let client = client()?;
    for source in sources {
        if cancel.is_cancelled() {
            return Err(fail("CANCELLED"));
        }
        let ip: std::net::IpAddr = match source.address.parse() {
            Ok(ip) => ip,
            Err(_) => continue,
        };
        let url = format!(
            "http://{}/api/plugins/v1/packages/{}",
            std::net::SocketAddr::new(ip, source.port),
            target.sha256
        );
        progress(source, 0, target.size_bytes);
        let attempt = async {
            let mut response = client.get(url).send().await.map_err(|_| fail("NETWORK"))?;
            let declared = response.content_length();
            if !response.status().is_success() || declared.is_some_and(|n| n > MAX_PACKAGE) {
                return Err(fail("NETWORK"));
            }
            let mut file = tokio::fs::File::create(destination)
                .await
                .map_err(|_| fail("IO"))?;
            let mut received = 0;
            let mut hasher = Sha256::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| fail("NETWORK"))? {
                received += chunk.len() as u64;
                if received > MAX_PACKAGE {
                    return Err(fail("HASH"));
                }
                hasher.update(&chunk);
                file.write_all(&chunk).await.map_err(|_| fail("IO"))?;
                progress(
                    source,
                    received,
                    declared.unwrap_or(target.size_bytes).max(received),
                );
            }
            file.sync_all().await.map_err(|_| fail("IO"))?;
            if declared.is_some_and(|n| n != received)
                || format!("{:x}", hasher.finalize()) != target.sha256
            {
                return Err(fail("HASH"));
            }
            Ok(())
        };
        let result = tokio::select! {biased;_=cancel.cancelled()=>return Err(fail("CANCELLED")),result=attempt=>result};
        if result.is_ok() {
            return Ok(());
        }
    }
    Err(if cancel.is_cancelled() {
        fail("CANCELLED")
    } else {
        fail("NO_SOURCES")
    })
}
async fn fetch_catalog(peer: crate::models::PeerInfo) -> Result<Vec<MarketPackage>> {
    let client = client()?;
    let mut offset = 0;
    let mut output = Vec::new();
    // The address comes from the observed UDP sender, never from a plugin URL.
    let ip: std::net::IpAddr = peer.address.parse().map_err(|_| fail("NETWORK"))?;
    let authority = std::net::SocketAddr::new(ip, peer.http_file_port);
    let source = Source {
        node_id: peer.device_id,
        display_name: peer.display_name,
        address: ip.to_string(),
        port: peer.http_file_port,
    };
    for _ in 0..10 {
        let mut response = client
            .get(format!(
                "http://{authority}/api/plugins/v1/catalog?offset={offset}"
            ))
            .timeout(Duration::from_secs(4))
            .send()
            .await
            .map_err(|_| fail("NETWORK"))?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(Vec::new());
        }
        if !response.status().is_success() {
            return Err(fail("NETWORK"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| fail("NETWORK"))? {
            if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                return Err(fail("INVALID_PACKAGE"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let page: Catalog = serde_json::from_slice(&bytes).map_err(|_| fail("INVALID_PACKAGE"))?;
        if page.protocol_version != 1 || page.items.len() > 20 {
            return Err(fail("INVALID_PACKAGE"));
        }
        for p in page.items {
            if !valid_hash(&p.sha256) || p.size_bytes == 0 || p.size_bytes > MAX_PACKAGE {
                continue;
            }
            let Ok(v) = verify_install_metadata(&p.metadata) else {
                continue;
            };
            output.push(MarketPackage {
                plugin_key: v.plugin_key,
                publisher_id: v.publisher_id,
                compatible: v.manifest.compatible(),
                manifest: v.manifest,
                metadata: p.metadata,
                sha256: p.sha256,
                size_bytes: p.size_bytes,
                sources: vec![source.clone()],
            });
        }
        match page.next_offset {
            None => return Ok(output),
            Some(next) if next > offset => offset = next,
            _ => return Err(fail("INVALID_PACKAGE")),
        }
    }
    Ok(output)
}
pub(super) fn aggregate(items: Vec<MarketPackage>) -> Vec<MarketPackage> {
    let mut map: BTreeMap<(String, String, String), MarketPackage> = BTreeMap::new();
    for mut p in items {
        let key = (
            p.plugin_key.clone(),
            p.manifest.version.clone(),
            p.sha256.clone(),
        );
        if let Some(existing) = map.get_mut(&key) {
            if existing.metadata.manifest == p.metadata.manifest {
                existing.sources.append(&mut p.sources);
            }
        } else {
            map.insert(key, p);
        }
    }
    map.into_values()
        .map(|mut p| {
            p.sources.sort_by(|a, b| a.node_id.cmp(&b.node_id));
            p.sources.dedup_by(|a, b| a.node_id == b.node_id);
            p
        })
        .collect()
}
impl Runtime {
    pub async fn refresh_market(
        &self,
        peers: Vec<crate::models::PeerInfo>,
    ) -> Result<Vec<MarketPackage>> {
        let semaphore = Arc::new(tokio::sync::Semaphore::new(4));
        let mut tasks = tokio::task::JoinSet::new();
        for peer in peers.into_iter().filter(|p| p.http_file_port > 0).take(128) {
            let sem = semaphore.clone();
            tasks.spawn(async move {
                let _permit = sem.acquire_owned().await.ok()?;
                fetch_catalog(peer).await.ok()
            });
        }
        let mut packages = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(12);
        while !tasks.is_empty() {
            let Ok(Some(result)) = tokio::time::timeout_at(deadline, tasks.join_next()).await
            else {
                tasks.abort_all();
                break;
            };
            if let Ok(Some(mut page)) = result {
                packages.append(&mut page);
            }
        }
        let result = aggregate(packages);
        *self.market.lock().map_err(|_| fail("STATE"))? = result.clone();
        Ok(result)
    }
    pub fn download(
        self: &Arc<Self>,
        app: AppHandle,
        key: &str,
        hash: &str,
        allow_unsigned: bool,
    ) -> Result<String> {
        let packages = self.market.lock().map_err(|_| fail("STATE"))?;
        let target = packages
            .iter()
            .find(|p| p.plugin_key == key && p.sha256 == hash)
            .cloned()
            .ok_or_else(|| fail("NO_SOURCES"))?;
        if packages.iter().any(|p| {
            p.plugin_key == key && p.manifest.version == target.manifest.version && p.sha256 != hash
        }) {
            return Err(fail("VERSION_COLLISION"));
        }
        if !target.compatible {
            return Err(fail("INCOMPATIBLE"));
        }
        require_install_approval(&target.metadata, hash, Some(hash), allow_unsigned)?;
        drop(packages);
        let (id, cancel, gate) = self.begin_job(key.into())?;
        let job_id = id.clone();
        let this = self.clone();
        self.notify(&app);
        tauri::async_runtime::spawn(async move {
            let result = this
                .download_job(&app, &job_id, target, cancel, allow_unsigned)
                .await;
            let _ = remove_managed(&this.root, &this.root.join("staging").join(&job_id));
            drop(gate);
            this.finish_job(&app, &job_id, result);
        });
        Ok(id)
    }
    async fn download_job(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        mut target: MarketPackage,
        cancel: CancellationToken,
        allow_unsigned: bool,
    ) -> Result<()> {
        target.sources.shuffle(&mut rand::thread_rng());
        let dir = self.root.join("staging").join(id);
        directory(&dir)?;
        let destination = dir.join("download.lmpk");
        let mut sources = Vec::new();
        for source in &target.sources {
            if cancel.is_cancelled() {
                return Err(fail("CANCELLED"));
            }
            let peer = {
                let state = app.state::<AppState>();
                let snapshot = state.network.lock().map_err(|_| fail("STATE"))?.snapshot();
                snapshot
                    .peers
                    .into_iter()
                    .find(|p| p.device_id == source.node_id && p.http_file_port > 0)
            };
            let Some(peer) = peer else {
                continue;
            };
            sources.push(Source {
                node_id: peer.device_id,
                display_name: source.display_name.clone(),
                address: peer.address,
                port: peer.http_file_port,
            });
        }
        retrieve(
            &target,
            &sources,
            &destination,
            &cancel,
            |source, received, total| {
                self.job_update(app, id, |j| {
                    j.state = "downloading".into();
                    j.received = received;
                    j.total = total;
                    j.source = Some(source.display_name.clone());
                });
            },
        )
        .await?;
        let worker = self.clone();
        let worker_app = app.clone();
        let worker_id = id.to_string();
        let worker_cancel = cancel.clone();
        let expected = target.clone();
        let path = destination.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            worker.install_staged(
                &worker_app,
                &worker_id,
                &path,
                &worker_cancel,
                Some(&expected),
                Some(expected.sha256.as_str()).filter(|_| allow_unsigned),
            )
        })
        .await
        .map_err(|_| fail("IO"))?;
        // Once the immutable hash matches, another source cannot repair an invalid signed payload.
        result
    }
}
