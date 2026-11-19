use super::{emit_incoming_chat, frame, NetworkRuntime, PeerFlight, WireMessage, PROTOCOL_VERSION};
use crate::db::Database;
use crate::lan_sync::{FeedCursor, SignedCursor, PAGE_BYTES, PAGE_OPERATIONS};
use crate::models::SyncOperation;
use crate::workspace_scope::WorkspaceContext;
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tauri::Emitter;
use tempfile::{spooled_tempfile, SpooledTempFile};
use uuid::Uuid;

const FRAGMENT_BYTES: usize = 1024 * 1024;
// A single stored SQLite operation can exceed the ordinary page budget.
const MAX_RECORD_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ROUNDS: u32 = 32;
const PAGE_PROCESSING_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Deserialize, Serialize)]
pub(super) struct Signed<T> {
    value: T,
    signature: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Hello {
    workspace_id: String,
    initiator: String,
    responder: String,
    nonce: Uuid,
}

#[derive(Serialize)]
struct Transcript {
    hello: Hello,
    challenge: Uuid,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Pull {
    cursor: Option<SignedCursor>,
    features: u8,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    cursor: SignedCursor,
    operations: usize,
    bytes: u64,
    digest: [u8; 32],
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Access {
    generation: i64,
    features: u8,
}

struct Endpoint<'a> {
    db: &'a Mutex<Database>,
    stopped: &'a AtomicBool,
    workspace_key: &'a [u8; 32],
    context: WorkspaceContext,
}

impl<'a> Endpoint<'a> {
    fn from_runtime(db: &'a Mutex<Database>, runtime: &'a NetworkRuntime) -> Self {
        Self {
            db,
            stopped: &runtime.stopped,
            workspace_key: &runtime.workspace_key,
            context: WorkspaceContext {
                workspace_id: runtime.workspace_id.clone(),
                user_id: runtime.user_id.clone(),
                revision: runtime.workspace_revision,
            },
        }
    }

    fn database(&self, peer: &str) -> Result<MutexGuard<'a, Database>, String> {
        let db = self.db.lock().map_err(|error| error.to_string())?;
        if self.stopped.load(Ordering::Acquire) {
            return Err("LAN sync stopped".into());
        }
        db.validate_workspace_context(&self.context)?;
        db.require_workspace_member(&self.context.user_id)?;
        db.require_workspace_member(peer)?;
        Ok(db)
    }

    fn check_access(&self, peer: &str, expected: Access) -> Result<(), String> {
        let db = self.database(peer)?;
        if access(&db)? != expected {
            return Err("LAN sync access changed".into());
        }
        Ok(())
    }
}

fn access(db: &Database) -> Result<Access, String> {
    Ok(Access {
        generation: db.lan_access_revision()?,
        features: db.lan_features()?,
    })
}

fn signature_body(
    label: &str,
    scope: &impl Serialize,
    value: &impl Serialize,
) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&("lanmind-sync", PROTOCOL_VERSION, label, scope, value))
        .map_err(|error| error.to_string())
}

fn sign<T: Serialize>(
    db: &Database,
    label: &str,
    scope: &impl Serialize,
    value: T,
) -> Result<Signed<T>, String> {
    let signature = db.sign_device_message(&signature_body(label, scope, &value)?)?;
    Ok(Signed { value, signature })
}

fn verify(
    db: &Database,
    peer: &str,
    label: &str,
    scope: &impl Serialize,
    message: &Signed<impl Serialize>,
) -> Result<(), String> {
    db.verify_device_message(
        peer,
        &signature_body(label, scope, &message.value)?,
        &message.signature,
    )
}

fn valid_cursor(cursor: &FeedCursor) -> bool {
    cursor.after >= 0 && (cursor.through == 0 || cursor.through > cursor.after)
}

pub(super) fn connect(
    db: Arc<Mutex<Database>>,
    runtime: &NetworkRuntime,
    peer: &str,
    address: SocketAddr,
) -> Result<(), String> {
    let local = Endpoint::from_runtime(&db, runtime);
    drop(local.database(peer)?);
    let stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))
        .map_err(|error| error.to_string())?;
    initiate(stream, &local, peer, |applied| {
        emit_applied(runtime, &local, peer, applied)
    })
}

