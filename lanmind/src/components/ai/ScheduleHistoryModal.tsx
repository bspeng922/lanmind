/**
 * ScheduleHistoryModal — 定时任务执行记录与状态详情浮层。
 * 展示每次触发的执行时间、执行状态、持续耗时、输入内容、输出结果、报错详情以及技术元数据。
 * 支持点击展开/收起详情。
 *
 * CALLING SPEC:
 *   <ScheduleHistoryModal
 *     schedule={schedule}
 *     isOpen={isOpen}
 *     onClose={() => setIsOpen(false)}
 *     onTriggered={() => void refreshSchedules()}
 *   />
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowRightCircle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Globe,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import { tr } from "../../i18n";
import { AI, aiError, type Run, type Schedule } from "./aiClient";
import { parseSchedulePrompt } from "./scheduleHelpers";

export interface ScheduleHistoryModalProps {
  schedule: Schedule | null;
  isOpen: boolean;
  onClose: () => void;
  onTriggered?: () => void;
}

export interface DetailedRun extends Run {
  inputText?: string;
  outputText?: string;
}

function formatDuration(createdAt?: string, updatedAt?: string): string {
  if (!createdAt || !updatedAt) return "-";
  const start = new Date(createdAt).getTime();
  const end = new Date(updatedAt).getTime();
  if (isNaN(start) || isNaN(end) || end < start) return "-";
  const diffMs = end - start;
  if (diffMs < 1000) return `${diffMs}ms`;
  return `${(diffMs / 1000).toFixed(1)}s`;
}

function formatDateTime(isoString?: string): string {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString();
  } catch {
    return isoString;
  }
}

export const ScheduleHistoryModal: React.FC<ScheduleHistoryModalProps> = ({
  schedule,
  isOpen,
  onClose,
  onTriggered,
}) => {
  const [runs, setRuns] = useState<DetailedRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [notice, setNotice] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const fetchRuns = useCallback(async () => {
    if (!schedule) return;
    setLoading(true);
    setNotice("");
    try {
      const list = await AI.call<DetailedRun[]>("schedule.runs", {
        id: schedule.id,
        lastRunId: schedule.lastRunId || "",
      });
      if (list && list.length > 0) {
        setRuns(list);
      } else if (schedule.lastRunId) {
        // 后端无记录但任务已有上次执行记录时的合成回退
        setRuns([
          {
            id: schedule.lastRunId,
            status: schedule.lastError ? "failed" : "succeeded",
            conversationId: "",
            userMessageId: "",
            assistantMessageId: "",
            branchId: "",
            modelRef: schedule.modelRef,
            modelLabel: schedule.modelRef?.modelId || "Scheduled Worker",
            mode: "workspace",
            seq: 1,
            toolCalls: [],
            artifacts: [],
            finishReason: "stop",
            inputText: schedule.prompt,
            outputText: schedule.lastError ? undefined : "定时任务自动化执行完成",
            error: schedule.lastError
              ? { code: "EXECUTION_ERROR", message: schedule.lastError }
              : null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as unknown as DetailedRun,
        ]);
      } else {
        setRuns([]);
      }
    } catch {
      if (schedule.lastRunId) {
        setRuns([
          {
            id: schedule.lastRunId,
            status: schedule.lastError ? "failed" : "succeeded",
            conversationId: "",
            userMessageId: "",
            assistantMessageId: "",
            branchId: "",
            modelRef: schedule.modelRef,
            modelLabel: schedule.modelRef?.modelId || "Scheduled Worker",
            mode: "workspace",
            seq: 1,
            toolCalls: [],
            artifacts: [],
            finishReason: "stop",
            inputText: schedule.prompt,
            outputText: schedule.lastError ? undefined : "定时任务自动化执行完成",
            error: schedule.lastError
              ? { code: "EXECUTION_ERROR", message: schedule.lastError }
              : null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as unknown as DetailedRun,
        ]);
      } else {
        setRuns([]);
      }
    } finally {
      setLoading(false);
    }
  }, [schedule]);

  useEffect(() => {
    if (isOpen && schedule) {
      void fetchRuns();
    }
  }, [isOpen, schedule, fetchRuns]);

  // ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isRunningNow) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isRunningNow, onClose]);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleRunNow = async () => {
    if (!schedule || isRunningNow) return;
    setIsRunningNow(true);
    setNotice("");
    try {
      await AI.call("schedule.run_now", { id: schedule.id });
      setNotice(tr("ai:schedules.runNowSuccess"));
      onTriggered?.();
      setTimeout(() => void fetchRuns(), 800);
      setTimeout(() => void fetchRuns(), 2500);
    } catch (err) {
      setNotice(aiError(err));
    } finally {
      setIsRunningNow(false);
    }
  };

  const parsed = useMemo(() => {
    return schedule ? parseSchedulePrompt(schedule.prompt) : null;
  }, [schedule]);

  const stats = useMemo(() => {
    const total = runs.length;
    const succeeded = runs.filter((r) => r.status === "succeeded").length;
    const failed = runs.filter((r) => r.status === "failed").length;
    const rate = total > 0 ? Math.round((succeeded / total) * 100) : 100;
    const firstRun = runs[0] as unknown as Record<string, string> | undefined;
    const lastIso = firstRun?.createdAt || firstRun?.created_at;
    return {
      total,
      succeeded,
      failed,
      rate,
      lastTime: lastIso ? formatDateTime(lastIso) : "-",
    };
  }, [runs]);

  if (!isOpen || !schedule) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-overlay backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRunningNow) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={tr("ai:schedules.historyTitle")}
    >
      <div className="relative flex h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-strong animate-in zoom-in-95 duration-200">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <Clock className="w-5 h-5 text-accent" />
              <h3 className="text-base font-bold text-main">
                {tr("ai:schedules.historyTitle")}
              </h3>
              {parsed?.actionType === "webhook" ? (
                <span className="flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-500">
                  <Globe className="w-3 h-3" />
                  <span>HTTP Webhook</span>
                </span>
              ) : parsed?.actionType === "script" ? (
                <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">
                  <Terminal className="w-3 h-3" />
                  <span>{tr("ai:schedules.actionScriptBadge")}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                  <Bot className="w-3 h-3" />
                  <span>{tr("ai:schedules.actionPromptBadge")}</span>
                </span>
              )}
            </div>
            <p className="text-xs text-sub">
              {tr("ai:schedules.historySubtitle", { name: schedule.name })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isRunningNow}
              onClick={handleRunNow}
              className="flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
              title={tr("ai:schedules.runNow")}
            >
              {isRunningNow ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{isRunningNow ? tr("ai:schedules.runningNow") : tr("ai:schedules.runNow")}</span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => void fetchRuns()}
              className="flex items-center gap-1.5 rounded-xl border border-edge bg-canvas px-3 py-1.5 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-50"
              title={tr("ai:schedules.refresh")}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-accent" : ""}`} />
              <span>{tr("ai:schedules.refresh")}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              disabled={isRunningNow}
              className="rounded-lg p-1.5 text-quiet hover:bg-hover hover:text-main transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 统计概览条 */}
        <div className="grid grid-cols-3 gap-3 border-b border-edge bg-canvas/30 px-6 py-3">
          <div className="rounded-xl border border-edge/60 bg-surface/80 p-3 shadow-xs">
            <span className="text-[11px] text-quiet block">{tr("ai:schedules.totalRuns")}</span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-lg font-bold text-main">{stats.total}</span>
              <span className="text-[10px] text-quiet">次</span>
            </div>
          </div>

          <div className="rounded-xl border border-edge/60 bg-surface/80 p-3 shadow-xs">
            <span className="text-[11px] text-quiet block">{tr("ai:schedules.successRate")}</span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className={`text-lg font-bold ${stats.rate >= 80 ? "text-success" : stats.rate >= 50 ? "text-amber-500" : "text-danger"}`}>
                {stats.rate}%
              </span>
              <span className="text-[10px] text-quiet">
                ({stats.succeeded} 成功 / {stats.failed} 失败)
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-edge/60 bg-surface/80 p-3 shadow-xs">
            <span className="text-[11px] text-quiet block">{tr("ai:schedules.lastRun")}</span>
            <span className="mt-1 block text-xs font-semibold text-main truncate" title={stats.lastTime}>
              {stats.lastTime}
            </span>
          </div>
        </div>

        {/* 提示消息 */}
        {notice && (
          <div className="mx-6 mt-3 rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-2 text-xs font-semibold text-accent">
            {notice}
          </div>
        )}

        {/* 记录列表区域 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading && runs.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-xs text-quiet">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
              <span>{tr("ai:schedules.runningNow")}</span>
            </div>
          ) : runs.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-edge bg-canvas/20 text-center text-xs text-quiet p-6">
              <Clock className="w-8 h-8 text-quiet/40 mb-2" />
              <p className="font-semibold text-sub">{tr("ai:schedules.noHistory")}</p>
              <p className="mt-1 text-[11px] text-quiet max-w-xs">{tr("ai:schedules.noHistoryHint")}</p>
            </div>
          ) : (
            runs.map((r) => {
              const runObj = r as unknown as Record<string, unknown>;
              const createdAt = (runObj.createdAt || runObj.created_at) as string | undefined;
              const updatedAt = (runObj.updatedAt || runObj.updated_at) as string | undefined;
              const isSuccess = r.status === "succeeded";
              const isFailed = r.status === "failed";
              const isRunning = r.status === "running" || r.status === "queued";
              const durationStr = formatDuration(createdAt, updatedAt);
              const isExpanded = expandedIds.has(r.id);

              const effectiveInput = r.inputText || schedule.prompt;
              const effectiveOutput = r.outputText;

              return (
                <div
                  key={r.id}
                  className={`rounded-2xl border transition-all ${
                    isExpanded
                      ? "border-accent/40 bg-canvas/60 shadow-soft"
                      : "border-edge bg-canvas/40 shadow-xs hover:border-accent/30 hover:bg-canvas/50"
                  } p-4 space-y-3`}
                >
                  {/* 卡片头部行：状态、时间、耗时、模型以及展开折叠切换 */}
                  <div
                    className="flex items-center justify-between gap-3 cursor-pointer select-none"
                    onClick={() => toggleExpand(r.id)}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* 状态徽标 */}
                      {isSuccess ? (
                        <span className="flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-xs font-bold text-success shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{tr("ai:schedules.statusSuccess")}</span>
                        </span>
                      ) : isFailed ? (
                        <span className="flex items-center gap-1 rounded-md bg-danger/15 px-2 py-0.5 text-xs font-bold text-danger shrink-0">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>{tr("ai:schedules.statusFailed")}</span>
                        </span>
                      ) : isRunning ? (
                        <span className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent shrink-0">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>{tr("ai:schedules.statusRunning")}</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 rounded-md bg-quiet/20 px-2 py-0.5 text-xs font-bold text-sub shrink-0">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>{r.status}</span>
                        </span>
                      )}

                      {/* 执行时间 */}
                      <span className="text-xs font-semibold text-main truncate">
                        {formatDateTime(createdAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {/* 耗时 */}
                      {durationStr !== "-" && (
                        <span className="text-[11px] text-quiet">
                          {tr("ai:schedules.duration")}: <strong className="text-sub font-mono">{durationStr}</strong>
                        </span>
                      )}

                      {/* 模型标签 */}
                      {r.modelLabel && (
                        <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] border border-edge text-quiet">
                          {r.modelLabel}
                        </span>
                      )}

                      {/* 展开/收起按钮 */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(r.id);
                        }}
                        className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:text-accent/80 transition-colors ml-1"
                        aria-expanded={isExpanded}
                      >
                        <span>{isExpanded ? tr("ai:schedules.collapseDetails") : tr("ai:schedules.expandDetails")}</span>
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                      </button>
                    </div>
                  </div>

                  {/* 默认摘要行：Run ID 快速展示与复制 */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-edge/30 text-[11px] text-quiet">
                    <div className="flex items-center gap-1.5 font-mono truncate">
                      <span className="text-quiet/70">{tr("ai:schedules.runId")}:</span>
                      <span className="text-sub truncate" title={r.id}>
                        {r.id}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(r.id, `id-${r.id}`);
                      }}
                      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-sub hover:bg-hover hover:text-main transition-colors shrink-0"
                      title={tr("ai:schedules.copy")}
                    >
                      {copiedKey === `id-${r.id}` ? (
                        <>
                          <Check className="w-3 h-3 text-success" />
                          <span className="text-success">{tr("ai:schedules.copied")}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>{tr("ai:schedules.copy")}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* 展开后的详细信息：输入内容、输出结果、报错详情、技术参数 */}
                  {isExpanded && (
                    <div className="pt-3 border-t border-edge/60 space-y-3 animate-in fade-in duration-150">
                      {/* 输入内容板块 */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-semibold text-sub">
                          <div className="flex items-center gap-1.5 text-main">
                            <ArrowRightCircle className="w-3.5 h-3.5 text-accent" />
                            <span>{tr("ai:schedules.inputText")}</span>
                          </div>
                          {effectiveInput && (
                            <button
                              type="button"
                              onClick={() => handleCopy(effectiveInput, `in-${r.id}`)}
                              className="flex items-center gap-1 text-[11px] text-quiet hover:text-main transition-colors"
                            >
                              {copiedKey === `in-${r.id}` ? (
                                <>
                                  <Check className="w-3 h-3 text-success" />
                                  <span className="text-success">{tr("ai:schedules.copied")}</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>{tr("ai:schedules.copy")}</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                        <div className="rounded-xl border border-edge/70 bg-surface/90 p-3 text-xs font-mono text-main select-text whitespace-pre-wrap break-all max-h-48 overflow-y-auto shadow-xs">
                          {effectiveInput || <span className="text-quiet">{tr("ai:schedules.noInput")}</span>}
                        </div>
                      </div>

                      {/* 输出结果板块 */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-semibold text-sub">
                          <div className="flex items-center gap-1.5 text-main">
                            <MessageSquare className="w-3.5 h-3.5 text-accent" />
                            <span>{tr("ai:schedules.outputText")}</span>
                          </div>
                          {effectiveOutput && (
                            <button
                              type="button"
                              onClick={() => handleCopy(effectiveOutput, `out-${r.id}`)}
                              className="flex items-center gap-1 text-[11px] text-quiet hover:text-main transition-colors"
                            >
                              {copiedKey === `out-${r.id}` ? (
                                <>
                                  <Check className="w-3 h-3 text-success" />
                                  <span className="text-success">{tr("ai:schedules.copied")}</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>{tr("ai:schedules.copy")}</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                        <div className="rounded-xl border border-edge/70 bg-surface/90 p-3 text-xs text-main select-text whitespace-pre-wrap break-words max-h-56 overflow-y-auto shadow-xs leading-relaxed">
                          {isRunning ? (
                            <div className="flex items-center gap-2 text-quiet py-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                              <span>{tr("ai:schedules.runningNow")}</span>
                            </div>
                          ) : effectiveOutput ? (
                            effectiveOutput
                          ) : (
                            <span className="text-quiet">{tr("ai:schedules.noOutput")}</span>
                          )}
                        </div>
                      </div>

                      {/* 报错详情面板 (发生错误时渲染) */}
                      {r.error && (
                        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger font-mono space-y-1">
                          <div className="flex items-center gap-1.5 font-bold text-[11px]">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>{tr("ai:schedules.errorDetails")} ({r.error.code || "FAILED"})</span>
                          </div>
                          <p className="text-[11px] break-all whitespace-pre-wrap">{r.error.message}</p>
                        </div>
                      )}

                      {/* 技术参数与 Token 指标 */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-edge/40 text-[11px] text-quiet">
                        <div className="flex items-center gap-3">
                          {r.conversationId && (
                            <span className="truncate max-w-xs font-mono" title={r.conversationId}>
                              Conv: {r.conversationId}
                            </span>
                          )}
                          {r.finishReason && (
                            <span>
                              {tr("ai:schedules.finishReason")}: <strong className="text-sub font-mono">{r.finishReason}</strong>
                            </span>
                          )}
                        </div>
                        {r.usage && (
                          <div className="font-mono text-sub">
                            {tr("ai:schedules.tokensUsed")}: {typeof r.usage === "object" ? JSON.stringify(r.usage) : String(r.usage)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 底部关闭栏 */}
        <div className="flex items-center justify-between border-t border-edge bg-canvas/40 px-6 py-3">
          <div className="text-xs text-quiet">
            {tr("ai:schedules.totalRuns")}: {runs.length}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isRunningNow}
            className="rounded-xl border border-edge bg-surface px-5 py-2 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-50"
          >
            {tr("ai:schedules.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
