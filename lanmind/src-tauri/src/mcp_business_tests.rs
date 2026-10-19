use super::*;
use std::path::Path;
fn fixture() -> (Database, String) {
    let db = Database::open(Path::new(":memory:")).unwrap();
    let user = db.current_user_id().unwrap();
    (db, user)
}
fn call(db: &Database, user: &str, name: &str, args: Value) -> Value {
    ai_execute(db, user, name, args).unwrap_or_else(|e| panic!("{name}: {e}"))
}

#[test]
fn business_catalog_has_twenty_five_tools_with_shared_schemas_and_write_metadata() {
    let definitions = business::registry();
    assert_eq!(definitions.len(), 25);
    let specs = ai_tool_specs();
    let mut writes = 0;
    for definition in definitions {
        assert_eq!(ai_business_write(definition.name), definition.write);
        let spec = specs
            .iter()
            .find(|s| s["function"]["name"] == definition.name)
            .unwrap();
        let tool = definition.mcp();
        assert_eq!(
            serde_json::to_value(&*tool.input_schema).unwrap(),
            spec["function"]["parameters"]
        );
        writes += usize::from(tool.annotations.unwrap().read_only_hint == Some(false));
    }
    assert_eq!(writes, 6);
}

#[test]
fn task_cancellation_preview_ignores_generated_timestamps_and_rejects_stale_versions() {
    let (db, user) = fixture();
    let task = call(&db, &user, "create_task", json!({"title":"Review"}))["task"].clone();
    let args = json!({"taskId":task["id"],"expectedVersion":task["version"],"patch":{"status":"abandoned"}});
    let (_, first) = ai_prepare_write(&db, &user, "update_task", args.clone()).unwrap();
    let (_, second) = ai_prepare_write(&db, &user, "update_task", args.clone()).unwrap();
    assert_eq!(first["after"], second["after"]);
    assert_eq!(first["after"]["stateGroup"], "cancelled");
    assert_eq!(
        call(&db, &user, "get_task", json!({"taskId":task["id"]}))["status"],
        "todo"
    );
    call(&db, &user, "update_task", args.clone());
    assert!(ai_execute(&db, &user, "update_task", args).is_err());
}

#[test]
fn task_preview_is_rolled_back_and_freezes_defaults_and_child_scope() {
    let (db, user) = fixture();
    let p = db
        .create_project(
            json!({"name":"Project","description":"","color":"#123456"}),
            &user,
        )
        .unwrap();
    let parent = call(
        &db,
        &user,
        "create_task",
        json!({"title":"Parent","projectId":p.id}),
    )["task"]
        .clone();
    let logs = db.sync_operations(0).unwrap().0.len();
    let (args, preview) = ai_prepare_write(
        &db,
        &user,
        "create_task",
        json!({"title":"Child","parentTaskId":parent["id"]}),
    )
    .unwrap();
    assert_eq!(db.tasks(Some(&user)).unwrap().len(), 1);
    assert_eq!(db.sync_operations(0).unwrap().0.len(), logs);
    assert_eq!(args["projectId"], p.id);
    assert_eq!(preview["after"]["assigneeId"], user);
    assert!(args["stateId"].is_string());
    let (_, second) = ai_prepare_write(&db, &user, "create_task", args.clone()).unwrap();
    assert_eq!(preview["after"], second["after"]);
    let child = call(&db, &user, "create_task", args)["task"].clone();
    assert_eq!(child["parentTaskId"], parent["id"]);
    assert_eq!(child["projectId"], p.id);
    assert_eq!(
        call(
            &db,
            &user,
            "list_tasks",
            json!({"parentTaskId":parent["id"]})
        )["total"],
        1
    );
    assert!(ai_execute(
        &db,
        &user,
        "create_task",
        json!({"title":"Third level","parentTaskId":child["id"]})
    )
    .is_err());
    assert!(ai_execute(&db, &user, "list_tasks", json!({"dueFrom":"2026-02-30"})).is_err());
}