pub(super) fn accept(
    stream: TcpStream,
    db: Arc<Mutex<Database>>,
    runtime: &NetworkRuntime,
    hello: Signed<Hello>,
) -> Result<(), String> {
    let peer = hello.value.initiator.clone();
    let _flight = PeerFlight::begin(&runtime.sync_peers, &peer)
        .ok_or("LAN sync already active for this peer")?;
    let local = Endpoint::from_runtime(&db, runtime);
    respond(stream, &local, hello, |applied| {
        emit_applied(runtime, &local, &peer, applied)
    })
}

fn emit_applied(
    runtime: &NetworkRuntime,
    local: &Endpoint<'_>,
    peer: &str,
    operations: Vec<SyncOperation>,
) {
    if operations.is_empty() || local.database(peer).is_err() {
        return;
    }
    for operation in &operations {
        emit_incoming_chat(&runtime.app, operation, local.context.revision);
    }
    let _ = runtime.app.emit(
        "sync://operation",
        serde_json::json!({
            "count": operations.len(),
            "workspaceId": local.context.workspace_id,
            "workspaceRevision": local.context.revision,
        }),
    );
}

fn initiate(
    mut stream: TcpStream,
    local: &Endpoint<'_>,
    peer: &str,
    applied: impl Fn(Vec<SyncOperation>),
) -> Result<(), String> {
    if local.context.user_id.as_str() >= peer {
        return Err("unexpected LAN sync initiator".into());
    }
    let hello = Hello {
        workspace_id: local.context.workspace_id.clone(),
        initiator: local.context.user_id.clone(),
        responder: peer.to_owned(),
        nonce: Uuid::new_v4(),
    };
    let message = sign(&*local.database(peer)?, "hello", &(), hello.clone())?;
    frame::send(
        &mut stream,
        &WireMessage::SyncHello { hello: message },
        local.workspace_key,
    )?;
    let challenge: Signed<Uuid> = frame::receive(&mut stream, local.workspace_key)?;
    let transcript = {
        let db = local.database(peer)?;
        verify(&db, peer, "challenge", &hello, &challenge)?;
        Transcript {
            hello,
            challenge: challenge.value,
        }
    };
    exchange(stream, local, peer, transcript, true, applied)
}

fn respond(
    mut stream: TcpStream,
    local: &Endpoint<'_>,
    hello: Signed<Hello>,
    applied: impl Fn(Vec<SyncOperation>),
) -> Result<(), String> {
    let peer = hello.value.initiator.clone();
    if hello.value.workspace_id != local.context.workspace_id
        || hello.value.responder != local.context.user_id
        || peer >= local.context.user_id
    {
        return Err("invalid LAN sync identity".into());
    }
    let challenge = {
        let db = local.database(&peer)?;
        verify(&db, &peer, "hello", &(), &hello)?;
        sign(&db, "challenge", &hello.value, Uuid::new_v4())?
    };
    frame::send(&mut stream, &challenge, local.workspace_key)?;
    let transcript = Transcript {
        hello: hello.value,
        challenge: challenge.value,
    };
    exchange(stream, local, &peer, transcript, false, applied)
}

struct Session<'a, 'db> {
    local: &'a Endpoint<'db>,
    peer: &'a str,
    transcript: Transcript,
    key: [u8; 32],
}

fn exchange(
    mut stream: TcpStream,
    local: &Endpoint<'_>,
    peer: &str,
    transcript: Transcript,
    initiator: bool,
    applied: impl Fn(Vec<SyncOperation>),
) -> Result<(), String> {
    let info = signature_body("session-key", &transcript, &())?;
    let mut key = [0; 32];
    Hkdf::<Sha256>::new(None, local.workspace_key)
        .expand(&info, &mut key)
        .map_err(|_| "invalid LAN session key")?;
    let session = Session {
        local,
        peer,
        transcript,
        key,
    };
    let _ = stream.set_nodelay(true);
    for round in 0..MAX_ROUNDS {
        let first = (&session.transcript, round, "initiator-pulls");
        let second = (&session.transcript, round, "responder-pulls");
        let finished = if initiator {
            let incoming = session.pull(&mut stream, &first, &applied)?;
            let outgoing = session.serve(&mut stream, &second)?;
            incoming && outgoing
        } else {
            let outgoing = session.serve(&mut stream, &first)?;
            let incoming = session.pull(&mut stream, &second, &applied)?;
            incoming && outgoing
        };
        if finished {
            break;
        }
    }
    Ok(())
}

