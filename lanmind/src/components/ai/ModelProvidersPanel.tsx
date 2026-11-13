/**
 * ModelProvidersPanel — 模型供应商管理面板（已配置供应商面板、快捷预设卡片、上游发现与模型标签管理）。
 *
 * CALLING SPEC:
 *   <ModelProvidersPanel />
 */

import React, { useCallback, useEffect, useId, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertCircle,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  Cpu,
  Edit2,
  Gauge,
  Globe,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { tr, useLocale } from "../../i18n";
import {
  AI,
  aiError,
  type Catalog,
  type Connection,
  type Model,
  type Parameters,
} from "./aiClient";
import { ModelTestModal } from "./ModelTestModal";
import { ModelFetchModal } from "./ModelFetchModal";
import { ProviderDeleteModal } from "./ProviderDeleteModal";
import { ThemeSelect, ThemeSelectOption } from "../ThemeSelect";
import {
  AI_ASSISTANT_NAME_MAX_LENGTH,
  getAIAssistantName,
  onAIAssistantNameChange,
  setAIAssistantName,
} from "../../utils/aiAssistant";
import { PRESETS, ProviderPresetGrid } from "./ProviderPresets";
import { EnabledSwitch } from "./EnabledSwitch";

const newModelItem = (remoteModelId: string): Model => ({
  id: "",
  remoteModelId,
  displayName: remoteModelId,
  enabled: true,
  missing: false,
  capabilities: {},
  parameters: {},
});

export const ModelProvidersPanel: React.FC = () => {
  useLocale();
  const modalTitleId = useId();
  const [catalog, setCatalog] = useState<Catalog>({ schemaVersion: 2, connections: [], defaults: {} });
  const [draft, setDraft] = useState<Connection | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const [pendingAction, setPendingAction] = useState<"save" | "discover" | "toggle" | "delete" | null>(null);
  const busy = pendingAction !== null;
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // 弹窗状态
  const [testModalConnection, setTestModalConnection] = useState<Connection | null>(null);
  const [fetchModalData, setFetchModalData] = useState<{
    isOpen: boolean;
    availableIds: string[];
  }>({ isOpen: false, availableIds: [] });

  // AI 助手名称
  const [assistantNameDraft, setAssistantNameDraft] = useState<string>(() => getAIAssistantName() ?? "");
  const [connectionToDelete, setConnectionToDelete] = useState<Connection | null>(null);

  useEffect(() => {
    const unsub = onAIAssistantNameChange((name) => setAssistantNameDraft(name ?? ""));
    return unsub;
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const data = await AI.call<Catalog>("catalog");
      setCatalog(data);
    } catch (e) {
      setError(aiError(e));
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // 从预设创建新供应商
  const startCreateFromPreset = (presetKey: string) => {
    const p = PRESETS[presetKey];
    const newConn: Connection = {
      id: "",
      name: p.name,
      providerType: p.type,
      baseUrl: p.url,
      enabled: true,
      bound: true,
      revision: 0,
      configRevision: 0,
      hasCredential: false,
      referenceCount: 0,
      parameters: {},
      models: [],
    };
    setDraft(newConn);
    setIsCreating(true);
    setKeyInput("");
    setClearKey(false);
    setCustomModelInput("");
    setError("");
    setNotice("");
  };

  // 开始编辑现有供应商
  const startEditConnection = (conn: Connection) => {
    const next = structuredClone(conn);
    if (!next.bound) {
      next.bound = true;
      next.models = next.models.map((model) => ({ ...model, enabled: true }));
    }
    setDraft(next);
    setIsCreating(false);
    setKeyInput("");
    setClearKey(false);
    setCustomModelInput("");
    setError("");
    setNotice("");
  };

  // 取消编辑
  const cancelEdit = () => {
    if (busy) return;
    setDraft(null);
    setKeyInput("");
    setIsCreating(false);
    setError("");
    setNotice("");
  };

  const connectionPayload = (connection: Connection) => ({
    id: connection.id || null,
    expectedRevision: connection.id ? connection.revision : null,
    name: connection.name.trim(),
    providerType: connection.providerType,
    baseUrl: connection.baseUrl.trim(),
    enabled: connection.enabled,
    bound: connection.bound,
    parameters: connection.parameters,
    models: connection.models,
    credentialChange: clearKey
      ? { action: "clear" }
      : keyInput
      ? { action: "replace", value: keyInput }
      : { action: "keep" },
  });

  // 保存当前编辑的供应商
  const saveDraft = async () => {
    if (!draft || busy) return;
    if (!draft.name.trim()) {
      setError(tr("ai:v2.errorNameRequired"));
      return;
    }
    if (!draft.baseUrl.trim()) {
      setError(tr("ai:v2.errorBaseUrlRequired"));
      return;
    }

    setPendingAction("save");
    setError("");
    setNotice("");

    try {
      const saved = await AI.call<Connection>("connection.save", connectionPayload(draft));

      await loadCatalog();
      setDraft(null);
      setKeyInput("");
      setClearKey(false);
      setIsCreating(false);
      setNotice(tr("ai:v2.savedConnectionSuccess", { name: saved.name }));
      setTimeout(() => setNotice(""), 3000);
    } catch (e) {
      setError(aiError(e));
    } finally {
      setPendingAction(null);
    }
  };

  const toggleConnection = async (connection: Connection, enabled: boolean) => {
    if (busy) return;
    setPendingAction("toggle");
    setError("");
    setNotice("");
    try {
      await AI.call("connection.save", {
        id: connection.id,
        expectedRevision: connection.revision,
        name: connection.name,
        providerType: connection.providerType,
        baseUrl: connection.baseUrl,
        enabled,
        bound: connection.bound || enabled,
        parameters: connection.parameters,
        models: !connection.bound && enabled
          ? connection.models.map((model) => ({ ...model, enabled: true }))
          : connection.models,
        credentialChange: { action: "keep" },
      });
      await loadCatalog();
    } catch (e) {
      setError(aiError(e));
    } finally {
      setPendingAction(null);
    }
  };

  // 执行删除供应商
  const handleExecuteDelete = async () => {
    if (!connectionToDelete || busy) return;

    setPendingAction("delete");
    setError("");
    try {
      await AI.call("connection.delete", {
        id: connectionToDelete.id,
        revision: connectionToDelete.revision,
      });
      await loadCatalog();
      if (draft?.id === connectionToDelete.id) setDraft(null);
      const deletedName = connectionToDelete.name;
      setConnectionToDelete(null);
      setNotice(tr("ai:v2.deletedConnectionSuccess", { name: deletedName }));
      setTimeout(() => setNotice(""), 3000);
    } catch (e) {
      setError(aiError(e));
    } finally {
      setPendingAction(null);
    }
  };

  // 从上游获取模型
  const handleFetchUpstreamModels = async () => {
    if (!draft || busy) return;
    setPendingAction("discover");
    setError("");
    setNotice("");

    try {
      const discoveredIds = await AI.call<string[]>("connection.discover", { draft: connectionPayload(draft) });
      setFetchModalData({
        isOpen: true,
        availableIds: discoveredIds || [],
      });
    } catch (e) {
      setError(`${tr("ai:v2.fetchModelsFailed")}: ${aiError(e)}`);
    } finally {
      setPendingAction(null);
    }
  };

  // 勾选后保存模型列表
  const handleSaveFetchedModels = (selectedIds: string[]) => {
    if (!draft) return;
    const existingMap = new Map<string, Model>(draft.models.map((m) => [m.remoteModelId, m]));
    const nextModels: Model[] = selectedIds.map((id) => {
      const existing = existingMap.get(id);
      return existing ? { ...existing, enabled: true, missing: false } : newModelItem(id);
    });

    setDraft({ ...draft, models: nextModels });
    setNotice(tr("ai:v2.selectedModelsCount", { count: nextModels.length }));
    setTimeout(() => setNotice(""), 3000);
  };

  // 手动添加单个模型
  const handleAddCustomModel = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!draft || !customModelInput.trim()) return;
    const modelName = customModelInput.trim();
    if (draft.models.some((m) => m.remoteModelId === modelName)) {
      setCustomModelInput("");
      return;
    }
    setDraft({
      ...draft,
      models: [...draft.models, newModelItem(modelName)],
    });
    setCustomModelInput("");
  };

  // 移除单个模型
  const handleRemoveModel = (remoteModelId: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      models: draft.models.filter((m) => m.remoteModelId !== remoteModelId),
    });
  };

  // 清除所有模型
  const handleClearAllModels = () => {
    if (!draft) return;
    setDraft({ ...draft, models: [] });
  };

  const providerTypeOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: "ollama", label: tr("ai:v2.providerOllama"), tone: "amber" },
      { value: "vllm", label: tr("ai:v2.providerVllm"), tone: "blue" },
      { value: "sglang", label: tr("ai:v2.providerSglang"), tone: "emerald" },
      { value: "openai-compatible", label: tr("ai:v2.providerOpenai"), tone: "slate" },
      { value: "anthropic-compatible", label: tr("ai:v2.providerAnthropic"), tone: "amber" },
    ],
    []
  );

  const initialSelectedModelIds = useMemo(
    () => draft?.models.map((m) => m.remoteModelId) || [],
    [draft?.models]
  );

  return (
    <div className="provider-settings space-y-6 animate-in fade-in duration-200">
      {/* 顶部：AI 助手名称配置卡片 */}
      <section aria-labelledby="ai-assistant-heading" className="rounded-2xl border border-edge bg-surface/80 p-4 shadow-soft">
        <div className="provider-assistant-row flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 text-accent font-bold">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h4 id="ai-assistant-heading" className="text-xs font-bold text-main flex items-center gap-2">
                <span>{tr("ai:v2.assistantConfigTitle")}</span>
                <span className="rounded-full bg-accent/15 px-2 py-0.2 text-caption font-semibold text-accent">{tr("ai:v2.assistantGlobalBadge")}</span>
              </h4>
              <p className="text-meta text-quiet mt-0.5">{tr("ai:v2.assistantConfigDesc")}</p>
            </div>
          </div>

          <div className="provider-assistant-controls items-center">
            <input
              type="text"
              value={assistantNameDraft}
              maxLength={AI_ASSISTANT_NAME_MAX_LENGTH}
              onChange={(e) => {
                const next = e.target.value;
                setAssistantNameDraft(next);
                setAIAssistantName(next);
              }}
              placeholder={tr("settings:settingsModal.assistantNamePlaceholder") || "输入 AI 助手名称..."}
              className="ui-field w-48 border border-edge bg-canvas text-main placeholder:text-quiet focus:border-accent focus:outline-none"
            />
            {assistantNameDraft && (
              <button
                type="button"
                onClick={() => {
                  setAssistantNameDraft("");
                  setAIAssistantName("");
                }}
                className="flex min-h-8 items-center gap-1 rounded-xl border border-edge bg-canvas px-2 py-1.5 text-meta font-semibold text-sub hover:bg-hover hover:text-main transition-colors"
                title={tr("ai:v2.assistantResetTitle")}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{tr("ai:v2.assistantReset")}</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 状态与通知消息 */}
      {error && !draft && (
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
      {draft ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="provider-editor relative flex flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-strong animate-in zoom-in-95 duration-150">
            <div className="provider-editor-header flex items-center justify-between border-b border-edge px-6 py-4 bg-canvas/30">
            <div className="flex items-center gap-2">
              <span id={modalTitleId} className="text-sm font-bold text-main">
                {isCreating ? tr("ai:v2.createConnectionTitle") : tr("ai:v2.editConnectionTitle", { name: draft.name })}
              </span>
              <span className="rounded bg-accent/15 px-2 py-0.5 text-caption font-semibold text-accent uppercase">
                {draft.providerType}
              </span>
            </div>
            <button
              type="button"
              disabled={busy}
              aria-label={tr("ai:v2.close")}
              onClick={cancelEdit}
              className="ui-icon-button flex items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="provider-editor-body flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4 text-body scrollbar-thin">
            {error && <p role="alert" className="ai-v2-error">{error}</p>}
            <div className="flex items-center justify-between gap-4 rounded-xl border border-edge p-3">
              <div className="space-y-1">
                <span className="font-semibold text-main">{tr("ai:v2.connectionEnabled")}</span>
                <p className="text-meta leading-5 text-quiet">{tr("ai:v2.providerEnabledHint")}</p>
              </div>
              <EnabledSwitch checked={draft.enabled} disabled={busy}
                label={tr("ai:v2.connectionEnabled")}
                onChange={(enabled) => setDraft({ ...draft, enabled })} />
            </div>
            <div className="provider-editor-fields">
              <div>
                <label className="font-semibold text-sub block mb-1">{tr("ai:v2.providerType")}</label>
                <ThemeSelect
                  portal
                  value={draft.providerType}
                  options={providerTypeOptions}
                  onChange={(val) => setDraft({ ...draft, providerType: val })}
                  ariaLabel={tr("ai:v2.providerType")}
                />
              </div>

              <div>
                <label className="font-semibold text-sub block mb-1">{tr("ai:v2.connectionName")}</label>
                <input
                  type="text"
                  value={draft.name}
                  aria-label={tr("ai:v2.connectionName")}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder={tr("ai:v2.connectionNamePlaceholder")}
                  className="ui-field w-full border border-edge bg-canvas text-main focus:border-accent focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-sub block mb-1">{tr("ai:v2.baseUrl")}</label>
              <input
                type="text"
                value={draft.baseUrl}
                aria-label={tr("ai:v2.baseUrl")}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder={tr("ai:v2.baseUrlPlaceholder")}
                className="ui-field w-full font-mono border border-edge bg-canvas text-main focus:border-accent focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold text-sub">{tr("ai:v2.apiKey")}</label>
                {draft.hasCredential && (
                  <span className="text-meta text-success flex items-center gap-1 font-semibold">
                    <Check className="w-3 h-3" /> {tr("ai:v2.credentialSavedBadge")}
                  </span>
                )}
              </div>
              <div className="provider-credential-row flex flex-wrap gap-2">
                <input
                  type="password"
                  aria-label={tr("ai:v2.apiKey")}
                  disabled={clearKey}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={clearKey ? tr("ai:v2.clearCredential") : draft.hasCredential ? tr("ai:v2.credentialSaved") : tr("ai:v2.credentialOptional")}
                  className="ui-field flex-1 font-mono border border-edge bg-canvas text-main focus:border-accent focus:outline-none disabled:opacity-40"
                />
                {draft.hasCredential && (
                  <button
                    type="button"
                    onClick={() => {
                      setClearKey(!clearKey);
                      setKeyInput("");
                    }}
                    className={`ui-button font-semibold border transition-colors ${
                      clearKey
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-edge bg-canvas text-sub hover:bg-hover hover:text-main"
                    }`}
                  >
                    {clearKey ? tr("ai:v2.cancelClearKey") : tr("ai:v2.clearKey")}
                  </button>
                )}
              </div>
            </div>

            {/* 模型列表管理 (参考 Image 2) */}
            <div className="rounded-2xl border border-edge bg-canvas/40 p-4 space-y-3">
              <div className="provider-models-header flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-main text-xs">{tr("ai:v2.models")} *</span>
                    <span className="rounded-full bg-card px-2 py-0.2 text-caption text-quiet font-mono border border-edge/60">
                      {tr("ai:v2.selectedModelsCount", { count: draft.models.length })}
                    </span>
                  </div>
                  <p className="text-meta text-quiet mt-0.5">
                    {tr("ai:v2.discoverHint")}
                  </p>
                </div>

                <div className="flex max-w-full flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    aria-busy={pendingAction === "discover"}
                    onClick={handleFetchUpstreamModels}
                    className="ui-button bg-accent font-semibold text-on-accent hover:bg-accent/90 disabled:opacity-50 shadow-soft"
                  >
                    {pendingAction === "discover" ? <><progress aria-label={tr("ai:v2.discover")} className="sr-only" /><Loader2 aria-hidden="true" className="w-3 h-3 motion-safe:animate-spin" /></> : <RefreshCw aria-hidden="true" className="w-3 h-3" />}
                    <span>{tr("ai:v2.discover")}</span>
                  </button>

                  {draft.models.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllModels}
                      className="rounded-xl border border-edge bg-surface px-2.5 py-1.5 text-xs font-semibold text-quiet hover:text-danger hover:border-danger/30 transition-colors"
                      title={tr("ai:v2.removeModelTitle")}
                    >
                      {tr("ai:v2.clearCredential") || "清除所有"}
                    </button>
                  )}
                </div>
              </div>

              {/* 选中的模型标签流 (Tag Chips Cloud, 参考 Image 2) */}
              <div className="min-h-16 rounded-xl border border-edge bg-surface p-3 flex flex-wrap items-center gap-1.5">
                {draft.models.length === 0 ? (
                  <span className="text-quiet text-xs">
                    {tr("ai:v2.discoverHint")}
                  </span>
                ) : (
                  draft.models.map((m) => (
                    <span
                      key={m.id || m.remoteModelId}
                      className="provider-model-chip inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-edge bg-canvas px-2.5 py-1 text-xs font-mono text-main hover:border-accent/40 transition-colors"
                    >
                      <span>{m.displayName || m.remoteModelId}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveModel(m.remoteModelId)}
                        className="text-quiet hover:text-danger transition-colors"
                        title={tr("ai:v2.removeModelTitle")}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>

              {/* 手动添加自定义模型输入框 */}
              <form onSubmit={handleAddCustomModel} className="flex gap-2">
                <input
                  type="text"
                  value={customModelInput}
                  aria-label={tr("ai:v2.remoteModelId")}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  placeholder={tr("ai:v2.customModelPlaceholder")}
                  className="ui-field flex-1 font-mono border border-edge bg-surface text-main focus:border-accent focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!customModelInput.trim()}
                  className="ui-icon-button border border-edge bg-surface text-sub hover:bg-hover hover:text-main disabled:opacity-40 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>

          {/* 弹窗底部操作栏 */}
          <div className="provider-editor-footer flex items-center justify-end border-t border-edge bg-canvas/40 px-6 py-3.5">
            <button
              type="button"
              disabled={busy}
              onClick={cancelEdit}
              className="ui-button border border-edge bg-surface font-semibold text-sub hover:bg-hover hover:text-main disabled:opacity-50"
            >
              {tr("ai:v2.cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-busy={pendingAction === "save"}
              onClick={saveDraft}
              className="ui-button bg-accent font-semibold text-on-accent hover:bg-accent/90 transition-colors disabled:opacity-50 shadow-soft"
            >
              {pendingAction === "save" && <><progress aria-label={tr("ai:v2.saveConnection")} className="sr-only" /><Loader2 aria-hidden="true" className="w-3.5 h-3.5 motion-safe:animate-spin" /></>}
              <span>{tr("ai:v2.saveConnection")}</span>
            </button>
          </div>
        </div>
      </div>,
      document.body
      ) : null}

      {/* ===================== 上半部分：已配置的模型供应商卡片列表 ===================== */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-main">{tr("ai:v2.configuredProviders")}</h3>
            <span className="rounded-full bg-accent/15 px-2 py-0.2 text-xs font-mono font-bold text-accent">
              {catalog.connections.length}
            </span>
          </div>
        </div>

        {catalog.connections.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-edge bg-canvas/30 p-8 text-center text-xs text-quiet">
            <p>{tr("ai:v2.noProvidersConfigured")}</p>
            <p className="mt-1 text-meta">{tr("ai:v2.selectPresetToCreate")}</p>
          </div>
        ) : (
          <div className="provider-connections">
            {catalog.connections.map((c) => {
              const presetInfo = PRESETS[c.providerType] || { icon: "⚙️", badge: tr("ai:v2.custom") };

              return (
                <div
                  key={c.id}
                  className="provider-connection group relative flex flex-col justify-between border border-edge bg-surface p-4 hover:border-accent/40 transition-colors"
                >
                  <div>
                    {/* 卡片头部 */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <span className="text-2xl">{presetInfo.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-bold text-main text-xs" title={c.name}>{c.name}</span>
                            <span className="rounded bg-accent/15 px-1.5 py-0.2 text-caption font-semibold text-accent uppercase">
                              {c.providerType}
                            </span>
                          </div>
                          <span className="text-meta text-quiet font-mono truncate max-w-[240px] block" title={c.baseUrl}>
                            {c.baseUrl}
                          </span>
                        </div>
                      </div>

                      <EnabledSwitch checked={c.enabled && c.bound} disabled={busy}
                        label={tr("ai:v2.toggleNamed", { name: c.name })}
                        onChange={(enabled) => void toggleConnection(c, enabled)} />
                    </div>

                    {!c.bound && (
                      <p className="text-meta text-quiet">{tr("ai:v2.providerUnboundHint")}</p>
                    )}

                    {/* 卡片中间：模型数量与预览 tags */}
                    <div className="my-2.5 flex flex-wrap gap-1 items-center">
                      <span className="rounded-md bg-card px-2 py-0.5 text-meta font-mono text-sub border border-edge/60">
                        {tr("ai:v2.modelsCount", { count: c.models.length })}
                      </span>
                      {c.models.slice(0, 3).map((m) => (
                        <span
                          key={m.id || m.remoteModelId}
                          className="rounded-md bg-canvas px-1.5 py-0.5 text-caption font-mono text-quiet truncate max-w-[120px]"
                          title={m.remoteModelId}
                        >
                          {m.displayName || m.remoteModelId}
                        </span>
                      ))}
                      {c.models.length > 3 && (
                        <span className="text-caption text-quiet font-mono">+{c.models.length - 3}</span>
                      )}
                    </div>
                  </div>

                  {/* 卡片右下角操作按钮：测试、编辑、删除（仅图标） */}
                  <div className="flex items-center justify-end gap-1.5 border-t border-edge/60 pt-2.5 mt-2">
                    {/* 测试按钮 */}
                    <button
                      type="button"
                      disabled={busy || !c.enabled || !c.bound}
                      onClick={() => setTestModalConnection(c)}
                      className="ui-icon-button flex items-center justify-center rounded-lg border border-edge bg-canvas/60 text-sub hover:bg-hover hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-50"
                      title={tr("ai:v2.testConnectionTitle")}
                    >
                      <Gauge className="w-3.5 h-3.5" />
                    </button>

                    {/* 编辑按钮 */}
                    <button
                      type="button"
                      onClick={() => startEditConnection(c)}
                      className="ui-icon-button flex items-center justify-center rounded-lg border border-edge bg-canvas/60 text-sub hover:bg-hover hover:text-main transition-colors"
                      title={tr("ai:v2.editProviderTitle")}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    {/* 删除按钮 */}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConnectionToDelete(c)}
                      className="ui-icon-button flex items-center justify-center rounded-lg border border-edge bg-canvas/60 text-danger hover:bg-danger/10 hover:border-danger/30 transition-colors"
                      title={tr("ai:v2.deleteProviderTitle")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===================== 分割线 ===================== */}
      <div className="relative py-2">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-edge" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-surface px-3 text-quiet font-semibold">
            {tr("ai:v2.addProviderPresetHeading")}
          </span>
        </div>
      </div>

      {/* ===================== 下半部分：4 大预设面板 ===================== */}
      <ProviderPresetGrid onSelectPreset={startCreateFromPreset} />

      {/* 测试弹窗 */}
      {testModalConnection && (
        <ModelTestModal
          isOpen={!!testModalConnection}
          onClose={() => setTestModalConnection(null)}
          connection={testModalConnection}
          onTested={loadCatalog}
        />
      )}

      {/* 上游获取模型勾选弹窗 */}
      {fetchModalData.isOpen && draft && (
        <ModelFetchModal
          isOpen={fetchModalData.isOpen}
          onClose={() => setFetchModalData({ isOpen: false, availableIds: [] })}
          channelName={draft.name}
          availableModelIds={fetchModalData.availableIds}
          initialSelectedModelIds={initialSelectedModelIds}
          onSaveModels={handleSaveFetchedModels}
        />
      )}

      {/* 确认删除供应商弹窗 */}
      <ProviderDeleteModal
        isOpen={Boolean(connectionToDelete)}
        connection={connectionToDelete}
        busy={busy}
        onClose={() => setConnectionToDelete(null)}
        onConfirm={handleExecuteDelete}
      />
    </div>
  );
};
