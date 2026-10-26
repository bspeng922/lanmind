/**
 * ScheduleSettingsPanel — 定时任务管理与丰富动作配置面板。
 * 支持丰富动作模式：
 * 1. AI 提示词与问答分析 (Prompt)
 * 2. HTTP 接口调用与 Webhook (API Request)
 * 3. 自动化脚本执行 (Script)
 *
 * CALLING SPEC:
 *   <ScheduleSettingsPanel catalog={catalog} />
 */

import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
  AlertCircle,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  Code,
  FileCode,
  Globe,
  History,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { tr, useLocale } from "../../i18n";
import {
  AI,
  aiError,
  modelKey,
  parseModelKey,
  type Catalog,
  type Extension,
  type Schedule,
} from "./aiClient";
import { GroupedModelSelect } from "./GroupedModelSelect";
import { ThemeSelect, ThemeSelectOption } from "../ThemeSelect";
import { EnabledSwitch } from "./EnabledSwitch";
import { ScheduleHistoryModal } from "./ScheduleHistoryModal";
import {
  type ScheduleActionType,
  type WebhookData,
  type ScriptData,
  defaultWebhook,
  defaultScript,
  parseSchedulePrompt,
  buildSchedulePrompt,
  localDate,
} from "./scheduleHelpers";