#[test]
fn today_schedule_and_project_statistics_follow_visible_top_level_rules() {
    let (db, user) = fixture();
    let today = Local::now().format("%Y-%m-%d").to_string();
    let p = db
        .create_project(
            json!({"name":"Project","description":"","color":"#123456"}),
            &user,
        )
        .unwrap();
    let active = call(
        &db,
        &user,
        "create_task",
        json!({"title":"In progress","projectId":p.id,"status":"in_progress"}),
    )["task"]
        .clone();
    call(
        &db,
        &user,
        "create_task",
        json!({"title":"Due","projectId":p.id,"dueDate":today}),
    );
    call(
        &db,
        &user,
        "create_task",
        json!({"title":"Done","projectId":p.id,"status":"completed","dueDate":today}),
    );
    call(
        &db,
        &user,
        "create_task",
        json!({"title":"Cancelled","projectId":p.id,"status":"abandoned","dueDate":today}),
    );
    call(
        &db,
        &user,
        "create_task",
        json!({"title":"Child","parentTaskId":active["id"],"dueDate":today}),
    );
    let result = call(&db, &user, "list_today_tasks", json!({"limit":1}));
    assert_eq!(result["date"], today);
    assert_eq!(result["total"], 2);
    assert_eq!(result["items"].as_array().unwrap().len(), 1);
    let summary = call(&db, &user, "get_project_summary", json!({"projectId":p.id}));
    assert_eq!(summary["total"], 4);
    assert!((summary["completionRate"].as_f64().unwrap() - 1.0 / 3.0).abs() < 0.001);
    db.update_project(&p.id, json!({"isArchived":true}), &user)
        .unwrap();
    assert_eq!(call(&db, &user, "list_today_tasks", json!({}))["total"], 0);
}

#[test]
fn comments_reply_author_scope_versions_and_preview_do_not_leak_side_effects() {
    let (db, user) = fixture();
    let t = call(
        &db,
        &user,
        "create_task",
        json!({"title":"Task","isShared":true}),
    )["task"]
        .clone();
    let (_, preview) = ai_prepare_write(
        &db,
        &user,
        "create_task_comment",
        json!({"taskId":t["id"],"content":"Draft"}),
    )
    .unwrap();
    assert_eq!(preview["after"]["content"], "Draft");
    assert!(db
        .task_comments(t["id"].as_str().unwrap(), &user)
        .unwrap()
        .is_empty());
    let c = call(
        &db,
        &user,
        "create_task_comment",
        json!({"taskId":t["id"],"content":"First"}),
    )["comment"]
        .clone();
    let reply = call(
        &db,
        &user,
        "create_task_comment",
        json!({"taskId":t["id"],"content":"Reply","replyToCommentId":c["id"]}),
    );
    assert_eq!(reply["comment"]["replyTo"]["commentId"], c["id"]);
    let patch = json!({"taskId":t["id"],"commentId":c["id"],"expectedUpdatedAt":c["updatedAt"],"content":"Edited"});
    call(&db, &user, "update_task_comment", patch.clone());
    assert!(ai_execute(&db, &user, "update_task_comment", patch)
        .unwrap_err()
        .contains("VERSION_CONFLICT"));
    assert!(ai_execute(&db,"other","update_task_comment",json!({"taskId":t["id"],"commentId":c["id"],"expectedUpdatedAt":db.task_comments(t["id"].as_str().unwrap(),&user).unwrap()[0].updated_at,"content":"Forged"})).is_err());
    assert!(call(
        &db,
        &user,
        "list_task_activity",
        json!({"taskId":t["id"],"pageSize":1})
    )["snapshot"]
        .is_number());
}

