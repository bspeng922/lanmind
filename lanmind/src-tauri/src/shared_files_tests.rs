use super::*;
use tempfile::{tempdir, TempDir};

fn setup() -> (TempDir, Arc<SharedFiles>, String) {
    let directory = tempdir().unwrap();
    std::fs::create_dir(directory.path().join("资料")).unwrap();
    let db = Arc::new(Mutex::new(Database::open(Path::new(":memory:")).unwrap()));
    let shares = Arc::new(SharedFiles::new(db).unwrap());
    let id = shares.add(&directory.path().join("资料")).unwrap()[0]
        .id
        .clone();
    (directory, shares, id)
}
fn begin(
    shares: &SharedFiles,
    id: &str,
    path: &str,
    name: &str,
    bytes: &[u8],
) -> ShareResult<String> {
    shares
        .request(ShareRequest::BeginUpload {
            share_id: id.into(),
            path: path.into(),
            name: name.into(),
            size: bytes.len() as u64,
            sha256: format!("{:x}", Sha256::digest(bytes)),
        })
        .map(|v| v["uploadId"].as_str().unwrap().to_string())
}
fn write(shares: &SharedFiles, id: &str, offset: u64, bytes: &[u8]) -> ShareResult<Value> {
    shares.request(ShareRequest::Write {
        upload_id: id.into(),
        offset,
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[test]
fn shares_persist_locally_and_remote_views_never_expose_absolute_paths() {
    let (directory, shares, id) = setup();
    std::fs::create_dir(directory.path().join("资料/空目录")).unwrap();
    std::fs::write(directory.path().join("资料/说明.txt"), b"hello").unwrap();
    let roots = shares.request(ShareRequest::Roots).unwrap();
    assert_eq!(roots["roots"][0]["name"], "资料");
    assert!(roots["roots"][0].get("localPath").is_none());
    assert!(!roots
        .to_string()
        .contains(&directory.path().to_string_lossy().to_string()));
    let listing = shares
        .request(ShareRequest::List {
            share_id: id.clone(),
            path: "".into(),
            offset: 0,
        })
        .unwrap();
    assert_eq!(listing["entries"][0]["name"], "空目录");
    assert_eq!(listing["entries"][0]["isDirectory"], true);
    assert_eq!(listing["entries"][1]["path"], "说明.txt");
    shares.update(&id, Some(true)).unwrap();
    let reopened = SharedFiles::new(shares.db.clone()).unwrap();
    assert!(reopened.local_roots().unwrap()[0].writable);
    reopened.update(&id, None).unwrap();
    assert!(SharedFiles::new(shares.db.clone())
        .unwrap()
        .local_roots()
        .unwrap()
        .is_empty());
}

#[test]
fn read_only_and_revoked_shares_reject_writes_and_clean_partial_uploads() {
    let (directory, shares, id) = setup();
    assert_eq!(
        begin(&shares, &id, "", "hello.txt", b"hello").unwrap_err(),
        failure("READ_ONLY")
    );
    shares.update(&id, Some(true)).unwrap();
    let upload = begin(&shares, &id, "", "hello.txt", b"hello").unwrap();
    write(&shares, &upload, 0, b"he").unwrap();
    shares.update(&id, Some(false)).unwrap();
    assert!(write(&shares, &upload, 2, b"llo").is_err());
    assert_eq!(
        std::fs::read_dir(directory.path().join("资料"))
            .unwrap()
            .count(),
        0
    );
    shares.update(&id, None).unwrap();
    assert!(shares
        .request(ShareRequest::List {
            share_id: id,
            path: "".into(),
            offset: 0
        })
        .is_err());
}

#[test]
fn writable_uploads_verify_hash_and_commit_without_overwriting_existing_files() {
    let (directory, shares, id) = setup();
    shares.update(&id, Some(true)).unwrap();
    shares
        .request(ShareRequest::Mkdir {
            share_id: id.clone(),
            path: "".into(),
            name: "交付".into(),
        })
        .unwrap();
    let upload = begin(&shares, &id, "交付", "report.txt", b"hello").unwrap();
    assert!(write(&shares, &upload, 1, b"hello").is_err());
    write(&shares, &upload, 0, b"hello").unwrap();
    shares
        .request(ShareRequest::Finish { upload_id: upload })
        .unwrap();
    assert_eq!(
        std::fs::read(directory.path().join("资料/交付/report.txt")).unwrap(),
        b"hello"
    );
    assert_eq!(
        begin(&shares, &id, "交付", "report.txt", b"changed").unwrap_err(),
        failure("EXISTS")
    );
    let upload = begin(&shares, &id, "交付", "race.txt", b"hello").unwrap();
    write(&shares, &upload, 0, b"hello").unwrap();
    std::fs::write(directory.path().join("资料/交付/race.txt"), b"local").unwrap();
    assert!(shares
        .request(ShareRequest::Finish { upload_id: upload })
        .is_err());
    assert_eq!(
        std::fs::read(directory.path().join("资料/交付/race.txt")).unwrap(),
        b"local"
    );
    let upload = begin(&shares, &id, "", "bad.txt", b"hello").unwrap();
    write(&shares, &upload, 0, b"wrong").unwrap();
    assert_eq!(
        shares
            .request(ShareRequest::Finish { upload_id: upload })
            .unwrap_err(),
        failure("CHECKSUM")
    );
    assert!(!directory.path().join("资料/bad.txt").exists());
}

#[test]
fn paths_links_and_replaced_roots_cannot_escape_the_selected_share() {
    let (directory, shares, id) = setup();
    shares.update(&id, Some(true)).unwrap();
    for path in [
        "../",
        "../secret",
        "/etc",
        "C:/Windows",
        "a\\b",
        "a//b",
        "a/../b",
        "NUL",
        "file.txt:stream",
        "a.",
    ] {
        assert!(
            shares
                .request(ShareRequest::List {
                    share_id: id.clone(),
                    path: path.into(),
                    offset: 0
                })
                .is_err(),
            "{path}"
        );
    }
    for name in ["..", "a/b", "CON.txt", ".lanmind-upload-evil.part"] {
        assert!(begin(&shares, &id, "", name, b"x").is_err());
    }
    let outside = tempdir().unwrap();
    std::fs::write(outside.path().join("secret"), b"private").unwrap();
    #[cfg(windows)]
    let linked =
        std::os::windows::fs::symlink_dir(outside.path(), directory.path().join("资料/link"));
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(outside.path(), directory.path().join("资料/link"));
    if linked.is_ok() {
        assert!(shares
            .request(ShareRequest::Stat {
                share_id: id.clone(),
                path: "link/secret".into()
            })
            .is_err());
    }
    match std::fs::rename(directory.path().join("资料"), directory.path().join("old")) {
        Ok(()) => {
            std::fs::create_dir(directory.path().join("资料")).unwrap();
            assert_eq!(
                shares
                    .request(ShareRequest::List {
                        share_id: id,
                        path: "".into(),
                        offset: 0
                    })
                    .unwrap_err(),
                failure("ROOT_CHANGED")
            );
        }
        Err(error) => {
            // cap-std deliberately pins Windows directory capabilities without
            // FILE_SHARE_DELETE, preventing replacement before it can occur.
            assert!(cfg!(windows) && error.raw_os_error() == Some(32));
            assert!(shares
                .request(ShareRequest::List {
                    share_id: id,
                    path: "".into(),
                    offset: 0
                })
                .is_ok());
        }
    }
}

#[test]
fn moved_upload_parent_and_workspace_switch_invalidate_pending_writes() {
    let (directory, shares, id) = setup();
    shares.update(&id, Some(true)).unwrap();
    std::fs::create_dir(directory.path().join("资料/nested")).unwrap();
    let upload = begin(&shares, &id, "nested", "file.txt", b"ok").unwrap();
    match std::fs::rename(
        directory.path().join("资料/nested"),
        directory.path().join("moved"),
    ) {
        Ok(()) => {
            std::fs::create_dir(directory.path().join("资料/nested")).unwrap();
            assert!(write(&shares, &upload, 0, b"ok").is_err());
            shares.clear_uploads();
            assert_eq!(
                std::fs::read_dir(directory.path().join("moved"))
                    .unwrap()
                    .count(),
                0
            );
        }
        Err(error) => {
            assert!(cfg!(windows) && error.raw_os_error() == Some(32));
            shares.clear_uploads();
            assert_eq!(
                std::fs::read_dir(directory.path().join("资料/nested"))
                    .unwrap()
                    .count(),
                0
            );
        }
    }
    let db = shares.db.lock().unwrap();
    let user = db.current_user_id().unwrap();
    let old = db.workspace_context().unwrap();
    let next = db.create_workspace("Other", None, None, &user).unwrap();
    db.switch_workspace(&next.id, &user).unwrap();
    drop(db);
    assert_eq!(
        shares.request(ShareRequest::Roots).unwrap_err(),
        failure("WORKSPACE")
    );
    let other = SharedFiles::new(shares.db.clone()).unwrap();
    assert!(other.local_roots().unwrap().is_empty());
    shares
        .db
        .lock()
        .unwrap()
        .switch_workspace(&old.workspace_id, &user)
        .unwrap();
    assert_eq!(
        shares.request(ShareRequest::Roots).unwrap_err(),
        failure("WORKSPACE")
    );
    assert_eq!(
        SharedFiles::new(shares.db.clone())
            .unwrap()
            .local_roots()
            .unwrap()
            .len(),
        1
    );
}

fn connection(shares: Arc<SharedFiles>) -> (Client, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let key = derive_workspace_key("test-secret");
    let workspace_id = shares.scope.workspace_id.clone();
    let thread = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut reader = BufReader::new(stream);
        if let WireMessage::ShareRequest { request, .. } =
            receive_message_line(&mut reader, &key).unwrap()
        {
            serve(
                reader.into_inner(),
                request,
                shares,
                key,
                Arc::new(AtomicBool::new(false)),
            );
        }
    });
    let client = Client {
        reader: BufReader::new(TcpStream::connect(address).unwrap()),
        key,
        workspace_id,
        stopped: Arc::new(AtomicBool::new(false)),
        cancel: Arc::new(AtomicBool::new(false)),
    };
    (client, thread)
}

#[test]
fn encrypted_connections_download_multiple_chunks_resume_and_never_overwrite() {
    let (directory, shares, id) = setup();
    let content = vec![0x5a; CHUNK_SIZE * 2 + 37];
    std::fs::write(directory.path().join("资料/large.bin"), &content).unwrap();
    let (mut client, thread) = connection(shares.clone());
    assert_eq!(
        client.call(ShareRequest::Roots).unwrap()["roots"][0]["id"],
        id
    );
    let destination = tempdir().unwrap();
    let target = Dir::open_ambient_dir(destination.path(), cap_std::ambient_authority()).unwrap();
    let cancel = client.cancel.clone();
    let result = download_one(
        &mut client,
        &id,
        "large.bin",
        &target,
        "large.bin",
        &|_, received, _| {
            if received >= CHUNK_SIZE as u64 {
                cancel.store(true, Ordering::Release);
            }
        },
    );
    assert_eq!(result.unwrap_err(), failure("CANCELLED"));
    assert!(!destination.path().join("large.bin").exists());
    cancel.store(false, Ordering::Release);
    let resumed = std::cell::Cell::new(0);
    download_one(
        &mut client,
        &id,
        "large.bin",
        &target,
        "large.bin",
        &|_, received, _| {
            if resumed.get() == 0 {
                resumed.set(received);
            }
        },
    )
    .unwrap();
    assert!(resumed.get() >= CHUNK_SIZE as u64);
    assert_eq!(
        std::fs::read(destination.path().join("large.bin")).unwrap(),
        content
    );
    std::fs::write(destination.path().join("keep.bin"), b"local").unwrap();
    assert_eq!(
        download_one(
            &mut client,
            &id,
            "large.bin",
            &target,
            "keep.bin",
            &|_, _, _| {}
        )
        .unwrap_err(),
        failure("EXISTS")
    );
    drop(client);
    thread.join().unwrap();
}

#[test]
fn disconnected_uploads_are_removed_and_empty_files_transfer() {
    let (directory, shares, id) = setup();
    shares.update(&id, Some(true)).unwrap();
    let (mut client, thread) = connection(shares.clone());
    client
        .call(ShareRequest::BeginUpload {
            share_id: id.clone(),
            path: "".into(),
            name: "partial.txt".into(),
            size: 100,
            sha256: format!("{:x}", Sha256::digest(b"x")),
        })
        .unwrap();
    drop(client);
    thread.join().unwrap();
    assert_eq!(
        std::fs::read_dir(directory.path().join("资料"))
            .unwrap()
            .count(),
        0
    );
    let upload = begin(&shares, &id, "", "empty.txt", b"").unwrap();
    shares
        .request(ShareRequest::Finish { upload_id: upload })
        .unwrap();
    let (mut client, thread) = connection(shares);
    let destination = tempdir().unwrap();
    let target = Dir::open_ambient_dir(destination.path(), cap_std::ambient_authority()).unwrap();
    download_one(
        &mut client,
        &id,
        "empty.txt",
        &target,
        "empty.txt",
        &|_, _, _| {},
    )
    .unwrap();
    assert_eq!(
        std::fs::metadata(destination.path().join("empty.txt"))
            .unwrap()
            .len(),
        0
    );
    drop(client);
    thread.join().unwrap();
}

#[test]
fn recursive_directory_download_preserves_nested_empty_folders_and_resumes() {
    let (directory, shares, id) = setup();
    std::fs::create_dir_all(directory.path().join("资料/设计/交付/空目录")).unwrap();
    std::fs::write(
        directory.path().join("资料/设计/交付/report.txt"),
        "项目交付内容",
    )
    .unwrap();
    std::fs::write(directory.path().join("资料/计划.txt"), "计划").unwrap();
    let (mut client, thread) = connection(shares);
    let destination = tempdir().unwrap();
    let cancel = client.cancel.clone();
    let interrupted = download_directory(
        &mut client,
        "owner",
        &id,
        "",
        "资料",
        destination.path(),
        &|_, _, _| cancel.store(true, Ordering::Release),
    );
    assert_eq!(interrupted.unwrap_err(), failure("CANCELLED"));
    cancel.store(false, Ordering::Release);
    download_directory(
        &mut client,
        "owner",
        &id,
        "",
        "资料",
        destination.path(),
        &|_, _, _| {},
    )
    .unwrap();
    assert!(destination.path().join("资料/设计/交付/空目录").is_dir());
    assert_eq!(
        std::fs::read_to_string(destination.path().join("资料/设计/交付/report.txt")).unwrap(),
        "项目交付内容"
    );
    assert_eq!(
        std::fs::read_to_string(destination.path().join("资料/计划.txt")).unwrap(),
        "计划"
    );
    assert!(!destination.path().join("资料/.lanmind-download").exists());
    assert_eq!(
        download_directory(
            &mut client,
            "owner",
            &id,
            "",
            "资料",
            destination.path(),
            &|_, _, _| {}
        )
        .unwrap_err(),
        failure("EXISTS")
    );
    drop(client);
    thread.join().unwrap();
}

#[test]
fn standalone_file_shares_reject_siblings_and_changed_download_versions() {
    let directory = tempdir().unwrap();
    let source = directory.path().join("public.txt");
    std::fs::write(&source, b"public").unwrap();
    std::fs::write(directory.path().join("private.txt"), b"private").unwrap();
    let db = Arc::new(Mutex::new(Database::open(Path::new(":memory:")).unwrap()));
    let shares = SharedFiles::new(db).unwrap();
    let root = shares.add(&source).unwrap().remove(0);
    assert!(!root.is_directory);
    assert!(!root.writable);
    assert!(shares.update(&root.id, Some(true)).is_err());
    assert!(shares
        .request(ShareRequest::Stat {
            share_id: root.id.clone(),
            path: "private.txt".into()
        })
        .is_err());
    let stat = shares
        .request(ShareRequest::Stat {
            share_id: root.id.clone(),
            path: "".into(),
        })
        .unwrap();
    std::fs::write(&source, b"updated content").unwrap();
    assert_eq!(
        shares
            .request(ShareRequest::Read {
                share_id: root.id,
                path: "".into(),
                version: stat["version"].as_str().unwrap().into(),
                offset: 0
            })
            .unwrap_err(),
        failure("CHANGED")
    );
}
