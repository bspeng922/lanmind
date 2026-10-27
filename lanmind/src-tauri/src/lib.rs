//! Desktop composition root.
//!
//! This module owns Tauri commands and process-level integrations. UI code
//! remains in the React renderer; SQLite, P2P, tray, window lifecycle, and
//! global shortcuts stay in this trusted Rust process.

mod db;
mod db_cleanup;
mod workspace_scope;
mod workspace_dissolution;
mod workspace_membership;
mod wiki_data;
use workspace_scope::WorkspaceContext;
mod desktop_calendar;
mod file_server;
mod mcp;
mod models;
mod network;
mod optical;
mod web_server;
mod task_markdown;
mod local_password;
mod app_lock;
mod i18n;
mod screenshot;
mod ai_chat;
mod ai_types;
mod ai_secrets;
mod ai_models;
mod ai_store;
mod ai_provider;
mod ai_files;
mod ai_documents;
mod ai_script;
mod ai_extensions;
mod ai_mcp_client;
mod ai_runtime;
mod ai_api;
mod wiki_polish;
#[cfg(test)] mod ai_tests;
pub use ai_script::try_worker as try_ai_script_worker;

use crate::db::{Database, ReportDataset, ReportTaskRecord};
use crate::mcp::McpRuntime;
#[cfg(test)]
use crate::models::Task;
use crate::models::{
    BootstrapData, CloseButtonBehavior, GeneratedPresentation, GeneratedReport, LlmConfig, PresentationRelation,
    PresentationSlide, PresentationSupportingPoint, PresentationVisual, ReportMetrics,
    ReportSection, ReportSectionItem, ReportSourceTask, User, Workspace, WorkspaceMember,
};
use crate::network::NetworkRuntime;
use crate::web_server::WebRuntime;
use chrono::{Duration, Local, NaiveDate, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const CHAT_TRAY_RGBA: &[u8] = include_bytes!("../icons/chat-tray.rgba");
const CHAT_TRAY_EMPTY_RGBA: &[u8] = include_bytes!("../icons/chat-tray-empty.rgba");
const TASKS_CHANGED_EVENT: &str = "tasks://changed";
const STATES_CHANGED_EVENT: &str = "states://changed";
const WORKSPACE_CHANGED_EVENT: &str = "workspace://changed";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayUnreadUser {
    pub key: String,
    pub name: String,
    pub count: u32,
    pub conversation: Value,
    #[serde(default)]
    pub icon_rgba: Option<Vec<u8>>,
}

pub struct AppState {
    ai: ai_runtime::AiRuntime,
    db: Arc<Mutex<Database>>,
    mcp: McpRuntime,
    web: WebRuntime,
    app_lock: Arc<app_lock::AppLockRuntime>,
    close_button_exits: AtomicBool,
    lock_hidden_windows: Mutex<Vec<String>>,
    network: Mutex<NetworkRuntime>,
    file_server: Arc<file_server::FileServer>,
    shortcut_actions: Arc<Mutex<HashMap<u32, String>>>,
    shortcut_bindings: Arc<Mutex<Vec<GlobalShortcutBinding>>>,
    notification_ready: AtomicBool,
    pending_notifications: Mutex<Vec<Value>>,
    tray_blinking: Arc<AtomicBool>,
    tray_generation: Arc<AtomicU64>,
    tray_popup_generation: Arc<AtomicU64>,
    tray_unread: Arc<Mutex<Vec<TrayUnreadUser>>>,
}

static MAIN_WINDOW_READY: AtomicBool = AtomicBool::new(false);
static STARTED_BY_AUTOSTART: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobalShortcutBinding {
    action: String,
    accelerator: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiReportContent {
    #[serde(default)]
    title: String,
    #[serde(default)]
    audience: String,
    #[serde(default)]
    key_takeaway: String,
    #[serde(default)]
    executive_summary: String,
    #[serde(default)]
    sections: Vec<ReportSection>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiPresentationContent {
    #[serde(default)]
    title: String,
    #[serde(default)]
    audience: String,
    #[serde(default)]
    key_takeaway: String,
    #[serde(default)]
    slides: Vec<PresentationSlide>,
}

fn report_type_name(report_type: &str) -> &'static str {
    match report_type {
        "daily" => i18n::text("runtime.dailyReport"),
        "weekly" => i18n::text("runtime.weeklyReport"),
        "monthly" => i18n::text("runtime.monthlyReport"),
        "quarterly" => i18n::text("runtime.quarterlyReport"),
        "semi_annual" => i18n::text("runtime.halfYearReport"),
        "annual" => i18n::text("runtime.annualReport"),
        _ => i18n::text("runtime.workReport"),
    }
}

fn parse_json_object<T: DeserializeOwned>(raw: &str, label: &str) -> Result<T, String> {
    let start = raw
        .find('{')
        .ok_or_else(|| i18n::format("runtime.noLabelJsonFoundInModelResponse", &[("label", (label).to_string())]))?;
    let end = raw
        .rfind('}')
        .filter(|end| *end >= start)
        .ok_or_else(|| i18n::format("runtime.incompleteLabelJsonInModelResponse", &[("label", (label).to_string())]))?;
    serde_json::from_str(&raw[start..=end])
        .map_err(|error| i18n::format("runtime.couldNotParseLabelError", &[("label", (label).to_string()), ("error", (error).to_string())]))
}

fn parse_ai_report_content(raw: &str) -> Result<AiReportContent, String> {
    parse_json_object(raw, i18n::text("runtime.workReport"))
}

fn parse_ai_presentation_content(raw: &str) -> Result<AiPresentationContent, String> {
    parse_json_object(raw, i18n::text("runtime.presentationPlan"))
}

fn report_template(report_type: &str, has_remaining_period: bool) -> &'static str {
    match report_type {
        "daily" => i18n::text("runtime.completedTodayProgressBlockersTomorrowSPlan"),
        "weekly" if has_remaining_period => i18n::text("runtime.deliveredThisWeekProgressRisksRemainingActions"),
        "weekly" => i18n::text("runtime.weeklyDeliveryMilestonesRisksNextWeekS"),
        "monthly" if has_remaining_period => i18n::text("runtime.monthlyOutcomesProjectProgressRisksRemainingPriorities"),
        "monthly" => i18n::text("runtime.monthlyOutcomesProjectsImprovementsNextMonthS"),
        "quarterly" if has_remaining_period => {
            i18n::text("runtime.quarterlyOutcomesProjectProgressRisksRemainingPriorities")
        }
        "quarterly" => i18n::text("runtime.quarterlyOutcomesProjectsReviewNextQuarterPriorities"),
        "semi_annual" if has_remaining_period => {
            i18n::text("runtime.halfYearOutcomesProjectProgressSystemicIssues")
        }
        "semi_annual" => i18n::text("runtime.halfYearOutcomesProjectsLessonsNextSteps"),
        "annual" if has_remaining_period => i18n::text("runtime.annualProgressMajorOutcomesKeyRisksRemaining"),
        "annual" => i18n::text("runtime.annualOverviewMajorOutcomesReviewNextYear"),
        _ => i18n::text("runtime.outcomesProgressRisksNextActions"),
    }
}

fn report_period_guidance(report_type: &str) -> &'static str {
    match report_type {
        "daily" => i18n::text("runtime.focusOn35ActivitiesCompletedWork"),
        "weekly" => i18n::text("runtime.focusOnWeeklyDeliveryGoalsIssuesAnd"),
        "monthly" => i18n::text("runtime.groupMonthlyOutcomesByGoalOrProject"),
        "quarterly" => i18n::text("runtime.coverQuarterlyGoalsProjectsResourcesRisksAnd"),
        "semi_annual" => i18n::text("runtime.coverHalfYearOutcomesCapabilitiesStrategicDeviations"),
        "annual" => i18n::text("runtime.summarizeAnnualOutcomesProjectsLessonsUnfinishedWork"),
        _ => i18n::text("runtime.organizeByOutcomesProgressRisksAndPlans"),
    }
}

fn markdown_from_report(
    title: &str,
    period: &str,
    audience: &str,
    key_takeaway: &str,
    executive_summary: &str,
    metrics: &ReportMetrics,
    sections: &[ReportSection],
    data_notes: &[String],
) -> String {
    let mut markdown = i18n::format("runtime.titlePeriodPeriodAudienceAudienceKeyTakeaway", &[("title", (title).to_string()), ("period", (period).to_string()), ("audience", (audience).to_string()), ("key_takeaway", (key_takeaway).to_string()), ("executive_summary", (executive_summary).to_string())]);
    for section in sections {
        markdown.push_str(&format!("\n\n## {}", section.title));
        if let Some(summary) = section
            .summary
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            markdown.push_str(&format!("\n{summary}"));
        }
        if let Some(conclusion) = section
            .conclusion
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            markdown.push_str(&i18n::format("runtime.conclusionConclusion", &[("conclusion", (conclusion).to_string())]));
        }
        if section.items.is_empty() {
            markdown.push_str(i18n::text("runtime.none"));
        } else {
            for item in &section.items {
                let detail = item.detail.trim();
                markdown.push_str(&format!(
                    "\n- **{}**{}",
                    item.headline.trim(),
                    if detail.is_empty() {
                        String::new()
                    } else {
                        format!("：{detail}")
                    }
                ));
                if let Some(impact) = item
                    .impact
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                {
                    markdown.push_str(&i18n::format("runtime.impactImpact", &[("impact", (impact).to_string())]));
                }
                if let Some(action) = item
                    .next_action
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                {
                    markdown.push_str(&i18n::format("runtime.nextActionAction", &[("action", (action).to_string())]));
                }
            }
        }
    }
    markdown.push_str(&i18n::format("runtime.evidenceRelevantTasksCompletedProgressedPendingBlocked", &[("arg0", (metrics.relevant_tasks_count).to_string()), ("arg1", (metrics.completed_tasks_count).to_string()), ("arg2", (metrics.progressed_tasks_count).to_string()), ("arg3", (metrics.pending_tasks_count).to_string()), ("arg4", (metrics.blocked_tasks_count).to_string()), ("arg5", (metrics.overdue_tasks_count).to_string()), ("arg6", (metrics.upcoming_tasks_count).to_string())]));
    if !data_notes.is_empty() {
        markdown.push_str(i18n::text("runtime.dataNotes"));
        for note in data_notes {
            markdown.push_str(&format!("\n- {note}"));
        }
    }
    markdown
}

async fn request_llm_text(
    config: &LlmConfig,
    system_prompt: &str,
    prompt: &str,
) -> Result<String, String> {
    let parameters=config.generation_parameters.clone().unwrap_or(ai_types::ModelParameters { temperature:Some(0.2), ..Default::default() });
    ai_provider::complete(config,&parameters,&[json!({"role":"system","content":system_prompt}),json!({"role":"user","content":prompt})],&[],&tokio_util::sync::CancellationToken::new(), |_|Ok(())).await.map(|result|result.text).map_err(|e|e.to_string())
}

fn report_item(
    record: &ReportTaskRecord,
    detail: String,
    severity: Option<&str>,
) -> ReportSectionItem {
    ReportSectionItem {
        headline: record.task.title.clone(),
        detail,
        impact: None,
        next_action: None,
        task_ids: vec![record.task.id.clone()],
        severity: severity.map(str::to_string),
        due_date: record.due_date_as_of.clone(),
    }
}

fn section_titles(report_type: &str, has_remaining_period: bool) -> [&'static str; 4] {
    match report_type {
        "daily" => [i18n::text("runtime.completedToday"), i18n::text("runtime.keyProgress"), i18n::text("runtime.issuesAndCoordination"), i18n::text("runtime.tomorrowSPlan")],
        "weekly" if has_remaining_period => {
            [i18n::text("runtime.deliveredThisWeek"), i18n::text("runtime.keyProgress"), i18n::text("runtime.risksAndDeviations"), i18n::text("runtime.remainingActionsThisWeek")]
        }
        "weekly" => [i18n::text("runtime.weeklyDelivery"), i18n::text("runtime.milestoneProgress"), i18n::text("runtime.risksAndDeviations"), i18n::text("runtime.nextWeekSActions")],
        "monthly" if has_remaining_period => {
            [i18n::text("runtime.monthlyOutcomes"), i18n::text("runtime.projectProgress"), i18n::text("runtime.riskReview"), i18n::text("runtime.remainingMonthlyPriorities")]
        }
        "monthly" => [i18n::text("runtime.monthlyOutcomes2"), i18n::text("runtime.keyProjects"), i18n::text("runtime.reviewAndImprovements"), i18n::text("runtime.nextMonthPriorities")],
        "quarterly" if has_remaining_period => [
            i18n::text("runtime.quarterlyOutcomes"),
            i18n::text("runtime.keyProjectProgress"),
            i18n::text("runtime.risksAndDeviations"),
            i18n::text("runtime.remainingQuarterlyPriorities"),
        ],
        "quarterly" => [i18n::text("runtime.quarterlyOutcomes2"), i18n::text("runtime.keyProjects2"), i18n::text("runtime.periodReview"), i18n::text("runtime.nextQuarterPriorities")],
        "semi_annual" if has_remaining_period => [
            i18n::text("runtime.halfYearOutcomes"),
            i18n::text("runtime.portfolioProgress"),
            i18n::text("runtime.systemicIssues"),
            i18n::text("runtime.remainingHalfYearPriorities"),
        ],
        "semi_annual" => [i18n::text("runtime.halfYearOutcomes2"), i18n::text("runtime.projectPortfolio"), i18n::text("runtime.capabilitiesAndLessons"), i18n::text("runtime.nextSteps")],
        "annual" if has_remaining_period => {
            [i18n::text("runtime.annualProgress"), i18n::text("runtime.majorActivities"), i18n::text("runtime.keyRisks"), i18n::text("runtime.remainingAnnualPriorities")]
        }
        "annual" => [
            i18n::text("runtime.majorAnnualOutcomes"),
            i18n::text("runtime.projectReviews"),
            i18n::text("runtime.annualIssueReview"),
            i18n::text("runtime.nextYearPriorities"),
        ],
        _ => [i18n::text("runtime.keyOutcomes"), i18n::text("runtime.keyProgress"), i18n::text("runtime.risksAndDeviations"), i18n::text("runtime.nextActions")],
    }
}

fn build_fallback_sections(
    records: &[ReportTaskRecord],
    report_type: &str,
    has_remaining_period: bool,
) -> Vec<ReportSection> {
    let titles = section_titles(report_type, has_remaining_period);
    let achievements: Vec<ReportSectionItem> = records
        .iter()
        .filter(|record| record.completed_in_period)
        .take(8)
        .map(|record| {
            report_item(
                record,
                if record.event_notes.is_empty() {
                    i18n::text("runtime.completedDuringThisPeriod").into()
                } else {
                    record.event_notes.join("；")
                },
                None,
            )
        })
        .collect();
    let progress: Vec<ReportSectionItem> = records
        .iter()
        .filter(|record| {
            record.progressed_in_period || (record.created_in_period && !record.upcoming_in_period)
        })
        .filter(|record| !record.completed_in_period)
        .take(8)
        .map(|record| {
            report_item(
                record,
                if record.event_notes.is_empty() {
                    i18n::format("runtime.currentStatus", &[("arg0", (record.status_as_of).to_string())])
                } else {
                    record.event_notes.join("；")
                },
                None,
            )
        })
        .collect();
    let risks: Vec<ReportSectionItem> = records
        .iter()
        .filter(|record| record.blocked_as_of || record.overdue_as_of || record.schedule_slipped)
        .take(8)
        .map(|record| {
            let mut facts = Vec::new();
            if record.blocked_as_of {
                facts.push(i18n::text("runtime.currentlyBlocked"));
            }
            if record.overdue_as_of {
                facts.push(i18n::text("runtime.pastTheDueDate"));
            }
            if record.schedule_slipped {
                facts.push(i18n::text("runtime.dueDateMovedLaterInThisPeriod"));
            }
            report_item(
                record,
                i18n::format("runtime.clarifyTheResolutionCriteriaAndNextAction", &[("arg0", (facts.join("；")).to_string())]),
                Some(if record.blocked_as_of || record.overdue_as_of {
                    "high"
                } else {
                    "medium"
                }),
            )
        })
        .collect();
    let plans: Vec<ReportSectionItem> = records
        .iter()
        .filter(|record| {
            record.upcoming_in_period
                || (record.status_as_of != "completed"
                    && (record.task.priority == "P1" || record.blocked_as_of))
        })
        .take(10)
        .map(|record| {
            report_item(
                record,
                if record.blocked_as_of {
                    i18n::text("runtime.resolveBlockersAndUpdateTheDeliveryDate").into()
                } else {
                    i18n::text("runtime.deliverVerifiableResultsByTheDueDate").into()
                },
                None,
            )
        })
        .collect();
    [
        ("achievement", "achievement", titles[0], achievements),
        ("progress", "progress", titles[1], progress),
        ("risk", "risk", titles[2], risks),
        ("plan", "plan", titles[3], plans),
    ]
    .into_iter()
    .map(|(id, kind, title, items)| ReportSection {
        id: id.into(),
        kind: kind.into(),
        title: title.into(),
        purpose: Some(match kind {
            "achievement" => i18n::text("runtime.explainTheOutcomesOfThisPeriodS").into(),
            "progress" => i18n::text("runtime.explainWhichActivitiesNeedContinuedAttention").into(),
            "risk" => i18n::text("runtime.explainWhatCouldChangeTheOutcome").into(),
            "plan" => i18n::text("runtime.defineActionsThatWillDeliverResults").into(),
            _ => i18n::text("runtime.presentAManagementConclusion").into(),
        }),
        conclusion: Some(if items.is_empty() {
            match kind {
                "achievement" => i18n::text("runtime.noConfirmedOutcomesAreRecordedForThis").into(),
                "progress" => i18n::text("runtime.noConfirmedProgressIsRecorded").into(),
                "risk" => i18n::text("runtime.noBlockersOverdueWorkOrScheduleChanges").into(),
                "plan" => i18n::text("runtime.noUpcomingActionsFallWithinThisScope").into(),
                _ => i18n::text("runtime.insufficientEvidenceForAConclusion").into(),
            }
        } else {
            match kind {
                "achievement" => i18n::format("runtime.groupsOfCompletedWorkSupportThisPeriod", &[("arg0", (items.len()).to_string())]),
                "progress" => i18n::format("runtime.groupsOfActivitiesShowProgress", &[("arg0", (items.len()).to_string())]),
                "risk" => i18n::format("runtime.groupsOfRiskEvidenceNeedAttention", &[("arg0", (items.len()).to_string())]),
                "plan" => i18n::format("runtime.focusNextOnGroupsOfVerifiableActions", &[("arg0", (items.len()).to_string())]),
                _ => i18n::text("runtime.recordedEvidenceSupportsThisConclusion").into(),
            }
        }),
        summary: None,
        items,
    })
    .collect()
}

fn clean_report_text(value: &str, limit: usize) -> String {
    value.trim().chars().take(limit).collect()
}

fn sanitize_report_sections(sections: &mut Vec<ReportSection>, allowed_task_ids: &HashSet<String>) {
    const KINDS: [&str; 6] = [
        "achievement",
        "progress",
        "risk",
        "plan",
        "support",
        "custom",
    ];
    sections.truncate(8);
    for (section_index, section) in sections.iter_mut().enumerate() {
        if !KINDS.contains(&section.kind.as_str()) {
            section.kind = "custom".into();
        }
        section.id = if section.id.trim().is_empty() {
            format!("section-{}", section_index + 1)
        } else {
            clean_report_text(&section.id, 40)
        };
        section.title = clean_report_text(&section.title, 50);
        if section.title.is_empty() {
            section.title = i18n::text("runtime.reportItem").into();
        }
        section.purpose = section
            .purpose
            .as_deref()
            .map(|value| clean_report_text(value, 120))
            .filter(|value| !value.is_empty());
        section.conclusion = section
            .conclusion
            .as_deref()
            .map(|value| clean_report_text(value, 240))
            .filter(|value| !value.is_empty());
        section.summary = section
            .summary
            .as_deref()
            .map(|value| clean_report_text(value, 240))
            .filter(|value| !value.is_empty());
        section.items.truncate(12);
        section.items.retain_mut(|item| {
            item.headline = clean_report_text(&item.headline, 100);
            item.detail = clean_report_text(&item.detail, 500);
            item.impact = item
                .impact
                .as_deref()
                .map(|value| clean_report_text(value, 240))
                .filter(|value| !value.is_empty());
            item.next_action = item
                .next_action
                .as_deref()
                .map(|value| clean_report_text(value, 240))
                .filter(|value| !value.is_empty());
            item.task_ids.retain(|id| allowed_task_ids.contains(id));
            item.task_ids.sort();
            item.task_ids.dedup();
            if !matches!(item.severity.as_deref(), Some("high" | "medium" | "low")) {
                item.severity = None;
            }
            !item.headline.is_empty() || !item.detail.is_empty()
        });
    }
}

