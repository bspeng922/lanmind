//! Desktop composition root.
//!
//! This module owns Tauri commands and process-level integrations. UI code
//! remains in the React renderer; SQLite, P2P, tray, window lifecycle, and
//! global shortcuts stay in this trusted Rust process.

mod db;
mod desktop_calendar;
mod file_server;
mod mcp;
mod models;
mod network;

use crate::db::{Database, ReportDataset, ReportTaskRecord};
use crate::mcp::McpRuntime;
#[cfg(test)]
use crate::models::Task;
use crate::models::{
    BootstrapData, GeneratedPresentation, GeneratedReport, LlmConfig, PresentationRelation,
    PresentationSlide, PresentationSupportingPoint, PresentationVisual, ReportMetrics,
    ReportSection, ReportSectionItem, ReportSourceTask, User,
};
use crate::network::NetworkRuntime;
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
    db: Arc<Mutex<Database>>,
    mcp: McpRuntime,
    network: NetworkRuntime,
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
        "daily" => "日报",
        "weekly" => "周报",
        "monthly" => "月报",
        "quarterly" => "季度工作汇报",
        "semi_annual" => "半年工作汇报",
        "annual" => "年度工作汇报",
        _ => "工作汇报",
    }
}

fn parse_json_object<T: DeserializeOwned>(raw: &str, label: &str) -> Result<T, String> {
    let start = raw
        .find('{')
        .ok_or_else(|| format!("大模型响应中没有找到{label} JSON"))?;
    let end = raw
        .rfind('}')
        .filter(|end| *end >= start)
        .ok_or_else(|| format!("大模型返回的{label} JSON 不完整"))?;
    serde_json::from_str(&raw[start..=end])
        .map_err(|error| format!("无法解析大模型返回的{label}: {error}"))
}

fn parse_ai_report_content(raw: &str) -> Result<AiReportContent, String> {
    parse_json_object(raw, "工作汇报")
}

fn parse_ai_presentation_content(raw: &str) -> Result<AiPresentationContent, String> {
    parse_json_object(raw, "汇报 PPT 方案")
}

fn report_template(report_type: &str, has_remaining_period: bool) -> &'static str {
    match report_type {
        "daily" => "今日完成、关键进展、问题与需协同、明日计划",
        "weekly" if has_remaining_period => "本周已交付、关键进展、风险与偏差、本周剩余动作",
        "weekly" => "本周交付、里程碑进展、风险与偏差、下周动作",
        "monthly" if has_remaining_period => "月度已达成结果、重点项目进展、风险复盘、本月剩余重点",
        "monthly" => "月度结果、重点项目、复盘改进、下月重点",
        "quarterly" if has_remaining_period => {
            "季度阶段成果、关键项目进展、风险与偏差、本季度剩余重点"
        }
        "quarterly" => "季度成果、关键项目、阶段复盘、下一季度重点",
        "semi_annual" if has_remaining_period => {
            "半年阶段成果、项目组合进展、系统性问题、下半年剩余重点"
        }
        "semi_annual" => "半年成果、项目组合、能力与问题复盘、下一阶段计划",
        "annual" if has_remaining_period => "年度阶段总览、重大成果进展、关键风险、年度剩余重点",
        "annual" => "年度总览、重大成果、年度复盘、下一年度重点",
        _ => "核心成果、关键进展、风险与偏差、下一步动作",
    }
}