export const ScheduleSettingsPanel: React.FC<{ catalog: Catalog }> = ({
  catalog,
}) => {
  useLocale();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [skills, setSkills] = useState<Extension[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [historySchedule, setHistorySchedule] = useState<Schedule | null>(null);

  // 编辑态扩展字段
  const [actionType, setActionType] = useState<ScheduleActionType>("prompt");
  const [webhookData, setWebhookData] = useState<WebhookData>({
    method: "POST",
    url: "",
    headers: "{\n  \"Content-Type\": \"application/json\"\n}",
    body: "{\n  \"timestamp\": \"{{now}}\"\n}",
    instruction: tr("ai:schedules.defaultWebhookInstruction"),
  });
  const [scriptData, setScriptData] = useState<ScriptData>({
    lang: "javascript",
    code: tr("ai:schedules.defaultScriptComment"),
    instruction: tr("ai:schedules.defaultScriptInstruction"),
  });
  const [plainPrompt, setPlainPrompt] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deletingId, setDeletingId] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [s, ext] = await Promise.all([
        AI.call<Schedule[]>("schedules"),
        AI.call<Extension[]>("extensions"),
      ]);
      setSchedules(s || []);
      setSkills((ext || []).filter((e) => e.kind === "skill" && e.enabled));
    } catch (e) {
      setError(aiError(e));
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleStartCreate = () => {
    const defaultModel =
      catalog.defaults.agent ||
      (catalog.connections[0]?.models[0]
        ? {
            connectionId: catalog.connections[0].id,
            modelEntryId: catalog.connections[0].models[0].id,
          }
        : { connectionId: "", modelEntryId: "" });

    const newSched: Schedule = {
      id: "",
      name: "",
      prompt: "",
      frequency: "daily",
      nextRunAt: new Date(Date.now() + 3600000).toISOString(),
      enabled: true,
      modelRef: defaultModel,
      skillIds: [],
      lastRunId: null,
      lastError: null,
      revision: 0,
    };

    setEditingSchedule(newSched);
    setActionType("prompt");
    setPlainPrompt("");
    setWebhookData({
      method: "POST",
      url: "",
      headers: "{\n  \"Content-Type\": \"application/json\"\n}",
      body: "{\n  \"timestamp\": \"{{now}}\"\n}",
      instruction: tr("ai:schedules.defaultWebhookInstruction"),
    });
    setScriptData({
      lang: "javascript",
      code: tr("ai:schedules.defaultScriptComment"),
      instruction: tr("ai:schedules.defaultScriptInstruction"),
    });
    setError("");
  };

  const handleStartEdit = (s: Schedule) => {
    setEditingSchedule(structuredClone(s));
    const parsed = parseSchedulePrompt(s.prompt);
    setActionType(parsed.actionType);
    setPlainPrompt(parsed.promptText);
    setWebhookData(parsed.webhookData);
    setScriptData(parsed.scriptData);
    setError("");
  };

  const handleSaveSchedule = async () => {
    if (!editingSchedule) return;
    if (!editingSchedule.name.trim()) {
      setError(tr("ai:schedules.nameRequired"));
      return;
    }

    const finalPrompt = buildSchedulePrompt(
      actionType,
      plainPrompt,
      webhookData,
      scriptData,
      editingSchedule.name
    );

    if (!finalPrompt.trim()) {
      setError(
        actionType === "webhook"
          ? tr("ai:schedules.urlRequired")
          : actionType === "script"
          ? tr("ai:schedules.scriptCodeRequired")
          : tr("ai:schedules.promptRequired")
      );
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      await AI.call("schedule.save", {
        ...editingSchedule,
        prompt: finalPrompt,
      });
      setEditingSchedule(null);
      await loadData();
      setNotice(tr("ai:v2.saved") || "定时任务已成功保存");
      setTimeout(() => setNotice(""), 3000);
    } catch (e) {
      setError(aiError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (s: Schedule) => {
    if (deletingId !== s.id) {
      setDeletingId(s.id);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await AI.call("schedule.delete", {
        id: s.id,
        revision: s.revision,
      });
      setDeletingId("");
      await loadData();
      setNotice("定时任务已删除");
      setTimeout(() => setNotice(""), 3000);
    } catch (e) {
      setError(aiError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEnabled = async (s: Schedule, enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await AI.call("schedule.save", {
        ...s,
        enabled,
      });
      await loadData();
    } catch (e) {
      setError(aiError(e));
    } finally {
      setBusy(false);
    }
  };

  const frequencyOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: "once", label: tr("ai:schedules.freqOnce"), tone: "slate" },
      { value: "hourly", label: tr("ai:schedules.freqHourly"), tone: "blue" },
      { value: "daily", label: tr("ai:schedules.freqDaily"), tone: "emerald" },
      { value: "weekly", label: tr("ai:schedules.freqWeekly"), tone: "amber" },
    ],
    []
  );

  const methodOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: "GET", label: "GET", tone: "blue" },
      { value: "POST", label: "POST", tone: "emerald" },
      { value: "PUT", label: "PUT", tone: "amber" },
      { value: "DELETE", label: "DELETE", tone: "rose" },
    ],
    []
  );

  const scriptLangOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: "javascript", label: "JavaScript / Node.js", tone: "amber" },
      { value: "shell", label: "Bash / Shell", tone: "slate" },
      { value: "python", label: "Python", tone: "blue" },
    ],
    []
  );

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-main flex items-center gap-2">
            <Clock className="w-4 h-4 text-accent" />
            <span>{tr("ai:schedules.pageTitle")}</span>
          </h3>
          <p className="text-xs text-sub mt-0.5 leading-relaxed">
            {tr("ai:schedules.pageDesc")}
          </p>
        </div>

        <button
          type="button"
          disabled={busy || !!editingSchedule}
          onClick={handleStartCreate}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-colors disabled:opacity-50 shadow-soft"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{tr("ai:v2.addSchedule")}</span>
        </button>
      </div>

      {error && !editingSchedule && (
        <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} className="ml-auto text-danger/70 hover:text-danger">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-xs text-success">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="ml-auto text-success/70 hover:text-success">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ===================== 编辑 / 创建表单弹窗 (Modal) ===================== */}
      {editingSchedule && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setEditingSchedule(null);
          }}
        >
          <div className="relative flex max-h-[90vh] w-[740px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-popover shadow-2xl animate-in zoom-in-95 duration-150">
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between border-b border-edge px-6 py-4 bg-canvas/30">
              <span className="text-sm font-bold text-main">
                {editingSchedule.id ? tr("ai:schedules.editTitle") : tr("ai:schedules.createTitle")}
              </span>
              <button
                type="button"
                onClick={() => setEditingSchedule(null)}
                disabled={busy}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors"
                title={tr("ai:schedules.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 scrollbar-thin">
              <fieldset
                disabled={busy}
                className="space-y-4 text-xs border-0 p-0 m-0 min-w-0"
              >
            {error && <p role="alert" className="ai-v2-error">{error}</p>}
            {/* 任务名称 */}
            <div>
              <label className="font-semibold text-sub block mb-1">{tr("ai:schedules.nameLabel")}</label>
              <input
                type="text"
                value={editingSchedule.name}
                aria-label={tr("ai:v2.connectionName")}
                onChange={(e) =>
                  setEditingSchedule({ ...editingSchedule, name: e.target.value })
                }
                placeholder={tr("ai:schedules.namePlaceholder")}
                className="w-full rounded-xl border border-edge bg-canvas px-3 py-2 text-xs text-main focus:border-accent focus:outline-none"
              />
            </div>

            {/* 动作类型切换 */}
            <div className="flex items-center justify-between gap-4 rounded-xl border border-edge p-3">
              <div className="space-y-1">
                <span className="font-semibold text-main">{tr("ai:schedules.enableTask")}</span>
                <p className="text-[11px] leading-5 text-quiet">{tr("ai:schedules.enabledHint")}</p>
              </div>
              <EnabledSwitch checked={editingSchedule.enabled} disabled={busy}
                label={tr("ai:schedules.enableTask")}
                onChange={(enabled) => setEditingSchedule({ ...editingSchedule, enabled })} />
            </div>
            <div>
              <label className="font-semibold text-sub block mb-1.5">{tr("ai:schedules.actionTypeLabel")}</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setActionType("prompt")}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-semibold transition-all ${
                    actionType === "prompt"
                      ? "border-accent bg-accent/15 text-accent shadow-soft"
                      : "border-edge bg-canvas text-sub hover:bg-hover hover:text-main"
                  }`}
                >
                  <Bot className="w-4 h-4" />
                  <span>{tr("ai:schedules.actionPrompt")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActionType("webhook")}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-semibold transition-all ${
                    actionType === "webhook"
                      ? "border-accent bg-accent/15 text-accent shadow-soft"
                      : "border-edge bg-canvas text-sub hover:bg-hover hover:text-main"
                  }`}
                >
                  <Globe className="w-4 h-4" />
                  <span>{tr("ai:schedules.actionWebhook")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActionType("script")}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-semibold transition-all ${
                    actionType === "script"
                      ? "border-accent bg-accent/15 text-accent shadow-soft"
                      : "border-edge bg-canvas text-sub hover:bg-hover hover:text-main"
                  }`}
                >
                  <Terminal className="w-4 h-4" />
                  <span>{tr("ai:schedules.actionScript")}</span>
                </button>
              </div>
            </div>

            {/* 模式 1: Prompt AI 提示词 */}
            {actionType === "prompt" && (
              <div>
                <label className="font-semibold text-sub block mb-1">{tr("ai:schedules.promptLabel")}</label>
                <textarea
                  rows={5}
                  value={plainPrompt}
                  aria-label={tr("ai:v2.prompt")}
                  onChange={(e) => setPlainPrompt(e.target.value)}
                  placeholder={tr("ai:schedules.promptPlaceholder")}
                  className="w-full rounded-xl border border-edge bg-canvas p-3 font-mono text-xs text-main focus:border-accent focus:outline-none min-h-[120px] resize-y"
                />
              </div>
            )}

            {/* 模式 2: HTTP 接口 / Webhook */}
            {actionType === "webhook" && (
              <div className="space-y-3 rounded-2xl border border-edge bg-canvas/40 p-4">
                <div className="grid grid-cols-[110px_1fr] gap-2">
                  <div>
                    <label className="font-semibold text-sub block mb-1">{tr("ai:schedules.methodLabel")}</label>
                    <ThemeSelect
                      portal
                      value={webhookData.method}
                      options={methodOptions}
                      onChange={(m) =>
                        setWebhookData({ ...webhookData, method: m as WebhookData["method"] })
                      }
                      ariaLabel="HTTP Method"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-sub block mb-1">{tr("ai:schedules.urlLabel")}</label>
                    <input
                      type="text"
                      value={webhookData.url}
                      onChange={(e) =>
                        setWebhookData({ ...webhookData, url: e.target.value })
                      }
                      placeholder="https://api.example.com/v1/sync 或 http://127.0.0.1:8080/hook"
                      className="w-full font-mono rounded-xl border border-edge bg-surface px-3 py-2 text-xs text-main focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-sub block mb-1">{tr("ai:schedules.headersLabel")}</label>
                  <textarea
                    rows={4}
                    value={webhookData.headers}
                    onChange={(e) =>
                      setWebhookData({ ...webhookData, headers: e.target.value })
                    }
                    placeholder="{\n  &quot;Content-Type&quot;: &quot;application/json&quot;\n}"
                    className="w-full font-mono rounded-xl border border-edge bg-surface p-2.5 text-xs text-main focus:border-accent focus:outline-none min-h-[96px] resize-y"
                  />
                </div>

                {webhookData.method !== "GET" && (
                  <div>
                    <label className="font-semibold text-sub block mb-1">{tr("ai:schedules.bodyLabel")}</label>
                    <textarea
                      rows={6}
                      value={webhookData.body}
                      onChange={(e) =>
                        setWebhookData({ ...webhookData, body: e.target.value })
                      }
                      placeholder="{\n  &quot;timestamp&quot;: &quot;{{now}}&quot;\n}"
                      className="w-full font-mono rounded-xl border border-edge bg-surface p-2.5 text-xs text-main focus:border-accent focus:outline-none min-h-[140px] resize-y"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 模式 3: 脚本执行 */}
            {actionType === "script" && (
              <div className="space-y-3 rounded-2xl border border-edge bg-canvas/40 p-4">
                <div>
                  <label className="font-semibold text-sub block mb-1">{tr("ai:schedules.langLabel")}</label>
                  <ThemeSelect
                    portal
                    value={scriptData.lang}
                    options={scriptLangOptions}
                    onChange={(l) =>
                      setScriptData({ ...scriptData, lang: l as ScriptData["lang"] })
                    }
                    ariaLabel={tr("ai:schedules.scriptType")}
                  />
                </div>

                <div>
                  <label className="font-semibold text-sub block mb-1">{tr("ai:schedules.codeLabel")}</label>
                  <textarea
                    rows={8}
                    value={scriptData.code}
                    onChange={(e) =>
                      setScriptData({ ...scriptData, code: e.target.value })
                    }
                    className="w-full font-mono rounded-xl border border-edge bg-surface p-3 text-xs text-main focus:border-accent focus:outline-none min-h-[180px] resize-y"
                  />
                </div>
              </div>
            )}

            {/* 模型配置与执行周期 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-sub block mb-1">{tr("ai:schedules.modelLabel")}</label>
                <GroupedModelSelect
                  catalog={catalog}
                  agent
                  value={modelKey(editingSchedule.modelRef)}
                  onChange={(key) => {
                    const ref = parseModelKey(key);
                    if (ref) setEditingSchedule({ ...editingSchedule, modelRef: ref });
                  }}
                />
              </div>

              <div>
                <label className="font-semibold text-sub block mb-1">{tr("ai:schedules.frequencyLabel")}</label>
                <ThemeSelect
                  portal
                  value={editingSchedule.frequency}
                  options={frequencyOptions}
                  onChange={(f) =>
                    setEditingSchedule({ ...editingSchedule, frequency: f })
                  }
                  ariaLabel={tr("ai:schedules.frequencyLabel")}
                />
              </div>
            </div>

            {/* 下次执行时间 */}
            <div>
              <label className="font-semibold text-sub block mb-1">{tr("ai:schedules.nextRunLabel")}</label>
              <input
                type="datetime-local"
                value={localDate(editingSchedule.nextRunAt)}
                onChange={(e) => {
                  const date = new Date(e.target.value);
                  if (Number.isFinite(date.getTime())) {
                    setEditingSchedule({
                      ...editingSchedule,
                      nextRunAt: date.toISOString(),
                    });
                  }
                }}
                className="w-full rounded-xl border border-edge bg-canvas px-3 py-2 text-xs text-main focus:border-accent focus:outline-none"
              />
            </div>

            {/* 关联 Skills 技能 */}
            {skills.length > 0 && (
              <div>
                <label className="font-semibold text-sub block mb-1">{tr("ai:schedules.skillsLabel")}</label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {skills.map((s) => {
                    const checked = editingSchedule.skillIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs cursor-pointer transition-colors ${
                          checked
                            ? "border-accent bg-accent/15 text-accent font-semibold"
                            : "border-edge bg-canvas text-sub hover:bg-hover hover:text-main"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="hidden"
                          checked={checked}
                          onChange={(e) =>
                            setEditingSchedule({
                              ...editingSchedule,
                              skillIds: e.target.checked
                                ? [...editingSchedule.skillIds, s.id]
                                : editingSchedule.skillIds.filter((id) => id !== s.id),
                            })
                          }
                        />
                        <span>{s.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            </fieldset>
          </div>

            {/* 弹窗底部操作栏 */}
            <div className="flex items-center justify-end gap-2.5 border-t border-edge bg-canvas/40 px-6 py-3.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditingSchedule(null)}
                className="rounded-xl border border-edge bg-surface px-4 py-2 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors"
              >
                {tr("ai:v2.cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSaveSchedule}
                className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-colors shadow-soft"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{tr("ai:v2.save")}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== 任务列表 ===================== */}
      <div className="space-y-2.5">
        {schedules.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-edge bg-canvas/30 p-8 text-center text-xs text-quiet">
            <Clock className="w-8 h-8 mx-auto mb-2 text-quiet/50" />
            <p>{tr("ai:schedules.noConfiguredSchedules")}</p>
            <p className="mt-1 text-[11px]">{tr("ai:schedules.clickToAddSchedule")}</p>
          </div>
        ) : (
          schedules.map((s) => {
            const parsed = parseSchedulePrompt(s.prompt);
            const isDeleting = deletingId === s.id;

            return (
              <div
                key={s.id}
                className="group flex flex-col justify-between rounded-2xl border border-edge bg-surface p-4 shadow-soft hover:border-accent/40 transition-all space-y-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-xs font-bold text-main">{s.name}</strong>

                        {/* 动作类型徽标 */}
                        {parsed.actionType === "webhook" ? (
                          <span className="flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.2 text-[10px] font-semibold text-blue-500">
                            <Globe className="w-2.5 h-2.5" />
                            <span>HTTP Webhook</span>
                          </span>
                        ) : parsed.actionType === "script" ? (
                          <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.2 text-[10px] font-semibold text-amber-500">
                            <Terminal className="w-2.5 h-2.5" />
                            <span>{tr("ai:schedules.actionScriptBadge")}</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.2 text-[10px] font-semibold text-accent">
                            <Bot className="w-2.5 h-2.5" />
                            <span>{tr("ai:schedules.actionPromptBadge")}</span>
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex items-center gap-3 text-[11px] text-quiet">
                        <span>{tr("ai:schedules.frequencyPrefix")} {tr(`ai:v2.frequency_${s.frequency}`) || s.frequency}</span>
                        <span>·</span>
                        <span>{s.enabled ? `${tr("ai:schedules.nextRunPrefix")} ${new Date(s.nextRunAt).toLocaleString()}` : tr("ai:schedules.disabledHint")}</span>
                      </div>
                    </div>
                  </div>

                  {/* 操作按钮区：启用开关 -> 编辑 -> 执行记录(纯图标) -> 删除(纯图标) */}
                  <div className="flex items-center gap-2 shrink-0">
                    <EnabledSwitch
                      checked={s.enabled}
                      disabled={busy}
                      label={tr("ai:v2.toggleNamed", { name: s.name })}
                      onChange={(enabled) => void handleToggleEnabled(s, enabled)}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleStartEdit(s)}
                      className="rounded-lg border border-edge bg-canvas/60 px-2.5 py-1 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors"
                    >
                      {tr("ai:schedules.editBtn")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setHistorySchedule(s)}
                      className="rounded-lg border border-edge bg-canvas/60 p-1.5 text-xs font-semibold text-sub hover:bg-hover hover:text-main hover:border-accent/40 transition-colors"
                      title={tr("ai:schedules.historyBtn")}
                      aria-label={tr("ai:schedules.historyBtn")}
                    >
                      <History className="w-3.5 h-3.5 text-accent" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDelete(s)}
                      className={`rounded-lg border p-1.5 text-xs font-semibold transition-colors ${
                        isDeleting
                          ? "border-danger bg-danger text-on-accent animate-pulse"
                          : "border-edge bg-canvas/60 text-sub hover:bg-danger/10 hover:text-danger hover:border-danger/30"
                      }`}
                      title={isDeleting ? tr("ai:schedules.confirmDelete") : tr("ai:schedules.deleteBtn")}
                      aria-label={isDeleting ? tr("ai:schedules.confirmDelete") : tr("ai:schedules.deleteBtn")}
                    >
                      {isDeleting ? tr("ai:schedules.confirmDelete") : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {s.lastRunId && (
                  <p className="truncate font-mono text-[10px] text-quiet" title={s.lastRunId}>
                    {tr("ai:schedules.lastRunId")} {s.lastRunId}
                  </p>
                )}
                {s.lastError && (
                  <p className="text-xs text-danger font-mono bg-danger/10 rounded-lg p-2 border border-danger/20">
                    {tr("ai:schedules.lastError")} {s.lastError}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 执行记录查看弹窗 */}
      <ScheduleHistoryModal
        schedule={historySchedule}
        isOpen={!!historySchedule}
        onClose={() => setHistorySchedule(null)}
        onTriggered={loadData}
      />
    </div>
  );
};