async fn generate_ai_report(
    config: LlmConfig,
    mut dataset: ReportDataset,
    users: Vec<User>,
    projects: Vec<models::Project>,
    report_type: &str,
    start: &str,
    end: &str,
    as_of: &str,
    custom_notes: Option<&str>,
    prompt_override: Option<&str>,
    locale: &str,
) -> Result<GeneratedReport, String> {
    let report_name = report_type_name(report_type);
    let scoped_project_count = dataset
        .records
        .iter()
        .filter_map(|record| record.task.project_id.as_deref())
        .collect::<HashSet<_>>()
        .len();
    let fallback_title = format!("{report_name} ({start} ~ {end})");
    let period = i18n::format("runtime.startToEnd", &[("start", (start).to_string()), ("end", (end).to_string())]);
    let has_remaining_period = as_of < end;
    let user_names = users
        .into_iter()
        .map(|user| (user.id, user.nickname))
        .collect::<HashMap<_, _>>();
    let project_names = projects
        .into_iter()
        .map(|project| (project.id, project.name))
        .collect::<HashMap<_, _>>();

    let allowed_task_ids = dataset
        .records
        .iter()
        .map(|record| record.task.id.clone())
        .collect::<HashSet<_>>();
    let source_tasks = dataset
        .records
        .iter()
        .map(|record| ReportSourceTask {
            id: record.task.id.clone(),
            title: record.task.title.clone(),
            description: record.task.description.clone(),
            priority: record.task.priority.clone(),
            status: record.status_as_of.clone(),
            due_date: record.due_date_as_of.clone(),
            assignee_id: record.task.assignee_id.clone(),
            project_id: record.task.project_id.clone(),
            tags: record.task.tags.clone(),
            created_at: record.task.created_at.clone(),
            updated_at: record.task.updated_at.clone(),
        })
        .collect::<Vec<_>>();
    let mut ordered_records = dataset.records.clone();
    ordered_records.sort_by_key(|record| {
        let attention = if record.blocked_as_of || record.overdue_as_of {
            0
        } else if record.completed_in_period {
            1
        } else if record.task.priority == "P1" {
            2
        } else {
            3
        };
        (attention, record.task.due_date.clone())
    });
    if ordered_records.len() > 200 {
        ordered_records.truncate(200);
        dataset
            .data_notes
            .push(i18n::text("runtime.theNarrativeUsesThe200HighestPriority").into());
    }
    let evidence = ordered_records
        .iter()
        .map(|record| {
            json!({
                "id": record.task.id,
                "title": record.task.title,
                "description": record.task.description.chars().take(300).collect::<String>(),
                "priority": record.task.priority,
                "statusAsOf": record.status_as_of,
                "dueDate": record.due_date_as_of,
                "project": record.task.project_id.as_ref().and_then(|id| project_names.get(id)).cloned(),
                "assignee": user_names.get(&record.task.assignee_id).cloned().unwrap_or_else(|| record.task.assignee_id.clone()),
                "createdInPeriod": record.created_in_period,
                "completedInPeriod": record.completed_in_period,
                "progressedInPeriod": record.progressed_in_period,
                "blockedAsOf": record.blocked_as_of,
                "overdueAsOf": record.overdue_as_of,
                "upcomingInPeriod": record.upcoming_in_period,
                "scheduleSlipped": record.schedule_slipped,
                "events": record.event_notes,
                "tags": record.task.tags,
            })
        })
        .collect::<Vec<_>>();

    let fallback_sections =
        build_fallback_sections(&dataset.records, report_type, has_remaining_period);
    let fallback_summary = if dataset.metrics.relevant_tasks_count == 0
        && dataset.metrics.upcoming_tasks_count == 0
    {
        i18n::text("runtime.noTasksMatchTheReportScope").to_string()
    } else {
        i18n::format("runtime.asOfAsOfCompletedProgressedBlocked", &[("arg0", (dataset.metrics.completed_tasks_count).to_string()), ("arg1", (dataset.metrics.progressed_tasks_count).to_string()), ("arg2", (dataset.metrics.blocked_tasks_count).to_string()), ("arg3", (dataset.metrics.overdue_tasks_count).to_string()), ("arg4", (dataset.metrics.upcoming_tasks_count).to_string()), ("as_of", (as_of).to_string())])
    };
    let fallback_audience = if scoped_project_count == 1 {
        i18n::text("runtime.projectLeadsAndMembers")
    } else {
        i18n::text("runtime.managersReviewingOutcomesRisksAndResources")
    }
    .to_string();
    let fallback_takeaway =
        if dataset.metrics.relevant_tasks_count == 0 && dataset.metrics.upcoming_tasks_count == 0 {
            i18n::text("runtime.recordMoreTaskEvidenceBeforeDrawingConclusions").to_string()
        } else if dataset.metrics.blocked_tasks_count + dataset.metrics.overdue_tasks_count > 0 {
            i18n::format("runtime.workHasProgressedButBlockedAndOverdue", &[("arg0", (dataset.metrics.blocked_tasks_count).to_string()), ("arg1", (dataset.metrics.overdue_tasks_count).to_string())])
        } else {
            i18n::format("runtime.tasksCompletedAndProgressedFocusNextOn", &[("arg0", (dataset.metrics.completed_tasks_count).to_string()), ("arg1", (dataset.metrics.progressed_tasks_count).to_string())])
        };

    let user_instruction = prompt_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| custom_notes.map(str::trim).filter(|v| !v.is_empty()))
        .unwrap_or_else(|| i18n::text("runtime.leadWithConclusionsOrganizeByOutcomesProgress"));
    let task_json = serde_json::to_string_pretty(&evidence)
        .map_err(|error| i18n::format("runtime.couldNotOrganizeTaskDataError", &[("error", (error).to_string())]))?;
    let prompt = format!(
        r#"【汇报周期上下文】
周期：{period} (统计截止: {as_of})
语言：{locale}

【周期任务数据】
{task_json}

【提示词】
{user_instruction}"#
    );

    let llm_raw = if evidence.is_empty() {
        None
    } else {
        request_llm_text(
            &config,
            "You are a helpful AI assistant.",
            &prompt,
        )
        .await
        .ok()
    };

    let mut direct_ai_markdown: Option<String> = None;
    let content = if let Some(raw) = llm_raw {
        let trimmed = raw.trim();
        if let Ok(parsed) = parse_ai_report_content(trimmed) {
            Some(parsed)
        } else {
            let mut cleaned = trimmed;
            if cleaned.starts_with("```markdown") {
                cleaned = &cleaned[11..];
            } else if cleaned.starts_with("```") {
                cleaned = &cleaned[3..];
            }
            if cleaned.ends_with("```") {
                cleaned = &cleaned[..cleaned.len() - 3];
            }
            direct_ai_markdown = Some(cleaned.trim().to_string());
            None
        }
    } else {
        None
    };

    let (title, audience, key_takeaway, executive_summary, mut sections, generation_mode) =
        if let Some(content) = content {
            (
                if content.title.trim().is_empty() {
                    fallback_title.clone()
                } else {
                    content.title.trim().to_string()
                },
                if content.audience.trim().is_empty() {
                    fallback_audience.clone()
                } else {
                    clean_report_text(&content.audience, 120)
                },
                if content.key_takeaway.trim().is_empty() {
                    fallback_takeaway.clone()
                } else {
                    clean_report_text(&content.key_takeaway, 240)
                },
                if content.executive_summary.trim().is_empty() {
                    fallback_summary.clone()
                } else {
                    content.executive_summary.trim().to_string()
                },
                content.sections,
                "ai".to_string(),
            )
        } else if let Some(ref md) = direct_ai_markdown {
            let extracted_title = md
                .lines()
                .find(|line| line.starts_with("# "))
                .map(|line| line.trim_start_matches("# ").trim().to_string())
                .unwrap_or_else(|| fallback_title.clone());
            (
                extracted_title,
                fallback_audience,
                fallback_takeaway,
                fallback_summary,
                fallback_sections.clone(),
                "ai".to_string(),
            )
        } else {
            if !evidence.is_empty() {
                dataset
                    .data_notes
                    .push(i18n::text("runtime.modelOutputUnavailableThisReportUsesRecorded").into());
            }
            (
                fallback_title,
                fallback_audience,
                fallback_takeaway,
                fallback_summary,
                fallback_sections.clone(),
                "fallback".to_string(),
            )
        };

    sanitize_report_sections(&mut sections, &allowed_task_ids);
    if sections.is_empty() {
        sections = fallback_sections;
    }
    let raw_markdown = if let Some(md) = direct_ai_markdown {
        md
    } else {
        markdown_from_report(
            &title,
            &period,
            &audience,
            &key_takeaway,
            &executive_summary,
            &dataset.metrics,
            &sections,
            &dataset.data_notes,
        )
    };
    Ok(GeneratedReport {
        title,
        report_type: report_type.to_string(),
        period,
        as_of: as_of.to_string(),
        generated_at: Utc::now().to_rfc3339(),
        audience,
        key_takeaway,
        executive_summary,
        metrics: dataset.metrics,
        sections,
        data_notes: dataset.data_notes,
        raw_markdown,
        source_tasks,
        generation_mode,
    })
}

fn presentation_point(text: String, task_ids: Vec<String>) -> PresentationSupportingPoint {
    PresentationSupportingPoint { text, task_ids }
}

fn fallback_presentation(report: &GeneratedReport) -> GeneratedPresentation {
    let evidence = report
        .sections
        .iter()
        .filter(|section| section.kind == "achievement" || section.kind == "progress")
        .flat_map(|section| section.items.iter())
        .take(4)
        .map(|item| {
            presentation_point(
                if item.detail.trim().is_empty() {
                    item.headline.clone()
                } else {
                    format!("{}：{}", item.headline, item.detail)
                },
                item.task_ids.clone(),
            )
        })
        .collect::<Vec<_>>();
    let risks = report
        .sections
        .iter()
        .filter(|section| section.kind == "risk")
        .flat_map(|section| section.items.iter())
        .take(4)
        .map(|item| {
            presentation_point(
                if item.detail.trim().is_empty() {
                    item.headline.clone()
                } else {
                    format!("{}：{}", item.headline, item.detail)
                },
                item.task_ids.clone(),
            )
        })
        .collect::<Vec<_>>();
    let actions = report
        .sections
        .iter()
        .filter(|section| section.kind == "plan")
        .flat_map(|section| section.items.iter())
        .take(4)
        .map(|item| {
            presentation_point(
                item.next_action
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| {
                        if item.detail.trim().is_empty() {
                            item.headline.clone()
                        } else {
                            format!("{}：{}", item.headline, item.detail)
                        }
                    }),
                item.task_ids.clone(),
            )
        })
        .collect::<Vec<_>>();
    let risk_message = if risks.is_empty() {
        i18n::text("runtime.noBlockersOrOverdueTasksAreRecorded").to_string()
    } else {
        i18n::format("runtime.riskItemsNeedClearResolutionActions", &[("arg0", (risks.len()).to_string())])
    };
    let action_message = if actions.is_empty() {
        i18n::text("runtime.deliverUnfinishedWorkAndKeepTheEvidence").to_string()
    } else {
        i18n::text("runtime.turnTheMostImportantActionsIntoVerifiable").to_string()
    };
    let slides = vec![
        PresentationSlide {
            id: "opening".into(),
            purpose: i18n::text("runtime.establishThePurposeAndCentralConclusion").into(),
            title: report.title.clone(),
            core_message: report.key_takeaway.clone(),
            relation_to_previous: PresentationRelation {
                relation_type: "opening".into(),
                label: i18n::text("runtime.openingLeadWithTheKeyTakeaway").into(),
            },
            layout: "cover".into(),
            visual: PresentationVisual {
                kind: "none".into(),
                title: String::new(),
                metric_keys: Vec::new(),
            },
            supporting_points: Vec::new(),
            speaker_notes: i18n::format("runtime.for01TheFollowingSlidesExplain", &[("arg0", (report.audience).to_string()), ("arg1", (report.key_takeaway).to_string())]),
        },
        PresentationSlide {
            id: "evidence".into(),
            purpose: i18n::text("runtime.supportTheConclusionWithEvidence").into(),
            title: i18n::text("runtime.evidenceSupportingTheConclusion").into(),
            core_message: if evidence.is_empty() {
                i18n::text("runtime.thereIsNotEnoughRecordedEvidenceFor").into()
            } else {
                report.executive_summary.clone()
            },
            relation_to_previous: PresentationRelation {
                relation_type: "evidence".into(),
                label: i18n::text("runtime.transitionSupportTheTakeawayWithVerifiedFacts").into(),
            },
            layout: if evidence.len() > 1 {
                "evidence-cards".into()
            } else {
                "metric-focus".into()
            },
            visual: PresentationVisual {
                kind: "metrics".into(),
                title: i18n::text("runtime.outcomeEvidence").into(),
                metric_keys: vec!["completedTasksCount".into(), "progressedTasksCount".into()],
            },
            supporting_points: evidence,
            speaker_notes:
                i18n::text("runtime.explainTheResultsAndTheirImpactWithout").into(),
        },
        PresentationSlide {
            id: "turn".into(),
            purpose: i18n::text("runtime.identifyRisksAndConstraints").into(),
            title: if risks.is_empty() {
                i18n::text("runtime.sustainingResultsDependsOnDelivery").into()
            } else {
                i18n::text("runtime.risksStillNeedResolution").into()
            },
            core_message: risk_message,
            relation_to_previous: PresentationRelation {
                relation_type: "turn".into(),
                label: i18n::text("runtime.transitionPastResultsDoNotGuaranteeFuture").into(),
            },
            layout: "risk-action".into(),
            visual: PresentationVisual {
                kind: "bar".into(),
                title: i18n::text("runtime.riskStatus").into(),
                metric_keys: vec!["blockedTasksCount".into(), "overdueTasksCount".into()],
            },
            supporting_points: risks,
            speaker_notes: i18n::text("runtime.explainHowConstraintsAffectTheConclusionAnd")
                .into(),
        },
        PresentationSlide {
            id: "closing".into(),
            purpose: i18n::text("runtime.closeWithConcreteNextActions").into(),
            title: i18n::text("runtime.nextTurnActionsIntoVerifiableOutcomes").into(),
            core_message: action_message,
            relation_to_previous: PresentationRelation {
                relation_type: "closing".into(),
                label: i18n::text("runtime.closingActionsAddressingTheRisksAndGoals").into(),
            },
            layout: "closing".into(),
            visual: PresentationVisual {
                kind: "timeline".into(),
                title: i18n::text("runtime.actionPlan").into(),
                metric_keys: vec!["upcomingTasksCount".into()],
            },
            supporting_points: actions,
            speaker_notes: i18n::format("runtime.returnToTheKeyTakeawayHighlightThe", &[("arg0", (report.key_takeaway).to_string())]),
        },
    ];
    GeneratedPresentation {
        title: report.title.clone(),
        report_type: report.report_type.clone(),
        period: report.period.clone(),
        as_of: report.as_of.clone(),
        generated_at: Utc::now().to_rfc3339(),
        audience: report.audience.clone(),
        key_takeaway: report.key_takeaway.clone(),
        metrics: report.metrics.clone(),
        slides,
        data_notes: report.data_notes.clone(),
        generation_mode: "fallback".into(),
    }
}

fn sanitize_presentation_slides(
    slides: &mut Vec<PresentationSlide>,
    allowed_task_ids: &HashSet<String>,
) -> bool {
    const RELATIONS: [&str; 7] = [
        "opening",
        "cause",
        "progression",
        "turn",
        "evidence",
        "decision",
        "closing",
    ];
    const LAYOUTS: [&str; 10] = [
        "cover",
        "conclusion",
        "metric-focus",
        "two-column",
        "comparison",
        "timeline",
        "process",
        "evidence-cards",
        "risk-action",
        "closing",
    ];
    const VISUALS: [&str; 7] = [
        "none",
        "metrics",
        "donut",
        "bar",
        "timeline",
        "process",
        "comparison",
    ];
    const METRICS: [&str; 7] = [
        "relevantTasksCount",
        "completedTasksCount",
        "progressedTasksCount",
        "pendingTasksCount",
        "blockedTasksCount",
        "overdueTasksCount",
        "upcomingTasksCount",
    ];
    if !(3..=8).contains(&slides.len()) {
        return false;
    }
    let mut purposes = HashSet::new();
    for (index, slide) in slides.iter_mut().enumerate() {
        slide.id = if slide.id.trim().is_empty() {
            format!("slide-{}", index + 1)
        } else {
            clean_report_text(&slide.id, 40)
        };
        slide.purpose = clean_report_text(&slide.purpose, 120);
        slide.title = clean_report_text(&slide.title, 80);
        slide.core_message = clean_report_text(&slide.core_message, 300);
        slide.relation_to_previous.label =
            clean_report_text(&slide.relation_to_previous.label, 160);
        slide.speaker_notes = clean_report_text(&slide.speaker_notes, 800);
        if slide.purpose.is_empty()
            || slide.title.is_empty()
            || slide.core_message.is_empty()
            || slide.relation_to_previous.label.is_empty()
            || slide.speaker_notes.is_empty()
        {
            return false;
        }
        if !purposes.insert(slide.purpose.clone()) {
            return false;
        }
        if !RELATIONS.contains(&slide.relation_to_previous.relation_type.as_str())
            || !LAYOUTS.contains(&slide.layout.as_str())
            || !VISUALS.contains(&slide.visual.kind.as_str())
        {
            return false;
        }
        if index == 0 {
            slide.relation_to_previous.relation_type = "opening".into();
        } else if slide.relation_to_previous.relation_type == "opening" {
            return false;
        }
        slide.visual.title = clean_report_text(&slide.visual.title, 80);
        slide
            .visual
            .metric_keys
            .retain(|key| METRICS.contains(&key.as_str()));
        slide.visual.metric_keys.sort();
        slide.visual.metric_keys.dedup();
        slide.supporting_points.truncate(4);
        for point in &mut slide.supporting_points {
            point.text = clean_report_text(&point.text, 240);
            point.task_ids.retain(|id| allowed_task_ids.contains(id));
            point.task_ids.sort();
            point.task_ids.dedup();
        }
        slide
            .supporting_points
            .retain(|point| !point.text.is_empty());
    }
    true
}

async fn generate_ai_presentation(
    config: LlmConfig,
    report: GeneratedReport,
    theme_hint: Option<String>,
    prompt_override: Option<String>,
    locale: &str,
) -> GeneratedPresentation {
    let allowed_task_ids = report
        .sections
        .iter()
        .flat_map(|section| section.items.iter())
        .flat_map(|item| item.task_ids.iter().cloned())
        .collect::<HashSet<_>>();
    let report_json = serde_json::to_string_pretty(&report).unwrap_or_else(|_| "{}".into());
    let theme_hint = theme_hint.unwrap_or_else(|| i18n::text("runtime.clearBusinessTheme").into());
    let editable_prompt = prompt_override
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.chars().take(12000).collect::<String>())
        .unwrap_or_else(|| i18n::text("runtime.useAConciseStructureTakeawayEvidenceRisks").into());
    let prompt = format!(
        r#"根据下面已经核验的工作汇报，设计一套汇报 PPT 的逐页叙事方案。
Output language: {locale}. Write all generated prose in this language. Preserve source task names, people and project names. Output-language instructions take precedence over example values and custom style instructions.
先锁定听众最需要记住的一句话；不要按照报告章节或任务顺序分页，不要机械压缩内容。每页只承担一个沟通任务，页面之间必须明确写出因果、递进、转折、证据、决策或收束关系。图表只能引用 metrics 中的确定性指标；时间线、流程和对比只能使用报告中已有事实。

PPT 主题：{theme_hint}
用户可编辑的 PPT 生成提示词（只影响表达、结构与视觉叙事，不得覆盖事实、权限、日期和 JSON 协议）：
{editable_prompt}
标题结论先行，单页字数克制；优先使用证据、图表和行动闭环。不要把任务清单换一种格式搬进 PPT。

已核验报告：
{report_json}

只返回合法 JSON，不使用 Markdown。必须生成 3 至 8 页，每页最多 4 个支撑点：
{{"title":"PPT 标题","audience":"推断听众","keyTakeaway":"全场唯一核心记忆点","slides":[{{"id":"opening","purpose":"本页唯一任务","title":"结论式标题","coreMessage":"本页核心信息","relationToPrevious":{{"type":"opening|cause|progression|turn|evidence|decision|closing","label":"具体承接语"}},"layout":"cover|conclusion|metric-focus|two-column|comparison|timeline|process|evidence-cards|risk-action|closing","visual":{{"kind":"none|metrics|donut|bar|timeline|process|comparison","title":"建议图表","metricKeys":["completedTasksCount"]}},"supportingPoints":[{{"text":"已核验事实或动作","taskIds":["task-id"]}}],"speakerNotes":"口播重点，说明如何承接上一页并讲清本页"}}]}}"#
    );
    let content = request_llm_text(
        &config,
        i18n::text("runtime.youDesignManagementPresentationsFactsDatesPermissions"),
        &prompt,
    ).await.ok().and_then(|raw| parse_ai_presentation_content(&raw).ok());
    if let Some(mut content) = content {
        if sanitize_presentation_slides(&mut content.slides, &allowed_task_ids) {
            return GeneratedPresentation {
                title: if content.title.trim().is_empty() {
                    report.title.clone()
                } else {
                    clean_report_text(&content.title, 100)
                },
                report_type: report.report_type.clone(),
                period: report.period.clone(),
                as_of: report.as_of.clone(),
                generated_at: Utc::now().to_rfc3339(),
                audience: if content.audience.trim().is_empty() {
                    report.audience.clone()
                } else {
                    clean_report_text(&content.audience, 120)
                },
                key_takeaway: if content.key_takeaway.trim().is_empty() {
                    report.key_takeaway.clone()
                } else {
                    clean_report_text(&content.key_takeaway, 240)
                },
                metrics: report.metrics.clone(),
                slides: content.slides,
                data_notes: report.data_notes.clone(),
                generation_mode: "ai".into(),
            };
        }
    }
    let mut fallback = fallback_presentation(&report);
    fallback
        .data_notes
        .push(i18n::text("runtime.modelOutputUnavailableTheSlidePlanUses").into());
    fallback
}