#[test]
fn wiki_incremental_updates_preserve_other_pages_and_reject_stale_editor_and_agent_writes() {
    let (db, user) = fixture();
    let a = call(
        &db,
        &user,
        "create_wiki_page",
        json!({"title":"A","content":"中文🙂"}),
    )["page"]
        .clone();
    let b = call(
        &db,
        &user,
        "create_wiki_page",
        json!({"title":"B","content":"Second"}),
    )["page"]
        .clone();
    let (_, preview) = ai_prepare_write(
        &db,
        &user,
        "update_wiki_page",
        json!({"pageId":a["id"],"expectedVersion":a["version"],"content":"Preview"}),
    )
    .unwrap();
    assert_eq!(preview["before"]["content"], "中文🙂");
    assert_eq!(
        db.wiki_page(a["id"].as_str().unwrap(), &user).unwrap()["content"],
        "中文🙂"
    );
    let current = call(
        &db,
        &user,
        "update_wiki_page",
        json!({"pageId":a["id"],"expectedVersion":a["version"],"content":"External"}),
    )["page"]
        .clone();
    let mut stale = a.clone();
    stale["content"] = json!("Stale editor");
    assert!(db
        .save_wiki_changes(
            &json!({"changes":[{"document":stale,"expectedVersion":a["version"]}]}),
            &user
        )
        .unwrap_err()
        .contains("VERSION_CONFLICT"));
    assert_eq!(
        db.wiki_page(a["id"].as_str().unwrap(), &user).unwrap()["content"],
        "External"
    );
    assert_eq!(
        db.wiki_page(b["id"].as_str().unwrap(), &user).unwrap()["content"],
        "Second"
    );
    let mut locked = current.clone();
    locked["isLocked"] = json!(true);
    db.write_wiki_page(&locked, current["version"].as_i64(), &user)
        .unwrap();
    assert!(ai_execute(&db,&user,"update_wiki_page",json!({"pageId":a["id"],"expectedVersion":current["version"],"content":"Change locked page"})).is_err());
}

#[test]
fn wiki_chunks_search_parent_permissions_and_subtree_deletion_are_enforced() {
    let (db, user) = fixture();
    let parent = call(
        &db,
        &user,
        "create_wiki_page",
        json!({"title":"Parent","content":"中文🙂more"}),
    )["page"]
        .clone();
    let child = call(
        &db,
        &user,
        "create_wiki_page",
        json!({"title":"Child","content":"Details","parentId":parent["id"]}),
    )["page"]
        .clone();
    let chunk = call(
        &db,
        &user,
        "get_wiki_page",
        json!({"pageId":parent["id"],"length":3}),
    );
    assert_eq!(chunk["content"], "中文🙂");
    assert_eq!(chunk["nextOffset"], 3);
    let search = call(&db, &user, "search_wiki", json!({"keyword":"中文"}));
    assert_eq!(search["total"], 1);
    assert!(search["items"][0].get("content").is_none());
    db.save_wiki_changes(&json!({"changes":[],"deletions":[{"id":parent["id"],"expectedVersion":parent["version"]},{"id":child["id"],"expectedVersion":child["version"]}]}),&user).unwrap();
    assert!(db.wiki_pages(&user).unwrap().is_empty());
    let p = db
        .create_project(
            json!({"name":"Private","description":"","color":"#123456"}),
            &user,
        )
        .unwrap();
    let restricted = call(
        &db,
        &user,
        "create_wiki_page",
        json!({"title":"Restricted","content":"secret","projectId":p.id}),
    )["page"]
        .clone();
    let inherited = call(
        &db,
        &user,
        "create_wiki_page",
        json!({"title":"Child","content":"secret","parentId":restricted["id"]}),
    )["page"]
        .clone();
    assert!(db
        .wiki_page(inherited["id"].as_str().unwrap(), "other")
        .is_err());
    assert!(ai_execute(&db, "other", "get_project", json!({"projectId":p.id})).is_err());
    let ws = db.create_workspace("B", None, None, &user).unwrap();
    db.switch_workspace(&ws.id, &user).unwrap();
    assert!(ai_execute(
        &db,
        &user,
        "get_wiki_page",
        json!({"pageId":inherited["id"]})
    )
    .is_err());
    assert_eq!(
        call(&db, &user, "search_wiki", json!({"keyword":"secret"}))["total"],
        0
    );
}

#[tokio::test]
async fn mcp_http_discovers_and_calls_new_tools_and_returns_useful_version_errors() {
    let mut h = super::tests::TestHarness::start().await;
    let listed = h
        .post(json!({"jsonrpc":"2.0","id":77,"method":"tools/list","params":{}}))
        .await;
    for tool in listed["result"]["tools"].as_array().unwrap() {
        assert_eq!(
            tool["annotations"]["readOnlyHint"],
            !ai_business_write(tool["name"].as_str().unwrap())
        );
    }
    let created = h
        .call_tool(
            "create_wiki_page",
            json!({"title":"Runbook","content":"Release notes"}),
        )
        .await;
    let p = created["result"]["structuredContent"]["page"].clone();
    assert!(p["version"].is_number(), "{created}");
    let found = h
        .call_tool("search_wiki", json!({"keyword":"Release"}))
        .await;
    assert_eq!(found["result"]["structuredContent"]["total"], 1);
    let conflict = h
        .call_tool(
            "update_wiki_page",
            json!({"pageId":p["id"],"expectedVersion":0,"content":"Stale"}),
        )
        .await;
    assert_eq!(conflict["result"]["isError"], true);
    for name in [
        "get_workspace",
        "list_workspace_members",
        "get_org_directory",
        "list_today_tasks",
    ] {
        assert_eq!(
            h.call_tool(name, json!({})).await["result"]["isError"],
            false
        );
    }
    h.shutdown().await;
}

