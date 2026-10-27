use super::*;
use std::path::Path;

fn database(identity: &str) -> Database {
    let db = Database::open(Path::new(":memory:")).unwrap();
    let mut user = db.users().unwrap().remove(0);
    user.id = identity.into();
    user.username = identity.into();
    user.device_id = identity.into();
    db.upsert_user(&user).unwrap();
    db.set_current_user(identity).unwrap();
    db.install_workspace_membership().unwrap();
    let own = db.create_workspace(&format!("{identity} personal"), None, None, identity).unwrap();
    db.switch_workspace(&own.id, identity).unwrap();
    db
}

fn discover(a: &Database, b: &Database) {
    let user = b.current_user_id().unwrap();
    let (signing, encryption) = b.device_public_keys().unwrap();
    a.remember_device_keys(&user, &signing, &encryption).unwrap();
    a.upsert_user(&b.users().unwrap().into_iter().find(|u| u.id == user).unwrap()).unwrap();
}

fn pair(a: &Database, b: &Database) { discover(a, b); discover(b, a); }

fn grant(owner: &Database, recipient: &Database, role: &str) -> MembershipPacket {
    pair(owner, recipient);
    owner.review_workspace_membership(&recipient.current_user_id().unwrap(), true, Some(role), &owner.current_user_id().unwrap()).unwrap();
    owner.membership_packets_for(&recipient.current_user_id().unwrap()).unwrap().remove(0)
}