impl Session<'_, '_> {
    fn pull(
        &self,
        stream: &mut TcpStream,
        scope: &impl Serialize,
        applied: &impl Fn(Vec<SyncOperation>),
    ) -> Result<bool, String> {
        let (request, expected) = {
            let db = self.local.database(self.peer)?;
            let expected = access(&db)?;
            let cursor = db.lan_cursor(&self.local.context.user_id, self.peer)?;
            let pull = Pull {
                cursor,
                features: expected.features,
            };
            (sign(&db, "pull", scope, pull)?, expected)
        };
        frame::send(stream, &request, &self.key)?;
        let page: Signed<Page> = frame::receive_with_timeout(stream, &self.key, PAGE_PROCESSING_TIMEOUT)
            .map_err(|error| format!("LAN sync page header: {error}"))?;
        {
            let db = self.local.database(self.peer)?;
            verify(&db, self.peer, "page", scope, &page)?;
            let cursor = &page.value.cursor;
            let cursor_scope = (
                &self.local.context.workspace_id,
                self.peer,
                &self.local.context.user_id,
            );
            db.verify_device_message(
                self.peer,
                &signature_body("cursor", &cursor_scope, &cursor.value)?,
                &cursor.signature,
            )?;
            if !valid_cursor(&cursor.value) || cursor.value.receiver_features != expected.features {
                return Err("invalid LAN page cursor".into());
            }
        }
        let operations = self.receive_body(stream, &page.value, expected)?;
        let (ack, changed) = {
            let db = self.local.database(self.peer)?;
            if access(&db)? != expected {
                return Err("LAN sync access changed".into());
            }
            let ack = sign(&db, "ack", scope, &page.signature)?;
            let changed = db.accept_lan_page(
                &self.local.context.user_id,
                self.peer,
                &page.value.cursor,
                operations,
            )?;
            (ack, changed)
        };
        let result = frame::send(stream, &ack, &self.key);
        applied(changed);
        result?;
        Ok(page.value.cursor.value.through == 0)
    }

    fn serve(&self, stream: &mut TcpStream, scope: &impl Serialize) -> Result<bool, String> {
        let request: Signed<Pull> = frame::receive(stream, &self.key)?;
        let (page, cursor, expected) = {
            let db = self.local.database(self.peer)?;
            verify(&db, self.peer, "pull", scope, &request)?;
            let cursor_scope = (
                &self.local.context.workspace_id,
                &self.local.context.user_id,
                self.peer,
            );
            let previous = request
                .value
                .cursor
                .as_ref()
                .filter(|cursor| {
                    self.issued_cursor(&db, &cursor_scope, cursor)
                        .unwrap_or(false)
                })
                .map(|cursor| &cursor.value);
            let page = db.lan_page(self.peer, previous, request.value.features)?;
            let expected = Access {
                generation: page.cursor.access_revision,
                features: page.cursor.features,
            };
            let signed = sign(&db, "cursor", &cursor_scope, page.cursor.clone())?;
            (
                page,
                SignedCursor {
                    value: signed.value,
                    signature: signed.signature,
                },
                expected,
            )
        };
        let count = page.operations.len();
        let finished = page.finished;
        let (mut body, bytes, digest) = page_body(page.operations)?;
        let header = {
            let db = self.local.database(self.peer)?;
            if access(&db)? != expected {
                return Err("LAN sync access changed".into());
            }
            sign(
                &db,
                "page",
                scope,
                Page {
                    cursor,
                    operations: count,
                    bytes,
                    digest,
                },
            )?
        };
        frame::send(stream, &header, &self.key)?;
        let mut remaining = bytes;
        let mut buffer = vec![0; remaining.min(FRAGMENT_BYTES as u64) as usize];
        while remaining != 0 {
            self.local.check_access(self.peer, expected)?;
            let length = remaining.min(FRAGMENT_BYTES as u64) as usize;
            body.read_exact(&mut buffer[..length])
                .map_err(|error| error.to_string())?;
            frame::send_bytes(stream, frame::SYNC_DATA, &buffer[..length], &self.key)?;
            remaining -= length as u64;
        }
        let ack: Signed<String> = frame::receive_with_timeout(stream, &self.key, PAGE_PROCESSING_TIMEOUT)
            .map_err(|error| format!("LAN sync page acknowledgement: {error}"))?;
        let db = self.local.database(self.peer)?;
        verify(&db, self.peer, "ack", scope, &ack)?;
        if ack.value != header.signature || access(&db)? != expected {
            return Err("LAN sync acknowledgement no longer matches the page".into());
        }
        Ok(finished)
    }