fn report_period_guidance(report_type: &str) -> &'static str {
    match report_type {
        "daily" => "日报聚焦今日完成、进行中事项、阻塞和明日安排，3 至 5 个重点，正文约 300 至 500 字。",
        "weekly" => "周报聚焦本周交付、目标进展、问题复盘和下周优先级，正文约 500 至 800 字。",
        "monthly" => "月报按目标或项目归纳月度成果，说明里程碑、偏差原因和下月计划，正文约 800 至 1200 字。",
        "quarterly" => "季报聚焦季度目标达成、重点项目成效、资源和风险复盘、下季度行动，正文约 1000 至 1600 字。",
        "semi_annual" => "半年报聚焦阶段成果、能力与机制沉淀、战略偏差及下半年优先事项，正文约 1200 至 1800 字。",
        "annual" => "年报归纳年度成果与贡献、关键项目复盘、经验沉淀、未完成事项和下一年度规划，正文约 1500 至 2200 字。",
        _ => "按成果、进展、风险、计划组织，保持重点明确。",
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
    let mut markdown = format!(
        "# {title}\n\n> 周期：{period}\n> 推断听众：{audience}\n\n## 最需要记住的结论\n{key_takeaway}\n\n## 管理摘要\n{executive_summary}",
    );
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
            markdown.push_str(&format!("\n\n**结论：** {conclusion}"));
        }
        if section.items.is_empty() {
            markdown.push_str("\n- 暂无");
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
                    markdown.push_str(&format!("；影响：{impact}"));
                }
                if let Some(action) = item
                    .next_action
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                {
                    markdown.push_str(&format!("；下一动作：{action}"));
                }
            }
        }
    }
    markdown.push_str(&format!(
        "\n\n## 数据依据\n- 周期相关任务：{}\n- 完成：{}\n- 有效推进：{}\n- 待处理：{}\n- 阻塞：{}\n- 逾期：{}\n- 后续计划：{}",
        metrics.relevant_tasks_count,
        metrics.completed_tasks_count,
        metrics.progressed_tasks_count,
        metrics.pending_tasks_count,
        metrics.blocked_tasks_count,
        metrics.overdue_tasks_count,
        metrics.upcoming_tasks_count,
    ));
    if !data_notes.is_empty() {
        markdown.push_str("\n\n## 数据说明");
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
    let base_url = config.base_url.trim().trim_end_matches('/');
    let model = config.model_name.trim();
    let api_key = config.api_key.trim();
    if base_url.is_empty() || model.is_empty() {
        return Err("请先在系统设置中完整配置大模型 Base URL 和模型名称".into());
    }
    if api_key.is_empty() && base_url.contains("api.openai.com") {
        return Err("当前大模型服务需要 API Key，请先在系统设置中保存密钥".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| format!("无法创建大模型请求: {error}"))?;

    let endpoint = if base_url.ends_with("/chat/completions") {
        base_url.to_string()
    } else {
        format!("{base_url}/chat/completions")
    };
    let mut request = client.post(endpoint).json(&json!({
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ]
    }));
    if !api_key.is_empty() {
        request = request.bearer_auth(api_key);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("调用大模型失败: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("无法读取大模型响应: {error}"))?;
    if !status.is_success() {
        let details = body.chars().take(500).collect::<String>();
        return Err(format!("大模型接口返回 {status}: {details}"));
    }
    let payload: Value = serde_json::from_str(&body)
        .map_err(|error| format!("大模型接口返回了无效 JSON: {error}"))?;
    let content = payload
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .ok_or_else(|| "大模型响应中没有可用的报告内容".to_string())?;
    Ok(content.to_string())
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
        "daily" => ["今日完成", "关键进展", "问题与需协同", "明日计划"],
        "weekly" if has_remaining_period => {
            ["本周已交付", "关键进展", "风险与偏差", "本周剩余动作"]
        }
        "weekly" => ["本周交付", "里程碑进展", "风险与偏差", "下周动作"],
        "monthly" if has_remaining_period => {
            ["月度已达成结果", "重点项目进展", "风险复盘", "本月剩余重点"]
        }
        "monthly" => ["月度结果", "重点项目", "复盘改进", "下月重点"],
        "quarterly" if has_remaining_period => [
            "季度阶段成果",
            "关键项目进展",
            "风险与偏差",
            "本季度剩余重点",
        ],
        "quarterly" => ["季度成果", "关键项目", "阶段复盘", "下一季度重点"],
        "semi_annual" if has_remaining_period => [
            "半年阶段成果",
            "项目组合进展",
            "系统性问题",
            "下半年剩余重点",
        ],
        "semi_annual" => ["半年成果", "项目组合", "能力与问题复盘", "下一阶段计划"],
        "annual" if has_remaining_period => {
            ["年度阶段成果", "重大事项进展", "关键风险", "年度剩余重点"]
        }
        "annual" => [
            "年度重大成果",
            "重点项目复盘",
            "年度问题复盘",
            "下一年度重点",
        ],
        _ => ["核心成果", "关键进展", "风险与偏差", "下一步动作"],
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
                    "本周期已完成。".into()
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
                    format!("当前状态为 {}。", record.status_as_of)
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
                facts.push("当前处于阻塞状态");
            }
            if record.overdue_as_of {
                facts.push("已超过截止日期");
            }
            if record.schedule_slipped {
                facts.push("本周期截止日期后移");
            }
            report_item(
                record,
                format!("{}，需明确解除条件和下一动作。", facts.join("；")),
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
                    "优先解除阻塞并更新交付时间。".into()
                } else {
                    "按截止日期推进并形成可验证交付物。".into()
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
            "achievement" => "说明周期工作形成了什么结果".into(),
            "progress" => "说明关键事项为何值得继续关注".into(),
            "risk" => "说明哪些因素可能改变结果".into(),
            "plan" => "明确接下来形成结果的动作".into(),
            _ => "传递管理判断".into(),
        }),
        conclusion: Some(if items.is_empty() {
            match kind {
                "achievement" => "当前记录中没有可确认的周期成果。".into(),
                "progress" => "当前记录中没有可确认的关键推进。".into(),
                "risk" => "当前没有已记录的阻塞、逾期或计划偏移。".into(),
                "plan" => "当前没有进入统计范围的后续重点动作。".into(),
                _ => "当前没有可形成判断的证据。".into(),
            }
        } else {
            match kind {
                "achievement" => format!("已有 {} 组完成证据，可作为本周期结果支撑。", items.len()),
                "progress" => format!("已有 {} 组关键事项形成有效推进。", items.len()),
                "risk" => format!(
                    "已有 {} 组风险证据可能影响后续结果，需要优先闭环。",
                    items.len()
                ),
                "plan" => format!("下一阶段应集中完成 {} 组可验证动作。", items.len()),
                _ => "现有证据支持本节判断。".into(),
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
            section.title = "汇报事项".into();
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
) -> Result<GeneratedReport, String> {
    let report_name = report_type_name(report_type);
    let scoped_project_count = dataset
        .records
        .iter()
        .filter_map(|record| record.task.project_id.as_deref())
        .collect::<HashSet<_>>()
        .len();
    let fallback_title = format!("{report_name} ({start} ~ {end})");
    let period = format!("{start} 至 {end}");
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
            .push("叙述部分仅使用优先级最高的 200 个任务，核心指标仍基于完整范围计算。".into());
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
        "当前汇报范围内暂无符合统计口径的任务记录。".to_string()
    } else {
        format!(
            "截至 {as_of}，周期内完成 {} 项、有效推进 {} 项，当前阻塞 {} 项、逾期 {} 项，后续计划 {} 项。",
            dataset.metrics.completed_tasks_count,
            dataset.metrics.progressed_tasks_count,
            dataset.metrics.blocked_tasks_count,
            dataset.metrics.overdue_tasks_count,
            dataset.metrics.upcoming_tasks_count,
        )
    };
    let fallback_audience = if scoped_project_count == 1 {
        "项目负责人及协作成员"
    } else {
        "关注阶段结果、风险与资源安排的管理者"
    }
    .to_string();
    let fallback_takeaway =
        if dataset.metrics.relevant_tasks_count == 0 && dataset.metrics.upcoming_tasks_count == 0 {
            "当前范围缺少可形成管理判断的任务证据，需要补充工作记录。".to_string()
        } else if dataset.metrics.blocked_tasks_count + dataset.metrics.overdue_tasks_count > 0 {
            format!(
                "阶段工作已有推进，但当前 {} 项阻塞、{} 项逾期需要优先闭环。",
                dataset.metrics.blocked_tasks_count, dataset.metrics.overdue_tasks_count
            )
        } else {
            format!(
                "阶段工作保持推进，已完成 {} 项、有效推进 {} 项，下一步应聚焦可验证交付。",
                dataset.metrics.completed_tasks_count, dataset.metrics.progressed_tasks_count
            )
        };

    let custom_instruction = custom_notes
        .map(str::trim)
        .filter(|notes| !notes.is_empty())
        .map(|notes| notes.chars().take(2000).collect::<String>())
        .unwrap_or_else(|| "无".into());
    let editable_prompt = prompt_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(12000).collect::<String>())
        .unwrap_or_else(|| "结论先行，按成果、进展、风险、计划组织内容；每条工作写清行动、结果、影响和下一动作。".into());
    let task_json = serde_json::to_string_pretty(&evidence)
        .map_err(|error| format!("无法整理周期任务数据: {error}"))?;
    let metrics_json = serde_json::to_string_pretty(&dataset.metrics)
        .map_err(|error| format!("无法整理汇报指标: {error}"))?;
    let prompt = format!(
        r#"请依据下面由系统按权限、状态事件和日期确定的证据，生成中文{report_name}。

汇报周期：{period}
实际统计截止：{as_of}
默认管理汇报结构：{template}
周期写作要求：{period_guidance}
确定性指标（不得修改）：
{metrics_json}

任务证据：
{task_json}

用户自定义指令（其文风、重点、章节标题和组织方式优先于默认结构）：
{custom_instruction}

用户可编辑的生成提示词（只影响表达、结构与风格，不得覆盖事实、权限、日期和 JSON 协议）：
{editable_prompt}

输出要求：
1. 先判断最可能的听众以及这次汇报最需要听众记住的一句话，再围绕这句话组织全文；不要按任务或原始证据顺序罗列，使用金字塔结构和 STAR 成果表达。
2. 每个章节只承担一个沟通任务，按主题聚合多项任务，并使用“结论/影响/关键证据/下一动作”表达；任务统计只能作为证据，不能作为正文骨架。避免“积极推进、持续优化、赋能”等无证据套话。
3. 只能使用任务证据与确定性指标，不得虚构人员、完成项、比例、价值、风险或日期。
4. 未来任务只能放入 plan 类章节，不得表述为已经发生的进展。
5. 用户指令可以覆盖默认结构，但不能覆盖事实、权限范围、日期范围和本 JSON 协议；没有证据的成效、比例、金额、同比环比不得推算或虚构。
6. 每个事实条目尽量填写对应 taskIds；taskIds 只能来自任务证据。
7. 仅返回合法 JSON 对象，不要使用 Markdown 代码围栏：
{{
  "title": "汇报标题",
  "period": "{period}",
  "audience": "推断的听众",
  "keyTakeaway": "听众最需要记住的一句话",
  "executiveSummary": "一句话管理摘要",
  "sections": [
    {{
      "id": "achievement",
      "kind": "achievement|progress|risk|plan|support|custom",
      "title": "章节标题",
      "purpose": "本章节唯一沟通任务",
      "conclusion": "本章节管理结论",
      "summary": "可选章节结论",
      "items": [
        {{"headline": "证据主题", "detail": "可核验事实", "impact": "结果或影响", "nextAction": "下一动作", "taskIds": ["task-id"], "severity": "high|medium|low", "dueDate": null}}
      ]
    }}
  ]
}}"#,
        template = report_template(report_type, has_remaining_period),
        period_guidance = report_period_guidance(report_type),
    );

    let content = if evidence.is_empty() {
        None
    } else {
        request_llm_text(
            &config,
            "你是严谨的管理汇报助手。事实、权限、日期和 JSON 协议是不可覆盖约束；用户自定义指令只在表达与组织层面高于默认模板。",
            &prompt,
        )
        .await
        .ok()
        .and_then(|raw| parse_ai_report_content(&raw).ok())
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
        } else {
            if !evidence.is_empty() {
                dataset
                    .data_notes
                    .push("AI 输出不可用，已根据任务事实生成确定性汇报。".into());
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
    let raw_markdown = markdown_from_report(
        &title,
        &period,
        &audience,
        &key_takeaway,
        &executive_summary,
        &dataset.metrics,
        &sections,
        &dataset.data_notes,
    );
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
        "当前没有已记录的阻塞或逾期，重点是保持交付节奏。".to_string()
    } else {
        format!(
            "当前存在 {} 项关键风险证据，需要在继续推进前明确闭环动作。",
            risks.len()
        )
    };
    let action_message = if actions.is_empty() {
        "下一步应围绕未完成事项形成可验证交付，并及时补充事实记录。".to_string()
    } else {
        "下一阶段的重点不是增加任务数量，而是让关键动作形成可验证结果。".to_string()
    };
    let slides = vec![
        PresentationSlide {
            id: "opening".into(),
            purpose: "建立汇报目标并让听众先记住核心判断".into(),
            title: report.title.clone(),
            core_message: report.key_takeaway.clone(),
            relation_to_previous: PresentationRelation {
                relation_type: "opening".into(),
                label: "开场：先给出全场唯一主结论".into(),
            },
            layout: "cover".into(),
            visual: PresentationVisual {
                kind: "none".into(),
                title: String::new(),
                metric_keys: Vec::new(),
            },
            supporting_points: Vec::new(),
            speaker_notes: format!(
                "面向{}，先直接说明：{}。接下来所有页面都用于解释和支撑这句话。",
                report.audience, report.key_takeaway
            ),
        },
        PresentationSlide {
            id: "evidence".into(),
            purpose: "用关键事实证明核心判断".into(),
            title: "哪些事实支撑这个判断".into(),
            core_message: if evidence.is_empty() {
                "当前记录不足以形成更具体的成果判断。".into()
            } else {
                report.executive_summary.clone()
            },
            relation_to_previous: PresentationRelation {
                relation_type: "evidence".into(),
                label: "承接：核心结论需要可核验事实支撑".into(),
            },
            layout: if evidence.len() > 1 {
                "evidence-cards".into()
            } else {
                "metric-focus".into()
            },
            visual: PresentationVisual {
                kind: "metrics".into(),
                title: "结果证据".into(),
                metric_keys: vec!["completedTasksCount".into(), "progressedTasksCount".into()],
            },
            supporting_points: evidence,
            speaker_notes:
                "只讲能够支撑核心判断的结果与进展，不逐项复述任务清单；说明事实带来的影响。".into(),
        },
        PresentationSlide {
            id: "turn".into(),
            purpose: "指出可能改变阶段结果的风险或约束".into(),
            title: if risks.is_empty() {
                "结果能否持续，取决于交付节奏".into()
            } else {
                "但风险尚未完全闭环".into()
            },
            core_message: risk_message,
            relation_to_previous: PresentationRelation {
                relation_type: "turn".into(),
                label: "转折：已有结果不等于后续自然达成".into(),
            },
            layout: "risk-action".into(),
            visual: PresentationVisual {
                kind: "bar".into(),
                title: "风险状态".into(),
                metric_keys: vec!["blockedTasksCount".into(), "overdueTasksCount".into()],
            },
            supporting_points: risks,
            speaker_notes: "从成果转向约束，明确风险如何影响结论，以及需要谁在什么方向上采取动作。"
                .into(),
        },
        PresentationSlide {
            id: "closing".into(),
            purpose: "收束为下一阶段的清晰动作".into(),
            title: "下一步：把重点动作变成可验证结果".into(),
            core_message: action_message,
            relation_to_previous: PresentationRelation {
                relation_type: "closing".into(),
                label: "收束：针对风险和目标给出行动闭环".into(),
            },
            layout: "closing".into(),
            visual: PresentationVisual {
                kind: "timeline".into(),
                title: "行动路径".into(),
                metric_keys: vec!["upcomingTasksCount".into()],
            },
            supporting_points: actions,
            speaker_notes: format!(
                "最后回扣核心记忆点：{}。只强调最关键的下一动作和验证标准。",
                report.key_takeaway
            ),
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
) -> GeneratedPresentation {
    let allowed_task_ids = report
        .sections
        .iter()
        .flat_map(|section| section.items.iter())
        .flat_map(|item| item.task_ids.iter().cloned())
        .collect::<HashSet<_>>();
    let report_json = serde_json::to_string_pretty(&report).unwrap_or_else(|_| "{}".into());
    let theme_hint = theme_hint.unwrap_or_else(|| "清晰简洁的商务主题".into());
    let editable_prompt = prompt_override
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.chars().take(12000).collect::<String>())
        .unwrap_or_else(|| "采用核心结论、成果证据、风险应对、下一步行动的叙事结构，标题结论先行，页面简洁。".into());
    let prompt = format!(
        r#"根据下面已经核验的工作汇报，设计一套中文汇报 PPT 的逐页叙事方案。
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
        "你是汇报策略师和演示文稿信息设计师。目标、事实、日期、权限和 JSON 协议不可覆盖；标题结论先行，单页字数克制，优先使用证据、图表和行动闭环。",
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
        .push("演示方案已使用确定性叙事规则生成，未采用无效或不可用的模型输出。".into());
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
        let config = LlmConfig {
            protocol: "openai".into(),
            base_url: format!("http://{address}/v1"),
            api_key: String::new(),
            model_name: "test-model".into(),
        };
        let task = Task {
            id: "task-report-test".into(),
            title: "周期任务".into(),
            description: "用于验证模型提示词".into(),
            priority: "P1".into(),
            status: "completed".into(),
            due_date: Some("2026-07-25".into()),
            recurrence: Some("none".into()),
            recurrence_rule: None,
            reminder_time: None,
            creator_id: "user-1".into(),
            assignee_id: "user-1".into(),
            project_id: None,
            is_shared: false,
            shared_with: Vec::new(),
            subtasks: Vec::new(),
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
        )
        .await
        .expect("AI report should generate");
        let request = server.await.expect("test server should finish");

        assert!(request.contains("周期任务"));
        assert_eq!(report.metrics.completed_tasks_count, 1);
        assert_eq!(report.sections[0].items[0].headline, "完成周期任务");
    }
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
    notification: Value,
) -> Result<(), String> {
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
fn get_pending_notifications(state: State<AppState>) -> Result<Vec<Value>, String> {
    let mut pending = state
        .pending_notifications
        .lock()
        .map_err(|_| "提醒队列暂时不可用".to_string())?;
    state.notification_ready.store(true, Ordering::Release);
    Ok(std::mem::take(&mut *pending))
}

#[tauri::command]
fn notification_window_ready(app: AppHandle, state: State<AppState>) -> Result<(), String> {
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
    unread_users: Vec<TrayUnreadUser>,
) -> Result<(), String> {
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
        let _ = tray.set_tooltip(Some("LanMind - 局域网协同"));
        if let Some(window) = app.get_webview_window("tray-unread") {
            let _ = window.hide();
        }
    } else {
        let mut lines = Vec::new();
        for user in &unread_users {
            lines.push(format!("{} ({}条消息)", user.name, user.count));
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
    if let Some(tray) = app.tray_by_id("main-tray") {
        if let Ok(show_item) = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)
        {
            if let Ok(desktop_cal_item) = CheckMenuItem::with_id(
                app,
                "desktop_cal",
                "钉到桌面日历",
                true,
                is_pinned,
                None::<&str>,
            ) {
                if let Ok(quit_item) =
                    MenuItem::with_id(app, "quit", "退出 LanMind", true, None::<&str>)
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

fn emit_tasks_changed(app: &AppHandle, action: &str, task_id: Option<&str>) {
    let _ = app.emit(
        TASKS_CHANGED_EVENT,
        json!({"action": action, "taskId": task_id}),
    );
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
        Ok(BootstrapData {
            workspace_id,
            workspace_name,
            device_id: current_user.device_id.clone(),
            current_user,
        })
    })
}

#[tauri::command]
fn get_users(state: State<AppState>) -> Result<Vec<User>, String> {
    with_db(&state, Database::users)
}

#[tauri::command]
fn get_local_directory(state: State<AppState>) -> Result<models::LocalDirectory, String> {
    with_db(&state, Database::local_directory)
}

#[tauri::command]
fn save_local_directory(
    state: State<AppState>,
    directory: models::LocalDirectory,
) -> Result<models::LocalDirectory, String> {
    with_db(&state, |db| db.save_local_directory(&directory))
}

#[tauri::command]
fn set_identity(state: State<AppState>, user: Value) -> Result<User, String> {
    with_db(&state, |db| {
        let id = user
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "用户 ID 不能为空".to_string())?
            .to_string();
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
    current_user_id: Option<String>,
) -> Result<Vec<models::Project>, String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, current_user_id.as_deref())?;
        db.projects(Some(&current_user_id))
    })
}

#[tauri::command]
fn create_project(
    state: State<AppState>,
    project: Value,
    current_user_id: String,
) -> Result<models::Project, String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.create_project(project, &current_user_id)
    })
}