fn delivery(packet: &MembershipPacket, recipient: &Database) -> MemberDelivery {
    let shared = recipient.device_secrets().unwrap().1.diffie_hellman(&PublicKey::from(bytes32(&packet.ephemeral_key).unwrap())).to_bytes();
    let nonce = STANDARD.decode(&packet.nonce).unwrap();
    let ciphertext = STANDARD.decode(&packet.payload).unwrap();
    let aad = format!("{}:{}", packet.sender_id, packet.recipient_id);
    let body = MembershipPacket::cipher(shared).unwrap().decrypt(Nonce::from_slice(&nonce), Payload { msg: &ciphertext, aad: aad.as_bytes() }).unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn seal(body: &MemberDelivery, sender: &Database, recipient: &Database) -> MembershipPacket {
    let secret = StaticSecret::from(random_key());
    let recipient_key = bytes32(&recipient.device_public_keys().unwrap().1).unwrap();
    let shared = secret.diffie_hellman(&PublicKey::from(recipient_key)).to_bytes();
    let nonce = [3; 12];
    let mut packet = MembershipPacket { kind: "workspaceMembership".into(), sender_id: sender.current_user_id().unwrap(), recipient_id: recipient.current_user_id().unwrap(), ephemeral_key: STANDARD.encode(PublicKey::from(&secret).to_bytes()), nonce: STANDARD.encode(nonce), payload: String::new(), signature: String::new() };
    let aad = format!("{}:{}", packet.sender_id, packet.recipient_id);
    packet.payload = STANDARD.encode(MembershipPacket::cipher(shared).unwrap().encrypt(Nonce::from_slice(&nonce), Payload { msg: &serde_json::to_vec(body).unwrap(), aad: aad.as_bytes() }).unwrap());
    packet.signature = sender.sign_device_message(&packet.body().unwrap()).unwrap();
    packet
}

#[test]
fn discovery_and_self_requests_never_enroll_or_escalate_users() {
    let owner = database("owner");
    let outsider = database("outsider");
    pair(&owner, &outsider);
    assert!(owner.request_workspace_membership("outsider", Some("admin")).is_err());
    assert!(owner.require_workspace_member("outsider").is_err());
    assert!(owner.membership_packets_for("outsider").unwrap().is_empty());
    assert!(owner.workspace_member_candidates("owner").unwrap().iter().any(|u| u.id == "outsider"));
    assert!(owner.workspace_member_candidates("outsider").is_err());
    assert!(owner.create_workspace_join_request("Outsider", "outsider").is_err());
    assert!(owner.review_workspace_membership("outsider", true, Some("member"), "outsider").is_err());
    assert!(owner.review_workspace_membership("owner", false, None, "owner").is_err());
    assert!(owner.review_workspace_membership("outsider", true, Some("owner"), "owner").is_err());
    assert!(owner.review_workspace_membership("outsider", true, Some("invalid"), "owner").is_err());
    assert!(owner.review_workspace_membership("unknown", true, Some("member"), "owner").is_err());
    owner.conn.execute("INSERT INTO workspace_members VALUES(?,?,'admin','pending','',NULL,NULL)", params![owner.workspace_context().unwrap().workspace_id,"outsider"]).unwrap();
    assert!(owner.review_workspace_membership("another", true, None, "outsider").is_err());
}

#[test]
fn encrypted_grant_adds_workspace_without_switching_and_is_idempotent() {
    let owner = database("owner");
    let member = database("member");
    let workspace = owner.workspace_record().unwrap();
    let before = member.workspace_context().unwrap();
    let packet = grant(&owner, &member, "member");
    let encoded = serde_json::to_string(&packet).unwrap();
    assert!(!encoded.contains(&owner.workspace_token().unwrap()));
    assert!(!encoded.contains(&workspace.name));
    assert_eq!(member.receive_membership_packet(&packet).unwrap().unwrap().id, workspace.id);
    assert_eq!(member.workspace_context().unwrap(), before);
    assert!(member.list_workspaces().unwrap().iter().any(|w| w.id == workspace.id));
    assert!(member.receive_membership_packet(&packet).unwrap().is_none());
    member.switch_workspace(&workspace.id, "member").unwrap();
    assert_eq!(member.workspace_token().unwrap(), owner.workspace_token().unwrap());
    assert!(member.review_workspace_membership("owner", true, Some("admin"), "member").is_err());
    assert!(member.conn.query_row("SELECT protected_secret FROM workspace_management_keys WHERE workspace_id=?", [&workspace.id], |r| r.get::<_, Option<String>>(0)).unwrap().is_none());
}

#[test]
fn delegated_admin_can_add_a_third_device_without_owner_online() {
    let owner = database("owner");
    let admin = database("admin");
    let third = database("third");
    let packet = grant(&owner, &admin, "admin");
    admin.receive_membership_packet(&packet).unwrap();
    let workspace = owner.workspace_record().unwrap();
    admin.switch_workspace(&workspace.id, "admin").unwrap();
    let third_packet = grant(&admin, &third, "guest");
    let before = third.workspace_context().unwrap();
    third.receive_membership_packet(&third_packet).unwrap();
    assert_eq!(third.workspace_context().unwrap(), before);
    third.switch_workspace(&workspace.id, "third").unwrap();
    assert_eq!(third.workspace_token().unwrap(), owner.workspace_token().unwrap());
    assert_eq!(third.request_workspace_membership("third", None).unwrap().role, "guest");
    assert!(admin.review_workspace_membership("admin", true, Some("member"), "admin").is_err());
}

#[test]
fn tampered_packets_wrong_recipient_and_changed_device_identity_are_rejected() {
    let owner = database("owner");
    let member = database("member");
    let wrong = database("wrong");
    let packet = grant(&owner, &member, "member");
    assert!(wrong.receive_membership_packet(&packet).is_err());
    let mut tampered = packet.clone();
    tampered.payload.push('A');
    assert!(member.receive_membership_packet(&tampered).is_err());
    let replacement = database("owner");
    let (signing, encryption) = replacement.device_public_keys().unwrap();
    assert!(member.remember_device_keys("owner", &signing, &encryption).is_err());
    let mut body = delivery(&packet, &member);
    body.control.role = "admin".into();
    assert!(member.receive_membership_packet(&seal(&body, &owner, &member)).is_err());
}

#[test]
fn ordinary_member_cannot_forward_copied_grants_with_a_forged_manager_roster() {
    let owner = database("owner");
    let attacker = database("attacker");
    let victim = database("victim");
    let own = grant(&owner, &attacker, "member");
    attacker.receive_membership_packet(&own).unwrap();
    let packet = grant(&owner, &victim, "member");
    let mut body = delivery(&packet, &victim);
    body.members.iter_mut().find(|m| m.user_id == "attacker").unwrap().role = "admin".into();
    body.token = Some("attacker-controlled-token".into());
    pair(&attacker, &victim);
    assert!(victim.receive_membership_packet(&seal(&body, &attacker, &victim)).is_err());
    assert!(victim.receive_membership_packet(&packet).is_ok());
}

#[test]
fn offline_delivery_survives_reopen_and_manager_workspace_switches() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("manager.sqlite");
    let owner = Database::open(&path).unwrap();
    let recipient = database("recipient");
    let workspace = owner.workspace_record().unwrap();
    grant(&owner, &recipient, "member");
    let user = owner.current_user_id().unwrap();
    let other = owner.create_workspace("Other", None, None, &user).unwrap();
    owner.switch_workspace(&other.id, &user).unwrap();
    drop(owner);
    let owner = Database::open(&path).unwrap();
    assert_eq!(owner.workspace_context().unwrap().workspace_id, other.id);
    let packet = owner.membership_packets_for("recipient").unwrap().remove(0);
    assert_eq!(recipient.receive_membership_packet(&packet).unwrap().unwrap().id, workspace.id);
}