    fn issued_cursor(
        &self,
        db: &Database,
        scope: &impl Serialize,
        cursor: &SignedCursor,
    ) -> Result<bool, String> {
        let (public, _) = db.device_public_keys()?;
        let body = signature_body("cursor", scope, &cursor.value)?;
        Ok(valid_cursor(&cursor.value)
            && crate::workspace_membership::verify(&public, &body, &cursor.signature).is_ok())
    }

    fn receive_body(
        &self,
        stream: &mut TcpStream,
        page: &Page,
        expected: Access,
    ) -> Result<Vec<SyncOperation>, String> {
        validate_body_size(page.operations, page.bytes)?;
        let mut hash = Sha256::new();
        let mut remaining = page.bytes;
        let mut body = spooled_tempfile(PAGE_BYTES);
        while remaining != 0 {
            self.local.check_access(self.peer, expected)?;
            let fragment = frame::receive_bytes(stream, frame::SYNC_DATA, &self.key)?;
            if fragment.len() as u64 != remaining.min(FRAGMENT_BYTES as u64) {
                return Err("invalid LAN sync fragment length".into());
            }
            hash.update(&fragment);
            body.write_all(&fragment)
                .map_err(|error| error.to_string())?;
            remaining -= fragment.len() as u64;
        }
        if <[u8; 32]>::from(hash.finalize()) != page.digest {
            return Err("invalid LAN sync page digest".into());
        }
        if page.operations == 0 {
            return Ok(Vec::new());
        }
        body.seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        let reader = BufReader::new(body);
        if page.operations == 1 {
            let operation = serde_json::from_reader(reader).map_err(|error| error.to_string())?;
            return Ok(vec![operation]);
        }
        let operations: Vec<SyncOperation> =
            serde_json::from_reader(reader).map_err(|error| error.to_string())?;
        if operations.len() != page.operations {
            return Err("invalid LAN sync operation count".into());
        }
        Ok(operations)
    }
}

fn validate_body_size(count: usize, bytes: u64) -> Result<(), String> {
    let valid = match count {
        0 => bytes == 0,
        1 => (1..=MAX_RECORD_BYTES).contains(&bytes),
        2..=PAGE_OPERATIONS => (1..=PAGE_BYTES as u64).contains(&bytes),
        _ => false,
    };
    if !valid {
        return Err("invalid LAN sync body size".into());
    }
    Ok(())
}

