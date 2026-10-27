use super::*;
use serde_json::json;
use std::path::Path;

fn database() -> Database { Database::open(Path::new(":memory:")).unwrap() }

fn task(db: &Database, title: &str) -> crate::models::Task {
    let user = db.current_user_id().unwrap();
    db.create_task(json!({"title":title,"description":"","priority":"P2","status":"todo","dueDate":null,"recurrence":null,"reminderTime":null,"assigneeId":user,"projectId":null,"isShared":false,"sharedWith":[],"subtasks":[],"tags":[]}), &user).unwrap()
}

/// Simulate a peer that joined the owner's workspace and shares its credential.
fn peer(owner: &Database) -> Database {
    let db = database();
    let ws = owner.workspace_record().unwrap();
    let mut identity = db.users().unwrap().remove(0);
    identity.id = format!("member-{}", uuid::Uuid::new_v4());
    db.upsert_user(&identity).unwrap();
    db.set_current_user(&identity.id).unwrap();
    let user = identity.id;
    db.conn.execute("INSERT INTO workspaces(id,name,slug,timezone,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        params![ws.id, ws.name, ws.slug, ws.timezone, ws.owner_id, ws.created_at, ws.updated_at]).unwrap();
    db.conn.execute("INSERT INTO workspace_credentials(workspace_id,token) VALUES(?,?)", params![ws.id, owner.workspace_token().unwrap()]).unwrap();
    db.conn.execute("INSERT INTO workspace_members(workspace_id,user_id,role,status,requested_at) VALUES(?,?,'member','member',?)",
        params![ws.id, user, ws.created_at]).unwrap();
    db.switch_workspace(&ws.id, &user).unwrap();
    db
}

#[test]
fn dissolution_requires_owner_session_and_exact_name_and_preserves_data_on_failure() {
    let db = database();
    let ws = db.workspace_record().unwrap();
    let user = db.current_user_id().unwrap();
    task(&db, "Must survive");
    let context = db.workspace_context().unwrap();
    assert!(db.dissolve_workspace(&ws.id, "other-user", &ws.name).is_err());
    assert!(db.dissolve_workspace(&ws.id, &user, "wrong name").is_err());
    let member = peer(&db);
    let member_id = member.current_user_id().unwrap();
    assert!(member.dissolve_workspace(&ws.id, &member_id, &ws.name).is_err());
    member.conn.execute("UPDATE workspace_members SET role='admin' WHERE workspace_id=? AND user_id=?", params![ws.id, member_id]).unwrap();
    assert!(member.dissolve_workspace(&ws.id, &member_id, &ws.name).is_err());
    assert_eq!(db.workspace_context().unwrap(), context);
    assert_eq!(db.tasks(None).unwrap().len(), 1);
    assert!(db.dissolution_packets().unwrap().is_empty());
}

#[test]
fn dissolving_last_workspace_creates_personal_fallback_and_keeps_tombstone_after_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.sqlite");
    let db = Database::open(&path).unwrap();
    let ws = db.workspace_record().unwrap();
    let user = db.current_user_id().unwrap();
    let before = db.workspace_context().unwrap();
    task(&db, "Removed");
    db.save_private_data("wiki", &json!({"documents":[]})).unwrap();
    assert!(db.dissolve_workspace(&ws.id, &user, &ws.name).unwrap());
    assert_ne!(db.workspace_context().unwrap().workspace_id, ws.id);
    assert!(db.validate_workspace_context(&before).is_err());
    assert_eq!(db.list_workspaces().unwrap().len(), 1);
    assert!(db.tasks(None).unwrap().is_empty());
    assert!(db.switch_workspace(&ws.id, &user).is_err());
    assert_eq!(db.dissolution_packets().unwrap().len(), 1);
    let fallback = db.workspace_context().unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    assert_eq!(db.workspace_context().unwrap(), fallback);
    assert!(db.workspace_is_dissolved(&ws.id).unwrap());
    assert_eq!(db.dissolution_packets().unwrap().len(), 1);
}

