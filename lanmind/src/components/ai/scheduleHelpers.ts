/**
 * scheduleHelpers — Helper types and pure functions for Scheduled Tasks.
 *
 * TOOL CONTRACT:
 *   - Pure functions with zero side effects.
 *   - Parses/builds action markers for Webhooks and Automation Scripts.
 *   - Formats datetime for inputs.
 */

export type ScheduleActionType = "prompt" | "webhook" | "script";

export interface WebhookData {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers?: string;
  body?: string;
  instruction?: string;
}

export interface ScriptData {
  lang: "shell" | "javascript" | "python";
  code: string;
  instruction?: string;
}

export const ACTION_MARKER_WEBHOOK = "/*LANMIND_SCHEDULE_ACTION:WEBHOOK*/";
export const ACTION_MARKER_SCRIPT = "/*LANMIND_SCHEDULE_ACTION:SCRIPT*/";

export const defaultWebhook: WebhookData = {
  method: "POST",
  url: "",
  headers: "{\n  \"Content-Type\": \"application/json\"\n}",
  body: "{\n  \"timestamp\": \"{{now}}\"\n}",
  instruction: "调用上述接口并汇报执行状态与返回摘要",
};

export const defaultScript: ScriptData = {
  lang: "javascript",
  code: "// 编写自动化执行逻辑\nconsole.log('Scheduled job executed at', new Date().toISOString());",
  instruction: "执行上述脚本并输出执行结果与日志",
};

export function parseSchedulePrompt(rawPrompt: string): {
  actionType: ScheduleActionType;
  promptText: string;
  webhookData: WebhookData;
  scriptData: ScriptData;
} {
  if (!rawPrompt) {
    return {
      actionType: "prompt",
      promptText: "",
      webhookData: defaultWebhook,
      scriptData: defaultScript,
    };
  }

  if (rawPrompt.startsWith(ACTION_MARKER_WEBHOOK)) {
    try {
      const rest = rawPrompt.slice(ACTION_MARKER_WEBHOOK.length);
      const jsonEnd = rest.indexOf("/*END_ACTION*/");
      if (jsonEnd !== -1) {
        const parsed = JSON.parse(rest.slice(0, jsonEnd));
        return {
          actionType: "webhook",
          promptText: "",
          webhookData: { ...defaultWebhook, ...parsed },
          scriptData: defaultScript,
        };
      }
    } catch {
      // fall through
    }
  }

  if (rawPrompt.startsWith(ACTION_MARKER_SCRIPT)) {
    try {
      const rest = rawPrompt.slice(ACTION_MARKER_SCRIPT.length);
      const jsonEnd = rest.indexOf("/*END_ACTION*/");
      if (jsonEnd !== -1) {
        const parsed = JSON.parse(rest.slice(0, jsonEnd));
        return {
          actionType: "script",
          promptText: "",
          webhookData: defaultWebhook,
          scriptData: { ...defaultScript, ...parsed },
        };
      }
    } catch {
      // fall through
    }
  }

  return {
    actionType: "prompt",
    promptText: rawPrompt,
    webhookData: defaultWebhook,
    scriptData: defaultScript,
  };
}

export function buildSchedulePrompt(
  actionType: ScheduleActionType,
  promptText: string,
  webhookData: WebhookData,
  scriptData: ScriptData,
  scheduleName: string
): string {
  if (actionType === "webhook") {
    const payload = JSON.stringify(webhookData);
    return `${ACTION_MARKER_WEBHOOK}${payload}/*END_ACTION*/\n\n【定时任务: HTTP 接口请求】\n任务名称: ${scheduleName}\n接口地址: ${webhookData.method} ${webhookData.url}\n${webhookData.instruction || "请请求该接口并记录返回结果"}`;
  }
  if (actionType === "script") {
    const payload = JSON.stringify(scriptData);
    return `${ACTION_MARKER_SCRIPT}${payload}/*END_ACTION*/\n\n【定时任务: 自动化脚本执行】\n任务名称: ${scheduleName}\n脚本语言: ${scriptData.lang}\n${scriptData.instruction || "请按计划执行脚本并记录执行结果"}`;
  }
  return promptText;
}

export function localDate(isoString: string): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${mins}`;
}
