use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use std::io::Write;

fn signed(id: &str, version: &str, secret: u8) -> SignedMetadata {
    let key = SigningKey::from_bytes(&[secret; 32]);
    let manifest=json!({"schemaVersion":2,"runtime":"web","id":id,"version":version,"name":{"en-US":"Example"},"description":{"en-US":"Example plugin"},"defaultLocale":"en-US","minHostVersion":"0.2.1","sdkVersion":1,"entry":"index.html","capabilities":["tasks.read","tasks.write"],"files":{"index.html":digest(b"<!doctype html><h1>Hello</h1>")}}).to_string();
    SignedMetadata {
        public_key: STANDARD.encode(key.verifying_key().to_bytes()),
        signature: STANDARD.encode(
            key.sign(&[SIGNING_CONTEXT, manifest.as_bytes()].concat())
                .to_bytes(),
        ),
        manifest,
    }
}
fn archive(path: &Path, meta: &SignedMetadata, extra: Option<(&str, &[u8])>) {
    let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, data) in [
        ("manifest.json", meta.manifest.as_bytes().to_vec()),
        (
            "signature.json",
            serde_json::to_vec(&PackageSignature {
                public_key: meta.public_key.clone(),
                signature: meta.signature.clone(),
            })
            .unwrap(),
        ),
        ("index.html", b"<!doctype html><h1>Hello</h1>".to_vec()),
    ] {
        zip.start_file(name, options).unwrap();
        zip.write_all(&data).unwrap();
    }
    if let Some((name, data)) = extra {
        zip.start_file(name, options).unwrap();
        zip.write_all(data).unwrap();
    }
    zip.finish().unwrap();
}
fn installed(meta: SignedMetadata) -> Installed {
    let v = verify_metadata(&meta).unwrap();
    Installed {
        previous_sha256: None,
        plugin_key: v.plugin_key,
        publisher_id: v.publisher_id,
        manifest: v.manifest,
        metadata: meta,
        sha256: "a".repeat(64),
        size_bytes: 500,
        enabled: true,
        shared: true,
        available: true,
        installed_at: "2026-11-02".into(),
    }
}
#[test]
fn plugin_packages_verify_signatures_and_all_resource_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.lmpk");
    let meta = signed("hello", "1.0.0", 1);
    archive(&path, &meta, None);
    let output = dir.path().join("out");
    fs::create_dir(&output).unwrap();
    let v = inspect(&path, Some(&output), &CancellationToken::new()).unwrap();
    assert!(v.manifest.compatible());
    assert!(output.join("index.html").is_file());
    let mut bad = meta.clone();
    bad.manifest = bad.manifest.replace("Example plugin", "Tampered");
    assert_eq!(verify_metadata(&bad).unwrap_err(), fail("SIGNATURE"));
    archive(&path, &meta, Some(("../escape.txt", b"escape")));
    assert!(inspect(&path, None, &CancellationToken::new()).is_err());
    assert!(!dir.path().join("escape.txt").exists());
}
#[test]
fn plugin_ids_bind_to_publisher_and_paths_are_cross_platform_safe() {
    assert_ne!(
        verify_metadata(&signed("hello", "1.0.0", 1))
            .unwrap()
            .plugin_key,
        verify_metadata(&signed("hello", "1.0.0", 2))
            .unwrap()
            .plugin_key
    );
    for path in [
        "../x",
        "/x",
        "C:/x",
        "a\\b",
        "a/CON.txt",
        "a/b.",
        "a//b",
        "a/../b",
    ] {
        assert!(!safe_relative(path), "{path}");
    }
    assert!(safe_relative("assets/main.js"));
}
#[test]
fn plugin_storage_grants_and_audit_are_local_and_workspace_scoped() {
    let db = Database::open(Path::new(":memory:")).unwrap();
    db.initialize_plugins().unwrap();
    let p = installed(signed("hello", "1.0.0", 1));
    db.save_plugin(&p).unwrap();
    let first = db.workspace_context().unwrap();
    db.plugin_storage_call(
        &p.plugin_key,
        &first,
        "storage.set",
        &json!({"key":"draft","value":"private"}),
    )
    .unwrap();
    db.conn
        .execute(
            "INSERT INTO plugin_grants VALUES(?,?,?,'tasks.read')",
            rusqlite::params![p.plugin_key, first.workspace_id, first.user_id],
        )
        .unwrap();
    db.plugin_audit(&p, &first, "grant", Some("tasks.read"), "request", "ok")
        .unwrap();
    let user = db.current_user_id().unwrap();
    let next = db.create_workspace("Other", None, None, &user).unwrap();
    db.switch_workspace(&next.id, &user).unwrap();
    let second = db.workspace_context().unwrap();
    assert_eq!(db.installed_plugins().unwrap().len(), 1);
    assert!(db.plugin_grants(&p.plugin_key, &second).unwrap().is_empty());
    assert_eq!(
        db.plugin_storage_call(
            &p.plugin_key,
            &second,
            "storage.get",
            &json!({"key":"draft"})
        )
        .unwrap(),
        Value::Null
    );
    assert!(db
        .plugin_storage_call(
            &p.plugin_key,
            &first,
            "storage.get",
            &json!({"key":"draft"})
        )
        .is_err());
    assert!(
        db.plugin_details(&p.plugin_key, &second, 0).unwrap()["audit"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    db.delete_workspace(&first.workspace_id, &user).unwrap();
    for table in ["plugin_grants", "plugin_storage", "plugin_audit"] {
        let remaining: i64 = db
            .conn
            .query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE workspace_id=?"),
                [&first.workspace_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
    }
    assert_eq!(db.installed_plugins().unwrap().len(), 1);
}
#[test]
fn plugin_market_aggregates_only_identical_packages() {
    let meta = signed("hello", "1.0.0", 1);
    let v = verify_metadata(&meta).unwrap();
    let p = MarketPackage {
        plugin_key: v.plugin_key,
        publisher_id: v.publisher_id,
        manifest: v.manifest,
        metadata: meta,
        sha256: "a".repeat(64),
        size_bytes: 500,
        compatible: true,
        sources: vec![Source {
            node_id: "one".into(),
            display_name: "One".into(),
            address: "127.0.0.1".into(),
            port: 1,
        }],
    };
    let mut another = p.clone();
    another.sources[0].node_id = "two".into();
    let mut conflicting = p.clone();
    conflicting.sha256 = "b".repeat(64);
    let grouped = transport::aggregate(vec![p.clone(), p, another, conflicting]);
    assert_eq!(grouped.len(), 2);
    assert_eq!(grouped[0].sources.len(), 2);
}
#[test]
fn plugin_bridge_whitelist_and_navigation_reject_privileged_or_external_access() {
    for method in [
        "delete_task",
        "save_text_file",
        "vault_api",
        "tasks.delete",
        "wiki.delete",
        "invoke",
    ] {
        assert!(runtime::method_capabilities(method).is_err());
    }
    assert_eq!(
        runtime::method_capabilities("tasks.update").unwrap(),
        vec!["tasks.read", "tasks.write"]
    );
    for url in [
        "https://example.com/abc/index.html",
        "http://127.0.0.1/abc/index.html",
        "lanmind-plugin://localhost/other/index.html",
        "lanmind-plugin://localhost/abc/index.html?leak=x",
    ] {
        assert!(!runtime::allowed_navigation(&url.parse().unwrap(), "abc"));
    }
    assert!(runtime::allowed_navigation(
        &"lanmind-plugin://localhost/abc/index.html".parse().unwrap(),
        "abc"
    ));
    let url = runtime::resource_url("abc", "assets/hello #?%世界.html").unwrap();
    assert!(runtime::allowed_navigation(&url, "abc"));
    assert!(url.query().is_none() && url.fragment().is_none());
    assert_eq!(
        percent_encoding::percent_decode_str(url.path())
            .decode_utf8()
            .unwrap(),
        "/abc/assets/hello #?%世界.html"
    );
}

#[test]
fn plugin_business_writes_require_grants_versions_and_current_workspace_and_are_audited() {
    let db = Database::open(Path::new(":memory:")).unwrap();
    db.initialize_plugins().unwrap();
    let p = installed(signed("hello", "1.0.0", 1));
    db.save_plugin(&p).unwrap();
    let scope = db.workspace_context().unwrap();
    let session = runtime::Session {
        plugin_key: p.plugin_key.clone(),
        sha256: p.sha256.clone(),
        scope: scope.clone(),
        locale: "en-US".into(),
        theme: Value::Null,
        denied: Default::default(),
        requests: Default::default(),
    };
    assert_eq!(
        runtime::execute_authorized(
            &db,
            &session,
            "tasks.create",
            json!({"title":"Denied"}),
            "a"
        )
        .unwrap_err(),
        fail("PERMISSION")
    );
    assert!(db.tasks(Some(&scope.user_id)).unwrap().is_empty());
    for cap in ["tasks.read", "tasks.write"] {
        db.conn
            .execute(
                "INSERT INTO plugin_grants VALUES(?,?,?,?)",
                rusqlite::params![p.plugin_key, scope.workspace_id, scope.user_id, cap],
            )
            .unwrap();
    }
    let created = runtime::execute_authorized(
        &db,
        &session,
        "tasks.create",
        json!({"title":"Created by a plugin"}),
        "create",
    )
    .unwrap();
    let id = created["task"]["id"].as_str().unwrap();
    let version = created["task"]["version"].as_i64().unwrap();
    runtime::execute_authorized(
        &db,
        &session,
        "tasks.update",
        json!({"taskId":id,"expectedVersion":version,"patch":{"title":"Updated"}}),
        "update",
    )
    .unwrap();
    assert_eq!(
        runtime::execute_authorized(
            &db,
            &session,
            "tasks.update",
            json!({"taskId":id,"expectedVersion":version,"patch":{"title":"Stale overwrite"}}),
            "stale"
        )
        .unwrap_err(),
        fail("VERSION_CONFLICT")
    );
    assert_eq!(db.tasks(Some(&scope.user_id)).unwrap()[0].title, "Updated");
    let audit = db.plugin_details(&p.plugin_key, &scope, 0).unwrap();
    assert_eq!(audit["audit"].as_array().unwrap().len(), 3);
    assert!(audit.to_string().contains("tasks.create"));
    assert!(!audit.to_string().contains("Created by a plugin"));
    let mut undeclared = p.clone();
    undeclared.manifest.capabilities.clear();
    db.save_plugin(&undeclared).unwrap();
    assert_eq!(
        runtime::execute_authorized(&db, &session, "tasks.list", json!({}), "undeclared")
            .unwrap_err(),
        fail("PERMISSION")
    );
    db.save_plugin(&p).unwrap();
    let next = db
        .create_workspace("Another", None, None, &scope.user_id)
        .unwrap();
    db.switch_workspace(&next.id, &scope.user_id).unwrap();
    assert_eq!(
        runtime::execute_authorized(
            &db,
            &session,
            "tasks.create",
            json!({"title":"Cross workspace"}),
            "wrong"
        )
        .unwrap_err(),
        fail("SESSION")
    );
    assert!(db.tasks(Some(&scope.user_id)).unwrap().is_empty());
}

#[tokio::test]
async fn plugin_http_catalog_shares_exact_packages_and_global_off_revokes_transfers() {
    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(Mutex::new(Database::open(Path::new(":memory:")).unwrap()));
    let rt = Runtime::new(dir.path().join("plugins"), db.clone()).unwrap();
    let meta = signed("hello", "1.0.0", 1);
    let archive_path = dir.path().join("hello.lmpk");
    archive(&archive_path, &meta, None);
    let mut p = installed(meta);
    p.sha256 = file_digest(&archive_path).unwrap();
    p.size_bytes = fs::metadata(&archive_path).unwrap().len();
    fs::copy(&archive_path, rt.package_path(&p.sha256).unwrap()).unwrap();
    db.lock().unwrap().save_plugin(&p).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let router = routes(rt.clone());
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let client = reqwest::Client::new();
    let catalog: Catalog = client
        .get(format!("{address}/api/plugins/v1/catalog"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(catalog.items.len(), 1);
    assert_eq!(catalog.items[0].metadata.manifest, p.metadata.manifest);
    let url = format!("{address}/api/plugins/v1/packages/{}", p.sha256);
    assert_eq!(
        client
            .get(&url)
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap()
            .as_ref(),
        fs::read(&archive_path).unwrap()
    );
    let token = rt.shares.lock().unwrap().get(&p.sha256).unwrap().clone();
    rt.set_sharing(false).unwrap();
    assert!(token.is_cancelled());
    assert_eq!(
        client.get(&url).send().await.unwrap().status(),
        reqwest::StatusCode::NOT_FOUND
    );
    let empty: Catalog = client
        .get(format!("{address}/api/plugins/v1/catalog"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(empty.items.is_empty());
    rt.set_sharing(true).unwrap();
    assert!(client.get(&url).send().await.unwrap().status().is_success());
    server.abort();
}

async fn byte_server(data: Vec<u8>, name: &str) -> (Source, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let router = axum::Router::new().route(
        "/api/plugins/v1/packages/{hash}",
        axum::routing::get(move || {
            let data = data.clone();
            async move { data }
        }),
    );
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (
        Source {
            node_id: name.into(),
            display_name: name.into(),
            address: "127.0.0.1".into(),
            port,
        },
        task,
    )
}
#[tokio::test]
async fn plugin_download_retries_bad_hash_without_mixing_bytes_and_honors_cancellation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hello.lmpk");
    let meta = signed("hello", "1.0.0", 1);
    archive(&path, &meta, None);
    let data = fs::read(&path).unwrap();
    let (bad, bad_task) = byte_server(vec![0; data.len()], "corrupt").await;
    let (good, good_task) = byte_server(data.clone(), "valid").await;
    let v = verify_metadata(&meta).unwrap();
    let target = MarketPackage {
        plugin_key: v.plugin_key,
        publisher_id: v.publisher_id,
        manifest: v.manifest,
        metadata: meta,
        sha256: digest(&data),
        size_bytes: 1,
        compatible: true,
        sources: vec![],
    };
    let output = dir.path().join("download.lmpk");
    let mut attempted = Vec::new();
    transport::retrieve(
        &target,
        &[bad, good],
        &output,
        &CancellationToken::new(),
        |source, received, _| {
            if received == 0 {
                attempted.push(source.node_id.clone());
            }
        },
    )
    .await
    .unwrap();
    assert_eq!(attempted, vec!["corrupt", "valid"]);
    assert_eq!(fs::read(&output).unwrap(), data);
    assert!(inspect(&output, None, &CancellationToken::new()).is_ok());
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        transport::retrieve(&target, &[], &output, &cancel, |_, _, _| {})
            .await
            .unwrap_err(),
        fail("CANCELLED")
    );
    bad_task.abort();
    good_task.abort();
}

#[test]
fn plugin_node_packager_fixture_is_accepted_by_native_verifier() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/web-plugin-v1.json")).unwrap();
    let bytes = STANDARD
        .decode(fixture["archiveBase64"].as_str().unwrap())
        .unwrap();
    assert_eq!(digest(&bytes), fixture["sha256"].as_str().unwrap());
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("node.lmpk");
    fs::write(&path, bytes).unwrap();
    let verified = inspect(&path, None, &CancellationToken::new()).unwrap();
    assert_eq!(verified.manifest.id, "example");
    assert_eq!(verified.manifest.version, "1.0.0");
    assert!(verified.manifest.compatible());
}

#[test]
fn plugin_wiki_access_obeys_grants_versions_locks_and_module_switches() {
    let db = Database::open(Path::new(":memory:")).unwrap();
    db.initialize_plugins().unwrap();
    let mut metadata = signed("wiki-example", "1.0.0", 1);
    let mut manifest: Value = serde_json::from_str(&metadata.manifest).unwrap();
    manifest["capabilities"] = json!(["wiki.read", "wiki.write"]);
    metadata.manifest = manifest.to_string();
    metadata.signature = STANDARD.encode(
        SigningKey::from_bytes(&[1; 32])
            .sign(&[SIGNING_CONTEXT, metadata.manifest.as_bytes()].concat())
            .to_bytes(),
    );
    let p = installed(metadata);
    db.save_plugin(&p).unwrap();
    let scope = db.workspace_context().unwrap();
    let session = runtime::Session {
        plugin_key: p.plugin_key.clone(),
        sha256: p.sha256.clone(),
        scope: scope.clone(),
        locale: "en-US".into(),
        theme: Value::Null,
        denied: Default::default(),
        requests: Default::default(),
    };
    let call = |method, payload, request| {
        runtime::execute_authorized(&db, &session, method, payload, request)
    };
    assert_eq!(
        call(
            "wiki.create",
            json!({"title":"Denied","content":"private"}),
            "deny"
        )
        .unwrap_err(),
        fail("PERMISSION")
    );
    for capability in ["wiki.read", "wiki.write"] {
        db.conn
            .execute(
                "INSERT INTO plugin_grants VALUES(?,?,?,?)",
                rusqlite::params![p.plugin_key, scope.workspace_id, scope.user_id, capability],
            )
            .unwrap();
    }
    let created = call(
        "wiki.create",
        json!({"title":"Page","content":"Original"}),
        "create",
    )
    .unwrap();
    let page = &created["page"];
    call(
        "wiki.update",
        json!({"pageId":page["id"],"expectedVersion":page["version"],"content":"Updated"}),
        "update",
    )
    .unwrap();
    assert_eq!(
        call(
            "wiki.update",
            json!({"pageId":page["id"],"expectedVersion":page["version"],"content":"Stale"}),
            "stale"
        )
        .unwrap_err(),
        fail("VERSION_CONFLICT")
    );
    let mut current = call("wiki.get", json!({"pageId":page["id"]}), "get").unwrap();
    assert_eq!(current["content"], "Updated");
    current["isLocked"] = json!(true);
    db.write_wiki_page(&current, current["version"].as_i64(), &scope.user_id)
        .unwrap();
    assert!(call("wiki.update",json!({"pageId":page["id"],"expectedVersion":current["version"],"content":"Locked overwrite"}),"locked").is_err());
    db.set_feature_enabled("wiki", false).unwrap();
    assert_eq!(
        call("wiki.list", json!({}), "off").unwrap_err(),
        fail("FEATURE_DISABLED")
    );
    let audit = db.plugin_details(&p.plugin_key, &scope, 0).unwrap();
    assert_eq!(audit["audit"].as_array().unwrap().len(), 4);
    assert!(!audit.to_string().contains("Original"));
}

#[test]
fn plugin_restart_preserves_previous_release_and_disables_corrupt_installations() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("plugins");
    let db = Arc::new(Mutex::new(Database::open(Path::new(":memory:")).unwrap()));
    let rt = Runtime::new(root.clone(), db.clone()).unwrap();
    let old_archive = temporary.path().join("old.lmpk");
    archive(&old_archive, &signed("hello", "1.0.0", 1), None);
    let old_hash = file_digest(&old_archive).unwrap();
    fs::copy(&old_archive, rt.package_path(&old_hash).unwrap()).unwrap();
    let metadata = signed("hello", "1.1.0", 1);
    let archive_path = temporary.path().join("new.lmpk");
    archive(&archive_path, &metadata, None);
    let mut p = installed(metadata);
    p.sha256 = file_digest(&archive_path).unwrap();
    p.size_bytes = fs::metadata(&archive_path).unwrap().len();
    p.previous_sha256 = Some(old_hash.clone());
    fs::copy(&archive_path, rt.package_path(&p.sha256).unwrap()).unwrap();
    db.lock().unwrap().save_plugin(&p).unwrap();
    let abandoned = root.join("staging").join("crash");
    directory(&abandoned).unwrap();
    fs::write(abandoned.join("partial"), b"partial").unwrap();
    directory(&root.join("profiles").join("expired")).unwrap();
    let orphan = "b".repeat(64);
    fs::write(rt.package_path(&orphan).unwrap(), b"orphan").unwrap();
    directory(&root.join("releases").join(&orphan)).unwrap();
    drop(rt);
    let rt = Runtime::new(root.clone(), db.clone()).unwrap();
    assert!(!abandoned.exists());
    assert!(!root.join("profiles").join("expired").exists());
    assert!(!rt.package_path(&orphan).unwrap().exists());
    assert!(!root.join("releases").join(&orphan).exists());
    assert!(rt.package_path(&old_hash).unwrap().is_file());
    assert!(
        db.lock()
            .unwrap()
            .installed_plugin(&p.plugin_key)
            .unwrap()
            .available
    );
    fs::write(rt.package_path(&p.sha256).unwrap(), b"corrupt").unwrap();
    drop(rt);
    let _rt = Runtime::new(root, db.clone()).unwrap();
    let broken = db.lock().unwrap().installed_plugin(&p.plugin_key).unwrap();
    assert!(!broken.enabled && !broken.shared && !broken.available);
    assert_eq!(broken.previous_sha256.as_deref(), Some(old_hash.as_str()));
}
