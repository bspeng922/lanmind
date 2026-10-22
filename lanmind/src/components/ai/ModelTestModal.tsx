/**
 * ModelTestModal — 模型供应商连接与模型可用性测试弹窗（参考 Image 3）。
 *
 * CALLING SPEC:
 *   <ModelTestModal
 *     isOpen={boolean}
 *     onClose={() => void}
 *     connection={Connection}
 *     onTested?: () => void
 *   />
 */

import React, { useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Gauge,
  Loader2,
  Play,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { tr, useLocale } from "../../i18n";
import { AI, aiError, type Connection, type Model } from "./aiClient";
import { ThemeSelect, ThemeSelectOption } from "../ThemeSelect";

export interface ModelTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  connection: Connection;
  onTested?: () => void;
}

interface TestItemResult {
  status: "idle" | "testing" | "success" | "error";
  latencyMs?: number;
  error?: string;
  streamed?: boolean;
}

export const ModelTestModal: React.FC<ModelTestModalProps> = ({
  isOpen,
  onClose,
  connection,
  onTested,
}) => {
  const { locale } = useLocale();
  const [endpointType, setEndpointType] = useState("auto");
  const [streamMode, setStreamMode] = useState(true);
  const [verifyTools, setVerifyTools] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [testResults, setTestResults] = useState<Record<string, TestItemResult>>({});
  const [isBatchTesting, setIsBatchTesting] = useState(false);

  const models = connection.models || [];

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models;
    const q = searchQuery.trim().toLowerCase();
    return models.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.remoteModelId.toLowerCase().includes(q)
    );
  }, [models, searchQuery]);

  const endpointOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: "auto", label: tr("ai:testModal.endpointAuto"), tone: "blue" },
      { value: "chat", label: tr("ai:testModal.endpointChat"), tone: "slate" },
    ],
    [locale]
  );

  // 单个模型测试
  const runSingleTest = async (model: Model) => {
    const key = model.id || model.remoteModelId;
    setTestResults((prev) => ({
      ...prev,
      [key]: { status: "testing" },
    }));

    try {
      const res = await AI.call<{
        success: boolean;
        latencyMs: number;
        toolsVerified: boolean;
      }>("model.test", {
        modelRef: {
          connectionId: connection.id,
          modelEntryId: model.id || model.remoteModelId,
        },
        tools: verifyTools,
      });

      setTestResults((prev) => ({
        ...prev,
        [key]: {
          status: "success",
          latencyMs: res.latencyMs,
          streamed: streamMode,
        },
      }));
      onTested?.();
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [key]: {
          status: "error",
          error: aiError(err),
        },
      }));
    }
  };

  // 批量运行全部模型测试
  const runBatchTest = async () => {
    if (isBatchTesting || filteredModels.length === 0) return;
    setIsBatchTesting(true);

    for (const m of filteredModels) {
      await runSingleTest(m);
    }

    setIsBatchTesting(false);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isBatchTesting) onClose();
      }}
    >
      <div className="relative flex h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-strong animate-in zoom-in-95 duration-200">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-edge px-6 py-4 bg-canvas/40">
          <div>
            <h3 className="text-sm font-bold text-main flex items-center gap-2">
              <Activity className="w-4 h-4 text-accent" />
              <span>{tr("ai:testModal.title", { name: connection.name })}</span>
            </h3>
            <p className="text-xs text-quiet mt-0.5 font-mono">{connection.baseUrl}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBatchTesting}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-50"
            title={tr("ai:testModal.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 测试配置表单区 */}
        <div className="border-b border-edge p-5 bg-canvas/20 space-y-4 text-xs">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="font-semibold text-sub block mb-1.5">{tr("ai:testModal.endpointType")}</label>
              <ThemeSelect
                portal
                value={endpointType}
                options={endpointOptions}
                onChange={(val) => setEndpointType(val)}
                ariaLabel={tr("ai:testModal.endpointType")}
              />
              <span className="text-[10px] text-quiet mt-1 block">{tr("ai:testModal.endpointDesc")}</span>
            </div>

            <div>
              <label className="font-semibold text-sub block mb-1.5">{tr("ai:testModal.streamMode")}</label>
              <div className="flex items-center gap-2.5 h-8">
                <input
                  type="checkbox"
                  id="streamModeToggle"
                  checked={streamMode}
                  onChange={(e) => setStreamMode(e.target.checked)}
                  className="h-4 w-4 rounded border-edge text-accent focus:ring-accent cursor-pointer"
                />
                <label htmlFor="streamModeToggle" className="cursor-pointer text-main font-medium select-none">
                  {streamMode ? tr("ai:testModal.streamEnabled") : tr("ai:testModal.streamDisabled")}
                </label>
              </div>
              <span className="text-[10px] text-quiet block">{tr("ai:testModal.streamDesc")}</span>
            </div>

            <div>
              <label className="font-semibold text-sub block mb-1.5">{tr("ai:testModal.toolCalling")}</label>
              <div className="flex items-center gap-2.5 h-8">
                <input
                  type="checkbox"
                  id="verifyToolsToggle"
                  checked={verifyTools}
                  onChange={(e) => setVerifyTools(e.target.checked)}
                  className="h-4 w-4 rounded border-edge text-accent focus:ring-accent cursor-pointer"
                />
                <label htmlFor="verifyToolsToggle" className="cursor-pointer text-main font-medium select-none">
                  {verifyTools ? tr("ai:testModal.toolVerifyFunctionCalling") : tr("ai:testModal.toolTextOnly")}
                </label>
              </div>
              <span className="text-[10px] text-quiet block">{tr("ai:testModal.toolDesc")}</span>
            </div>
          </div>
        </div>

        {/* 渠道模型操作栏 */}
        <div className="flex items-center justify-between border-b border-edge px-5 py-3 bg-canvas/10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isBatchTesting || filteredModels.length === 0}
              onClick={runBatchTest}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-colors disabled:opacity-50 shadow-soft"
            >
              {isBatchTesting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Gauge className="w-3.5 h-3.5" />
              )}
              <span>{isBatchTesting ? tr("ai:testModal.statusTesting") : tr("ai:testModal.testAll", { count: filteredModels.length })}</span>
            </button>
            <span className="text-xs text-quiet">
              {tr("ai:testModal.passedRatio", {
                passed: (Object.values(testResults) as TestItemResult[]).filter((r) => r.status === "success").length,
                total: models.length,
              })}
            </span>
          </div>

          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-quiet" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tr("ai:testModal.filterPlaceholder")}
              className="w-full bg-canvas border border-edge rounded-xl pl-8 pr-3 py-1.5 text-xs text-main focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* 模型测试表格 */}
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
          <div className="rounded-xl border border-edge overflow-hidden bg-canvas/30">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-edge bg-canvas/60 text-quiet font-semibold">
                <tr>
                  <th className="py-2.5 px-4 w-52">{tr("ai:testModal.colModel")}</th>
                  <th className="py-2.5 px-4 w-28">{tr("ai:testModal.colStatus")}</th>
                  <th className="py-2.5 px-4">{tr("ai:testModal.colResult")}</th>
                  <th className="py-2.5 px-4 text-right w-20">{tr("ai:testModal.colActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {filteredModels.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-quiet">
                      {tr("ai:testModal.noModels")}
                    </td>
                  </tr>
                ) : (
                  filteredModels.map((m) => {
                    const key = m.id || m.remoteModelId;
                    const res = testResults[key] || { status: "idle" };

                    return (
                      <tr key={key} className="hover:bg-hover/40 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-main truncate font-mono text-[11px]" title={m.remoteModelId}>
                            {m.displayName || m.remoteModelId}
                          </div>
                          {m.displayName !== m.remoteModelId && (
                            <div className="text-[10px] text-quiet truncate font-mono">{m.remoteModelId}</div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {res.status === "idle" && (
                            <span className="text-quiet text-[11px]">{tr("ai:testModal.statusUntested")}</span>
                          )}
                          {res.status === "testing" && (
                            <span className="inline-flex items-center gap-1 text-info text-[11px] font-medium">
                              <Loader2 className="w-3 h-3 animate-spin" /> {tr("ai:testModal.statusTesting")}
                            </span>
                          )}
                          {res.status === "success" && (
                            <span className="inline-flex items-center gap-1 text-success text-[11px] font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" /> {tr("ai:testModal.statusSuccess")}
                            </span>
                          )}
                          {res.status === "error" && (
                            <span className="inline-flex items-center gap-1 text-danger text-[11px] font-semibold">
                              <AlertCircle className="w-3.5 h-3.5" /> {tr("ai:testModal.statusError")}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {res.status === "idle" && <span className="text-quiet">-</span>}
                          {res.status === "testing" && (
                            <span className="text-info text-[11px]">{tr("ai:testModal.testingProgress")}</span>
                          )}
                          {res.status === "success" && (
                            <div className="flex items-center gap-2 text-success font-mono text-[11px]">
                              <span>{tr("ai:testModal.latency", { latencyMs: res.latencyMs })}</span>
                              {res.streamed && (
                                <span className="rounded bg-success/15 px-1.5 py-0.2 text-[10px] font-semibold">
                                  SSE
                                </span>
                              )}
                            </div>
                          )}
                          {res.status === "error" && (
                            <span className="text-danger text-[11px] font-mono break-all line-clamp-2" title={res.error}>
                              {res.error || tr("ai:testModal.requestFailed")}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            disabled={res.status === "testing" || isBatchTesting}
                            onClick={() => runSingleTest(m)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-edge bg-surface text-sub hover:bg-hover hover:text-main transition-colors ml-auto disabled:opacity-40"
                            title={tr("ai:testModal.testSingle")}
                          >
                            {res.status === "testing" ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : res.status !== "idle" ? (
                              <RotateCcw className="w-3.5 h-3.5" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 底部信息与关闭栏 */}
        <div className="flex items-center justify-between border-t border-edge bg-canvas/40 px-6 py-3">
          <div className="text-xs text-quiet">
            {tr("ai:testModal.totalModels", { count: filteredModels.length })}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBatchTesting}
            className="rounded-xl border border-edge bg-surface px-5 py-2 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-50"
          >
            {tr("ai:testModal.close")}
          </button>
        </div>
      </div>
    </div>
  );
};
