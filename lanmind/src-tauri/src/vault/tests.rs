use super::*;
use serde_json::{json, Value};
use std::path::Path;
use std::time::{Duration, Instant};
const MASTER: &str = "a long vault master password";
fn runtime() -> (tempfile::TempDir, Runtime, u64) {
    let dir = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(dir.path().join("vault.sqlite"));
    let version = runtime.create(MASTER).unwrap()["sessionVersion"]
        .as_u64()
        .unwrap();
    (dir, runtime, version)
}
fn save(runtime: &Runtime, version: u64) -> Value {
    runtime.execute("save",json!({"entry":{"name":"Disk canary title","username":"canary-user","password":"canary-password-very-secret","notes":"searchable private notes","urls":["https://example.com"]}}),version).unwrap()
}

#[test]
fn encrypted_persistence_redacted_lists_and_wrong_password() {
    let (dir, runtime, v) = runtime();
    let item = save(&runtime, v);
    let list = runtime.execute("list", json!({}), v).unwrap();
    assert!(list["entries"][0].get("password").is_none());
    assert!(list["entries"][0].get("notes").is_none());
    for entry in std::fs::read_dir(dir.path()).unwrap() {
        let bytes = std::fs::read(entry.unwrap().path()).unwrap();
        let raw = String::from_utf8_lossy(&bytes);
        for secret in [
            "Disk canary title",
            "canary-user",
            "canary-password-very-secret",
            "searchable private notes",
            MASTER,
        ] {
            assert!(!raw.contains(secret));
        }
    }
    runtime.lock();
    assert_eq!(
        runtime
            .execute("get", json!({"id":item["id"]}), v)
            .unwrap_err(),
        "VAULT_LOCKED"
    );
    let reopened = Runtime::new(dir.path().join("vault.sqlite"));
    assert!(reopened.status().unwrap()["locked"].as_bool().unwrap());
    assert_eq!(
        reopened.unlock("wrong password").unwrap_err(),
        "VAULT_PASSWORD"
    );
    reopened.inner.lock().unwrap().retry_at = None;
    let v = reopened.unlock(MASTER).unwrap()["sessionVersion"]
        .as_u64()
        .unwrap();
    assert_eq!(
        reopened
            .execute("get", json!({"id":item["id"]}), v)
            .unwrap()["password"],
        "canary-password-very-secret"
    );
}
#[test]
fn changing_password_rewraps_without_losing_entries_and_stale_edits_fail() {
    let (_dir, runtime, v) = runtime();
    let item = save(&runtime, v);
    let mut entry = runtime.execute("get", json!({"id":item["id"]}), v).unwrap();
    let stale = entry.clone();
    entry["name"] = json!("Updated");
    runtime.execute("save", json!({"entry":entry}), v).unwrap();
    assert_eq!(
        runtime
            .execute("save", json!({"entry":stale}), v)
            .unwrap_err(),
        "VAULT_CONFLICT"
    );
    runtime
        .execute(
            "changePassword",
            json!({"currentPassword":MASTER,"password":"my new master password"}),
            v,
        )
        .unwrap();
    runtime.lock();
    assert_eq!(runtime.unlock(MASTER).unwrap_err(), "VAULT_PASSWORD");
    runtime.inner.lock().unwrap().retry_at = None;
    let v = runtime.unlock("my new master password").unwrap()["sessionVersion"]
        .as_u64()
        .unwrap();
    assert_eq!(
        runtime.execute("list", json!({}), v).unwrap()["entries"][0]["name"],
        "Updated"
    );
}
#[test]
fn tampered_data_and_headers_are_rejected() {
    let (_dir, runtime, v) = runtime();
    save(&runtime, v);
    let conn = rusqlite::Connection::open(&runtime.path).unwrap();
    conn.execute("UPDATE vault_data SET ciphertext='AAAA'", [])
        .unwrap();
    assert_eq!(
        runtime.execute("list", json!({}), v).unwrap_err(),
        "VAULT_CORRUPT"
    );
    let mut header = storage::header(&conn).unwrap();
    header.memory_kib = u32::MAX;
    assert_eq!(crypto::unwrap(MASTER, &header).unwrap_err(), "VAULT_FORMAT");
}
#[test]
fn inactivity_sleep_and_workspace_changes_invalidate_sessions() {
    let (_dir, runtime, v) = runtime();
    runtime.tick("workspace-a", false);
    {
        let mut s = runtime.inner.lock().unwrap();
        s.last_activity = Instant::now() - Duration::from_secs(301);
    }
    assert!(runtime.tick("workspace-a", false));
    assert!(runtime.execute("list", json!({}), v).is_err());
    let v = runtime.unlock(MASTER).unwrap()["sessionVersion"]
        .as_u64()
        .unwrap();
    assert!(runtime.tick("workspace-b", false));
    assert!(runtime.execute("list", json!({}), v).is_err());
    runtime.unlock(MASTER).unwrap();
    runtime.inner.lock().unwrap().last_tick = Instant::now() - Duration::from_secs(20);
    assert!(runtime.tick("workspace-b", false));
}
#[test]
fn folder_cycles_deletion_and_trash_preserve_expected_records() {
    let (_dir, runtime, v) = runtime();
    let root = runtime
        .execute(
            "saveFolder",
            json!({"folder":{"id":"","name":"Work","parentId":null}}),
            v,
        )
        .unwrap();
    let child = runtime
        .execute(
            "saveFolder",
            json!({"folder":{"id":"","name":"Servers","parentId":root["id"]}}),
            v,
        )
        .unwrap();
    assert_eq!(
        runtime
            .execute(
                "saveFolder",
                json!({"folder":{"id":root["id"],"name":"Work","parentId":child["id"]}}),
                v
            )
            .unwrap_err(),
        "VAULT_FOLDER_CYCLE"
    );
    assert_eq!(
        runtime
            .execute(
                "saveFolder",
                json!({"folder":{"id":"","name":"work","parentId":null}}),
                v
            )
            .unwrap_err(),
        "VAULT_FOLDER_EXISTS"
    );
    let item = runtime
        .execute(
            "save",
            json!({"entry":{"name":"Folder item","folderId":child["id"],"password":"keep me"}}),
            v,
        )
        .unwrap();
    runtime
        .execute(
            "deleteFolder",
            json!({"id":root["id"],"deleteEntries":false}),
            v,
        )
        .unwrap();
    let entry = runtime.execute("get", json!({"id":item["id"]}), v).unwrap();
    assert!(entry["folderId"].is_null());
    assert_eq!(entry["password"], "keep me");
    runtime
        .execute(
            "delete",
            json!({"id":entry["id"],"revision":entry["revision"]}),
            v,
        )
        .unwrap();
    let deleted = runtime.execute("get", json!({"id":item["id"]}), v).unwrap();
    assert!(deleted["deletedAt"].is_string());
    runtime
        .execute(
            "restore",
            json!({"id":deleted["id"],"revision":deleted["revision"]}),
            v,
        )
        .unwrap();
    assert_eq!(
        runtime
            .execute("search", json!({"query":"Folder"}), v)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn password_generator_obeys_classes_and_rejects_impossible_policies() {
    let policy = model::PasswordPolicy::default();
    let mut generated = std::collections::HashSet::new();
    for _ in 0..200 {
        let value = generator::generate(&policy).unwrap();
        assert_eq!(value.len(), 20);
        assert!(value.chars().any(|c| c.is_ascii_uppercase()));
        assert!(value.chars().any(|c| c.is_ascii_lowercase()));
        assert!(value.chars().any(|c| c.is_ascii_digit()));
        assert!(value.chars().any(|c| policy.symbol_chars.contains(c)));
        assert!(!value.chars().any(|c| "0Oo1Il".contains(c)));
        generated.insert(value);
    }
    assert_eq!(generated.len(), 200);
    let mut invalid = policy.clone();
    invalid.uppercase = false;
    invalid.lowercase = false;
    invalid.digits = false;
    invalid.symbols = false;
    assert!(generator::generate(&invalid).is_err());
    invalid.symbols = true;
    invalid.symbol_chars = String::new();
    assert!(generator::generate(&invalid).is_err());
}
#[test]
fn ssh_keys_validate_encrypted_private_keys_and_detect_mismatch() {
    let generated = ssh::generate("private key passphrase").unwrap();
    let mut entry:model::Entry=serde_json::from_value(json!({"kind":"ssh","name":"Test","privateKey":generated["privateKey"],"publicKey":generated["publicKey"],"keyPassphrase":"private key passphrase"})).unwrap();
    ssh::validate(&mut entry).unwrap();
    assert_eq!(entry.fingerprint, generated["fingerprint"]);
    entry.key_passphrase = "wrong".into();
    assert_eq!(ssh::validate(&mut entry).unwrap_err(), "VAULT_SSH_PASSWORD");
    entry.key_passphrase = "private key passphrase".into();
    entry.public_key = ssh::generate("").unwrap()["publicKey"]
        .as_str()
        .unwrap()
        .into();
    assert_eq!(ssh::validate(&mut entry).unwrap_err(), "VAULT_SSH_MISMATCH");
}
#[test]
fn encrypted_backup_roundtrip_and_file_change_detection() {
    let (dir, source, v) = runtime();
    save(&source, v);
    let path = dir.path().join("backup.lmvault");
    source
        .export(
            json!({"path":path,"format":"encrypted","password":"backup password independent"}),
            v,
        )
        .unwrap();
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains("canary-password"));
    let (_other, target, tv) = runtime();
    let mut payload = json!({"path":path,"format":"encrypted","password":"backup password independent","skipDuplicates":true});
    let preview = target.import(payload.clone(), tv, false).unwrap();
    payload["fileHash"] = preview["fileHash"].clone();
    assert_eq!(
        target.import(payload.clone(), tv, true).unwrap()["added"],
        1
    );
    assert_eq!(
        target.import(payload.clone(), tv, true).unwrap()["added"],
        0
    );
    std::fs::write(&path, "modified").unwrap();
    assert_eq!(
        target.import(payload, tv, true).unwrap_err(),
        "VAULT_IMPORT_CHANGED"
    );
    assert_eq!(
        target.execute("list", json!({}), tv).unwrap()["entries"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn csv_and_bitwarden_support_quoted_secrets_and_import_rollback() {
    let (dir, source, v) = runtime();
    source.execute("save",json!({"entry":{"name":"Comma, quote \" and newline\n","username":"user,1","password":"secret,\"\ntext"}}),v).unwrap();
    for format in ["csv", "bitwarden"] {
        let path = dir.path().join(format!("export.{format}"));
        source
            .export(
                json!({"path":path,"format":format,"currentPassword":MASTER}),
                v,
            )
            .unwrap();
        let (_other, target, tv) = runtime();
        let mut payload = json!({"path":path,"format":format});
        let preview = target.import(payload.clone(), tv, false).unwrap();
        payload["fileHash"] = preview["fileHash"].clone();
        assert_eq!(target.import(payload, tv, true).unwrap()["added"], 1);
        let list = target.execute("list", json!({}), tv).unwrap();
        assert_eq!(
            target
                .execute("get", json!({"id":list["entries"][0]["id"]}), tv)
                .unwrap()["password"],
            "secret,\"\ntext"
        );
    }
    let bad = dir.path().join("invalid.json");
    std::fs::write(
        &bad,
        r#"{"encrypted":false,"folders":[{"id":"a","name":"X"},{"id":"a","name":"Y"}],"items":[]}"#,
    )
    .unwrap();
    assert!(source
        .import(json!({"path":bad,"format":"bitwarden"}), v, false)
        .is_err());
    assert_eq!(
        source.execute("list", json!({}), v).unwrap()["entries"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
fn peer(owner: &crate::db::Database) -> crate::db::Database {
    let db = crate::db::Database::open(Path::new(":memory:")).unwrap();
    let mut user = db.users().unwrap().remove(0);
    user.id = format!("member-{}", uuid::Uuid::new_v4());
    db.upsert_user(&user).unwrap();
    db.set_current_user(&user.id).unwrap();
    db.install_workspace_membership().unwrap();
    let ws = owner.workspace_record().unwrap();
    db.conn
        .execute(
            "INSERT OR IGNORE INTO workspaces VALUES(?,?,?,?,?,?,?,?,?)",
            rusqlite::params![
                ws.id,
                ws.name,
                ws.slug,
                ws.logo,
                ws.description,
                ws.timezone,
                ws.owner_id,
                ws.created_at,
                ws.updated_at
            ],
        )
        .unwrap();
    for database in [&db, owner] {
        for id in [&user.id, &owner.current_user_id().unwrap()] {
            database.conn.execute("INSERT OR REPLACE INTO workspace_members VALUES(?,?,'member','member',?,NULL,NULL)",rusqlite::params![ws.id,id,model::now()]).unwrap();
        }
    }
    db.switch_workspace(&ws.id, &user.id).unwrap();
    let keys = owner.device_public_keys().unwrap();
    db.remember_device_keys(&owner.current_user_id().unwrap(), &keys.0, &keys.1)
        .unwrap();
    let keys = db.device_public_keys().unwrap();
    owner
        .remember_device_keys(&user.id, &keys.0, &keys.1)
        .unwrap();
    db
}
#[test]
fn shares_are_recipient_encrypted_signed_and_idempotently_imported() {
    let owner = crate::db::Database::open(Path::new(":memory:")).unwrap();
    let recipient = peer(&owner);
    let (_ad, a, av) = runtime();
    let (_bd, b, bv) = runtime();
    let (_cd, wrong, _cv) = runtime();
    let item = save(&a, av);
    b.publish_key(bv, &recipient).unwrap();
    let info = b.public_info().unwrap();
    sharing::verify_public(&owner, &info).unwrap();
    let mut message=a.share(json!({"id":item["id"],"recipient":info,"userId":info.user_id,"verifiedFingerprint":info.fingerprint,"includePassword":true}),av,&owner).unwrap();
    message["senderName"] = json!("Sender");
    assert!(!message["content"]
        .as_str()
        .unwrap()
        .contains("canary-password"));
    let saved = recipient.save_chat_message(message.clone()).unwrap();
    let payload = json!({"messageId":saved.id});
    assert_eq!(
        b.receive(payload.clone(), bv, &recipient, false).unwrap()["password"],
        "canary-password-very-secret"
    );
    assert!(wrong
        .receive(
            payload.clone(),
            wrong.status().unwrap()["sessionVersion"].as_u64().unwrap(),
            &recipient,
            false
        )
        .is_err());
    b.receive(payload.clone(), bv, &recipient, true).unwrap();
    assert_eq!(
        b.receive(payload.clone(), bv, &recipient, true)
            .unwrap_err(),
        "VAULT_SHARE_IMPORTED"
    );
    let mut envelope: Value = serde_json::from_str(message["content"].as_str().unwrap()).unwrap();
    envelope["recipientId"] = json!(owner.current_user_id().unwrap());
    message["content"] = json!(serde_json::to_string(&envelope).unwrap());
    assert!(recipient.save_chat_message(message).is_err());
    b.lock();
    assert_eq!(
        b.receive(payload, bv, &recipient, false).unwrap_err(),
        "VAULT_LOCKED"
    );
}

#[test]
fn destroy_requires_password_and_invalidates_the_old_session() {
    let (_dir, runtime, v) = runtime();
    save(&runtime, v);
    assert_eq!(
        runtime.destroy("incorrect", v).unwrap_err(),
        "VAULT_PASSWORD"
    );
    assert_eq!(
        runtime.execute("list", json!({}), v).unwrap()["entries"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let status = runtime.destroy(MASTER, v).unwrap();
    assert_eq!(status["locked"], true);
    assert_eq!(status["configured"], false);
    assert_eq!(
        runtime.execute("list", json!({}), v).unwrap_err(),
        "VAULT_LOCKED"
    );
    assert!(!runtime.path.exists());
    runtime.create(MASTER).unwrap();
    assert_eq!(
        runtime.execute("list", json!({}), v).unwrap_err(),
        "VAULT_LOCKED"
    );
}

#[test]
fn import_database_failure_rolls_back_the_entire_encrypted_snapshot() {
    let (dir, source, v) = runtime();
    save(&source, v);
    let import_path = dir.path().join("import.csv");
    std::fs::write(
        &import_path,
        "name,username,password,folder\nImported,bob,secret,Imported folder\n",
    )
    .unwrap();
    let mut payload = json!({"path":import_path,"format":"csv"});
    payload["fileHash"] = source.import(payload.clone(), v, false).unwrap()["fileHash"].clone();
    let conn = rusqlite::Connection::open(&source.path).unwrap();
    let before: (u64, String) = conn
        .query_row(
            "SELECT revision,ciphertext FROM metadata,vault_data",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    // Fail after replacement of the ciphertext, while updating its authenticated revision.
    conn.execute_batch("CREATE TRIGGER reject_revision BEFORE UPDATE ON metadata BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert_eq!(
        source.import(payload.clone(), v, true).unwrap_err(),
        "VAULT_STORAGE"
    );
    let after: (u64, String) = conn
        .query_row(
            "SELECT revision,ciphertext FROM metadata,vault_data",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(before, after);
    let list = source.execute("list", json!({}), v).unwrap();
    assert_eq!(list["entries"].as_array().unwrap().len(), 1);
    assert!(list["folders"].as_array().unwrap().is_empty());
    conn.execute_batch("DROP TRIGGER reject_revision").unwrap();
    assert_eq!(source.import(payload, v, true).unwrap()["added"], 1);
}

#[test]
fn shares_minimize_secrets_bind_the_selected_recipient_and_save_atomically() {
    let owner = crate::db::Database::open(Path::new(":memory:")).unwrap();
    let recipient = peer(&owner);
    let (_ad, a, av) = runtime();
    let (_bd, b, bv) = runtime();
    b.publish_key(bv, &recipient).unwrap();
    let info = b.public_info().unwrap();
    let login = save(&a, av);
    let mut payload = json!({"id":login["id"],"recipient":info,"userId":info.user_id,"verifiedFingerprint":info.fingerprint});
    payload["userId"] = json!("another-user");
    assert_eq!(
        a.share(payload.clone(), av, &owner).unwrap_err(),
        "VAULT_RECIPIENT"
    );
    payload["userId"] = json!(info.user_id);
    let mut message = a.share(payload, av, &owner).unwrap();
    message["senderName"] = json!("Sender");
    owner.conn.execute_batch("CREATE TRIGGER reject_proof BEFORE INSERT ON settings WHEN NEW.key LIKE 'vaultVerified:%' BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(owner.save_vault_share(message.clone(), &info).is_err());
    let messages: u64 = owner
        .conn
        .query_row("SELECT COUNT(*) FROM chat_messages", [], |r| r.get(0))
        .unwrap();
    assert_eq!(messages, 0);
    owner
        .conn
        .execute_batch("DROP TRIGGER reject_proof")
        .unwrap();
    owner.save_vault_share(message.clone(), &info).unwrap();
    assert!(owner
        .setting(&format!("vaultVerified:{}", info.user_id))
        .unwrap()
        .is_some());
    let saved = recipient.save_chat_message(message).unwrap();
    let received = b
        .receive(json!({"messageId":saved.id}), bv, &recipient, false)
        .unwrap();
    assert_eq!(received["username"], "canary-user");
    assert_eq!(received["password"], "");
    assert_eq!(received["notes"], "");
    let generated = ssh::generate("").unwrap();
    let ssh = a.execute("save", json!({"entry":{"name":"Server","kind":"ssh","privateKey":generated["privateKey"],"notes":"private notes"}}), av).unwrap();
    let mut message = a.share(json!({"id":ssh["id"],"recipient":info,"userId":info.user_id,"verifiedFingerprint":info.fingerprint,"includePassword":true}), av, &owner).unwrap();
    message["senderName"] = json!("Sender");
    let saved = recipient.save_chat_message(message).unwrap();
    let received = b
        .receive(json!({"messageId":saved.id}), bv, &recipient, false)
        .unwrap();
    assert_eq!(received["publicKey"], generated["publicKey"]);
    assert_eq!(received["fingerprint"], generated["fingerprint"]);
    for field in ["privateKey", "keyPassphrase", "password", "notes"] {
        assert_eq!(received[field], "");
    }
}