#[test]
fn revocation_switches_only_active_workspace_and_rejects_stale_grants() {
    let owner = database("owner");
    let member = database("member");
    let workspace = owner.workspace_record().unwrap();
    let original = grant(&owner, &member, "admin");
    member.receive_membership_packet(&original).unwrap();
    member.switch_workspace(&workspace.id, "member").unwrap();
    owner.review_workspace_membership("member", false, None, "owner").unwrap();
    let removed = owner.membership_packets_for("member").unwrap().remove(0);
    assert!(delivery(&removed, &member).token.is_none());
    member.receive_membership_packet(&removed).unwrap();
    assert_ne!(member.workspace_context().unwrap().workspace_id, workspace.id);
    assert!(!member.list_workspaces().unwrap().iter().any(|w| w.id == workspace.id));
    assert!(member.switch_workspace(&workspace.id, "member").is_err());
    assert!(member.conn.query_row("SELECT protected_secret FROM workspace_management_keys WHERE workspace_id=?", [&workspace.id], |r| r.get::<_, Option<String>>(0)).unwrap().is_none());
    assert!(member.receive_membership_packet(&original).unwrap().is_none());
    assert!(member.switch_workspace(&workspace.id, "member").is_err());
    let next = grant(&owner, &member, "member");
    member.receive_membership_packet(&next).unwrap();
    assert!(member.switch_workspace(&workspace.id, "member").is_ok());
}

#[test]
fn revocation_before_first_grant_prevents_delayed_enrollment() {
    let owner = database("owner");
    let member = database("member");
    let original = grant(&owner, &member, "member");
    owner.review_workspace_membership("member", false, None, "owner").unwrap();
    let removed = owner.membership_packets_for("member").unwrap().remove(0);
    member.receive_membership_packet(&removed).unwrap();
    member.receive_membership_packet(&original).unwrap();
    assert!(!member.list_workspaces().unwrap().iter().any(|w| w.id == owner.workspace_record().unwrap().id));
}

#[test]
fn readmission_refreshes_removed_members_and_never_revives_them_from_a_stale_roster() {
    let owner = database("owner");
    let member = database("member");
    let other = database("other");
    grant(&owner, &other, "member");
    let initial = grant(&owner, &member, "member");
    let old_other = delivery(&initial, &member).members.into_iter().find(|m| m.user_id == "other").unwrap();
    member.receive_membership_packet(&initial).unwrap();
    let workspace = owner.workspace_record().unwrap();
    owner.review_workspace_membership("member", false, None, "owner").unwrap();
    member.receive_membership_packet(&owner.membership_packets_for("member").unwrap().remove(0)).unwrap();
    owner.review_workspace_membership("other", false, None, "owner").unwrap();
    let readded = grant(&owner, &member, "member");
    let mut body = delivery(&readded, &member);
    body.members.push(old_other);
    member.receive_membership_packet(&seal(&body, &owner, &member)).unwrap();
    member.switch_workspace(&workspace.id, "member").unwrap();
    assert!(member.require_workspace_member("other").is_err());
}

#[test]
fn failed_import_rolls_back_credentials_roster_and_authorization() {
    let owner = database("owner");
    let member = database("member");
    let packet = grant(&owner, &member, "admin");
    let before = member.workspace_context().unwrap();
    member.conn.execute_batch("CREATE TRIGGER fail_membership BEFORE INSERT ON workspace_members BEGIN SELECT RAISE(ABORT, 'disk failure'); END;").unwrap();
    assert!(member.receive_membership_packet(&packet).is_err());
    assert_eq!(member.workspace_context().unwrap(), before);
    let workspace = owner.workspace_record().unwrap();
    for table in ["workspaces", "workspace_credentials", "workspace_members", "workspace_management_keys", "workspace_member_controls"] {
        let column = if table == "workspaces" { "id" } else { "workspace_id" };
        let count: i64 = member.conn.query_row(&format!("SELECT COUNT(*) FROM {table} WHERE {column}=?"), [&workspace.id], |r| r.get(0)).unwrap();
        assert_eq!(count, 0, "{table}");
    }
    member.conn.execute_batch("DROP TRIGGER fail_membership").unwrap();
    assert!(member.receive_membership_packet(&packet).is_ok());
}