#[test]
fn offline_peer_accepts_relay_after_owner_switches_and_old_operations_cannot_revive_workspace() {
    let owner = database();
    let ws = owner.workspace_record().unwrap();
    let user = owner.current_user_id().unwrap();
    task(&owner, "Owner data");
    let operations = owner.sync_operations(0).unwrap().0;
    let online = peer(&owner);
    let offline = peer(&owner);
    task(&online, "Member data");
    owner.dissolve_workspace(&ws.id, &user, &ws.name).unwrap();
    let packet = owner.dissolution_packets().unwrap().remove(0);
    let public_packet = serde_json::to_string(&packet).unwrap();
    assert!(!public_packet.contains(&user));
    assert!(!public_packet.contains("Owner data"));
    assert!(online.apply_workspace_dissolution(&packet).unwrap());
    assert!(!online.apply_workspace_dissolution(&packet).unwrap());
    // The owner no longer needs to be online: a previous recipient relays it.
    let relayed = online.dissolution_packets().unwrap().remove(0);
    assert!(offline.apply_workspace_dissolution(&relayed).unwrap());
    for operation in operations { assert!(offline.apply_operation(&operation).is_err()); }
    assert!(offline.workspace_is_dissolved(&ws.id).unwrap());
    assert!(!offline.list_workspaces().unwrap().iter().any(|w| w.id == ws.id));
    assert!(online.tasks(None).unwrap().is_empty());
}

#[test]
fn inactive_workspace_dissolution_purges_only_target_and_rejects_tampering_wrong_keys_and_owner() {
    let db = database();
    let ws = db.workspace_record().unwrap();
    let user = db.current_user_id().unwrap();
    let token = db.workspace_token().unwrap();
    task(&db, "A removed");
    db.save_private_data("wiki", &json!({"documents":[]})).unwrap();
    let b = db.create_workspace("B", None, None, &user).unwrap();
    db.switch_workspace(&b.id, &user).unwrap();
    let kept = task(&db, "B survives");
    let context = db.workspace_context().unwrap();
    let notice = |owner: &str| DissolutionNotice { workspace_id: ws.id.clone(), owner_id: owner.into(), dissolved_at: chrono::Utc::now().to_rfc3339() };
    let wrong_key = DissolutionPacket::seal(&notice(&user), "wrong token").unwrap();
    assert!(db.apply_workspace_dissolution(&wrong_key).is_err());
    let wrong_owner = DissolutionPacket::seal(&notice("member"), &token).unwrap();
    assert!(db.apply_workspace_dissolution(&wrong_owner).is_err());
    let valid = DissolutionPacket::seal(&notice(&user), &token).unwrap();
    let mut corrupt = valid.clone();
    corrupt.nonce = STANDARD.encode([0u8; 12]);
    assert!(db.apply_workspace_dissolution(&corrupt).is_err());
    let mut cross_workspace = valid.clone();
    cross_workspace.workspace_id = b.id.clone();
    assert!(db.apply_workspace_dissolution(&cross_workspace).is_err());
    assert!(db.dissolution_packets().unwrap().is_empty());
    assert!(db.apply_workspace_dissolution(&valid).unwrap());
    assert_eq!(db.workspace_context().unwrap(), context);
    assert_eq!(db.tasks(None).unwrap()[0].id, kept.id);
    for table in crate::workspace_scope::TABLES.iter().copied().chain(["workspace_private_data", "workspace_credentials", "workspace_members", "wiki_documents"]) {
        let count: i64 = db.conn.query_row(&format!("SELECT COUNT(*) FROM {table} WHERE workspace_id=?"), params![ws.id], |r| r.get(0)).unwrap();
        assert_eq!(count, 0, "{table} still contains dissolved data");
    }
}

#[test]
fn dissolution_rolls_back_tombstone_fallback_and_context_when_cleanup_fails() {
    let db = database();
    let ws = db.workspace_record().unwrap();
    let user = db.current_user_id().unwrap();
    let before = db.workspace_context().unwrap();
    task(&db, "Keep on failure");
    db.conn.execute_batch("CREATE TRIGGER fail_dissolution BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT, 'disk failure'); END;").unwrap();
    assert!(db.dissolve_workspace(&ws.id, &user, &ws.name).is_err());
    assert_eq!(db.workspace_context().unwrap(), before);
    assert_eq!(db.list_workspaces().unwrap().len(), 1);
    assert_eq!(db.tasks(None).unwrap().len(), 1);
    assert!(db.dissolution_packets().unwrap().is_empty());
}