fn page_body(operations: Vec<SyncOperation>) -> Result<(SpooledTempFile, u64, [u8; 32]), String> {
    let mut body = spooled_tempfile(PAGE_BYTES);
    let count = operations.len();
    match operations.as_slice() {
        [] => {}
        [operation] => {
            serde_json::to_writer(&mut body, operation).map_err(|error| error.to_string())?
        }
        operations => {
            serde_json::to_writer(&mut body, operations).map_err(|error| error.to_string())?
        }
    }
    drop(operations);
    let bytes = body.stream_position().map_err(|error| error.to_string())?;
    validate_body_size(count, bytes)?;
    body.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    std::io::copy(&mut body, &mut hash).map_err(|error| error.to_string())?;
    body.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    Ok((body, bytes, hash.finalize().into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lan_sync::PAGE_BYTES;
    use serde_json::json;
    use std::net::TcpListener;
    use std::path::Path;

    fn database(user_id: &str) -> Database {
        let db = Database::open(Path::new(":memory:")).unwrap();
        let mut user = db.users().unwrap().remove(0);
        user.id = user_id.into();
        user.username = user_id.into();
        user.device_id = user_id.into();
        db.upsert_user(&user).unwrap();
        db.set_current_user(user_id).unwrap();
        db.install_workspace_membership().unwrap();
        let workspace = db.create_workspace(user_id, None, None, user_id).unwrap();
        db.switch_workspace(&workspace.id, user_id).unwrap();
        db
    }

    fn peers() -> (Database, Database) {
        let alice = database("alice");
        let bob = database("bob");
        for (local, remote) in [(&alice, &bob), (&bob, &alice)] {
            let id = remote.current_user_id().unwrap();
            let user = remote
                .users()
                .unwrap()
                .into_iter()
                .find(|user| user.id == id)
                .unwrap();
            let (signing, encryption) = remote.device_public_keys().unwrap();
            local.upsert_user(&user).unwrap();
            local
                .remember_device_keys(&id, &signing, &encryption)
                .unwrap();
        }
        alice
            .review_workspace_membership("bob", true, Some("member"), "alice")
            .unwrap();
        let packet = alice.membership_packets_for("bob").unwrap().remove(0);
        let workspace = bob.receive_membership_packet(&packet).unwrap().unwrap();
        bob.switch_workspace(&workspace.id, "bob").unwrap();
        (alice, bob)
    }

    fn shared_task_payload(mut payload: serde_json::Value) -> serde_json::Value {
        let fields = payload.as_object_mut().unwrap();
        fields.entry("description").or_insert_with(|| json!(""));
        fields.insert("priority".into(), json!("P3"));
        fields.insert("isShared".into(), json!(true));
        fields.insert("sharedWith".into(), json!([]));
        fields.insert("subtasks".into(), json!([]));
        fields.insert("tags".into(), json!([]));
        payload
    }

    fn endpoint<'a>(
        db: &'a Mutex<Database>,
        stopped: &'a AtomicBool,
        workspace_key: &'a [u8; 32],
    ) -> Endpoint<'a> {
        let context = db.lock().unwrap().workspace_context().unwrap();
        Endpoint {
            db,
            stopped,
            workspace_key,
            context,
        }
    }

    fn loopback(alice: &Mutex<Database>, bob: &Mutex<Database>) -> (usize, usize) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let cancelled = AtomicBool::new(false);
        let key =
            super::super::derive_workspace_key(&alice.lock().unwrap().workspace_token().unwrap());
        let left = endpoint(alice, &cancelled, &key);
        let right = endpoint(bob, &cancelled, &key);
        let a_count = std::cell::Cell::new(0);
        let b_count = std::thread::scope(|scope| {
            let receiver = scope.spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let WireMessage::SyncHello { hello } = frame::receive(&mut stream, &key).unwrap()
                else {
                    panic!("expected LAN sync hello");
                };
                let count = std::cell::Cell::new(0);
                respond(stream, &right, hello, |ops| {
                    count.set(count.get() + ops.len())
                })
                .unwrap();
                count.get()
            });
            initiate(TcpStream::connect(address).unwrap(), &left, "bob", |ops| {
                a_count.set(a_count.get() + ops.len())
            })
            .unwrap();
            receiver.join().unwrap()
        });
        (a_count.get(), b_count)
    }

    #[test]
    fn loopback_sync_pages_fragments_and_delivers_late_operations() {
        let (alice, bob) = peers();
        let project = alice
            .create_project(json!({"name":"Shared project","members":["bob"]}), "alice")
            .unwrap();
        let tasks = PAGE_OPERATIONS + 4;
        let large_body = "x".repeat(PAGE_BYTES * 2 + 100);
        for index in 0..tasks {
            let body = if index == tasks - 1 { &large_body } else { "" };
            alice
                .create_task(
                    shared_task_payload(json!({
                        "title":format!("Task {index}"),"description":body,
                        "projectId":project.id
                    })),
                    "alice",
                )
                .unwrap();
        }
        let alice = Mutex::new(alice);
        let bob = Mutex::new(bob);
        assert!(loopback(&alice, &bob).1 >= tasks);
        let received = bob.lock().unwrap().tasks(Some("bob")).unwrap();
        assert_eq!(received.len(), tasks);
        assert!(received.iter().any(|task| task.description == large_body));
        assert_eq!(loopback(&alice, &bob), (0, 0));

        let late = {
            let db = bob.lock().unwrap();
            let task = db
                .create_task(
                    shared_task_payload(json!({"title":"Late task","projectId":project.id})),
                    "bob",
                )
                .unwrap();
            let mut op = db
                .sync_operations(0)
                .unwrap()
                .0
                .into_iter()
                .find(|op| op.entity_id == task.id)
                .unwrap();
            db.conn
                .execute("UPDATE sync_operations SET version=1 WHERE id=?", [&op.id])
                .unwrap();
            op.version = 1;
            op
        };
        assert!(loopback(&alice, &bob).0 > 0);
        let db = alice.lock().unwrap();
        assert!(db
            .tasks(Some("alice"))
            .unwrap()
            .iter()
            .any(|task| task.id == late.entity_id));
    }

    #[test]
    fn loopback_replays_a_private_project_after_permission_changes() {
        let (alice, bob) = peers();
        let project = alice
            .create_project(
                json!({"name":"Private project","visibility":"private"}),
                "alice",
            )
            .unwrap();
        let task = alice
            .create_task(
                shared_task_payload(json!({"title":"Previously private","projectId":project.id})),
                "alice",
            )
            .unwrap();
        let alice = Mutex::new(alice);
        let bob = Mutex::new(bob);
        loopback(&alice, &bob);
        assert!(bob.lock().unwrap().tasks(None).unwrap().is_empty());
        let cursor = bob
            .lock()
            .unwrap()
            .lan_cursor("bob", "alice")
            .unwrap()
            .unwrap();
        assert!(cursor.value.after > 0);
        let prior_revision = alice.lock().unwrap().lan_access_revision().unwrap();
        alice
            .lock()
            .unwrap()
            .update_project(&project.id, json!({"members":["alice","bob"]}), "alice")
            .unwrap();
        assert!(alice.lock().unwrap().lan_access_revision().unwrap() > prior_revision);
        assert!(loopback(&alice, &bob).1 > 0);
        assert_eq!(
            bob.lock().unwrap().tasks(Some("bob")).unwrap()[0].id,
            task.id
        );
        assert_eq!(loopback(&alice, &bob), (0, 0));
    }

    #[test]
    fn committed_page_survives_a_lost_acknowledgement() {
        let (alice, bob) = peers();
        alice
            .create_task(shared_task_payload(json!({"title":"Committed once"})), "alice")
            .unwrap();
        let alice = Mutex::new(alice);
        let bob = Mutex::new(bob);
        let stopped = AtomicBool::new(false);
        let key =
            super::super::derive_workspace_key(&alice.lock().unwrap().workspace_token().unwrap());
        let left = endpoint(&alice, &stopped, &key);
        let right = endpoint(&bob, &stopped, &key);
        let transcript = || Transcript {
            hello: Hello {
                workspace_id: left.context.workspace_id.clone(),
                initiator: "alice".into(),
                responder: "bob".into(),
                nonce: Uuid::nil(),
            },
            challenge: Uuid::nil(),
        };
        let sender = Session {
            local: &left,
            peer: "bob",
            transcript: transcript(),
            key,
        };
        let receiver = Session {
            local: &right,
            peer: "alice",
            transcript: transcript(),
            key,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::scope(|threads| {
            let sending = threads.spawn(|| {
                let (mut stream, _) = listener.accept().unwrap();
                assert!(sender.serve(&mut stream, &0).is_err());
            });
            let mut stream = TcpStream::connect(address).unwrap();
            let (request, expected) = {
                let db = right.database("alice").unwrap();
                let expected = access(&db).unwrap();
                let request = sign(
                    &db,
                    "pull",
                    &0,
                    Pull {
                        cursor: None,
                        features: expected.features,
                    },
                )
                .unwrap();
                (request, expected)
            };
            frame::send(&mut stream, &request, &key).unwrap();
            let page: Signed<Page> = frame::receive(&mut stream, &key).unwrap();
            let operations = receiver
                .receive_body(&mut stream, &page.value, expected)
                .unwrap();
            right
                .database("alice")
                .unwrap()
                .accept_lan_page("bob", "alice", &page.value.cursor, operations)
                .unwrap();
            drop(stream);
            sending.join().unwrap();
        });
        assert_eq!(bob.lock().unwrap().tasks(Some("bob")).unwrap().len(), 1);
        assert_eq!(loopback(&alice, &bob).1, 0);
        let db = bob.lock().unwrap();
        assert_eq!(db.tasks(Some("bob")).unwrap().len(), 1);
        assert!(db.lan_cursor("bob", "alice").unwrap().is_some());
    }

    #[test]
    fn a_disabled_receiver_replays_wiki_content_after_it_is_enabled() {
        let (alice, bob) = peers();
        bob.set_feature_enabled("wiki", false).unwrap();
        let saved = alice
            .write_wiki_page(
                &json!({"id":"lan-runbook","title":"Runbook","content":"Check the package"}),
                None,
                "alice",
            )
            .unwrap();
        let alice = Mutex::new(alice);
        let bob = Mutex::new(bob);
        loopback(&alice, &bob);
        assert!(bob.lock().unwrap().wiki_page("lan-runbook", "bob").is_err());
        bob.lock()
            .unwrap()
            .set_feature_enabled("wiki", true)
            .unwrap();
        loopback(&alice, &bob);
        assert_eq!(
            bob.lock().unwrap().wiki_page("lan-runbook", "bob").unwrap()["content"],
            saved["content"]
        );
        alice
            .lock()
            .unwrap()
            .save_wiki_changes(
                &json!({
                    "changes":[],
                    "deletions":[{"id":"lan-runbook","expectedVersion":saved["version"]}]
                }),
                "alice",
            )
            .unwrap();
        loopback(&alice, &bob);
        assert!(bob.lock().unwrap().wiki_page("lan-runbook", "bob").is_err());
    }

    #[test]
    fn an_update_waits_for_its_create_operation() {
        let (alice, bob) = peers();
        let task = alice
            .create_task(shared_task_payload(json!({"title":"Before"})), "alice")
            .unwrap();
        alice
            .update_task(&task.id, json!({"title":"After"}), "alice")
            .unwrap();
        let mut records = alice
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .filter(|op| op.entity_id == task.id);
        let create = records.next().unwrap();
        let update = records.next().unwrap();
        assert_eq!(create.action, "create");
        assert_eq!(update.action, "update");
        let mut cursor = SignedCursor {
            value: FeedCursor {
                log_id: "test-feed".into(),
                after: 1,
                through: 2,
                access_revision: 0,
                features: alice.lan_features().unwrap(),
                receiver_features: bob.lan_features().unwrap(),
            },
            signature: "transport verified".into(),
        };
        assert!(bob
            .accept_lan_page("bob", "alice", &cursor, vec![update])
            .unwrap()
            .is_empty());
        cursor.value.after = 2;
        cursor.value.through = 0;
        assert_eq!(
            bob.accept_lan_page("bob", "alice", &cursor, vec![create])
                .unwrap()
                .len(),
            2
        );
        assert_eq!(bob.tasks(Some("bob")).unwrap()[0].title, "After");
    }

    #[test]
    fn recycle_projection_merges_later_items_and_reenters_the_feed() {
        let (alice, bob) = peers();
        let parent = alice
            .create_task(shared_task_payload(json!({"title":"Parent"})), "alice")
            .unwrap();
        let child = alice
            .create_task(
                shared_task_payload(json!({"title":"Child","parentTaskId":parent.id})),
                "alice",
            )
            .unwrap();
        alice.trash_task(&parent.id, "alice", true, None).unwrap();
        let full = alice
            .sync_operations(0)
            .unwrap()
            .0
            .into_iter()
            .find(|op| op.entity_id == parent.id && op.action == "trash")
            .unwrap();
        assert_eq!(full.payload["items"].as_array().unwrap().len(), 2);
        let mut partial = full.clone();
        partial.payload["items"]
            .as_array_mut()
            .unwrap()
            .retain(|item| item["task"]["id"] == parent.id);
        let signed = SignedCursor {
            value: alice
                .lan_page("bob", None, bob.lan_features().unwrap())
                .unwrap()
                .cursor,
            signature: "transport verified".into(),
        };
        assert_eq!(
            bob.accept_lan_page("bob", "alice", &signed, vec![partial])
                .unwrap()
                .len(),
            1
        );
        let first = bob
            .lan_page("alice", None, alice.lan_features().unwrap())
            .unwrap();
        assert_eq!(
            bob.accept_lan_page("bob", "alice", &signed, vec![full.clone()])
                .unwrap()
                .len(),
            1
        );
        assert!(bob
            .accept_lan_page("bob", "alice", &signed, vec![full.clone()])
            .unwrap()
            .is_empty());
        let relay = bob
            .lan_page("alice", Some(&first.cursor), alice.lan_features().unwrap())
            .unwrap();
        let projected = relay.operations.iter().find(|op| op.id == full.id).unwrap();
        let items = projected.payload["items"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert!(items.iter().any(|item| item["task"]["id"] == child.id));
    }
}