#[cfg(test)]
mod ai_generation_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn parses_report_json_from_a_fenced_model_response() {
        let response = r##"```json
        {
          "title": "研发周报",
          "period": "2026-07-20 至 2026-07-26",
          "audience": "研发负责人",
          "keyTakeaway": "同步模块已经形成可验证交付。",
          "executiveSummary": "本周完成同步模块。",
          "sections": [{
            "id": "achievement",
            "kind": "achievement",
            "title": "本周交付",
            "items": [{"headline": "完成同步模块", "detail": "完成核心链路。", "taskIds": ["task-1"]}]
          }]
        }
        ```"##;
        let report = parse_ai_report_content(response).expect("report JSON should parse");

        assert_eq!(report.title, "研发周报");
        assert_eq!(report.audience, "研发负责人");
        assert_eq!(report.key_takeaway, "同步模块已经形成可验证交付。");
        assert_eq!(report.executive_summary, "本周完成同步模块。");
        assert_eq!(report.sections[0].items[0].headline, "完成同步模块");
    }

    fn valid_presentation_slide(id: &str, purpose: &str, relation_type: &str) -> PresentationSlide {
        PresentationSlide {
            id: id.into(),
            purpose: purpose.into(),
            title: format!("{purpose}标题"),
            core_message: "本页核心信息".into(),
            relation_to_previous: PresentationRelation {
                relation_type: relation_type.into(),
                label: "承接上一页形成明确关系".into(),
            },
            layout: "evidence-cards".into(),
            visual: PresentationVisual {
                kind: "metrics".into(),
                title: "确定性指标".into(),
                metric_keys: vec!["completedTasksCount".into(), "inventedMetric".into()],
            },
            supporting_points: vec![PresentationSupportingPoint {
                text: "核验证据".into(),
                task_ids: vec!["task-allowed".into(), "task-invented".into()],
            }],
            speaker_notes: "说明页面承接并讲清核心信息。".into(),
        }
    }

    #[test]
    fn sanitizes_presentation_references_and_keeps_a_valid_story() {
        let mut slides = vec![
            valid_presentation_slide("one", "先给结论", "cause"),
            valid_presentation_slide("two", "提供证据", "evidence"),
            valid_presentation_slide("three", "形成收束", "closing"),
        ];
        let allowed = HashSet::from(["task-allowed".to_string()]);

        assert!(sanitize_presentation_slides(&mut slides, &allowed));
        assert_eq!(slides[0].relation_to_previous.relation_type, "opening");
        assert_eq!(slides[0].visual.metric_keys, vec!["completedTasksCount"]);
        assert_eq!(
            slides[0].supporting_points[0].task_ids,
            vec!["task-allowed"]
        );
    }

    #[test]
    fn rejects_duplicate_page_purposes_or_missing_narrative_links() {
        let allowed = HashSet::new();
        let mut duplicate = vec![
            valid_presentation_slide("one", "同一任务", "opening"),
            valid_presentation_slide("two", "同一任务", "evidence"),
            valid_presentation_slide("three", "收束", "closing"),
        ];
        assert!(!sanitize_presentation_slides(&mut duplicate, &allowed));

        let mut missing_link = vec![
            valid_presentation_slide("one", "结论", "opening"),
            valid_presentation_slide("two", "证据", "evidence"),
            valid_presentation_slide("three", "收束", "closing"),
        ];
        missing_link[1].relation_to_previous.label.clear();
        assert!(!sanitize_presentation_slides(&mut missing_link, &allowed));
    }

    #[test]
    fn parses_extended_quick_task_fields() {
        let response = r#"{
          "title": "提交周报",
          "dueDate": "2026-07-27",
          "reminderTime": "2026-07-27T09:00",
          "priority": "P1",
          "projectName": "协同项目",
          "assigneeName": "张三",
          "recurrence": "weekly",
          "recurrenceRule": {"interval": 1, "daysOfWeek": [1], "timeOfDay": "09:00"},
          "tags": ["周报"]
        }"#;
        let task: models::QuickParseResult =
            parse_json_object(response, "任务信息").expect("task JSON should parse");

        assert_eq!(task.assignee_name.as_deref(), Some("张三"));
        assert_eq!(task.recurrence.as_deref(), Some("weekly"));
        assert_eq!(
            task.recurrence_rule
                .as_ref()
                .and_then(|rule| rule.days_of_week.first())
                .copied(),
            Some(1u8)
        );
        assert_eq!(task.reminder_time.as_deref(), Some("2026-07-27T09:00"));
    }

    #[tokio::test]
    async fn sends_period_tasks_to_the_configured_openai_endpoint() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test server should bind");
        let address = listener.local_addr().expect("test address should exist");
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("request should connect");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                let read = stream.read(&mut buffer).await.expect("request should read");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|value| value.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if request.len() >= header_end + 4 + content_length {
                        break;
                    }
                }
            }
            let report_json = json!({
                "title": "AI 日报",
                "period": "2026-07-25 至 2026-07-25",
                "executiveSummary": "完成周期任务。",
                "sections": [{
                    "id": "achievement",
                    "kind": "achievement",
                    "title": "今日完成",
                    "items": [{
                        "headline": "完成周期任务",
                        "detail": "任务已完成。",
                        "taskIds": ["task-report-test"]
                    }]
                }]
            })
            .to_string();
            let body = json!({"choices": [{"message": {"content": report_json}}]}).to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("response should write");
            String::from_utf8(request).expect("request should be utf-8")
        });
        let config = LlmConfig { generation_parameters:None,
            protocol: "openai".into(),
            base_url: format!("http://{address}/v1"),
            api_key: String::new(),
            model_name: "test-model".into(),
        };
        let task = Task {
            workspace_id: None,
            id: "task-report-test".into(),
            title: "周期任务".into(),
            description: "用于验证模型提示词".into(),
            priority: "P1".into(),
            status: "completed".into(),
            state_id: Some("state-test-done".into()),
            state_group: Some("completed".into()),
            state_name: Some("Done".into()),
            identifier: None,
            sequence_number: None,
            progress: 100,
            start_date: None,
            due_date: Some("2026-07-25".into()),
            recurrence: Some("none".into()),
            recurrence_rule: None,
            reminder_time: None,
            creator_id: "user-1".into(),
            assignee_id: "user-1".into(),
            project_id: None,
            parent_task_id: None,
            content_mode: "markdown".into(),
            abandoned_at: None,
            is_shared: false,
            shared_with: Vec::new(),
            subtasks: Vec::new(),
            attachments: Vec::new(),
            tags: vec!["测试".into()],
            created_at: "2026-07-25T08:00:00Z".into(),
            updated_at: "2026-07-25T09:00:00Z".into(),
            version: 1,
        };

        let dataset = ReportDataset {
            records: vec![ReportTaskRecord {
                task,
                status_as_of: "completed".into(),
                due_date_as_of: Some("2026-07-25".into()),
                created_in_period: false,
                completed_in_period: true,
                progressed_in_period: false,
                blocked_as_of: false,
                overdue_as_of: false,
                upcoming_in_period: false,
                schedule_slipped: false,
                event_notes: vec!["状态变更为 completed".into()],
            }],
            metrics: ReportMetrics {
                relevant_tasks_count: 1,
                completed_tasks_count: 1,
                progressed_tasks_count: 0,
                pending_tasks_count: 0,
                blocked_tasks_count: 0,
                overdue_tasks_count: 0,
                upcoming_tasks_count: 0,
            },
            data_notes: Vec::new(),
        };
        let report = generate_ai_report(
            config,
            dataset,
            Vec::new(),
            Vec::new(),
            "daily",
            "2026-07-25",
            "2026-07-25",
            "2026-07-25",
            None,
            None,
            "zh-CN",
        )
        .await
        .expect("AI report should generate");
        let request = server.await.expect("test server should finish");

        assert!(request.contains("周期任务"));
        assert_eq!(report.metrics.completed_tasks_count, 1);
        assert_eq!(report.sections[0].items[0].headline, "完成周期任务");
    }
}

fn publish_app_lock_status(app: &AppHandle, status: &app_lock::AppLockStatus) {
    // Events from concurrent activity/configuration commands may arrive out of order.
    let latest = app.try_state::<AppState>().and_then(|state| state.app_lock.status().ok());
    let status = latest.as_ref().unwrap_or(status);
    if let Some(state) = app.try_state::<AppState>() {
        if status.locked {
            state.ai.cancel_all();
            screenshot::cancel(app);
            for (label, window) in app.webview_windows() {
                if label == "main" { continue; }
                if window.is_visible().unwrap_or(false) && matches!(label.as_str(), "desktop-calendar" | "quick-add" | "optical-transfer") {
                    if let Ok(mut hidden) = state.lock_hidden_windows.lock() {
                        if !hidden.contains(&label) { hidden.push(label.clone()); }
                    }
                }
                let _ = window.hide();
            }
        } else {
            let hidden = state.lock_hidden_windows.lock().map(|mut labels| std::mem::take(&mut *labels)).unwrap_or_default();
            for label in hidden {
                if label == "desktop-calendar" {
                    let calendar_app = app.clone();
                    tauri::async_runtime::spawn(async move { let _ = desktop_calendar::show_desktop_calendar(&calendar_app).await; });
                } else if let Some(window) = app.get_webview_window(&label) { let _ = window.show(); }
            }
        }
    }
    let _ = app.emit(app_lock::STATE_EVENT, status);
}

fn app_interface_locked(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<AppState>() else { return false; };
    if let Ok(Some(status)) = state.app_lock.tick() { publish_app_lock_status(app, &status); }
    state.app_lock.status().map(|status| status.locked).unwrap_or(true)
}

#[tauri::command]
fn get_close_button_behavior(state: State<AppState>) -> CloseButtonBehavior {
    if state.close_button_exits.load(Ordering::Acquire) {
        CloseButtonBehavior::Exit
    } else {
        CloseButtonBehavior::Tray
    }
}

#[tauri::command]
fn set_close_button_behavior(state: State<AppState>, behavior: CloseButtonBehavior) -> Result<CloseButtonBehavior, String> {
    let db = state.db.lock().map_err(|_| "数据库暂时不可用")?;
    db.save_close_button_behavior(behavior)?;
    // Publish only after persistence succeeds, while writes are still serialized.
    state.close_button_exits.store(behavior == CloseButtonBehavior::Exit, Ordering::Release);
    Ok(behavior)
}

#[tauri::command]
async fn get_app_lock_status(app: AppHandle) -> Result<app_lock::AppLockStatus, String> {
    // WebViews can query before setup has finished constructing AppState. Using
    // a State argument rejects the request before this command can wait for it.
    for _ in 0..50 {
        if let Some(state) = app.try_state::<AppState>() {
            if let Some(status) = state.app_lock.tick()? { publish_app_lock_status(&app, &status); }
            return state.app_lock.status();
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err("程序初始化尚未完成，请稍后重新读取锁定状态".into())
}

#[tauri::command]
fn record_app_activity(app: AppHandle, state: State<AppState>) -> Result<app_lock::AppLockStatus, String> {
    let was_locked = state.app_lock.status()?.locked;
    let status = state.app_lock.activity()?;
    if status.locked && !was_locked { publish_app_lock_status(&app, &status); }
    Ok(status)
}

#[tauri::command]
fn lock_app(app: AppHandle, window: tauri::WebviewWindow, state: State<AppState>) -> Result<app_lock::AppLockStatus, String> {
    if window.label() != "main" { return Err("请在主界面锁定程序".into()); }
    let status = state.app_lock.lock()?;
    publish_app_lock_status(&app, &status);
    Ok(status)
}

#[tauri::command]
async fn unlock_app(app: AppHandle, window: tauri::WebviewWindow, state: State<'_, AppState>, password: String) -> Result<app_lock::AppLockStatus, String> {
    if window.label() != "main" { return Err("请在主界面解锁程序".into()); }
    let runtime = state.app_lock.clone();
    let status = tauri::async_runtime::spawn_blocking(move || runtime.unlock(&password)).await.map_err(|e| e.to_string())??;
    publish_app_lock_status(&app, &status);
    Ok(status)
}

#[tauri::command]
async fn update_app_lock_config(app: AppHandle, window: tauri::WebviewWindow, state: State<'_, AppState>, enabled: bool, idle_minutes: u32, password: Option<String>, current_password: Option<String>, clear_password: Option<bool>) -> Result<app_lock::AppLockStatus, String> {
    if window.label() != "main" { return Err("自动锁定只能在主界面设置中配置".into()); }
    let runtime = state.app_lock.clone();
    let database = state.db.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let previous = runtime.config()?;
        let config = if clear_password.unwrap_or(false) {
            if enabled || password.as_deref().is_some_and(|value| !value.is_empty()) { return Err("清除密码时必须关闭自动锁定，且不能同时设置新密码".into()); }
            app_lock::prepare_password_clear(&previous, current_password.as_deref())?
        } else {
            app_lock::prepare_config(&previous, enabled, idle_minutes, password.as_deref(), current_password.as_deref())?
        };
        runtime.configure(config, &previous.password_hash, |config| {
            database.lock().map_err(|_| "数据库暂时不可用")?.save_app_lock_config(config)
        })
    }).await.map_err(|e| e.to_string())?;
    if result.is_err() {
        if let Ok(status) = state.app_lock.status() {
            if status.locked { publish_app_lock_status(&app, &status); }
        }
    }
    let status = result?;
    publish_app_lock_status(&app, &status);
    Ok(status)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn open_optical_window(app: AppHandle) -> Result<(), String> {
    if app_interface_locked(&app) { show_main_window(&app); return Ok(()); }
    if let Some(window) = app.get_webview_window("optical-transfer") {
        window.show().map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "optical-transfer",
        WebviewUrl::App("optical-transfer.html".into()),
    )
    .title("光学文件传输")
    .inner_size(1280.0, 820.0)
    .min_inner_size(920.0, 680.0)
    .resizable(true)
    .decorations(false)
    .center()
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn reveal_main_window(app: AppHandle) {
    MAIN_WINDOW_READY.store(true, Ordering::Release);
    show_main_window(&app);
}

#[tauri::command]
fn main_window_ready(app: AppHandle) {
    MAIN_WINDOW_READY.store(true, Ordering::Release);
    if !STARTED_BY_AUTOSTART.load(Ordering::Acquire) {
        show_main_window(&app);
    }
}

fn show_quick_add_window(app: &AppHandle) -> bool {
    if app_interface_locked(app) { show_main_window(app); return true; }
    let Some(window) = app.get_webview_window("quick-add") else {
        return false;
    };
    let _ = window.center();
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("quick-add://opened", ());
    true
}

fn present_notification_window(app: &AppHandle, notification: &Value) -> Result<(), String> {
    if app_interface_locked(app) { return Ok(()); }
    let window = app
        .get_webview_window("notification")
        .ok_or_else(|| "提醒窗口不可用".to_string())?;
    let monitor = app
        .get_webview_window("main")
        .and_then(|main| main.current_monitor().ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let work_area = monitor.work_area();
        let scale = monitor.scale_factor();
        let target_width = (420.0 * scale).round() as u32;
        let target_height = (210.0 * scale).round() as u32;
        let margin = (16.0 * scale).round() as u32;
        let x = work_area.position.x
            + work_area
                .size
                .width
                .saturating_sub(target_width.saturating_add(margin)) as i32;
        let y = work_area.position.y
            + work_area
                .size
                .height
                .saturating_sub(target_height.saturating_add(margin)) as i32;
        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(target_width, target_height)));
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }

    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    window
        .show()
        .map_err(|error| format!("无法显示提醒窗口: {error}"))?;

    // Multi-channel broadcast: window direct, app emit_to, and app global emit
    let _ = window.emit("notification://show", notification);
    let _ = app.emit_to("notification", "notification://show", notification);
    let _ = app.emit("notification://show", notification);

    // Asynchronous delayed re-broadcast: handles WebView2 waking from suspended/throttled state
    let app_handle = app.clone();
    let payload = notification.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        let valid=app_handle.try_state::<AppState>().is_some_and(|s| s.db.lock().ok().is_some_and(|db| db.workspace_context().is_ok_and(|ctx| payload["workspaceId"].as_str()==Some(&ctx.workspace_id) && payload["workspaceRevision"].as_u64()==Some(ctx.revision))));
        if !valid { return; }
        if let Some(w) = app_handle.get_webview_window("notification") {
            let _ = w.emit("notification://show", &payload);
            let _ = app_handle.emit_to("notification", "notification://show", &payload);
        }
    });

    Ok(())
}

#[tauri::command]
fn show_notification_window(
    app: AppHandle,
    state: State<AppState>,
    mut notification: Value, workspace_context: WorkspaceContext) -> Result<(), String> {
    with_workspace_db(&state,&workspace_context,|_| Ok(()))?;
    notification["workspaceId"]=json!(workspace_context.workspace_id); notification["workspaceRevision"]=json!(workspace_context.revision);
    {
        let mut pending = state
            .pending_notifications
            .lock()
            .map_err(|_| "提醒队列暂时不可用".to_string())?;
        if pending.len() >= 50 {
            pending.remove(0);
        }
        pending.push(notification.clone());
    }

    // Always unminimize, position, and show window immediately to wake up WebView2
    present_notification_window(&app, &notification)
}

#[tauri::command]
fn resize_notification_window(app: AppHandle, height: f64) -> Result<(), String> {
    if !height.is_finite() { return Err("Invalid notification height".into()); }
    let Some(window) = app.get_webview_window("notification") else { return Ok(()); };
    let monitor = window.current_monitor().ok().flatten().or_else(|| window.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let area = monitor.work_area(); let scale = monitor.scale_factor();
        let margin = (16.0 * scale).round() as u32;
        let width = (420.0 * scale).round() as u32;
        let height = ((height.max(210.0) * scale).round() as u32).min(area.size.height.saturating_sub(margin * 2));
        window.set_size(tauri::PhysicalSize::new(width.min(area.size.width), height)).map_err(|error| error.to_string())?;
        window.set_position(PhysicalPosition::new(area.position.x + area.size.width.saturating_sub(width + margin) as i32, area.position.y + area.size.height.saturating_sub(height + margin) as i32)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_pending_notifications(state: State<AppState>, workspace_context: WorkspaceContext) -> Result<Vec<Value>, String> {
    with_workspace_db(&state,&workspace_context,|_| Ok(()))?;
    let mut pending = state
        .pending_notifications
        .lock()
        .map_err(|_| "提醒队列暂时不可用".to_string())?;
    state.notification_ready.store(true, Ordering::Release);
    Ok(std::mem::take(&mut *pending))
}

#[tauri::command]
fn notification_window_ready(app: AppHandle, state: State<AppState>, workspace_context: WorkspaceContext) -> Result<(), String> {
    with_workspace_db(&state,&workspace_context,|_| Ok(()))?;
    let pending = {
        let mut pending = state
            .pending_notifications
            .lock()
            .map_err(|_| "提醒队列暂时不可用".to_string())?;
        state.notification_ready.store(true, Ordering::Release);
        std::mem::take(&mut *pending)
    };

    for notification in pending {
        let _ = present_notification_window(&app, &notification);
    }
    Ok(())
}

#[tauri::command]
fn update_tray_unread_status(
    app: AppHandle,
    state: State<AppState>,
    unread_users: Vec<TrayUnreadUser>, workspace_context: WorkspaceContext) -> Result<(), String> {
    with_workspace_db(&state,&workspace_context,|_| Ok(()))?;
    let tray = match app.tray_by_id("main-tray") {
        Some(t) => t,
        None => return Ok(()),
    };

    {
        let mut stored = state
            .tray_unread
            .lock()
            .map_err(|_| "托盘未读状态暂时不可用".to_string())?;
        *stored = unread_users.clone();
    }
    let _ = app.emit_to("tray-unread", "tray://unread_updated", &unread_users);
    let generation = state.tray_generation.fetch_add(1, Ordering::AcqRel) + 1;
    state.tray_blinking.store(false, Ordering::Release);

    if unread_users.is_empty() {
        if let Some(default_icon) = app.default_window_icon() {
            let _ = tray.set_icon(Some(default_icon.clone()));
        }
        let _ = tray.set_tooltip(Some(i18n::translate(&i18n::app_locale(&app), "native", "tray.tooltip", &[])));
        if let Some(window) = app.get_webview_window("tray-unread") {
            let _ = window.hide();
        }
    } else {
        let mut lines = Vec::new();
        for user in &unread_users {
            lines.push(i18n::translate(&i18n::app_locale(&app), "native", "tray.unread", &[("name", user.name.clone()), ("count", user.count.to_string())]));
        }
        let tooltip_text = lines.join("\n");
        let _ = tray.set_tooltip(Some(&tooltip_text));

        let icon_bytes = if unread_users.len() == 1 {
            unread_users[0]
                .icon_rgba
                .clone()
                .filter(|bytes| bytes.len() == 32 * 32 * 4)
                .unwrap_or_else(|| CHAT_TRAY_RGBA.to_vec())
        } else {
            CHAT_TRAY_RGBA.to_vec()
        };
        state.tray_blinking.store(true, Ordering::Release);
        let app_handle = app.clone();
        let blinking_flag = state.tray_blinking.clone();
        let generation_flag = state.tray_generation.clone();
        std::thread::spawn(move || {
            let active_icon = tauri::image::Image::new_owned(icon_bytes, 32, 32);
            let empty_icon = tauri::image::Image::new_owned(CHAT_TRAY_EMPTY_RGBA.to_vec(), 32, 32);
            let mut is_on = false;
            while blinking_flag.load(Ordering::Acquire)
                && generation_flag.load(Ordering::Acquire) == generation
            {
                if let Some(tray) = app_handle.tray_by_id("main-tray") {
                    let icon = if is_on { empty_icon.clone() } else { active_icon.clone() };
                    let _ = tray.set_icon(Some(icon));
                    is_on = !is_on;
                }
                std::thread::sleep(std::time::Duration::from_millis(450));
            }

            if generation_flag.load(Ordering::Acquire) == generation {
                if let Some(tray) = app_handle.tray_by_id("main-tray") {
                    if let Some(default_icon) = app_handle.default_window_icon() {
                        let _ = tray.set_icon(Some(default_icon.clone()));
                    }
                }
            }
        });
    }

    Ok(())
}

fn show_tray_unread_popup_at(app: &AppHandle, x: i32, y: i32) {
    if app_interface_locked(app) { return; }
    let Some(window) = app.get_webview_window("tray-unread") else { return; };
    if let Some(state) = app.try_state::<AppState>() {
        state.tray_popup_generation.fetch_add(1, Ordering::AcqRel);
    }
    let width = 350i32;
    let height = 280i32;
    let popup_x = (x - width + 18).max(0);
    let popup_y = if y > height { y - height - 8 } else { y + 24 };
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(width as u32, height as u32)));
    let _ = window.set_position(PhysicalPosition::new(popup_x, popup_y));
    let _ = window.show();
    let _ = window.set_focus();
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(unread) = state.tray_unread.lock() {
            let _ = window.emit("tray://unread_updated", &*unread);
        }
    }
}

#[tauri::command]
fn open_tray_unread_conversation(app: AppHandle, conversation: Value) -> Result<(), String> {
    show_main_window(&app);
    let _ = app.emit("chat://open_conversation", conversation);
    if let Some(window) = app.get_webview_window("tray-unread") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
fn hide_tray_unread_popup(app: AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<AppState>() {
        state.tray_popup_generation.fetch_add(1, Ordering::AcqRel);
    }
    if let Some(window) = app.get_webview_window("tray-unread") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
fn keep_tray_unread_popup_open(state: State<AppState>) {
    state.tray_popup_generation.fetch_add(1, Ordering::AcqRel);
}

pub fn update_tray_desktop_calendar_menu(app: &AppHandle, is_pinned: bool) {
    let locale = i18n::app_locale(app);
    if let Some(tray) = app.tray_by_id("main-tray") {
        if let Ok(show_item) = MenuItem::with_id(app, "show", i18n::translate(&locale, "native", "tray.show", &[]), true, None::<&str>)
        {
            if let Ok(desktop_cal_item) = CheckMenuItem::with_id(
                app,
                "desktop_cal",
                i18n::translate(&locale, "native", "tray.calendar", &[]),
                true,
                is_pinned,
                None::<&str>,
            ) {
                if let Ok(quit_item) =
                    MenuItem::with_id(app, "quit", i18n::translate(&locale, "native", "tray.quit", &[]), true, None::<&str>)
                {
                    if let Ok(menu) =
                        Menu::with_items(app, &[&show_item, &desktop_cal_item, &quit_item])
                    {
                        let _ = tray.set_menu(Some(menu));
                    }
                }
            }
        }
    }
}

pub(crate) fn refresh_tray_locale(app: &AppHandle) {
    update_tray_desktop_calendar_menu(app, desktop_calendar::is_active());
}

fn with_db<T>(
    state: &State<'_, AppState>,
    operation: impl FnOnce(&Database) -> Result<T, String>,
) -> Result<T, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "本地数据库正在被其他操作占用".to_string())?;
    operation(&db)
}

fn with_workspace_db<T>(state: &State<'_,AppState>, context: &WorkspaceContext, operation: impl FnOnce(&Database)->Result<T,String>) -> Result<T,String> {
    with_db(state, |db| { db.validate_workspace_context(context)?; operation(db) })
}

#[tauri::command]
fn get_workspace_context(state: State<AppState>) -> Result<Value,String> {
    with_db(&state, |db| { let mut value=serde_json::to_value(db.workspace_context()?).map_err(|e| e.to_string())?; value["originalWorkspaceId"]=json!(db.setting("workspaceOriginalId")?); value["originalUserId"]=json!(db.setting("workspaceOriginalUserId")?); Ok(value) })
}
#[tauri::command]
fn get_workspace_data(state: State<AppState>, workspace_context: WorkspaceContext, feature: String) -> Result<Option<Value>,String> {
    with_workspace_db(&state, &workspace_context, |db| db.read_private_data(&feature))
}
#[tauri::command]
fn save_workspace_data(state: State<AppState>, workspace_context: WorkspaceContext, feature: String, payload: Value) -> Result<(),String> {
    with_workspace_db(&state, &workspace_context, |db| db.save_private_data(&feature,&payload))
}

fn emit_tasks_changed(app: &AppHandle, action: &str, task_id: Option<&str>) {
    let _ = app.emit(
        TASKS_CHANGED_EVENT,
        json!({"action": action, "taskId": task_id}),
    );
}

#[tauri::command]
fn save_wiki_changes(app: AppHandle, state: State<AppState>, workspace_context: WorkspaceContext, payload: Value) -> Result<Value,String> {
    let result = with_workspace_db(&state, &workspace_context, |db| db.save_wiki_changes(&payload, &workspace_context.user_id))?;
    let _ = app.emit("sync://operation",json!({"source":"wiki","workspaceId":workspace_context.workspace_id}));
    Ok(result)
}

fn current_session_user(db: &Database, supplied_user_id: Option<&str>) -> Result<String, String> {
    let current_user_id = db.current_user_id()?;
    if supplied_user_id.is_some_and(|user_id| user_id != current_user_id) {
        return Err("请求用户与当前桌面会话身份不一致，请刷新后重试".into());
    }
    Ok(current_user_id)
}

#[tauri::command]
fn get_bootstrap(state: State<AppState>) -> Result<BootstrapData, String> {
    with_db(&state, |db| {
        // Older local databases can retain a missing/stale currentUserId after
        // an identity was removed. Recover from the local users table before
        // failing the entire desktop session bootstrap.
        let users = db.users()?;
        let configured_id = db.current_user_id().ok();
        let current_user = configured_id
            .as_deref()
            .and_then(|id| users.iter().find(|user| user.id == id))
            .cloned()
            .or_else(|| users.first().cloned())
            .ok_or_else(|| "本机用户记录为空，无法初始化桌面身份".to_string())?;
        if configured_id.as_deref() != Some(current_user.id.as_str()) {
            db.set_current_user(&current_user.id)?;
        }
        let (workspace_id, workspace_name) = db.workspace()?;
        let workspace = db.workspace_record()?;
        Ok(BootstrapData {
            workspace_id,
            workspace_name,
            workspace,
            device_id: current_user.device_id.clone(),
            current_user,
        })
    })
}

fn emit_workspace_changed(app: &AppHandle, action: &str) {
    let context=app.try_state::<AppState>().and_then(|s| s.db.lock().ok().and_then(|db| db.workspace_context().ok()));
    if let (Some(state),Some(scope))=(app.try_state::<AppState>(),context.as_ref()){state.ai.cancel_stale(scope);}
    let _ = app.emit(WORKSPACE_CHANGED_EVENT, json!({"action": action, "context": context}));
}

fn emit_states_changed(app: &AppHandle, action: &str, state_id: Option<&str>) {
    let _ = app.emit(
        STATES_CHANGED_EVENT,
        json!({"action": action, "stateId": state_id}),
    );
}

#[tauri::command]
fn get_states(
    state: State<AppState>,
    project_id: Option<String>,
    current_user_id: Option<String>, workspace_context: WorkspaceContext) -> Result<Vec<models::State>, String> {
    if current_user_id.as_deref().is_some_and(|id| id!=workspace_context.user_id) { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, current_user_id.as_deref())?;
        match project_id.as_deref() {
            Some(project_id) => db.states_for_scope(Some(project_id), None),
            None => db.states(&current_user_id),
        }
    })
}

/// The draft arrives under the key `state`, so the payload argument is named to
/// match and the app state is reached through the handle instead of being
/// injected. Tauri derives payload keys from argument names, and `State` has no
/// per-argument rename.
#[tauri::command(rename_all = "camelCase")]
fn create_state(
    app: AppHandle,
    state: Value,
    current_user_id: String,
) -> Result<models::State, String> {
    let app_state = app.state::<AppState>();
    let created = with_db(&app_state, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.create_state(state, &current_user_id)
    })?;
    emit_states_changed(&app, "created", Some(&created.id));
    Ok(created)
}

#[tauri::command]
fn update_state(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    updates: Value,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::State, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let updated = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.update_state(&id, updates, &current_user_id)
    })?;
    emit_states_changed(&app, "updated", Some(&updated.id));
    Ok(updated)
}

#[tauri::command]
fn delete_state(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<bool, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let deleted = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.delete_state(&id, &current_user_id)
    })?;
    emit_states_changed(&app, "deleted", Some(&id));
    Ok(deleted)
}

#[tauri::command]
fn reorder_states(
    app: AppHandle,
    state: State<AppState>,
    project_id: Option<String>,
    ordered_ids: Vec<String>,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<Vec<models::State>, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let states = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.reorder_states(project_id.as_deref(), ordered_ids, &current_user_id)
    })?;
    emit_states_changed(&app, "reordered", None);
    Ok(states)
}

#[tauri::command]
fn set_default_state(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::State, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let updated = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.set_default_state(&id, &current_user_id)
    })?;
    emit_states_changed(&app, "default", Some(&updated.id));
    Ok(updated)
}

#[tauri::command]
fn get_workspace(state: State<AppState>) -> Result<Workspace, String> {
    with_db(&state, Database::workspace_record)
}

#[tauri::command]
fn get_workspaces(state: State<AppState>) -> Result<Vec<Workspace>, String> {
    with_db(&state, Database::list_workspaces)
}

#[tauri::command]
fn create_workspace(
    app: AppHandle,
    state: State<AppState>,
    name: String,
    slug: Option<String>,
    timezone: Option<String>,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<Workspace, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let ws = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.create_workspace(&name, slug.as_deref(), timezone.as_deref(), &current_user_id)
    })?;
    emit_workspace_changed(&app, "created");
    Ok(ws)
}

#[tauri::command]
fn delete_workspace(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<(), String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let current=with_workspace_db(&state,&workspace_context,Database::workspace_context)?;
    let workspace_context=if workspace_id==current.workspace_id {
        let next=with_workspace_db(&state,&workspace_context,|db| db.list_workspaces()?.into_iter().find(|ws| ws.id!=workspace_id).ok_or_else(|| "至少保留一个工作区".to_string()))?;
        switch_workspace(app.clone(),state.clone(),next.id,current_user_id.clone(),workspace_context)?;
        with_db(&state,Database::workspace_context)?
    } else { workspace_context };
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.delete_workspace(&workspace_id, &current_user_id)
    })?;
    emit_workspace_changed(&app, "deleted");
    Ok(())
}

/// Serializes dissolution with workspace switching. The database transaction
/// chooses a valid fallback before the runtime is restarted; stale IPC, MCP and
/// Web authorizations are invalidated by the new workspace revision.
fn change_dissolved_workspace(
    app: &AppHandle,
    workspace_id: &str,
    operation: impl FnOnce(&Database) -> Result<bool, String>,
) -> Result<(), String> {
    let state = app.try_state::<AppState>().ok_or("应用尚未初始化")?;
    let mut runtime = state.network.lock().map_err(|e| e.to_string())?;
    let (changed, before, after, token) = with_db(&state, |db| {
        let before = db.workspace_context()?;
        let changed = operation(db)?;
        Ok((changed, before, db.workspace_context()?, db.workspace_token()?))
    })?;
    if !changed { return Ok(()); }
    if before != after {
        runtime.stop();
        let next = network::start(app.clone(), state.db.clone(), after.workspace_id.clone(), token, after.user_id.clone());
        if let Ok(next) = next {
            next.set_http_file_port(state.file_server.port());
            *runtime = next;
        } else {
            // Dissolution has committed. Do not report a failed deletion or
            // restore the dissolved workspace if restarting networking fails.
            let _ = app.emit("network://error", json!({"message":"工作区已解散，网络服务启动失败，请重启应用"}));
        }
        if let Ok(mut pending) = state.pending_notifications.lock() { pending.clear(); }
        if let Ok(mut unread) = state.tray_unread.lock() { unread.clear(); }
        state.tray_generation.fetch_add(1, Ordering::AcqRel);
    }
    drop(runtime);
    state.ai.cancel_stale(&after);
    if let Err(error) = file_server::purge_workspace_files(state.file_server.storage_root(), workspace_id) {
        eprintln!("解散工作区文件清理待重试: {error}");
    }
    let _ = app.emit(WORKSPACE_CHANGED_EVENT, json!({
        "action":"dissolved", "dissolvedWorkspaceId":workspace_id, "context":after,
    }));
    Ok(())
}

fn receive_workspace_dissolution(app: &AppHandle, packet: &workspace_dissolution::DissolutionPacket) -> Result<(), String> {
    change_dissolved_workspace(app, &packet.workspace_id, |db| db.apply_workspace_dissolution(packet))
}

fn receive_workspace_membership(app: &AppHandle, packet: &workspace_membership::MembershipPacket) -> Result<(), String> {
    let state = app.try_state::<AppState>().ok_or("应用尚未初始化")?;
    let mut runtime = state.network.lock().map_err(|e| e.to_string())?;
    let (added, changed, before, after, token) = with_db(&state, |db| {
        let before = db.workspace_context()?;
        let changes = db.conn.total_changes();
        let added = db.receive_membership_packet(packet)?;
        Ok((added, changes != db.conn.total_changes(), before, db.workspace_context()?, db.workspace_token()?))
    })?;
    if !changed { return Ok(()); }
    if before != after {
        runtime.stop();
        match network::start(app.clone(), state.db.clone(), after.workspace_id.clone(), token, after.user_id.clone()) {
            Ok(next) => { next.set_http_file_port(state.file_server.port()); *runtime = next; }
            Err(_) => { let _ = app.emit("network://error", json!({"message":"成员权限已更新，网络服务启动失败，请重启应用"})); }
        }
        if let Ok(mut pending) = state.pending_notifications.lock() { pending.clear(); }
        if let Ok(mut unread) = state.tray_unread.lock() { unread.clear(); }
        state.tray_generation.fetch_add(1, Ordering::AcqRel);
    }
    drop(runtime);
    if before != after { state.ai.cancel_stale(&after); emit_workspace_changed(app, "switched"); }
    else if let Some(workspace) = added {
        let _ = app.emit(WORKSPACE_CHANGED_EVENT, json!({"action":"added", "workspace":workspace}));
    } else { emit_workspace_changed(app, "membership-reviewed"); }
    Ok(())
}

#[tauri::command]
fn dissolve_workspace(
    app: AppHandle,
    workspace_id: String,
    current_user_id: String,
    confirmation_name: String,
    workspace_context: WorkspaceContext,
) -> Result<Workspace, String> {
    change_dissolved_workspace(&app, &workspace_id, |db| {
        db.validate_workspace_context(&workspace_context)?;
        let operator = current_session_user(db, Some(&current_user_id))?;
        if workspace_id != workspace_context.workspace_id { return Err("工作区已切换，请重新载入后操作".into()); }
        db.dissolve_workspace(&workspace_id, &operator, &confirmation_name)
    })?;
    with_db(&app.state::<AppState>(), Database::workspace_record)
}

#[tauri::command]
fn switch_workspace(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<Workspace, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let mut runtime=state.network.lock().map_err(|e| e.to_string())?;
    let (previous,previous_token)=with_workspace_db(&state,&workspace_context,|db| Ok((db.workspace_context()?,db.workspace_token()?)))?;
    let ws=with_workspace_db(&state,&workspace_context,|db| { let user=current_session_user(db,Some(&current_user_id))?; db.switch_workspace(&workspace_id,&user) })?;
    runtime.stop();
    let token=with_db(&state,Database::workspace_token)?;
    match network::start(app.clone(),state.db.clone(),ws.id.clone(),token,current_user_id.clone()) {
        Ok(next) => { next.set_http_file_port(state.file_server.port()); *runtime=next; }
        Err(error) => {
            with_db(&state,|db| db.switch_workspace(&previous.workspace_id,&previous.user_id))?;
            if let Ok(old)=network::start(app.clone(),state.db.clone(),previous.workspace_id,previous_token,previous.user_id) { old.set_http_file_port(state.file_server.port()); *runtime=old; }
            return Err(error);
        }
    }
    if let Ok(mut pending)=state.pending_notifications.lock() { pending.clear(); }
    if let Ok(mut unread)=state.tray_unread.lock() { unread.clear(); }
    state.tray_generation.fetch_add(1,Ordering::AcqRel);
    drop(runtime);
    emit_workspace_changed(&app, "switched");
    Ok(ws)
}

#[tauri::command]
fn update_workspace(
    app: AppHandle,
    state: State<AppState>,
    updates: Value,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<Workspace, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let workspace = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.update_workspace_record(updates, &current_user_id)
    })?;
    emit_workspace_changed(&app, "updated");
    Ok(workspace)
}

#[tauri::command]
fn get_workspace_members(
    state: State<AppState>,
    current_user_id: Option<String>, workspace_context: WorkspaceContext) -> Result<Vec<WorkspaceMember>, String> {
    if current_user_id.as_deref().is_some_and(|id| id!=workspace_context.user_id) { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        current_session_user(db, current_user_id.as_deref())?;
        let workspace = db.workspace_record()?;
        db.workspace_members(&workspace.id)
    })
}

#[tauri::command]
fn request_workspace_membership(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: Option<String>,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<WorkspaceMember, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let member = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        if let Some(workspace_id) = workspace_id.as_deref() {
            // The renderer sends the workspace it is joining; only the local
            // workspace exists locally, so a mismatch is rejected rather than
            // silently joined to the wrong one.
            let local = db.workspace_record()?;
            if local.id != workspace_id {
                return Err("请求加入的工作区与本机工作区不一致".into());
            }
        }
        db.request_workspace_membership(&current_user_id, None)
    })?;
    emit_workspace_changed(&app, "membership-requested");
    Ok(member)
}

#[tauri::command]
fn review_workspace_membership(
    app: AppHandle,
    state: State<AppState>,
    request_id: String,
    approve: bool,
    role: Option<String>,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<WorkspaceMember, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let member = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        // `requestId` is either a `workspace_join_requests` row id or a bare
        // user id, depending on whether the join came through an explicit
        // invite or plain discovery.
        let user_id = db
            .workspace_join_request_user(&request_id)?
            .unwrap_or_else(|| request_id.clone());
        db.review_workspace_membership(&user_id, approve, role.as_deref(), &current_user_id)
    })?;
    emit_workspace_changed(&app, "membership-reviewed");
    Ok(member)
}

#[tauri::command]
fn get_workspace_member_candidates(state: State<AppState>, current_user_id: String, workspace_context: WorkspaceContext) -> Result<Vec<User>, String> {
    with_workspace_db(&state, &workspace_context, |db| {
        let operator = current_session_user(db, Some(&current_user_id))?;
        db.workspace_member_candidates(&operator)
    })
}

#[tauri::command]
fn get_users(state: State<AppState>, workspace_context: WorkspaceContext) -> Result<Vec<User>, String> {
    with_workspace_db(&state, &workspace_context, Database::workspace_users)
}

#[tauri::command]
fn get_local_directory(state: State<AppState>, workspace_context: WorkspaceContext) -> Result<models::LocalDirectory, String> {
    with_workspace_db(&state, &workspace_context, Database::local_directory)
}

#[tauri::command]
fn save_local_directory(
    state: State<AppState>,
    directory: models::LocalDirectory, workspace_context: WorkspaceContext) -> Result<models::LocalDirectory, String> {
    with_workspace_db(&state, &workspace_context, |db| db.save_local_directory(&directory))
}

#[tauri::command]
fn set_identity(state: State<AppState>, user: Value, workspace_context: WorkspaceContext) -> Result<User, String> {
    with_workspace_db(&state, &workspace_context, |db| {
        let id = user
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "用户 ID 不能为空".to_string())?
            .to_string();
        if id != workspace_context.user_id { return Err("个人资料不能更换用户身份".into()); }
        let existing = db.users()?.into_iter().find(|item| item.id == id);
        let username = user
            .get("username")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| existing.as_ref().map(|item| item.username.clone()))
            .unwrap_or_else(|| id.split('@').next().unwrap_or("user").into());
        let device_id = user
            .get("deviceId")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| existing.as_ref().map(|item| item.device_id.clone()))
            .unwrap_or_else(|| id.split('@').nth(1).unwrap_or("desktop").into());
        let updated = User {
            id: id.clone(),
            username: username.clone(),
            device_id,
            nickname: user
                .get("nickname")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| existing.as_ref().map(|item| item.nickname.clone()))
                .unwrap_or(username),
            role: user
                .get("role")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| existing.as_ref().map(|item| item.role.clone()))
                .unwrap_or_else(|| "user".into()),
            ip: user
                .get("ip")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| existing.as_ref().map(|item| item.ip.clone()))
                .unwrap_or_else(|| "127.0.0.1".into()),
            is_online: user
                .get("isOnline")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            last_active: Utc::now().to_rfc3339(),
            avatar: user
                .get("avatar")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| existing.and_then(|item| item.avatar)),
        };
        let updated = db.save_local_user_profile(&updated)?;
        db.set_current_user(&updated.id)?;
        Ok(updated)
    })
}

#[tauri::command]
fn get_projects(
    state: State<AppState>,
    current_user_id: Option<String>, workspace_context: WorkspaceContext) -> Result<Vec<models::Project>, String> {
    if current_user_id.as_deref().is_some_and(|id| id!=workspace_context.user_id) { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, current_user_id.as_deref())?;
        db.projects(Some(&current_user_id))
    })
}

#[tauri::command]
fn create_project(
    state: State<AppState>,
    project: Value,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::Project, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.create_project(project, &current_user_id)
    })
}

#[tauri::command]
fn update_project(
    state: State<AppState>,
    id: String,
    updates: Value,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::Project, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.update_project(&id, updates, &current_user_id)
    })
}

#[tauri::command]
fn transfer_project(
    state: State<AppState>,
    id: String,
    target_user_id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::Project, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.transfer_project(&id, &target_user_id, &current_user_id)
    })
}

#[tauri::command]
fn delete_project(
    state: State<AppState>,
    id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<bool, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.delete_project(&id, &current_user_id)
    })
}

#[tauri::command]
fn get_tasks(
    state: State<AppState>,
    current_user_id: Option<String>, workspace_context: WorkspaceContext) -> Result<Vec<models::Task>, String> {
    if current_user_id.as_deref().is_some_and(|id| id!=workspace_context.user_id) { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, current_user_id.as_deref())?;
        db.tasks(Some(&current_user_id))
    })
}

#[tauri::command]
fn save_text_file(path: String, content: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("保存路径不能为空".into());
    }
    fs::write(&path, content).map_err(|error| format!("无法写入文件: {error}"))
}

#[tauri::command]
fn export_tasks(
    state: State<AppState>,
    path: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::TaskExportResult, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    if path.trim().is_empty() {
        return Err("请选择任务数据的导出位置".into());
    }
    let archive = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.task_archive(&current_user_id)
    })?;
    let exported_count = archive.tasks.len();
    let serialized = serde_json::to_string_pretty(&archive)
        .map_err(|error| format!("无法生成任务数据文件: {error}"))?;
    fs::write(&path, serialized).map_err(|error| format!("无法写入任务数据文件: {error}"))?;
    Ok(models::TaskExportResult {
        exported_count,
        path,
    })
}

#[tauri::command]
fn import_tasks(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::TaskImportResult, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    if path.trim().is_empty() {
        return Err("请选择要导入的任务数据文件".into());
    }
    let metadata =
        fs::metadata(&path).map_err(|error| format!("无法读取任务数据文件信息: {error}"))?;
    if !metadata.is_file() {
        return Err("所选路径不是任务数据文件".into());
    }
    if metadata.len() > 25 * 1024 * 1024 {
        return Err("任务数据文件不能超过 25 MB".into());
    }
    let raw =
        fs::read_to_string(&path).map_err(|error| format!("无法读取任务数据文件: {error}"))?;
    let archive: models::TaskDataArchive =
        serde_json::from_str(&raw).map_err(|error| format!("任务数据文件内容无效: {error}"))?;
    let result = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.import_task_archive(archive, &current_user_id)
    })?;
    if result.imported_count > 0 || result.restored_count > 0 {
        emit_tasks_changed(&app, "imported", None);
    }
    Ok(result)
}

#[tauri::command]
fn clear_local_data(
    app: AppHandle,
    state: State<AppState>,
    options: models::ClearDataOptions,
    current_user_id: String,
    workspace_context: WorkspaceContext,
) -> Result<models::ClearDataResult, String> {
    if current_user_id != workspace_context.user_id {
        return Err("请求用户与会话身份不一致".into());
    }
    let tasks_selected = options.tasks;
    let chat_selected = options.chat;
    let wiki_selected = options.wiki;
    let ai_selected = options.ai;

    let result = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.clear_local_data(&options, &workspace_context.workspace_id, &current_user_id)
    })?;

    if tasks_selected {
        emit_tasks_changed(&app, "cleared", None);
    }
    if chat_selected {
        let _ = app.emit("chat://data_cleared", ());
    }
    if wiki_selected {
        let _ = app.emit("wiki://data_cleared", ());
    }
    if ai_selected {
        let _ = app.emit("ai://data_cleared", ());
    }

    Ok(result)
}

#[tauri::command]
fn create_task(
    app: AppHandle,
    state: State<AppState>,
    task: Value,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::Task, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let created = with_workspace_db(&state, &workspace_context, |db| db.create_task(task, &current_user_id))?;
    emit_tasks_changed(&app, "created", Some(&created.id));
    Ok(created)
}

#[tauri::command]
fn update_task(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    updates: Value,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::Task, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let updated = with_workspace_db(&state, &workspace_context, |db| {
        db.update_task_with_recurrence(&id, updates, &current_user_id, None)
            .map(|result| result.task)
    })?;
    emit_tasks_changed(&app, "updated", Some(&updated.id));
    Ok(updated)
}

#[tauri::command]
fn save_task_with_children(
    app: AppHandle,
    state: State<AppState>,
    id: Option<String>,
    task: Value,
    child_tasks: Vec<Value>,
    detached_child_ids: Vec<String>,
    current_user_id: String,
    expected_version: Option<i64>, workspace_context: WorkspaceContext) -> Result<models::Task, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let saved = with_workspace_db(&state, &workspace_context, |db| db.save_task_with_children(
        id.as_deref(), task, child_tasks, detached_child_ids, &current_user_id, expected_version,
    ))?;
    emit_tasks_changed(&app, "saved", Some(&saved.id));
    Ok(saved)
}

#[tauri::command]
fn get_task_comments(
    state: State<AppState>,
    task_id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<Vec<models::TaskComment>, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| db.task_comments(&task_id, &current_user_id))
}

#[tauri::command]
fn create_task_comment(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
    content: String,
    current_user_id: String,
    reply_to_comment_id: Option<String>, workspace_context: WorkspaceContext) -> Result<models::TaskComment, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let comment = with_workspace_db(&state, &workspace_context, |db| db.create_task_comment_reply(&task_id, &content, &current_user_id, reply_to_comment_id.as_deref()))?;
    emit_tasks_changed(&app, "comment-created", Some(&task_id));
    Ok(comment)
}

#[tauri::command]
fn update_task_comment(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    content: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::TaskComment, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let comment = with_workspace_db(&state, &workspace_context, |db| db.update_task_comment(&id, &content, &current_user_id))?;
    emit_tasks_changed(&app, "comment-updated", Some(&comment.task_id));
    Ok(comment)
}

#[tauri::command]
fn delete_task_comment(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<bool, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let deleted = with_workspace_db(&state, &workspace_context, |db| db.delete_task_comment(&id, &current_user_id))?;
    if deleted { emit_tasks_changed(&app, "comment-deleted", None); }
    Ok(deleted)
}

#[tauri::command]
fn get_task_activity(
    state: State<AppState>,
    task_id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<Vec<models::TaskActivity>, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| db.task_activity(&task_id, &current_user_id))
}

#[tauri::command]
fn get_task_activity_page(
    state: State<AppState>,
    task_id: String,
    current_user_id: String,
    page: i64,
    page_size: i64,
    snapshot: Option<i64>, workspace_context: WorkspaceContext) -> Result<models::RecordPage<models::TaskActivity>, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| db.task_activity_page(&task_id, &current_user_id, page, page_size, snapshot))
}

#[tauri::command]
fn get_mcp_status(state: State<AppState>, workspace_context: WorkspaceContext) -> Result<models::McpStatus, String> {
    let config = with_workspace_db(&state, &workspace_context, Database::mcp_config)?;
    Ok(state.mcp.status(config))
}

#[tauri::command]
async fn update_mcp_config(
    state: State<'_, AppState>,
    enabled: bool,
    port: u16, workspace_context: WorkspaceContext) -> Result<models::McpStatus, String> {
    let (previous, authorization) = with_workspace_db(&state, &workspace_context, |db| Ok((db.mcp_config()?, db.external_authorization("mcp")?)))?;
    let candidate = with_workspace_db(&state, &workspace_context, |db| db.save_mcp_config(enabled, port))?;
    if let Err(error) = state.mcp.apply(candidate.clone()).await {
        let _ = with_workspace_db(&state, &workspace_context, |db| {
            db.save_mcp_config(previous.enabled, previous.port)?;
            db.restore_mcp_token(&previous.token)?;
            db.save_external_authorization("mcp", &authorization)
        });
        let _ = state.mcp.apply(previous).await;
        return Err(error);
    }
    Ok(state.mcp.status(candidate))
}

#[tauri::command]
async fn rotate_mcp_token(state: State<'_, AppState>, workspace_context: WorkspaceContext) -> Result<models::McpStatus, String> {
    let (previous, authorization) = with_workspace_db(&state, &workspace_context, |db| Ok((db.mcp_config()?, db.external_authorization("mcp")?)))?;
    let rotated = with_workspace_db(&state, &workspace_context, Database::rotate_mcp_token)?;
    if let Err(error) = state.mcp.apply(rotated.clone()).await {
        let _ = with_workspace_db(&state, &workspace_context, |db| {
            db.save_mcp_config(previous.enabled, previous.port)?;
            db.restore_mcp_token(&previous.token)?;
            db.save_external_authorization("mcp", &authorization)
        });
        let _ = state.mcp.apply(previous).await;
        return Err(error);
    }
    Ok(state.mcp.status(rotated))
}

#[tauri::command]
fn get_web_status(state: State<AppState>, workspace_context: WorkspaceContext) -> Result<models::WebStatus, String> {
    let config = with_workspace_db(&state, &workspace_context, Database::web_config)?;
    Ok(state.web.status(config))
}

#[tauri::command]
fn get_web_password(app: AppHandle, window: tauri::WebviewWindow, state: State<AppState>, workspace_context: WorkspaceContext) -> Result<Option<String>, String> {
    if window.label() != "main" { return Err("访问密码只能在主界面设置中查看".into()); }
    let config = with_workspace_db(&state, &workspace_context, Database::web_config)?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    config.password_protected.filter(|value| !value.is_empty())
        .map(|value| local_password::reveal(&value, &data_dir)).transpose()
}

#[tauri::command]
async fn update_web_config(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
    bind_address: String,
    port: u16,
    password: Option<String>,
    read_only: Option<bool>, workspace_context: WorkspaceContext) -> Result<models::WebStatus, String> {
    if !matches!(bind_address.as_str(), "0.0.0.0" | "127.0.0.1") {
        return Err("Web 服务监听地址无效".into());
    }
    if port < 1024 {
        return Err("Web 服务端口必须在 1024 到 65535 之间".into());
    }
    let (previous, authorization) = with_workspace_db(&state, &workspace_context, |db| Ok((db.web_config()?, db.external_authorization("web")?)))?;
    let password_hash = match password.as_deref().map(str::trim) {
        Some(password) if !password.is_empty() => web_server::hash_password(password)?,
        _ => previous.password_hash.clone(),
    };
    let password_protected = match password.as_deref().map(str::trim) {
        Some(password) if !password.is_empty() => Some(local_password::protect(password, &app.path().app_data_dir().map_err(|e| e.to_string())?)?),
        _ => previous.password_protected.clone(),
    };
    let candidate = models::WebConfig {
        read_only: read_only.unwrap_or(previous.read_only),
        enabled,
        bind_address,
        port,
        password_hash,
        password_protected,
    };
    if enabled && candidate.password_hash.is_empty() {
        return Err("启用 Web 服务前必须设置访问密码".into());
    }

    let candidate = with_workspace_db(&state, &workspace_context, |db| db.save_web_config(&candidate))?;
    if let Err(error) = state.web.apply(candidate.clone()).await {
        let _ = with_workspace_db(&state, &workspace_context, |db| {
            db.save_web_config(&previous)?;
            db.save_external_authorization("web", &authorization)
        });
        let _ = state.web.apply(previous).await;
        return Err(error);
    }
    Ok(state.web.status(candidate))
}

#[tauri::command]
fn task_recycle(app: AppHandle, state: State<AppState>, action: String, request: Value, workspace_context: WorkspaceContext) -> Result<Value,String> {
    let result=with_workspace_db(&state,&workspace_context,|db| {
        let user=&workspace_context.user_id;
        match action.as_str() {
            "list"=>db.list_trashed_tasks(user,request["query"].as_str().unwrap_or(""),request["projectId"].as_str(),request["page"].as_i64().unwrap_or(1)),
            "detail"=>db.trashed_task_detail(request["id"].as_str().ok_or("缺少任务 ID")?,user),
            "trash"=>db.trash_task_with_attachments(request["id"].as_str().ok_or("缺少任务 ID")?,user,request["withChildren"]==true,request["expectedVersion"].as_i64(),request.get("legacyAttachments")),
            "restore"=>db.restore_trashed_tasks(&request["selection"],user,request["confirmed"]==true),
            "purge"=>db.purge_trashed_tasks(&request["selection"],user),
            _=>Err("未知的回收站操作".into())
        }
    })?;
    if matches!(action.as_str(),"trash"|"restore"|"purge") {emit_tasks_changed(&app,"recycle",None);}
    Ok(result)
}

#[tauri::command]
fn delete_task(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<bool, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let deleted = with_workspace_db(&state, &workspace_context, |db| db.delete_task(&id, &current_user_id))?;
    if deleted {
        emit_tasks_changed(&app, "deleted", Some(&id));
    }
    Ok(deleted)
}

#[tauri::command]
fn get_sync_logs(state: State<AppState>, since_version: i64, workspace_context: WorkspaceContext) -> Result<Value, String> {
    with_workspace_db(&state, &workspace_context, |db| {
        let logs = db.audit_operations_for_user(&workspace_context.user_id)?.into_iter().filter(|op| op.version > since_version).collect::<Vec<_>>();
        let (_, latest_version) = db.sync_operations(since_version)?;
        Ok(json!({"logs":logs,"latestVersion":latest_version}))
    })
}

#[tauri::command]
fn get_sync_logs_page(state: State<AppState>, page: i64, page_size: i64, snapshot: Option<i64>, workspace_context: WorkspaceContext) -> Result<models::SyncLogPage, String> {
    with_workspace_db(&state, &workspace_context, |db| db.sync_logs_page_for_user(page, page_size, snapshot, &workspace_context.user_id))
}

#[tauri::command]
fn get_risk_warnings(
    state: State<AppState>,
    current_user_id: Option<String>, workspace_context: WorkspaceContext) -> Result<Vec<models::RiskWarning>, String> {
    if current_user_id.as_deref().is_some_and(|id| id!=workspace_context.user_id) { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| db.risks(Some(&workspace_context.user_id)))
}

#[tauri::command]
fn get_task_assignment_notifications(
    state: State<AppState>,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<Vec<models::TaskAssignmentNotification>, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        db.task_assignment_notifications(&current_user_id)
    })
}

#[tauri::command]
fn mark_task_assignment_notifications_read(
    state: State<AppState>,
    ids: Vec<String>,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<usize, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        db.mark_task_assignment_notifications_read(&ids, &current_user_id)
    })
}

#[tauri::command]
fn get_llm_config(state: State<AppState>, workspace_context: WorkspaceContext) -> Result<LlmConfig, String> {
    with_workspace_db(&state, &workspace_context, |db| {
        db.ai_catalog().map_err(|e|e.to_string())?;
        let mut config=db.ai_config_for("chat").unwrap_or(LlmConfig{generation_parameters:None,protocol:"openai".into(),base_url:String::new(),api_key:String::new(),model_name:String::new()});
        config.api_key.clear();Ok(config)
    })
}

#[tauri::command]
fn update_llm_config(state: State<AppState>, config: Value, workspace_context: WorkspaceContext) -> Result<LlmConfig, String> {
    let _=config;
    with_workspace_db(&state, &workspace_context, |_| Err("AI_STORAGE_VERSION: 请使用多连接模型设置保存配置".into()))
}

#[tauri::command]
async fn test_llm_connection(config: Value) -> Result<Value, String> {
    let base_url = config
        .get("baseUrl")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .trim_end_matches('/')
        .to_string();
    let api_key = config.get("apiKey").and_then(Value::as_str).unwrap_or("");
    let model = config
        .get("modelName")
        .and_then(Value::as_str)
        .unwrap_or("gpt-4o-mini");
    if base_url.is_empty() {
        return Ok(json!({"success":false,"error":"请填写 Base URL"}));
    }
    let start = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let url = if base_url.ends_with("/chat/completions") {
        base_url
    } else {
        format!("{base_url}/chat/completions")
    };
    let mut request = client
        .post(url)
        .json(&json!({"model":model,"max_tokens":1,"messages":[{"role":"user","content":"ping"}]}));
    if !api_key.is_empty() {
        request = request.bearer_auth(api_key);
    }
    let response = request.send().await;
    match response {
        Ok(response) if response.status().is_success() => Ok(
            json!({"success":true,"message":"模型服务连接成功","latencyMs":start.elapsed().as_millis()}),
        ),
        Ok(response) => {
            Ok(json!({"success":false,"error":format!("接口返回错误: {}",response.status())}))
        }
        Err(error) => Ok(json!({"success":false,"error":format!("无法连接模型服务: {error}")})),
    }
}

#[tauri::command]
async fn fetch_llm_models(config: Value) -> Result<Value, String> {
    let mut base_url = config
        .get("baseUrl")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .trim_end_matches('/')
        .to_string();
    let api_key = config.get("apiKey").and_then(Value::as_str).unwrap_or("");
    if base_url.is_empty() {
        return Ok(json!({"success": false, "error": "请先填写接口地址"}));
    }

    if base_url.ends_with("/chat/completions") {
        base_url = base_url.trim_end_matches("/chat/completions").to_string();
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let candidate_urls = if base_url.ends_with("/models") {
        vec![base_url.clone()]
    } else if base_url.ends_with("/v1") {
        vec![format!("{base_url}/models")]
    } else {
        vec![
            format!("{base_url}/models"),
            format!("{base_url}/v1/models"),
            format!("{base_url}/api/tags"),
        ]
    };

    let mut last_error = String::from("未找到可用模型接口");
    for url in candidate_urls {
        let mut request = client.get(&url);
        if !api_key.is_empty() {
            request = request.bearer_auth(api_key);
        }
        match request.send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(json_data) = resp.json::<Value>().await {
                    let mut model_ids: Vec<String> = Vec::new();
                    // 1. OpenAI standard format: { "data": [ { "id": "gpt-4o" }, ... ] }
                    if let Some(arr) = json_data.get("data").and_then(Value::as_array) {
                        for item in arr {
                            if let Some(id) = item.get("id").and_then(Value::as_str) {
                                if !id.trim().is_empty() {
                                    model_ids.push(id.trim().to_string());
                                }
                            }
                        }
                    }
                    // 2. Ollama format: { "models": [ { "name": "llama3" }, ... ] }
                    if model_ids.is_empty() {
                        if let Some(arr) = json_data.get("models").and_then(Value::as_array) {
                            for item in arr {
                                if let Some(name) = item.get("name").and_then(Value::as_str) {
                                    if !name.trim().is_empty() {
                                        model_ids.push(name.trim().to_string());
                                    }
                                } else if let Some(name) = item.as_str() {
                                    if !name.trim().is_empty() {
                                        model_ids.push(name.trim().to_string());
                                    }
                                }
                            }
                        }
                    }
                    // 3. Simple array format: [ { "id": "..." } ] or [ "..." ]
                    if model_ids.is_empty() {
                        if let Some(arr) = json_data.as_array() {
                            for item in arr {
                                if let Some(id) = item.get("id").and_then(Value::as_str) {
                                    model_ids.push(id.trim().to_string());
                                } else if let Some(name) = item.as_str() {
                                    model_ids.push(name.trim().to_string());
                                }
                            }
                        }
                    }

                    if !model_ids.is_empty() {
                        model_ids.sort();
                        model_ids.dedup();
                        return Ok(json!({
                            "success": true,
                            "models": model_ids
                        }));
                    }
                }
            }
            Ok(resp) => {
                last_error = format!("接口状态码: {}", resp.status());
            }
            Err(e) => {
                last_error = format!("网络请求失败: {e}");
            }
        }
    }

    Ok(json!({
        "success": false,
        "error": format!("获取模型失败: {last_error}")
    }))
}

#[tauri::command]
fn get_ppt_templates(state: State<AppState>, workspace_context: WorkspaceContext) -> Result<Vec<Value>, String> {
    with_workspace_db(&state, &workspace_context, Database::templates)
}

#[tauri::command]
fn add_ppt_template(state: State<AppState>, template: Value, workspace_context: WorkspaceContext) -> Result<Value, String> {
    with_workspace_db(&state, &workspace_context, |db| db.add_template(template))
}

#[tauri::command]
async fn quick_parse_task(
    state: State<'_, AppState>,
    input: String,
    locale: Option<String>, workspace_context: WorkspaceContext) -> Result<models::QuickParseResult, String> {
    let locale = locale.as_deref().and_then(i18n::match_locale).unwrap_or_else(|| "zh-CN".into());
    let input = input.trim().to_string();
    if input.is_empty() {
        return Err("请输入需要解析的任务内容".into());
    }
    let (config, users, projects) = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = db.current_user_id()?;
        let projects = db
            .projects(Some(&current_user_id))?
            .into_iter()
            .filter(|project| {
                project.members.iter().any(|id| id == &current_user_id)
                    || project.admins.iter().any(|id| id == &current_user_id)
            })
            .collect::<Vec<_>>();
        Ok((db.ai_config_for("quick_parse")?, db.users()?, projects))
    })?;
    let user_context = users
        .iter()
        .map(|user| {
            json!({
                "id": user.id,
                "username": user.username,
                "nickname": user.nickname
            })
        })
        .collect::<Vec<_>>();
    let project_context = projects
        .iter()
        .map(|project| {
            json!({
                "id": project.id,
                "name": project.name,
                "memberIds": project.members,
                "adminIds": project.admins
            })
        })
        .collect::<Vec<_>>();
    let prompt = format!(
        r#"Parse Chinese or English task input. Preserve the original task title language and all user-supplied names. Interface language: {locale}.
当前本地时间：{now}
请解析以下任务输入：
{input}

当前可选负责人：
{users}

当前已加入项目：
{projects}

仅返回一个合法 JSON 对象，不要使用 Markdown 代码围栏。字段要求：
{{
  "title": "去除时间、人员、项目、优先级和循环修饰后的任务标题",
  "dueDate": "YYYY-MM-DD 或 null",
  "reminderTime": "YYYY-MM-DDTHH:mm 或 null，有明确时刻时填写",
  "priority": "P1、P2、P3、P4 之一，默认 P4",
  "projectName": "必须精确匹配可选项目名称，无法匹配则为 null",
  "assigneeName": "必须精确匹配负责人的 nickname 或 username，无法匹配则为 null",
  "recurrence": "none、daily、weekly、monthly、yearly 之一",
  "recurrenceRule": null 或 {{"interval": 1, "daysOfWeek": [1,2,3,4,5], "dayOfMonth": 1, "monthOfYear": 8, "timeOfDay": "08:00"}}；星期使用 1=周一 至 7=周日，只返回当前频率需要的字段；每 N 个周期写入 interval",
  "tags": ["从输入提取的标签"]
}}
“每天、每周、每月、每年”等表达必须转换为 recurrence 和 recurrenceRule；“周一到周五”转换为 daysOfWeek [1,2,3,4,5]；“每两周”转换为 interval 2；明确时刻同时写入 reminderTime 和 timeOfDay。今天、明天、后天、下周等相对日期必须根据当前本地时间换算。如果匹配了项目，负责人必须属于该项目的 memberIds 或 adminIds。"#,
        now = Local::now().format("%Y-%m-%d %H:%M:%S %:z"),
        users = serde_json::to_string_pretty(&user_context)
            .map_err(|error| format!("无法整理负责人信息: {error}"))?,
        projects = serde_json::to_string_pretty(&project_context)
            .map_err(|error| format!("无法整理项目信息: {error}"))?,
    );
    let raw = request_llm_text(
        &config,
        "你是任务信息提取助手，只能输出符合指定结构的 JSON。",
        &prompt,
    )
    .await?;
    let mut parsed: models::QuickParseResult = parse_json_object(&raw, "任务信息")?;
    if parsed.title.trim().is_empty() {
        parsed.title = input;
    }
    if !matches!(parsed.priority.as_str(), "P1" | "P2" | "P3" | "P4") {
        parsed.priority = "P4".into();
    }
    if !matches!(
        parsed.recurrence.as_deref(),
        Some("daily" | "weekly" | "monthly" | "yearly")
    ) {
        parsed.recurrence = Some("none".into());
        parsed.recurrence_rule = None;
    } else if let Some(rule) = parsed.recurrence_rule.as_mut() {
        if !(1..=999).contains(&rule.interval) {
            rule.interval = 1;
        }
        rule.days_of_week.retain(|day| (1..=7).contains(day));
        rule.days_of_week.sort_unstable();
        rule.days_of_week.dedup();
        if !rule.day_of_month.is_some_and(|day| (1..=31).contains(&day)) {
            rule.day_of_month = None;
        }
        if !rule
            .month_of_year
            .is_some_and(|month| (1..=12).contains(&month))
        {
            rule.month_of_year = None;
        }
        if !rule
            .time_of_day
            .as_deref()
            .is_some_and(|time| chrono::NaiveTime::parse_from_str(time, "%H:%M").is_ok())
        {
            rule.time_of_day = None;
        }
    }
    Ok(parsed)
}

#[tauri::command]
async fn send_ai_chat(
    state: State<'_, AppState>,
    prompt: String,
    system_prompt: Option<String>,
    model_name: Option<String>, workspace_context: WorkspaceContext) -> Result<String, String> {
    let config = with_workspace_db(&state, &workspace_context, |db| db.ai_config_for("chat"))?;
    if let Some(override_model) = model_name.filter(|s| !s.trim().is_empty()) {
        if override_model.trim()!=config.model_name { return Err("MODEL_REFERENCE_REQUIRED: use the grouped model selector".into()); }
    }
    let system = system_prompt.unwrap_or_else(|| "你是一个人工智能助手。".to_string());
    request_llm_text(&config, &system, &prompt).await
}

#[tauri::command]
async fn send_ai_chat_stream(
    state: State<'_, AppState>,
    prompt: String,
    system_prompt: Option<String>,
    model_name: Option<String>,
    channel: tauri::ipc::Channel<ai_chat::ChatStreamEvent>, workspace_context: WorkspaceContext) -> Result<(), String> {
    let config = with_workspace_db(&state, &workspace_context, |db| db.ai_config_for("chat"))?;
    if let Some(override_model) = model_name.filter(|s| !s.trim().is_empty()) {
        if override_model.trim()!=config.model_name { return Err("MODEL_REFERENCE_REQUIRED: use the grouped model selector".into()); }
    }
    let system = system_prompt.unwrap_or_else(|| "你是一个人工智能助手。".to_string());
    ai_chat::execute_stream_to_channel(&config, &system, &prompt, channel).await
}

#[tauri::command]
async fn generate_report(
    state: State<'_, AppState>,
    params: Value, workspace_context: WorkspaceContext) -> Result<models::GeneratedReport, String> {
    let locale = params.get("locale").and_then(Value::as_str).and_then(i18n::match_locale).unwrap_or_else(|| state.db.lock().ok().and_then(|db| db.locale_settings().ok()).map(|settings| settings.locale).unwrap_or_else(|| "zh-CN".into()));
    let project_id = params
        .get("projectId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let current_user_id = params
        .get("currentUserId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "生成工作汇报需要当前用户身份".to_string())?;
    let range = params.get("dateRange").and_then(Value::as_object);
    let start = range
        .and_then(|range| range.get("startDate"))
        .and_then(Value::as_str)
        .unwrap_or("1970-01-01")
        .to_string();
    let end = range
        .and_then(|range| range.get("endDate"))
        .and_then(Value::as_str)
        .unwrap_or("2999-12-31")
        .to_string();
    let start_date = NaiveDate::parse_from_str(&start, "%Y-%m-%d")
        .map_err(|_| "工作汇报的开始日期格式无效".to_string())?;
    let end_date = NaiveDate::parse_from_str(&end, "%Y-%m-%d")
        .map_err(|_| "工作汇报的结束日期格式无效".to_string())?;
    if start_date > end_date {
        return Err("工作汇报的开始日期不能晚于结束日期".into());
    }
    let report_type = params
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("weekly")
        .to_string();
    let custom_notes = params
        .get("customNotes")
        .and_then(Value::as_str)
        .map(str::to_string);
    let prompt_override = params
        .get("promptOverride")
        .and_then(Value::as_str)
        .map(str::to_string);
    let today = Local::now().date_naive();
    let as_of_date = std::cmp::min(today, end_date);
    let planning_days = match report_type.as_str() {
        "daily" => 1,
        "weekly" => 7,
        "monthly" => 31,
        "quarterly" => 92,
        "semi_annual" => 184,
        "annual" => 366,
        _ => 7,
    };
    let planning_end = if end_date <= as_of_date {
        end_date + Duration::days(planning_days)
    } else {
        end_date
    };
    let (config, dataset, users, projects) = with_workspace_db(&state, &workspace_context, |db| {
        Ok((
            db.ai_config_for("report")?,
            db.report_dataset(
                project_id.as_deref(),
                &current_user_id,
                start_date,
                planning_end,
                as_of_date,
            )?,
            db.users()?,
            db.projects(Some(&current_user_id))?,
        ))
    })?;
    if let Some(override_model) = params.get("modelName").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
        if override_model.trim()!=config.model_name { return Err("MODEL_REFERENCE_REQUIRED: use the grouped model selector".into()); }
    }
    let mut dataset = dataset;
    i18n::localize_dataset(&locale, &mut dataset);
    i18n::REQUEST_LOCALE.scope(locale.clone(), generate_ai_report(
        config,
        dataset,
        users,
        projects,
        &report_type,
        &start,
        &end,
        &as_of_date.format("%Y-%m-%d").to_string(),
        custom_notes.as_deref(),
        prompt_override.as_deref(),
        &locale,
    ))
    .await
}

#[tauri::command]
async fn generate_presentation_plan(
    state: State<'_, AppState>,
    params: Value, workspace_context: WorkspaceContext) -> Result<models::GeneratedPresentation, String> {
    let locale = params.get("locale").and_then(Value::as_str).and_then(i18n::match_locale).unwrap_or_else(|| state.db.lock().ok().and_then(|db| db.locale_settings().ok()).map(|settings| settings.locale).unwrap_or_else(|| "zh-CN".into()));
    let project_id = params
        .get("projectId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let current_user_id = params
        .get("currentUserId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "生成汇报 PPT 需要当前用户身份".to_string())?;
    let range = params.get("dateRange").and_then(Value::as_object);
    let start = range
        .and_then(|value| value.get("startDate"))
        .and_then(Value::as_str)
        .unwrap_or("1970-01-01")
        .to_string();
    let end = range
        .and_then(|value| value.get("endDate"))
        .and_then(Value::as_str)
        .unwrap_or("2999-12-31")
        .to_string();
    let start_date = NaiveDate::parse_from_str(&start, "%Y-%m-%d")
        .map_err(|_| "汇报 PPT 的开始日期格式无效".to_string())?;
    let end_date = NaiveDate::parse_from_str(&end, "%Y-%m-%d")
        .map_err(|_| "汇报 PPT 的结束日期格式无效".to_string())?;
    if start_date > end_date {
        return Err("汇报 PPT 的开始日期不能晚于结束日期".into());
    }
    let report_type = params
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("weekly")
        .to_string();
    let custom_notes = params
        .get("customNotes")
        .and_then(Value::as_str)
        .map(str::to_string);
    let prompt_override = params
        .get("promptOverride")
        .and_then(Value::as_str)
        .map(str::to_string);
    let ppt_template_id = params
        .get("pptTemplateId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let today = Local::now().date_naive();
    let as_of_date = std::cmp::min(today, end_date);
    let planning_days = match report_type.as_str() {
        "daily" => 1,
        "weekly" => 7,
        "monthly" => 31,
        "quarterly" => 92,
        "semi_annual" => 184,
        "annual" => 366,
        _ => 7,
    };
    let planning_end = if end_date <= as_of_date {
        end_date + Duration::days(planning_days)
    } else {
        end_date
    };
    let (config, dataset, users, projects) = with_workspace_db(&state, &workspace_context, |db| {
        Ok((
            db.ai_config_for("report")?,
            db.report_dataset(
                project_id.as_deref(),
                &current_user_id,
                start_date,
                planning_end,
                as_of_date,
            )?,
            db.users()?,
            db.projects(Some(&current_user_id))?,
        ))
    })?;
    if let Some(override_model) = params.get("modelName").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
        if override_model.trim()!=config.model_name { return Err("MODEL_REFERENCE_REQUIRED: use the grouped model selector".into()); }
    }
    let mut dataset = dataset;
    i18n::localize_dataset(&locale, &mut dataset);
    let report = i18n::REQUEST_LOCALE.scope(locale.clone(), generate_ai_report(
        config.clone(),
        dataset,
        users,
        projects,
        &report_type,
        &start,
        &end,
        &as_of_date.format("%Y-%m-%d").to_string(),
        custom_notes.as_deref(),
        prompt_override.as_deref(),
        &locale,
    ))
    .await?;
    let theme_hint = ppt_template_id.and_then(|template_id| {
        with_workspace_db(&state, &workspace_context, |db| {
            db.templates().map(|templates| {
                templates.into_iter().find(|template| {
                    template.get("id").and_then(Value::as_str) == Some(template_id.as_str())
                })
            })
        })
        .ok()
        .flatten()
        .map(|template| {
            serde_json::to_string(&json!({
                "name": template.get("name"),
                "description": template.get("description"),
                "theme": template.get("theme"),
                "primaryColor": template.get("primaryColor"),
                "accentColor": template.get("accentColor"),
                "backgroundColor": template.get("backgroundColor"),
            }))
            .unwrap_or_else(|_| "清晰简洁的商务主题".into())
        })
    });
    Ok(i18n::REQUEST_LOCALE.scope(locale.clone(), generate_ai_presentation(config, report, theme_hint, prompt_override, &locale)).await)
}

#[tauri::command]
fn get_chat_messages(
    state: State<AppState>,
    current_user_id: String,
    target_id: Option<String>, workspace_context: WorkspaceContext) -> Result<Vec<models::ChatMessage>, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.chat_messages(&current_user_id, target_id.as_deref())
    })
}

#[tauri::command]
fn get_chat_message_page(
    state: State<AppState>,
    current_user_id: String,
    conversation_type: String,
    target_id: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>, workspace_context: WorkspaceContext) -> Result<models::ChatMessagePage, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.chat_message_page(
            &current_user_id,
            &conversation_type,
            target_id.as_deref(),
            cursor.as_deref(),
            limit.unwrap_or(30),
        )
    })
}

#[tauri::command]
fn get_chat_unread_summaries(
    state: State<AppState>,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<Vec<models::ChatUnreadSummary>, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.chat_unread_summaries(&current_user_id)
    })
}

#[tauri::command]
fn search_chat_messages(
    state: State<AppState>,
    current_user_id: String,
    conversation_type: String,
    target_id: Option<String>,
    query: String,
    cursor: Option<String>,
    limit: Option<usize>, workspace_context: WorkspaceContext) -> Result<models::ChatSearchPage, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.search_chat_messages(
            &current_user_id,
            &conversation_type,
            target_id.as_deref(),
            &query,
            cursor.as_deref(),
            limit.unwrap_or(50),
        )
    })
}

#[tauri::command]
fn get_chat_message_context(
    state: State<AppState>,
    current_user_id: String,
    conversation_type: String,
    target_id: Option<String>,
    message_id: String,
    before: Option<usize>,
    after: Option<usize>, workspace_context: WorkspaceContext) -> Result<Vec<models::ChatMessage>, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.chat_message_context(
            &current_user_id,
            &conversation_type,
            target_id.as_deref(),
            &message_id,
            before.unwrap_or(30),
            after.unwrap_or(30),
        )
    })
}

#[tauri::command]
fn clear_chat_messages(
    state: State<AppState>,
    current_user_id: String,
    conversation_type: String,
    target_id: Option<String>, workspace_context: WorkspaceContext) -> Result<usize, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.clear_chat_messages(&current_user_id, &conversation_type, target_id.as_deref())
    })
}

#[tauri::command]
fn delete_chat_message(
    state: State<AppState>,
    message_id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<(), String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.delete_chat_message(&message_id, &current_user_id)
    })
}

#[tauri::command]
fn mark_chat_messages_read(
    state: State<AppState>,
    message_ids: Vec<String>,
    reader_id: String, workspace_context: WorkspaceContext) -> Result<Vec<models::ChatMessage>, String> {
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&reader_id))?;
        db.mark_chat_messages_read(&message_ids, &current_user_id)
    })
}

#[tauri::command]
fn send_chat_message(
    app: AppHandle,
    state: State<AppState>,
    message: Value, workspace_context: WorkspaceContext) -> Result<models::ChatMessage, String> {
    let result = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, None)?;
        if message.get("senderId").and_then(Value::as_str) != Some(current_user_id.as_str()) {
            return Err("消息发送者与当前桌面会话身份不一致".into());
        }
        if let Some(group_id) = message.get("groupId").and_then(Value::as_str) {
            let group = db
                .chat_groups_for_user(&current_user_id)?
                .into_iter()
                .find(|group| group.id == group_id)
                .ok_or_else(|| "你不是该群组成员，无法发送消息".to_string())?;
            if let Some(project_id) = group.project_id.as_deref() {
                let is_current_project_member = db
                    .projects(Some(&current_user_id))?
                    .iter()
                    .any(|project| project.id == project_id);
                if !is_current_project_member {
                    return Err("你已不在关联项目中，只能查看历史消息".into());
                }
            }
            if !group.member_ids.iter().any(|id| id == &current_user_id) {
                return Err("你不是该群组成员，无法发送消息".into());
            }
        }
        db.save_chat_message(message)
    })?;
    let _ = app.emit("chat://message", &result);
    Ok(result)
}

#[tauri::command]
fn get_chat_groups(state: State<AppState>, workspace_context: WorkspaceContext) -> Result<Vec<models::ChatGroup>, String> {
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, None)?;
        db.chat_groups_for_user(&current_user_id)
    })
}

#[tauri::command]
fn save_chat_group(state: State<AppState>, group: Value, workspace_context: WorkspaceContext) -> Result<models::ChatGroup, String> {
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, None)?;
        db.save_chat_group(group, &current_user_id)
    })
}

#[tauri::command]
fn update_chat_group_members(
    state: State<AppState>,
    group_id: String,
    member_ids: Vec<String>,
    admin_ids: Option<Vec<String>>,
    current_user_id: String,
    workspace_context: WorkspaceContext,
) -> Result<models::ChatGroup, String> {
    if current_user_id != workspace_context.user_id {
        return Err("请求用户与会话身份不一致".into());
    }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.update_chat_group_members(&group_id, member_ids, admin_ids, &current_user_id)
    })
}

#[tauri::command]
fn update_chat_group_profile(
    state: State<AppState>,
    group_id: String,
    name: String,
    description: Option<String>,
    avatar: Option<String>,
    project_id: Option<String>,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::ChatGroup, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.update_chat_group_profile(
            &group_id,
            &name,
            description.as_deref(),
            avatar.as_deref(),
            project_id.as_deref(),
            &current_user_id,
        )
    })
}

#[tauri::command]
fn transfer_chat_group(
    app: AppHandle,
    state: State<AppState>,
    group_id: String,
    target_user_id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::ChatGroup, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let group = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.transfer_chat_group(&group_id, &target_user_id, &current_user_id)
    })?;
    let _ = app.emit("chat://group_updated", &group);
    Ok(group)
}

#[tauri::command]
fn delete_chat_group(
    app: AppHandle,
    state: State<AppState>,
    group_id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<bool, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let deleted = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.delete_chat_group(&group_id, &current_user_id)
    })?;
    if deleted {
        let _ = app.emit("chat://group_deleted", &group_id);
    }
    Ok(deleted)
}

#[tauri::command]
fn get_group_announcements(
    state: State<AppState>,
    group_id: String, workspace_context: WorkspaceContext) -> Result<Vec<models::GroupAnnouncement>, String> {
    with_workspace_db(&state, &workspace_context, |db| {
        if !db.chat_groups_for_user(&workspace_context.user_id)?.iter().any(|g| g.id == group_id) {
            return Err("群组不存在或没有访问权限".into());
        }
        db.group_announcements(&group_id)
    })
}

#[tauri::command]
fn save_group_announcement(
    app: AppHandle,
    state: State<AppState>,
    announcement: Value,
    current_user_id: Option<String>, workspace_context: WorkspaceContext) -> Result<models::GroupAnnouncement, String> {
    if current_user_id.as_deref().is_some_and(|id| id!=workspace_context.user_id) { return Err("请求用户与会话身份不一致".into()); }
    let saved = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, current_user_id.as_deref())?;
        db.save_group_announcement(announcement, &current_user_id)
    })?;
    let _ = app.emit("chat://announcement_updated", &saved);
    Ok(saved)
}

#[tauri::command]
fn delete_group_announcement(
    app: AppHandle,
    state: State<AppState>,
    announcement_id: String,
    current_user_id: Option<String>, workspace_context: WorkspaceContext) -> Result<(), String> {
    if current_user_id.as_deref().is_some_and(|id| id!=workspace_context.user_id) { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, current_user_id.as_deref())?;
        db.delete_group_announcement(&announcement_id, &current_user_id)
    })?;
    let _ = app.emit("chat://announcement_deleted", &announcement_id);
    Ok(())
}

#[tauri::command]
fn pin_group_announcement(
    app: AppHandle,
    state: State<AppState>,
    announcement_id: String,
    pinned: bool,
    current_user_id: Option<String>, workspace_context: WorkspaceContext) -> Result<models::GroupAnnouncement, String> {
    if current_user_id.as_deref().is_some_and(|id| id!=workspace_context.user_id) { return Err("请求用户与会话身份不一致".into()); }
    let updated = with_workspace_db(&state, &workspace_context, |db| {
        let current_user_id = current_session_user(db, current_user_id.as_deref())?;
        db.pin_group_announcement(&announcement_id, pinned, &current_user_id)
    })?;
    let _ = app.emit("chat://announcement_updated", &updated);
    Ok(updated)
}

#[tauri::command]
fn mark_group_announcement_read(
    app: AppHandle,
    state: State<AppState>,
    announcement_id: String,
    reader_id: Option<String>, workspace_context: WorkspaceContext) -> Result<models::GroupAnnouncement, String> {
    let updated = with_workspace_db(&state, &workspace_context, |db| {
        let reader_id = current_session_user(db, reader_id.as_deref())?;
        db.mark_group_announcement_read(&announcement_id, &reader_id)
    })?;
    let _ = app.emit("chat://announcement_updated", &updated);
    Ok(updated)
}

#[tauri::command]
fn get_network_status(state: State<AppState>) -> models::NetworkStatus {
    state.network.lock().unwrap_or_else(|e| e.into_inner()).snapshot()
}

#[tauri::command]
fn sync_now(app: AppHandle, state: State<AppState>) -> models::NetworkStatus {
    let snapshot = state.network.lock().unwrap_or_else(|e| e.into_inner()).snapshot();
    let _ = app.emit("sync://state", &snapshot);
    snapshot
}

#[tauri::command]
fn register_file_for_transfer(
    state: State<AppState>,
    path: String, workspace_context: WorkspaceContext) -> Result<models::FileOffer, String> {
    let runtime = state.network.lock().map_err(|e| e.to_string())?;
    with_workspace_db(&state,&workspace_context,|_| Ok(()))?;
    runtime.register_file(std::path::Path::new(&path))
}

#[tauri::command]
fn download_file_from_peer(
    state: State<AppState>,
    url: String,
    destination: String, workspace_context: WorkspaceContext) -> Result<String, String> {
    let runtime = {
        let runtime = state.network.lock().map_err(|e| e.to_string())?;
        with_workspace_db(&state,&workspace_context,|_| Ok(()))?;
        runtime.clone()
    };
    runtime.download_file(&url, std::path::Path::new(&destination))
}

#[tauri::command]
fn get_project_files(
    state: State<AppState>,
    project_id: String, workspace_context: WorkspaceContext) -> Result<Vec<models::ProjectFileRecord>, String> {
    let mut files = with_workspace_db(&state, &workspace_context, |db| db.project_files(&project_id))?;
    let local_port = state.file_server.port();
    for file in &mut files {
        let mime_type = effective_project_file_mime(file);
        let local_path = state.file_server.file_path(&workspace_context.workspace_id, &file.project_id, &file.id);
        file.is_local = local_path.exists();
        if file.is_local {
            file.http_url = Some(with_file_mime_query(format!(
                "http://127.0.0.1:{}/api/projects/{}/files/{}/raw",
                local_port, file.project_id, file.id
            ), &mime_type));
        } else if let Some(peer) = state.network.lock().map_err(|e| e.to_string())?.get_peer(&file.source_node_id) {
            let port = if peer.http_file_port > 0 {
                peer.http_file_port
            } else {
                file.source_http_port
            };
            file.http_url = Some(with_file_mime_query(format!(
                "http://{}:{}/api/projects/{}/files/{}/raw",
                peer.address, port, file.project_id, file.id
            ), &mime_type));
        } else {
            file.http_url = Some(with_file_mime_query(format!(
                "http://{}:{}/api/projects/{}/files/{}/raw",
                file.source_address, file.source_http_port, file.project_id, file.id
            ), &mime_type));
        }
        if let Some(url)=file.http_url.as_ref() { file.http_url=Some(with_workspace_db(&state,&workspace_context,|db| file_server::authorize_url(db,url,&file.project_id,&file.id))?); }
    }
    Ok(files)
}

fn effective_project_file_mime(file: &models::ProjectFileRecord) -> String {
    if !file.mime_type.trim().is_empty() && file.mime_type != "application/octet-stream" {
        return file.mime_type.clone();
    }
    let ext = std::path::Path::new(&file.name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    file_server::guess_mime_type(ext).to_string()
}

fn with_file_mime_query(url: String, mime_type: &str) -> String {
    let mut encoded = String::with_capacity(mime_type.len());
    for byte in mime_type.bytes() {
        if matches!(byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push(char::from_digit((byte >> 4) as u32, 16).unwrap().to_ascii_uppercase());
            encoded.push(char::from_digit((byte & 0x0f) as u32, 16).unwrap().to_ascii_uppercase());
        }
    }
    format!("{url}?mime={encoded}")
}

#[tauri::command]
fn get_project_folders(
    state: State<AppState>,
    project_id: String, workspace_context: WorkspaceContext) -> Result<Vec<models::ProjectFolderRecord>, String> {
    with_workspace_db(&state, &workspace_context, |db| db.project_folders(&project_id))
}

#[tauri::command]
async fn save_wiki_asset(
    state: State<'_, AppState>,
    workspace_context: workspace_scope::WorkspaceContext,
    name: String,
    base64_content: String,
) -> Result<String, String> {
    use base64::Engine;
    with_workspace_db(&state, &workspace_context, |_| Ok(()))?;
    let clean_name = web_server::wiki_asset_name(&name).ok_or("文件名无效")?;
    let raw_bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_content)
        .map_err(|e| format!("Base64 解码失败: {e}"))?;
    let dir = state.file_server.storage_root()
        .parent()
        .map(|p| p.join("wiki_assets"))
        .unwrap_or_else(|| state.file_server.storage_root().join("wiki_assets"));
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("创建目录失败: {e}"))?;
    let dest = dir.join(clean_name);
    tokio::fs::write(&dest, &raw_bytes)
        .await
        .map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(format!("assets/{clean_name}"))
}

#[tauri::command]
async fn save_project_file(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
    relative_path: String,
    base64_content: String,
    mime_type: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::ProjectFileRecord, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state,&workspace_context,|db| db.require_project_read(&project_id,&db.current_user_id()?))?;
    use base64::Engine;
    let raw_bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_content)
        .map_err(|e| format!("Base64 解码失败: {e}"))?;

    let file_id = format!("pf-{}", uuid::Uuid::new_v4().simple());
    let dest_path = state.file_server.file_path(&workspace_context.workspace_id, &project_id, &file_id);
    if let Some(parent) = dest_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::fs::write(&dest_path, &raw_bytes)
        .await
        .map_err(|e| e.to_string())?;

    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(&raw_bytes);
    let sha256 = format!("{:x}", hasher.finalize());

    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".into());

    let record = models::ProjectFileRecord { workspace_id: Some(workspace_context.workspace_id.clone()),
        id: file_id,
        project_id: project_id.clone(),
        name,
        relative_path,
        size_bytes: raw_bytes.len() as u64,
        mime_type,
        sha256,
        source_node_id: state.network.lock().map_err(|e| e.to_string())?.node_id.clone(),
        source_address: local_ip,
        source_http_port: state.file_server.port(),
        uploaded_by: current_user_id,
        uploaded_at: Utc::now().to_rfc3339(),
        is_local: true,
        http_url: None,
    };

    with_workspace_db(&state, &workspace_context, |db| db.insert_project_file(&record, true))?;
    Ok(record)
}

fn collect_files_recursive(
    current: &std::path::Path,
    root: &std::path::Path,
) -> Vec<(std::path::PathBuf, String)> {
    let mut results = Vec::new();
    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                results.extend(collect_files_recursive(&p, root));
            } else if p.is_file() {
                if let Ok(rel) = p.strip_prefix(root) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    results.push((p, rel_str));
                }
            }
        }
    }
    results
}

#[tauri::command]
async fn upload_project_files_from_paths(
    state: State<'_, AppState>,
    project_id: String,
    target_directory: String,
    paths: Vec<String>,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<Vec<models::ProjectFileRecord>, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    with_workspace_db(&state,&workspace_context,|db| db.require_project_read(&project_id,&db.current_user_id()?))?;
    use sha2::Digest;

    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".into());
    let local_port = state.file_server.port();

    let mut created_files = Vec::new();

    for p_str in paths {
        let path = std::path::PathBuf::from(&p_str);
        if !path.exists() {
            continue;
        }

        if path.is_file() {
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string();

            let rel_path = if target_directory.trim().is_empty() {
                filename.clone()
            } else {
                format!("{}/{}", target_directory.trim().trim_matches('/'), filename)
            };

            let bytes = tokio::fs::read(&path)
                .await
                .map_err(|e| format!("读取文件失败 {}: {e}", path.display()))?;

            let mut hasher = sha2::Sha256::new();
            hasher.update(&bytes);
            let sha256 = format!("{:x}", hasher.finalize());

            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default();
            let mime_type = file_server::guess_mime_type(ext).to_string();

            let file_id = format!("pf-{}", uuid::Uuid::new_v4().simple());
            let dest = state.file_server.file_path(&workspace_context.workspace_id, &project_id, &file_id);
            if let Some(parent) = dest.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            tokio::fs::write(&dest, &bytes)
                .await
                .map_err(|e| format!("写入文件失败: {e}"))?;

            let record = models::ProjectFileRecord { workspace_id: Some(workspace_context.workspace_id.clone()),
                id: file_id,
                project_id: project_id.clone(),
                name: filename,
                relative_path: rel_path,
                size_bytes: bytes.len() as u64,
                mime_type,
                sha256,
                source_node_id: state.network.lock().map_err(|e| e.to_string())?.node_id.clone(),
                source_address: local_ip.clone(),
                source_http_port: local_port,
                uploaded_by: current_user_id.clone(),
                uploaded_at: Utc::now().to_rfc3339(),
                is_local: true,
                http_url: None,
            };

            with_workspace_db(&state, &workspace_context, |db| db.insert_project_file(&record, true))?;
            created_files.push(record);
        } else if path.is_dir() {
            let dir_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("folder")
                .to_string();

            let folder_base = if target_directory.trim().is_empty() {
                dir_name
            } else {
                format!("{}/{}", target_directory.trim().trim_matches('/'), dir_name)
            };

            let collected = collect_files_recursive(&path, &path);
            for (file_abs, rel_within_dir) in collected {
                let full_rel = format!("{folder_base}/{rel_within_dir}");
                let filename = file_abs
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("file")
                    .to_string();

                let bytes = tokio::fs::read(&file_abs)
                    .await
                    .map_err(|e| format!("读取文件失败 {}: {e}", file_abs.display()))?;

                let mut hasher = sha2::Sha256::new();
                hasher.update(&bytes);
                let sha256 = format!("{:x}", hasher.finalize());

                let ext = file_abs.extension().and_then(|e| e.to_str()).unwrap_or_default();
                let mime_type = file_server::guess_mime_type(ext).to_string();

                let file_id = format!("pf-{}", uuid::Uuid::new_v4().simple());
                let dest = state.file_server.file_path(&workspace_context.workspace_id, &project_id, &file_id);
                if let Some(parent) = dest.parent() {
                    let _ = tokio::fs::create_dir_all(parent).await;
                }
                tokio::fs::write(&dest, &bytes)
                    .await
                    .map_err(|e| format!("写入文件失败: {e}"))?;

                let record = models::ProjectFileRecord { workspace_id: Some(workspace_context.workspace_id.clone()),
                    id: file_id,
                    project_id: project_id.clone(),
                    name: filename,
                    relative_path: full_rel,
                    size_bytes: bytes.len() as u64,
                    mime_type,
                    sha256,
                    source_node_id: state.network.lock().map_err(|e| e.to_string())?.node_id.clone(),
                    source_address: local_ip.clone(),
                    source_http_port: local_port,
                    uploaded_by: current_user_id.clone(),
                    uploaded_at: Utc::now().to_rfc3339(),
                    is_local: true,
                    http_url: None,
                };

                with_workspace_db(&state, &workspace_context, |db| db.insert_project_file(&record, true))?;
                created_files.push(record);
            }
        }
    }

    Ok(created_files)
}

#[tauri::command]
fn delete_project_file(
    state: State<AppState>,
    file_id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<bool, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let local_file = with_workspace_db(&state, &workspace_context, |db| {
        Ok::<Option<(String, String)>, String>(db.project_file_by_id(&file_id)?.map(|file| (file.project_id, file.id)))
    })?;
    let result = with_workspace_db(&state, &workspace_context, |db| {
        db.delete_project_file(&file_id, &current_user_id)
    })?;
    if let Some((project_id, id)) = local_file {
        let _ = std::fs::remove_file(state.file_server.file_path(&workspace_context.workspace_id, &project_id, &id));
    }
    Ok(result)
}

#[tauri::command]
fn create_project_folder(
    state: State<AppState>,
    project_id: String,
    path: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<models::ProjectFolderRecord, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let folder_id = format!("fld-{}", uuid::Uuid::new_v4().simple());
    let record = models::ProjectFolderRecord { workspace_id: Some(workspace_context.workspace_id.clone()),
        id: folder_id,
        project_id,
        path,
        created_by: current_user_id,
        created_at: Utc::now().to_rfc3339(),
    };
    with_workspace_db(&state, &workspace_context, |db| db.insert_project_folder(&record, true))?;
    Ok(record)
}

#[tauri::command]
fn delete_project_folder(
    state: State<AppState>,
    folder_id: String,
    current_user_id: String, workspace_context: WorkspaceContext) -> Result<bool, String> {
    if current_user_id!=workspace_context.user_id { return Err("请求用户与会话身份不一致".into()); }
    let descendants = with_workspace_db(&state, &workspace_context, |db| db.project_folder_descendant_files(&folder_id))?;
    let result = with_workspace_db(&state, &workspace_context, |db| {
        db.delete_project_folder(&folder_id, &current_user_id)
    })?;
    for (project_id, file_id) in descendants {
        let path = state.file_server.file_path(&workspace_context.workspace_id, &project_id, &file_id);
        let _ = std::fs::remove_file(path);
    }
    Ok(result)
}

#[tauri::command]
async fn read_project_file_content(
    state: State<'_, AppState>,
    project_id: String,
    file_id: String, workspace_context: WorkspaceContext) -> Result<String, String> {
    with_workspace_db(&state,&workspace_context,|db| db.require_project_read(&project_id,&db.current_user_id()?))?;
    with_workspace_db(&state,&workspace_context,|db| db.project_file_by_id(&file_id)?.filter(|file| file.project_id==project_id).ok_or_else(|| "文件不存在或没有访问权限".to_string()).map(|_| ()))?;
    let local_path = state.file_server.file_path(&workspace_context.workspace_id, &project_id, &file_id);
    if local_path.exists() {
        let bytes = tokio::fs::read(&local_path)
            .await
            .map_err(|e| e.to_string())?;
        const MAX_BYTES: usize = 1024 * 1024;
        let slice = if bytes.len() > MAX_BYTES {
            &bytes[..MAX_BYTES]
        } else {
            &bytes[..]
        };
        return Ok(String::from_utf8_lossy(slice).to_string());
    }

    let files = with_workspace_db(&state, &workspace_context, |db| db.project_files(&project_id))?;
    let file = files
        .into_iter()
        .find(|f| f.id == file_id)
        .ok_or_else(|| "文件不存在".to_string())?;
    let (ip, port) = if let Some(peer) = state.network.lock().map_err(|e| e.to_string())?.get_peer(&file.source_node_id) {
        let port = if peer.http_file_port > 0 {
            peer.http_file_port
        } else {
            file.source_http_port
        };
        (peer.address, port)
    } else {
        (file.source_address, file.source_http_port)
    };

    let url = format!(
        "http://{}:{}/api/projects/{}/files/{}/raw",
        ip, port, project_id, file_id
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("无法连接文件源节点: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("源节点返回错误: {}", res.status()));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("下载文件内容失败: {e}"))?;
    if let Some(parent) = local_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let _ = tokio::fs::write(&local_path, &bytes).await;

    const MAX_BYTES: usize = 1024 * 1024;
    let slice = if bytes.len() > MAX_BYTES {
        &bytes[..MAX_BYTES]
    } else {
        &bytes[..]
    };
    Ok(String::from_utf8_lossy(slice).to_string())
}

#[tauri::command]
async fn download_project_file_to(
    state: State<'_, AppState>,
    project_id: String,
    file_id: String,
    destination_path: String, workspace_context: WorkspaceContext) -> Result<String, String> {
    with_workspace_db(&state,&workspace_context,|db| db.require_project_read(&project_id,&db.current_user_id()?))?;
    with_workspace_db(&state,&workspace_context,|db| db.project_file_by_id(&file_id)?.filter(|file| file.project_id==project_id).ok_or_else(|| "文件不存在或没有访问权限".to_string()).map(|_| ()))?;
    let local_path = state.file_server.file_path(&workspace_context.workspace_id, &project_id, &file_id);
    let dest = std::path::PathBuf::from(&destination_path);

    if local_path.exists() {
        tokio::fs::copy(&local_path, &dest)
            .await
            .map_err(|e| format!("复制文件到目标路径失败: {e}"))?;
        return Ok(destination_path);
    }

    let files = with_workspace_db(&state, &workspace_context, |db| db.project_files(&project_id))?;
    let file = files
        .into_iter()
        .find(|f| f.id == file_id)
        .ok_or_else(|| "文件不存在".to_string())?;
    let (ip, port) = if let Some(peer) = state.network.lock().map_err(|e| e.to_string())?.get_peer(&file.source_node_id) {
        let port = if peer.http_file_port > 0 {
            peer.http_file_port
        } else {
            file.source_http_port
        };
        (peer.address, port)
    } else {
        (file.source_address, file.source_http_port)
    };

    let url = format!(
        "http://{}:{}/api/projects/{}/files/{}/raw",
        ip, port, project_id, file_id
    );
    let url=with_workspace_db(&state,&workspace_context,|db| file_server::authorize_url(db,&url,&project_id,&file_id))?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("无法连接文件源节点: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("源节点返回错误: {}", res.status()));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("下载文件内容失败: {e}"))?;

    tokio::fs::write(&dest, &bytes)
        .await
        .map_err(|e| format!("写入文件失败: {e}"))?;
    if let Some(parent) = local_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let _ = tokio::fs::write(&local_path, &bytes).await;

    Ok(destination_path)
}

#[tauri::command]
async fn save_file_to_path(
    data_url: String,
    destination_path: String,
) -> Result<String, String> {
    let dest = std::path::PathBuf::from(&destination_path);
    if let Some(parent) = dest.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    if data_url.starts_with("data:") {
        let comma_idx = data_url
            .find(',')
            .ok_or_else(|| "无效的 Data URL 格式".to_string())?;
        let meta = &data_url[..comma_idx];
        let raw = &data_url[comma_idx + 1..];

        let bytes = if meta.contains(";base64") {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(raw.trim())
                .map_err(|e| format!("Base64 解码失败: {e}"))?
        } else {
            raw.as_bytes().to_vec()
        };

        tokio::fs::write(&dest, &bytes)
            .await
            .map_err(|e| format!("写入文件失败: {e}"))?;
        return Ok(destination_path);
    }

    if data_url.starts_with("http://") || data_url.starts_with("https://") {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client
            .get(&data_url)
            .send()
            .await
            .map_err(|e| format!("网络请求失败: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("下载失败，状态码: {}", resp.status()));
        }
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        tokio::fs::write(&dest, &bytes)
            .await
            .map_err(|e| format!("写入文件失败: {e}"))?;
        return Ok(destination_path);
    }

    let src = std::path::PathBuf::from(&data_url);
    if src.exists() {
        tokio::fs::copy(&src, &dest)
            .await
            .map_err(|e| format!("复制文件失败: {e}"))?;
        return Ok(destination_path);
    }

    Err("无法识别的文件数据格式或路径".to_string())
}

#[tauri::command]
fn show_item_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.replace('/', "\\")))
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let p = std::path::Path::new(&path);
        let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
        let _ = std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn();
    }
    Ok(())
}

#[tauri::command]
fn get_platform() -> &'static str {
    std::env::consts::OS
}

#[tauri::command]
fn set_global_shortcuts(
    app: AppHandle,
    state: State<AppState>,
    bindings: Vec<GlobalShortcutBinding>,
) -> Result<(), String> {
    let previous_bindings = state
        .shortcut_bindings
        .lock()
        .map_err(|_| "系统快捷键状态暂时不可用".to_string())?
        .clone();
    let requested_bindings = bindings.clone();
    let mut parsed = Vec::with_capacity(bindings.len());
    let mut shortcut_ids = HashMap::new();
    for binding in bindings {
        if binding.action.trim().is_empty() || binding.accelerator.trim().is_empty() {
            return Err("快捷键名称和按键组合不能为空".into());
        }
        let shortcut = binding
            .accelerator
            .parse::<Shortcut>()
            .map_err(|error| format!("快捷键 {} 无效: {error}", binding.accelerator))?;
        if shortcut_ids
            .insert(shortcut.id(), binding.accelerator.clone())
            .is_some()
        {
            return Err(format!("快捷键 {} 与其他操作重复", binding.accelerator));
        }
        parsed.push((binding, shortcut));
    }

    app.global_shortcut()
        .unregister_all()
        .map_err(|error| format!("无法更新系统快捷键: {error}"))?;
    state
        .shortcut_actions
        .lock()
        .map_err(|_| "系统快捷键状态暂时不可用".to_string())?
        .clear();

    let mut actions = HashMap::new();
    for (binding, shortcut) in parsed {
        if let Err(error) = app.global_shortcut().register(shortcut) {
            let _ = app.global_shortcut().unregister_all();
            let mut restored_actions = HashMap::new();
            for previous in &previous_bindings {
                if let Ok(previous_shortcut) = previous.accelerator.parse::<Shortcut>() {
                    if app.global_shortcut().register(previous_shortcut).is_ok() {
                        restored_actions.insert(previous_shortcut.id(), previous.action.clone());
                    }
                }
            }
            if let Ok(mut current_actions) = state.shortcut_actions.lock() {
                *current_actions = restored_actions;
            }
            return Err(format!(
                "无法注册系统快捷键 {}，可能已被其他程序占用: {error}",
                binding.accelerator
            ));
        }
        actions.insert(shortcut.id(), binding.action);
    }
    *state
        .shortcut_actions
        .lock()
        .map_err(|_| "系统快捷键状态暂时不可用".to_string())? = actions;
    *state
        .shortcut_bindings
        .lock()
        .map_err(|_| "系统快捷键状态暂时不可用".to_string())? = requested_bindings;
    Ok(())
}

#[tauri::command]
async fn toggle_desktop_calendar(app: AppHandle) -> Result<bool, String> {
    if app_interface_locked(&app) { show_main_window(&app); return Err("请先解锁程序界面".into()); }
    desktop_calendar::toggle_desktop_calendar(&app).await
}

#[tauri::command]
async fn show_desktop_calendar(app: AppHandle) -> Result<bool, String> {
    if app_interface_locked(&app) { return Err("请先解锁程序界面".into()); }
    desktop_calendar::show_desktop_calendar(&app).await
}

#[tauri::command]
async fn hide_desktop_calendar(app: AppHandle) -> Result<bool, String> {
    desktop_calendar::hide_desktop_calendar(&app).await
}

#[tauri::command]
fn is_desktop_calendar_visible() -> bool {
    desktop_calendar::is_active()
}

#[tauri::command]
fn is_desktop_calendar_adjust_mode() -> bool {
    desktop_calendar::is_adjust_mode()
}

#[tauri::command]
async fn set_desktop_calendar_adjust_mode(app: AppHandle, enabled: bool) -> Result<(), String> {
    desktop_calendar::set_adjust_mode(&app, enabled).await
}

#[tauri::command]
async fn set_desktop_calendar_bounds(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    desktop_calendar::set_bounds(&app, x, y, width, height).await
}

#[tauri::command]
fn get_desktop_calendar_config(app: AppHandle) -> desktop_calendar::DesktopCalendarConfig {
    desktop_calendar::load_config(&app)
}

#[tauri::command]
async fn set_desktop_calendar_opacity(app: AppHandle, opacity: u32) -> Result<(), String> {
    desktop_calendar::set_opacity(&app, opacity).await
}

#[tauri::command]
async fn set_desktop_calendar_show_completed(
    app: AppHandle,
    show_completed: bool,
) -> Result<(), String> {
    desktop_calendar::set_show_completed(&app, show_completed).await
}

#[tauri::command]
async fn set_desktop_calendar_interactive_mode(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    desktop_calendar::set_interactive_mode(&app, enabled).await
}

#[tauri::command]
async fn set_desktop_calendar_theme_tone(
    app: AppHandle,
    theme_tone: String,
) -> Result<(), String> {
    desktop_calendar::set_theme_tone(&app, theme_tone).await
}

#[tauri::command]
async fn set_desktop_calendar_custom_color(
    app: AppHandle,
    custom_color: String,
) -> Result<(), String> {
    desktop_calendar::set_custom_color(&app, custom_color).await
}


#[derive(Serialize)]
struct QuickAddPosition {
    x: i32,
    y: i32,
}

#[tauri::command]
fn get_quick_add_position(app: AppHandle) -> Result<QuickAddPosition, String> {
    let Some(window) = app.get_webview_window("quick-add") else {
        return Err("快捷创建窗口未找到".to_string());
    };
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    Ok(QuickAddPosition { x: pos.x, y: pos.y })
}

#[tauri::command]
fn set_quick_add_position(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    let Some(window) = app.get_webview_window("quick-add") else {
        return Err("快捷创建窗口未找到".to_string());
    };
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_task_form(app: AppHandle, date: String) -> Result<(), String> {
    if app_interface_locked(&app) { show_main_window(&app); return Ok(()); }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        window
            .emit("task-form://open", serde_json::json!({ "date": date }))
            .map_err(|error| error.to_string())?;
        Ok(())
    } else {
        Err("主窗口未就绪".to_string())
    }
}

#[tauri::command]
fn open_task_list(app: AppHandle, date: String) -> Result<(), String> {
    if app_interface_locked(&app) { show_main_window(&app); return Ok(()); }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        window
            .emit("task-list://open", serde_json::json!({ "date": date }))
            .map_err(|error| error.to_string())?;
        Ok(())
    } else {
        Err("主窗口未就绪".to_string())
    }
}

pub fn run() {
    STARTED_BY_AUTOSTART.store(
        std::env::args_os().any(|argument| argument == "--autostart"),
        Ordering::Release,
    );
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window(app);
            let urls: Vec<String> = args.into_iter().filter(|arg| arg.starts_with("lanmind://task/")).collect();
            if !urls.is_empty() { let _ = app.emit("deep-link://new-url", urls); }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let action = app.try_state::<AppState>().and_then(|state| {
                        state
                            .shortcut_actions
                            .lock()
                            .ok()
                            .and_then(|actions| actions.get(&shortcut.id()).cloned())
                    });
                    if let Some(action) = action {
                        if app_interface_locked(app) { show_main_window(app); return; }
                        if action == "quickAdd" && show_quick_add_window(app) {
                            return;
                        }
                        show_main_window(app);
                        let _ = app.emit("shortcut://action", action);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("无法解析应用数据目录: {error}"))?;
            fs::create_dir_all(&data_dir)
                .map_err(|error| format!("无法创建应用数据目录: {error}"))?;
            let database = Database::open(&data_dir.join("zhiyu-collaboration.sqlite"))
                .map_err(|error| format!("无法打开本地数据库: {error}"))?;
            if let Err(error) = ai_runtime::recover_checkpoints(&database, &data_dir.join("ai-recovery")) {
                eprintln!("AI recovery unavailable: {}", error.code);
            }
            let db = Arc::new(Mutex::new(database));
            let (workspace_id, _) = db
                .lock()
                .map_err(|_| "数据库初始化失败".to_string())?
                .workspace()
                .map_err(|error| error.to_string())?;
            let workspace_token = db
                .lock()
                .map_err(|_| "数据库初始化失败".to_string())?
                .workspace_token()
                .map_err(|error| error.to_string())?;
            let user_id = db
                .lock()
                .map_err(|_| "数据库初始化失败".to_string())?
                .current_user_id()
                .map_err(|error| error.to_string())?;
            let network = network::start(
                app.handle().clone(),
                db.clone(),
                workspace_id,
                workspace_token,
                user_id,
            )?;
            let storage_root = data_dir.join("storage").join("projects");
            let mcp = McpRuntime::new(db.clone(), app.handle().clone());
            let mcp_config = db
                .lock()
                .map_err(|_| "数据库初始化失败".to_string())?
                .mcp_config()?;
            let mcp_to_start = mcp.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = mcp_to_start.apply(mcp_config).await {
                    eprintln!("MCP 服务启动失败: {error}");
                }
            });
            let web = WebRuntime::new(db.clone(), storage_root.clone(), app.handle().clone());
            let web_config = db
                .lock()
                .map_err(|_| "数据库初始化失败".to_string())?
                .web_config()?;
            let web_to_start = web.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = web_to_start.apply(web_config).await {
                    eprintln!("Web 服务启动失败: {error}");
                }
            });
            let shortcut_actions = Arc::new(Mutex::new(HashMap::new()));
            let shortcut_bindings = Arc::new(Mutex::new(Vec::new()));
            for (action, accelerator) in [
                ("quickAdd", "Ctrl+Shift+Space"),
                ("toggleRightPanel", "Alt+N"),
                ("toggleRiskScanner", "Alt+R"),
                ("toggleTheme", "Alt+T"),
            ] {
                let Ok(shortcut) = accelerator.parse::<Shortcut>() else {
                    continue;
                };
                if app.global_shortcut().register(shortcut).is_ok() {
                    shortcut_actions
                        .lock()
                        .map_err(|_| "系统快捷键初始化失败".to_string())?
                        .insert(shortcut.id(), action.to_string());
                    shortcut_bindings
                        .lock()
                        .map_err(|_| "系统快捷键初始化失败".to_string())?
                        .push(GlobalShortcutBinding {
                            action: action.to_string(),
                            accelerator: accelerator.to_string(),
                        });
                }
            }
            let file_server = tauri::async_runtime::block_on(async {
                file_server::FileServer::start(storage_root, 45995, db.clone()).await
            })
            .map_err(|e| format!("启动文件共享服务失败: {e}"))?;
            network.set_http_file_port(file_server.port());
            let file_server = Arc::new(file_server);

            let app_lock_config = db.lock().map_err(|_| "数据库暂时不可用")?.app_lock_config()?;
            let app_lock = Arc::new(app_lock::AppLockRuntime::new(app_lock_config));
            let close_button_behavior = db.lock().map_err(|_| "数据库暂时不可用")?.close_button_behavior()?;
            app.manage(AppState {
                ai: ai_runtime::AiRuntime::default(),
                db,
                mcp,
                web,
                app_lock: app_lock.clone(),
                close_button_exits: AtomicBool::new(close_button_behavior == CloseButtonBehavior::Exit),
                lock_hidden_windows: Mutex::new(Vec::new()),
                network: Mutex::new(network),
                file_server,
                shortcut_actions,
                shortcut_bindings,
                notification_ready: AtomicBool::new(false),
                pending_notifications: Mutex::new(Vec::new()),
                tray_blinking: Arc::new(AtomicBool::new(false)),
                tray_generation: Arc::new(AtomicU64::new(0)),
                tray_popup_generation: Arc::new(AtomicU64::new(0)),
                tray_unread: Arc::new(Mutex::new(Vec::new())),
            });
            app.manage(screenshot::ScreenshotRuntime::default());
            ai_api::spawn_scheduler(app.handle().clone());

            let recycle_timer_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    if let Some(state) = recycle_timer_app.try_state::<AppState>() {
                        if let Ok(db) = state.db.lock() {
                            if let Err(error) = db.cleanup_expired_tasks() {
                                eprintln!("task recycle cleanup failed: {error}");
                            }
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                }
            });

            let lock_timer_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    if let Ok(Some(status)) = app_lock.tick() { publish_app_lock_status(&lock_timer_app, &status); }
                }
            });
            let locale = i18n::app_locale(app.handle());
            i18n::update_native(app.handle(), &locale);
            let show_item = MenuItem::with_id(app, "show", i18n::translate(&locale, "native", "tray.show", &[]), true, None::<&str>)?;
            let is_pinned = desktop_calendar::is_active();
            let desktop_cal_item = CheckMenuItem::with_id(
                app,
                "desktop_cal",
                i18n::translate(&locale, "native", "tray.calendar", &[]),
                true,
                is_pinned,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", i18n::translate(&locale, "native", "tray.quit", &[]), true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &desktop_cal_item, &quit_item])?;
            let mut tray = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip(i18n::translate(&locale, "native", "tray.tooltip", &[]))
                .on_menu_event(|app, event| {
                    if event.id() == "show" {
                        show_main_window(app);
                    } else if event.id() == "desktop_cal" {
                        if app_interface_locked(app) { show_main_window(app); return; }
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) =
                                desktop_calendar::toggle_desktop_calendar(&app).await
                            {
                                eprintln!("failed to toggle desktop calendar from tray: {error}");
                                let _ = app.emit("desktop-calendar://error", error);
                                update_tray_desktop_calendar_menu(
                                    &app,
                                    desktop_calendar::is_active(),
                                );
                            }
                        });
                    } else if event.id() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Enter { position, .. } | TrayIconEvent::Move { position, .. } => {
                            let app = tray.app_handle();
                            if let Some(state) = app.try_state::<AppState>() {
                                let has_unread = state
                                    .tray_unread
                                    .lock()
                                    .map(|items| !items.is_empty())
                                    .unwrap_or(false);
                                if has_unread {
                                    show_tray_unread_popup_at(app, position.x as i32, position.y as i32);
                                }
                            }
                        }
                        TrayIconEvent::Leave { .. } => {
                            let app = tray.app_handle().clone();
                            let hide_generation = app
                                .try_state::<AppState>()
                                .map(|state| state.tray_popup_generation.fetch_add(1, Ordering::AcqRel) + 1);
                            std::thread::spawn(move || {
                                std::thread::sleep(std::time::Duration::from_millis(400));
                                let should_hide = hide_generation
                                    .and_then(|generation| {
                                        app.try_state::<AppState>().map(|state| {
                                            state.tray_popup_generation.load(Ordering::Acquire) == generation
                                        })
                                    })
                                    .unwrap_or(true);
                                if !should_hide {
                                    return;
                                }
                                if let Some(window) = app.get_webview_window("tray-unread") {
                                    let _ = window.hide();
                                }
                            });
                        }
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            position,
                            ..
                        } => {
                            let app = tray.app_handle();
                            let has_unread = app
                                .try_state::<AppState>()
                                .and_then(|state| state.tray_unread.lock().ok().map(|items| !items.is_empty()))
                                .unwrap_or(false);
                            if has_unread {
                                show_tray_unread_popup_at(app, position.x as i32, position.y as i32);
                            } else {
                                show_main_window(app);
                            }
                        }
                        _ => {}
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Automatically restore desktop calendar if previously enabled
            let cal_cfg = desktop_calendar::load_config(app.handle());
            if cal_cfg.enabled {
                let cal_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    if app_interface_locked(&cal_app) {
                        if let Some(state) = cal_app.try_state::<AppState>() {
                            if let Ok(mut hidden) = state.lock_hidden_windows.lock() {
                                if !hidden.iter().any(|label| label == "desktop-calendar") { hidden.push("desktop-calendar".into()); }
                            }
                        }
                        return;
                    }
                    if let Err(error) = desktop_calendar::show_desktop_calendar(&cal_app).await {
                        eprintln!("failed to restore desktop calendar: {error}");
                        let _ = cal_app.emit("desktop-calendar://error", error);
                    }
                });
            }

            let fallback_app = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(10));
                if !MAIN_WINDOW_READY.load(Ordering::Acquire)
                    && !STARTED_BY_AUTOSTART.load(Ordering::Acquire)
                {
                    show_main_window(&fallback_app);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Focused(true)) {
                let locked = app_interface_locked(window.app_handle());
                if locked && window.label() != "main" {
                    let _ = window.hide();
                    show_main_window(window.app_handle());
                }
            }
            if window.label() == "desktop-calendar" {
                desktop_calendar::on_window_event(window.app_handle(), event);
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let app = window.app_handle();
                    let should_exit = app.try_state::<AppState>()
                        .map(|state| state.close_button_exits.load(Ordering::Acquire))
                        .unwrap_or(false);
                    if should_exit {
                        app.exit(0);
                    } else {
                        let _ = window.hide();
                    }
                } else if window.label() == "quick-add" {
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == "desktop-calendar" {
                    api.prevent_close();
                    let app = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = desktop_calendar::hide_desktop_calendar(&app).await {
                            eprintln!("failed to hide desktop calendar: {error}");
                        }
                    });
                } else if window.label() == "notification" {
                    api.prevent_close();
                    let _ = window.emit("notification://dismiss-current", ());
                } else if window.label() == "tray-unread" {
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == "optical-transfer" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![ai_api::ai_api, network::shared_files::lan_share, get_workspace_context, get_workspace_data, save_workspace_data, save_wiki_changes,
            screenshot::capture_chat_screenshot,
            screenshot::get_screenshot_frame,
            screenshot::screenshot_ready,
            screenshot::finish_screenshot,
            screenshot::cancel_screenshot,
            i18n::get_locale_settings,
            i18n::set_locale_preference,
            resize_notification_window,
            get_close_button_behavior,
            set_close_button_behavior,
            optical::optical_source_open,
            optical::optical_source_read_range,
            optical::optical_source_close,
            optical::optical_cache_create,
            optical::optical_cache_load,
            optical::optical_cache_read,
            optical::optical_cache_write,
            optical::optical_cache_commit,
            optical::optical_cache_delete,
            optical::optical_cache_keys,
            optical::output::optical_output_begin,
            optical::output::optical_output_write,
            optical::output::optical_output_finalize,
            optical::output::optical_output_abort,
            open_optical_window,
            toggle_desktop_calendar,
            show_desktop_calendar,
            hide_desktop_calendar,
            is_desktop_calendar_visible,
            is_desktop_calendar_adjust_mode,
            set_desktop_calendar_adjust_mode,
            set_desktop_calendar_bounds,
            get_desktop_calendar_config,
            set_desktop_calendar_opacity,
            set_desktop_calendar_show_completed,
            set_desktop_calendar_theme_tone,
            set_desktop_calendar_custom_color,
            set_desktop_calendar_interactive_mode,
            get_quick_add_position,
            set_quick_add_position,
            open_task_form,
            open_task_list,
            get_bootstrap,
            get_states,
            create_state,
            update_state,
            delete_state,
            reorder_states,
            set_default_state,
            get_workspace,
            get_workspaces,
            create_workspace,
            delete_workspace,
            dissolve_workspace,
            switch_workspace,
            update_workspace,
            get_workspace_members,
            request_workspace_membership,
            review_workspace_membership,
            get_users,
            get_workspace_member_candidates,
            get_local_directory,
            save_local_directory,
            set_identity,
            get_projects,
            create_project,
            update_project,
            transfer_project,
            delete_project,
            get_tasks,
            export_tasks,
            save_text_file,
            import_tasks,
            clear_local_data,
            create_task,
            update_task,
            save_task_with_children,
            delete_task,
            task_recycle,
            get_task_comments,
            create_task_comment,
            update_task_comment,
            delete_task_comment,
            get_task_activity,
            get_task_activity_page,
            get_mcp_status,
            update_mcp_config,
            rotate_mcp_token,
            get_web_status,
            get_app_lock_status,
            update_app_lock_config,
            record_app_activity,
            lock_app,
            unlock_app,
            get_web_password,
            update_web_config,
            get_sync_logs,
            get_sync_logs_page,
            get_risk_warnings,
            get_task_assignment_notifications,
            mark_task_assignment_notifications_read,
            get_llm_config,
            update_llm_config,
            test_llm_connection,
            fetch_llm_models,
            get_ppt_templates,
            add_ppt_template,
            quick_parse_task,
            send_ai_chat,
            send_ai_chat_stream,
            generate_report,
            generate_presentation_plan,
            get_chat_messages,
            get_chat_message_page,
            get_chat_unread_summaries,
            search_chat_messages,
            get_chat_message_context,
            open_tray_unread_conversation,
            hide_tray_unread_popup,
            keep_tray_unread_popup_open,
            clear_chat_messages,
            delete_chat_message,
            mark_chat_messages_read,
            send_chat_message,
            get_chat_groups,
            save_chat_group,
            update_chat_group_members,
            update_chat_group_profile,
            transfer_chat_group,
            delete_chat_group,
            get_group_announcements,
            save_group_announcement,
            delete_group_announcement,
            pin_group_announcement,
            mark_group_announcement_read,
            get_network_status,
            sync_now,
            register_file_for_transfer,
            download_file_from_peer,
            get_project_files,
            get_project_folders,
            save_project_file,
            save_wiki_asset,
            upload_project_files_from_paths,
            delete_project_file,
            create_project_folder,
            delete_project_folder,
            read_project_file_content,
            download_project_file_to,
            save_file_to_path,
            show_item_in_folder,
            get_platform,
            set_global_shortcuts,
            main_window_ready,
            reveal_main_window,
            show_notification_window,
            get_pending_notifications,
            notification_window_ready,
            update_tray_unread_status
        ])
        .run(tauri::generate_context!())
        .expect("启动智域协同失败");
}