#[test]
fn member_directory_and_project_roles_only_include_authorized_workspace_profiles() {
    let (db, user) = fixture();
    let mut member = db.workspace_users().unwrap()[0].clone();
    member.id = "member".into();
    member.nickname = "Alex".into();
    db.upsert_user(&member).unwrap();
    db.request_workspace_membership(&member.id, None).unwrap();
    let mut outsider = member.clone();
    outsider.id = "outsider".into();
    db.upsert_user(&outsider).unwrap();
    let directory:crate::models::LocalDirectory=serde_json::from_value(json!({"units":[{"id":"team","name":"Delivery","sortOrder":0}],"members":[{"orgUnitId":"team","userId":member.id},{"orgUnitId":"team","userId":outsider.id}]})).unwrap();
    db.save_local_directory(&directory).unwrap();
    let users = call(&db, &user, "list_workspace_members", json!({"limit":1}));
    assert_eq!(users["total"], 2);
    assert_eq!(users["items"].as_array().unwrap().len(), 1);
    let org = call(&db, &user, "get_org_directory", json!({}));
    assert_eq!(org["members"].as_array().unwrap().len(), 1);
    assert_eq!(org["members"][0]["user"]["nickname"], "Alex");
    let project=db.create_project(json!({"name":"Delivery","description":"","color":"#123456","members":[member.id],"leadId":member.id}),&user).unwrap();
    let members = call(
        &db,
        &user,
        "list_project_members",
        json!({"projectId":project.id}),
    );
    assert_eq!(members["total"], 2);
    let lead = members["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["userId"] == member.id)
        .unwrap();
    assert_eq!(lead["isLead"], true);
    assert_eq!(lead["role"], "admin");
    assert_eq!(lead["user"]["nickname"], "Alex");
}

#[test]
fn wiki_batches_order_dependencies_and_roll_back_failed_multi_page_changes() {
    let (db, user) = fixture();
    let parent =
        json!({"id":"parent","title":"Parent","content":"Original","parentId":null,"icon":"book","tags":[" Product ","Product","",42,"Notes"]});
    let child = json!({"id":"child","title":"Child","content":"Details","parentId":"parent"});
    db.save_wiki_changes(
        &json!({"changes":[{"document":child},{"document":parent}]}),
        &user,
    )
    .unwrap();
    let current = db.wiki_page("parent", &user).unwrap();
    assert_eq!(current["icon"], "book");
    assert_eq!(current["tags"], json!(["Product", "Notes"]));
    let logs = db.sync_operations(0).unwrap().0.len();
    let mut changed = current.clone();
    changed["content"] = json!("Must roll back");
    let error=db.save_wiki_changes(&json!({"changes":[{"document":changed,"expectedVersion":current["version"]},{"document":{"id":"other","title":"Other","parentId":"missing"}}]}),&user).unwrap_err();
    assert!(error.contains("文档"));
    assert_eq!(
        db.wiki_page("parent", &user).unwrap()["content"],
        "Original"
    );
    assert_eq!(db.sync_operations(0).unwrap().0.len(), logs);
    assert!(db.save_wiki_changes(&json!({"changes":[],"deletions":[{"id":"parent","expectedVersion":current["version"]}]}),&user).is_err());
    assert_eq!(db.wiki_pages(&user).unwrap().len(), 2);
    let mut without_tags = current.clone();
    without_tags["tags"] = json!([]);
    db.save_wiki_changes(&json!({"changes":[{"document":without_tags,"expectedVersion":current["version"]}]}), &user).unwrap();
    let saved = db.wiki_page("parent", &user).unwrap();
    assert_eq!(saved["tags"], json!([]));
    assert_eq!(saved["icon"], "book");
    assert_eq!(saved["content"], "Original");
}
