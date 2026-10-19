use super::*;
pub(super) fn list_tasks(
    db: &Database,
    user_id: &str,
    request: ListTasksRequest,
) -> Result<Value, String> {
    if let Some(status) = request.status.as_deref() {
        validate_enum(
            status,
            &["todo", "in_progress", "completed", "blocked", "abandoned"],
            "状态",
        )?;
    }
    if let Some(group) = request.state_group.as_deref() {
        validate_enum(
            group,
            &["backlog", "unstarted", "started", "completed", "cancelled"],
            "状态分组",
        )?;
    }
    // Legacy `status` filters are resolved through the same mapping the
    // database uses, so `blocked` matches the `Blocked` state by name
    // rather than every state in the shared `started` group.
    let wanted_state_name = request.status.as_deref().map(legacy_status_to_state_name);
    if let Some(priority) = request.priority.as_deref() {
        validate_enum(priority, &["P1", "P2", "P3", "P4"], "优先级")?;
    }
    for date in [request.due_from.as_deref(), request.due_to.as_deref()]
        .into_iter()
        .flatten()
    {
        if NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
            return Err("到期日期筛选必须是 YYYY-MM-DD".into());
        }
    }
    let keyword = request.keyword.as_deref().map(str::to_lowercase);
    let mut tasks = db.tasks(Some(user_id))?;
    tasks.retain(|task| {
        let searchable = format!(
            "{} {} {}",
            task.title,
            task.description,
            task.tags.join(" ")
        )
        .to_lowercase();
        let due = task.due_date.as_deref().and_then(|value| value.get(..10));
        request
            .parent_task_id
            .as_ref()
            .is_none_or(|id| task.parent_task_id.as_ref() == Some(id))
            && keyword
                .as_ref()
                .is_none_or(|keyword| searchable.contains(keyword))
            && request
                .project_id
                .as_ref()
                .is_none_or(|id| task.project_id.as_ref() == Some(id))
            && request
                .assignee_id
                .as_ref()
                .is_none_or(|id| &task.assignee_id == id)
            && request
                .state_id
                .as_ref()
                .is_none_or(|id| task.state_id.as_ref() == Some(id))
            && request
                .state_group
                .as_ref()
                .is_none_or(|group| task.state_group.as_ref() == Some(group))
            && wanted_state_name
                .as_deref()
                .is_none_or(|name| task_state_name(task) == name)
            && request
                .priority
                .as_ref()
                .is_none_or(|value| &task.priority == value)
            && request
                .due_from
                .as_deref()
                .is_none_or(|from| due.is_some_and(|due| due >= from))
            && request
                .due_to
                .as_deref()
                .is_none_or(|to| due.is_some_and(|due| due <= to))
    });
    let total = tasks.len();
    let offset = request.offset.unwrap_or(0).min(total);
    let limit = request.limit.unwrap_or(100).clamp(1, 200);
    let items: Vec<Task> = tasks.into_iter().skip(offset).take(limit).collect();
    Ok(json!({"items": items, "total": total, "offset": offset, "limit": limit}))
}