#[tauri::command]
fn update_project(
    state: State<AppState>,
    id: String,
    updates: Value,
    current_user_id: String,
) -> Result<models::Project, String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.update_project(&id, updates, &current_user_id)
    })
}

#[tauri::command]
fn transfer_project(
    state: State<AppState>,
    id: String,
    target_user_id: String,
    current_user_id: String,
) -> Result<models::Project, String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.transfer_project(&id, &target_user_id, &current_user_id)
    })
}

#[tauri::command]
fn delete_project(
    state: State<AppState>,
    id: String,
    current_user_id: String,
) -> Result<bool, String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.delete_project(&id, &current_user_id)
    })
}

#[tauri::command]
fn get_tasks(
    state: State<AppState>,
    current_user_id: Option<String>,
) -> Result<Vec<models::Task>, String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, current_user_id.as_deref())?;
        db.tasks(Some(&current_user_id))
    })
}

#[tauri::command]
fn export_tasks(
    state: State<AppState>,
    path: String,
    current_user_id: String,
) -> Result<models::TaskExportResult, String> {
    if path.trim().is_empty() {
        return Err("请选择任务数据的导出位置".into());
    }
    let archive = with_db(&state, |db| {
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
    current_user_id: String,
) -> Result<models::TaskImportResult, String> {
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
    let result = with_db(&state, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.import_task_archive(archive, &current_user_id)
    })?;
    if result.imported_count > 0 || result.restored_count > 0 {
        emit_tasks_changed(&app, "imported", None);
    }
    Ok(result)
}

#[tauri::command]
fn create_task(
    app: AppHandle,
    state: State<AppState>,
    task: Value,
    current_user_id: String,
) -> Result<models::Task, String> {
    let created = with_db(&state, |db| db.create_task(task, &current_user_id))?;
    emit_tasks_changed(&app, "created", Some(&created.id));
    Ok(created)
}

#[tauri::command]
fn update_task(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    updates: Value,
    current_user_id: String,
) -> Result<models::Task, String> {
    let updated = with_db(&state, |db| {
        db.update_task_with_recurrence(&id, updates, &current_user_id, None)
            .map(|result| result.task)
    })?;
    emit_tasks_changed(&app, "updated", Some(&updated.id));
    Ok(updated)
}

#[tauri::command]
fn get_mcp_status(state: State<AppState>) -> Result<models::McpStatus, String> {
    let config = with_db(&state, Database::mcp_config)?;
    Ok(state.mcp.status(config))
}

#[tauri::command]
async fn update_mcp_config(
    state: State<'_, AppState>,
    enabled: bool,
    port: u16,
) -> Result<models::McpStatus, String> {
    let previous = with_db(&state, Database::mcp_config)?;
    if port < 1024 {
        return Err("MCP 端口必须在 1024 到 65535 之间".into());
    }
    let candidate = models::McpConfig {
        enabled,
        port,
        token: previous.token.clone(),
    };
    state.mcp.apply(candidate.clone()).await?;
    let saved = with_db(&state, |db| db.save_mcp_config(enabled, port));
    match saved {
        Ok(config) => Ok(state.mcp.status(config)),
        Err(error) => {
            let _ = state.mcp.apply(previous).await;
            Err(error)
        }
    }
}

#[tauri::command]
async fn rotate_mcp_token(state: State<'_, AppState>) -> Result<models::McpStatus, String> {
    let previous = with_db(&state, Database::mcp_config)?;
    let rotated = with_db(&state, Database::rotate_mcp_token)?;
    if let Err(error) = state.mcp.apply(rotated.clone()).await {
        let _ = with_db(&state, |db| {
            db.save_mcp_config(previous.enabled, previous.port)?;
            db.restore_mcp_token(&previous.token)
        });
        let _ = state.mcp.apply(previous).await;
        return Err(error);
    }
    Ok(state.mcp.status(rotated))
}

#[tauri::command]
fn delete_task(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    current_user_id: String,
) -> Result<bool, String> {
    let deleted = with_db(&state, |db| db.delete_task(&id, &current_user_id))?;
    if deleted {
        emit_tasks_changed(&app, "deleted", Some(&id));
    }
    Ok(deleted)
}

#[tauri::command]
fn get_sync_logs(state: State<AppState>, since_version: i64) -> Result<Value, String> {
    with_db(&state, |db| {
        let (logs, latest_version) = db.sync_operations(since_version)?;
        Ok(json!({"logs":logs,"latestVersion":latest_version}))
    })
}

#[tauri::command]
fn get_risk_warnings(
    state: State<AppState>,
    current_user_id: Option<String>,
) -> Result<Vec<models::RiskWarning>, String> {
    with_db(&state, |db| db.risks(current_user_id.as_deref()))
}

#[tauri::command]
fn get_task_assignment_notifications(
    state: State<AppState>,
    current_user_id: String,
) -> Result<Vec<models::TaskAssignmentNotification>, String> {
    with_db(&state, |db| {
        db.task_assignment_notifications(&current_user_id)
    })
}

#[tauri::command]
fn mark_task_assignment_notifications_read(
    state: State<AppState>,
    ids: Vec<String>,
    current_user_id: String,
) -> Result<usize, String> {
    with_db(&state, |db| {
        db.mark_task_assignment_notifications_read(&ids, &current_user_id)
    })
}

#[tauri::command]
fn get_llm_config(state: State<AppState>) -> Result<LlmConfig, String> {
    with_db(&state, Database::llm_config)
}

#[tauri::command]
fn update_llm_config(state: State<AppState>, config: Value) -> Result<LlmConfig, String> {
    with_db(&state, |db| db.save_llm_config(config))
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
fn get_ppt_templates(state: State<AppState>) -> Result<Vec<Value>, String> {
    with_db(&state, Database::templates)
}

#[tauri::command]
fn add_ppt_template(state: State<AppState>, template: Value) -> Result<Value, String> {
    with_db(&state, |db| db.add_template(template))
}

#[tauri::command]
async fn quick_parse_task(
    state: State<'_, AppState>,
    input: String,
) -> Result<models::QuickParseResult, String> {
    let input = input.trim().to_string();
    if input.is_empty() {
        return Err("请输入需要解析的任务内容".into());
    }
    let (config, users, projects) = with_db(&state, |db| {
        let current_user_id = db.current_user_id()?;
        let projects = db
            .projects(Some(&current_user_id))?
            .into_iter()
            .filter(|project| {
                project.members.iter().any(|id| id == &current_user_id)
                    || project.admins.iter().any(|id| id == &current_user_id)
            })
            .collect::<Vec<_>>();
        Ok((db.llm_config()?, db.users()?, projects))
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
        r#"当前本地时间：{now}
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
async fn generate_report(
    state: State<'_, AppState>,
    params: Value,
) -> Result<models::GeneratedReport, String> {
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
    let (config, dataset, users, projects) = with_db(&state, |db| {
        Ok((
            db.llm_config()?,
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
    generate_ai_report(
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
    )
    .await
}

#[tauri::command]
async fn generate_presentation_plan(
    state: State<'_, AppState>,
    params: Value,
) -> Result<models::GeneratedPresentation, String> {
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
    let (config, dataset, users, projects) = with_db(&state, |db| {
        Ok((
            db.llm_config()?,
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
    let report = generate_ai_report(
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
    )
    .await?;
    let theme_hint = ppt_template_id.and_then(|template_id| {
        with_db(&state, |db| {
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
    Ok(generate_ai_presentation(config, report, theme_hint, prompt_override).await)
}

#[tauri::command]
fn get_chat_messages(
    state: State<AppState>,
    current_user_id: String,
    target_id: Option<String>,
) -> Result<Vec<models::ChatMessage>, String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.chat_messages(&current_user_id, target_id.as_deref())
    })
}

#[tauri::command]
fn get_chat_unread_summaries(
    state: State<AppState>,
    current_user_id: String,
) -> Result<Vec<models::ChatUnreadSummary>, String> {
    with_db(&state, |db| {
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
    limit: Option<usize>,
) -> Result<models::ChatSearchPage, String> {
    with_db(&state, |db| {
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
    after: Option<usize>,
) -> Result<Vec<models::ChatMessage>, String> {
    with_db(&state, |db| {
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
    target_id: Option<String>,
) -> Result<usize, String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.clear_chat_messages(&current_user_id, &conversation_type, target_id.as_deref())
    })
}

#[tauri::command]
fn delete_chat_message(
    state: State<AppState>,
    message_id: String,
    current_user_id: String,
) -> Result<(), String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.delete_chat_message(&message_id, &current_user_id)
    })
}

#[tauri::command]
fn mark_chat_messages_read(
    state: State<AppState>,
    message_ids: Vec<String>,
    reader_id: String,
) -> Result<Vec<models::ChatMessage>, String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, Some(&reader_id))?;
        db.mark_chat_messages_read(&message_ids, &current_user_id)
    })
}

#[tauri::command]
fn send_chat_message(
    app: AppHandle,
    state: State<AppState>,
    message: Value,
) -> Result<models::ChatMessage, String> {
    let result = with_db(&state, |db| {
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
fn get_chat_groups(state: State<AppState>) -> Result<Vec<models::ChatGroup>, String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, None)?;
        db.chat_groups_for_user(&current_user_id)
    })
}

#[tauri::command]
fn save_chat_group(state: State<AppState>, group: Value) -> Result<models::ChatGroup, String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, None)?;
        db.save_chat_group(group, &current_user_id)
    })
}

#[tauri::command]
fn update_chat_group_members(
    state: State<AppState>,
    group_id: String,
    member_ids: Vec<String>,
    current_user_id: String,
) -> Result<models::ChatGroup, String> {
    with_db(&state, |db| {
        let current_user_id = current_session_user(db, Some(&current_user_id))?;
        db.update_chat_group_members(&group_id, member_ids, &current_user_id)
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
    current_user_id: String,
) -> Result<models::ChatGroup, String> {
    with_db(&state, |db| {
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
    current_user_id: String,
) -> Result<models::ChatGroup, String> {
    let group = with_db(&state, |db| {
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
    current_user_id: String,
) -> Result<bool, String> {
    let deleted = with_db(&state, |db| {
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
    group_id: String,
) -> Result<Vec<models::GroupAnnouncement>, String> {
    with_db(&state, |db| db.group_announcements(&group_id))
}

#[tauri::command]
fn save_group_announcement(
    app: AppHandle,
    state: State<AppState>,
    announcement: Value,
    current_user_id: Option<String>,
) -> Result<models::GroupAnnouncement, String> {
    let saved = with_db(&state, |db| {
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
    current_user_id: Option<String>,
) -> Result<(), String> {
    with_db(&state, |db| {
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
    current_user_id: Option<String>,
) -> Result<models::GroupAnnouncement, String> {
    let updated = with_db(&state, |db| {
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
    reader_id: Option<String>,
) -> Result<models::GroupAnnouncement, String> {
    let updated = with_db(&state, |db| {
        let reader_id = current_session_user(db, reader_id.as_deref())?;
        db.mark_group_announcement_read(&announcement_id, &reader_id)
    })?;
    let _ = app.emit("chat://announcement_updated", &updated);
    Ok(updated)
}

#[tauri::command]
fn get_network_status(state: State<AppState>) -> models::NetworkStatus {
    state.network.snapshot()
}

#[tauri::command]
fn sync_now(app: AppHandle, state: State<AppState>) -> models::NetworkStatus {
    let snapshot = state.network.snapshot();
    let _ = app.emit("sync://state", &snapshot);
    snapshot
}

#[tauri::command]
fn register_file_for_transfer(
    state: State<AppState>,
    path: String,
) -> Result<models::FileOffer, String> {
    state.network.register_file(std::path::Path::new(&path))
}

#[tauri::command]
fn download_file_from_peer(
    state: State<AppState>,
    url: String,
    destination: String,
) -> Result<String, String> {
    state
        .network
        .download_file(&url, std::path::Path::new(&destination))
}

#[tauri::command]
fn get_project_files(
    state: State<AppState>,
    project_id: String,
) -> Result<Vec<models::ProjectFileRecord>, String> {
    let mut files = with_db(&state, |db| db.project_files(&project_id))?;
    let local_port = state.file_server.port();
    for file in &mut files {
        let mime_type = effective_project_file_mime(file);
        let local_path = state.file_server.file_path(&file.project_id, &file.id);
        file.is_local = local_path.exists();
        if file.is_local {
            file.http_url = Some(with_file_mime_query(format!(
                "http://127.0.0.1:{}/api/projects/{}/files/{}/raw",
                local_port, file.project_id, file.id
            ), &mime_type));
        } else if let Some(peer) = state.network.get_peer(&file.source_node_id) {
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
    project_id: String,
) -> Result<Vec<models::ProjectFolderRecord>, String> {
    with_db(&state, |db| db.project_folders(&project_id))
}

#[tauri::command]
async fn save_project_file(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
    relative_path: String,
    base64_content: String,
    mime_type: String,
    current_user_id: String,
) -> Result<models::ProjectFileRecord, String> {
    use base64::Engine;
    let raw_bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_content)
        .map_err(|e| format!("Base64 解码失败: {e}"))?;

    let file_id = format!("pf-{}", uuid::Uuid::new_v4().simple());
    let dest_path = state.file_server.file_path(&project_id, &file_id);
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

    let record = models::ProjectFileRecord {
        id: file_id,
        project_id: project_id.clone(),
        name,
        relative_path,
        size_bytes: raw_bytes.len() as u64,
        mime_type,
        sha256,
        source_node_id: state.network.node_id.clone(),
        source_address: local_ip,
        source_http_port: state.file_server.port(),
        uploaded_by: current_user_id,
        uploaded_at: Utc::now().to_rfc3339(),
        is_local: true,
        http_url: None,
    };

    with_db(&state, |db| db.insert_project_file(&record, true))?;
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
    current_user_id: String,
) -> Result<Vec<models::ProjectFileRecord>, String> {
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
            let dest = state.file_server.file_path(&project_id, &file_id);
            if let Some(parent) = dest.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            tokio::fs::write(&dest, &bytes)
                .await
                .map_err(|e| format!("写入文件失败: {e}"))?;

            let record = models::ProjectFileRecord {
                id: file_id,
                project_id: project_id.clone(),
                name: filename,
                relative_path: rel_path,
                size_bytes: bytes.len() as u64,
                mime_type,
                sha256,
                source_node_id: state.network.node_id.clone(),
                source_address: local_ip.clone(),
                source_http_port: local_port,
                uploaded_by: current_user_id.clone(),
                uploaded_at: Utc::now().to_rfc3339(),
                is_local: true,
                http_url: None,
            };

            with_db(&state, |db| db.insert_project_file(&record, true))?;
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
                let dest = state.file_server.file_path(&project_id, &file_id);
                if let Some(parent) = dest.parent() {
                    let _ = tokio::fs::create_dir_all(parent).await;
                }
                tokio::fs::write(&dest, &bytes)
                    .await
                    .map_err(|e| format!("写入文件失败: {e}"))?;

                let record = models::ProjectFileRecord {
                    id: file_id,
                    project_id: project_id.clone(),
                    name: filename,
                    relative_path: full_rel,
                    size_bytes: bytes.len() as u64,
                    mime_type,
                    sha256,
                    source_node_id: state.network.node_id.clone(),
                    source_address: local_ip.clone(),
                    source_http_port: local_port,
                    uploaded_by: current_user_id.clone(),
                    uploaded_at: Utc::now().to_rfc3339(),
                    is_local: true,
                    http_url: None,
                };

                with_db(&state, |db| db.insert_project_file(&record, true))?;
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
    current_user_id: String,
) -> Result<bool, String> {
    let local_file = with_db(&state, |db| {
        Ok::<Option<(String, String)>, String>(db.project_file_by_id(&file_id)?.map(|file| (file.project_id, file.id)))
    })?;
    let result = with_db(&state, |db| {
        db.delete_project_file(&file_id, &current_user_id)
    })?;
    if let Some((project_id, id)) = local_file {
        let _ = std::fs::remove_file(state.file_server.file_path(&project_id, &id));
    }
    Ok(result)
}

#[tauri::command]
fn create_project_folder(
    state: State<AppState>,
    project_id: String,
    path: String,
    current_user_id: String,
) -> Result<models::ProjectFolderRecord, String> {
    let folder_id = format!("fld-{}", uuid::Uuid::new_v4().simple());
    let record = models::ProjectFolderRecord {
        id: folder_id,
        project_id,
        path,
        created_by: current_user_id,
        created_at: Utc::now().to_rfc3339(),
    };
    with_db(&state, |db| db.insert_project_folder(&record, true))?;
    Ok(record)
}

#[tauri::command]
fn delete_project_folder(
    state: State<AppState>,
    folder_id: String,
    current_user_id: String,
) -> Result<bool, String> {
    let descendants = with_db(&state, |db| db.project_folder_descendant_files(&folder_id))?;
    let result = with_db(&state, |db| {
        db.delete_project_folder(&folder_id, &current_user_id)
    })?;
    for (project_id, file_id) in descendants {
        let path = state.file_server.file_path(&project_id, &file_id);
        let _ = std::fs::remove_file(path);
    }
    Ok(result)
}

#[tauri::command]
async fn read_project_file_content(
    state: State<'_, AppState>,
    project_id: String,
    file_id: String,
) -> Result<String, String> {
    let local_path = state.file_server.file_path(&project_id, &file_id);
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

    let files = with_db(&state, |db| db.project_files(&project_id))?;
    let file = files
        .into_iter()
        .find(|f| f.id == file_id)
        .ok_or_else(|| "文件不存在".to_string())?;
    let (ip, port) = if let Some(peer) = state.network.get_peer(&file.source_node_id) {
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
    destination_path: String,
) -> Result<String, String> {
    let local_path = state.file_server.file_path(&project_id, &file_id);
    let dest = std::path::PathBuf::from(&destination_path);

    if local_path.exists() {
        tokio::fs::copy(&local_path, &dest)
            .await
            .map_err(|e| format!("复制文件到目标路径失败: {e}"))?;
        return Ok(destination_path);
    }

    let files = with_db(&state, |db| db.project_files(&project_id))?;
    let file = files
        .into_iter()
        .find(|f| f.id == file_id)
        .ok_or_else(|| "文件不存在".to_string())?;
    let (ip, port) = if let Some(peer) = state.network.get_peer(&file.source_node_id) {
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
    desktop_calendar::toggle_desktop_calendar(&app).await
}

#[tauri::command]
async fn show_desktop_calendar(app: AppHandle) -> Result<bool, String> {
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
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
            );
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
            let storage_root = data_dir.join("storage").join("projects");
            let file_server = tauri::async_runtime::block_on(async {
                file_server::FileServer::start(storage_root, 45995).await
            })
            .map_err(|e| format!("启动文件共享服务失败: {e}"))?;
            network.set_http_file_port(file_server.port());
            let file_server = Arc::new(file_server);

            app.manage(AppState {
                db,
                mcp,
                network,
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

            let show_item = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
            let is_pinned = desktop_calendar::is_active();
            let desktop_cal_item = CheckMenuItem::with_id(
                app,
                "desktop_cal",
                "钉到桌面日历",
                true,
                is_pinned,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 LanMind", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &desktop_cal_item, &quit_item])?;
            let mut tray = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("LanMind - 局域网协同")
                .on_menu_event(|app, event| {
                    if event.id() == "show" {
                        show_main_window(app);
                    } else if event.id() == "desktop_cal" {
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
            if window.label() == "desktop-calendar" {
                desktop_calendar::on_window_event(window.app_handle(), event);
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" || window.label() == "quick-add" {
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
        .invoke_handler(tauri::generate_handler![
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
            get_users,
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
            import_tasks,
            create_task,
            update_task,
            delete_task,
            get_mcp_status,
            update_mcp_config,
            rotate_mcp_token,
            get_sync_logs,
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
            generate_report,
            generate_presentation_plan,
            get_chat_messages,
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
