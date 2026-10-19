/**
 * ModelProvidersPanel — 模型供应商管理面板（已配置供应商面板、快捷预设卡片、上游发现与模型标签管理）。
 *
 * CALLING SPEC:
 *   <ModelProvidersPanel />
 */

import React, { useCallback, useEffect, useState, useMemo } from "react";
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
import { ThemeSelect, ThemeSelectOption } from "../ThemeSelect";
import {
  AI_ASSISTANT_NAME_MAX_LENGTH,
  getAIAssistantName,
  onAIAssistantNameChange,
  setAIAssistantName,
} from "../../utils/aiAssistant";
import { PRESETS, ProviderPresetGrid } from "./ProviderPresets";

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
  const [catalog, setCatalog] = useState<Catalog>({ schemaVersion: 2, connections: [], defaults: {} });
  const [draft, setDraft] = useState<Connection | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const [busy, setBusy] = useState(false);
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
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    setDraft(structuredClone(conn));
    setIsCreating(false);
    setKeyInput("");
    setClearKey(false);
    setCustomModelInput("");
    setError("");
    setNotice("");
  };

  // 取消编辑
  const cancelEdit = () => {
    setDraft(null);
    setIsCreating(false);
    setError("");
    setNotice("");
  };

  // 保存当前编辑的供应商
  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("供应商名称不能为空");
      return;
    }
    if (!draft.baseUrl.trim()) {
      setError("接口地址 (Base URL) 不能为空");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const saved = await AI.call<Connection>("connection.save", {
        id: draft.id || null,
        expectedRevision: draft.id ? draft.revision : null,
        name: draft.name.trim(),
        providerType: draft.providerType,
        baseUrl: draft.baseUrl.trim(),
        enabled: draft.enabled,
        bound: draft.bound,
        parameters: draft.parameters,
        models: draft.models,
        credentialChange: clearKey
          ? { action: "clear" }
          : keyInput
          ? { action: "replace", value: keyInput }
          : { action: "keep" },
      });

      await loadCatalog();
      setDraft(saved);
      setKeyInput("");
      setClearKey(false);
      setIsCreating(false);
      setNotice(`模型供应商「${saved.name}」已成功保存`);
      setTimeout(() => setNotice(""), 3000);
    } catch (e) {
      setError(aiError(e));
    } finally {
      setBusy(false);
    }
  };

  // 删除供应商
  const handleDeleteConnection = async (conn: Connection) => {
    if (deletingId !== conn.id) {
      setDeletingId(conn.id);
      return;
    }

    setBusy(true);
    setError("");
    try {
      await AI.call("connection.delete", {
        id: conn.id,
        revision: conn.revision,
      });
      await loadCatalog();
      if (draft?.id === conn.id) setDraft(null);
      setDeletingId(null);
      setNotice(`已删除模型供应商: ${conn.name}`);
      setTimeout(() => setNotice(""), 3000);
    } catch (e) {
      setError(aiError(e));
    } finally {
      setBusy(false);
    }
  };

  // 从上游获取模型
  const handleFetchUpstreamModels = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      // 若当前尚未保存，先静默保存生成 ID 再执行发现
      let connId = draft.id;
      if (!connId) {
        const saved = await AI.call<Connection>("connection.save", {
          id: null,
          expectedRevision: null,
          name: draft.name.trim() || "未命名渠道",
          providerType: draft.providerType,
          baseUrl: draft.baseUrl.trim(),
          enabled: draft.enabled,
          bound: draft.bound,
          parameters: draft.parameters,
          models: draft.models,
          credentialChange: keyInput ? { action: "replace", value: keyInput } : { action: "keep" },
        });
        connId = saved.id;
        setDraft(saved);
        await loadCatalog();
      }

      const discoveredIds = await AI.call<string[]>("connection.discover", { id: connId });
      setFetchModalData({
        isOpen: true,
        availableIds: discoveredIds || [],
      });
    } catch (e) {
      setError(`从上游获取模型失败: ${aiError(e)}`);
    } finally {
      setBusy(false);
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
    setNotice(`已选择 ${nextModels.length} 个可用模型`);
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
      { value: "ollama", label: "Ollama (本地框架)", tone: "amber" },
      { value: "vllm", label: "vLLM (高性能服务)", tone: "blue" },
      { value: "sglang", label: "SGLang (结构化高并发)", tone: "emerald" },
      { value: "openai-compatible", label: "OpenAI 兼容 (通用接口)", tone: "slate" },
    ],
    []
  );

  const initialSelectedModelIds = useMemo(
    () => draft?.models.map((m) => m.remoteModelId) || [],
    [draft?.models]
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 顶部：AI 助手名称配置卡片 */}
      <section aria-labelledby="ai-assistant-heading" className="rounded-2xl border border-edge bg-surface/80 p-4 shadow-soft">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 text-accent font-bold">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h4 id="ai-assistant-heading" className="text-xs font-bold text-main flex items-center gap-2">
                <span>AI 助手配置</span>
                <span className="rounded-full bg-accent/15 px-2 py-0.2 text-[10px] font-semibold text-accent">全局助手</span>
              </h4>
              <p className="text-[11px] text-quiet mt-0.5">设定对话界面中助手的称谓名称，实时在聊天标题与问答中呈现</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
              className="w-48 rounded-xl border border-edge bg-canvas px-3 py-1.5 text-xs text-main placeholder:text-quiet focus:border-accent focus:outline-none"
            />
            {assistantNameDraft && (
              <button
                type="button"
                onClick={() => {
                  setAssistantNameDraft("");
                  setAIAssistantName("");
                }}
                className="flex h-8 items-center gap-1 rounded-xl border border-edge bg-canvas px-2 text-[11px] font-semibold text-sub hover:bg-hover hover:text-main transition-colors"
                title="恢复默认助手名称"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>重置</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 状态与通知消息 */}
      {error && (
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
      {draft ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) cancelEdit();
          }}
        >
          <div className="relative flex max-h-[90vh] w-[740px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-strong animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-edge px-6 py-4 bg-canvas/30">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-main">
                {isCreating ? "新建模型供应商" : `编辑模型供应商: ${draft.name}`}
              </span>
              <span className="rounded bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent uppercase">
                {draft.providerType}
              </span>
            </div>
            <button
              type="button"
              onClick={cancelEdit}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4 text-xs scrollbar-thin">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-sub block mb-1">供应商类型</label>
                <ThemeSelect
                  portal
                  value={draft.providerType}
                  options={providerTypeOptions}
                  onChange={(val) => setDraft({ ...draft, providerType: val })}
                  ariaLabel="供应商类型"
                />
              </div>

              <div>
                <label className="font-semibold text-sub block mb-1">供应商名称</label>
                <input
                  type="text"
                  value={draft.name}
                  aria-label={tr("ai:v2.connectionName")}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="例如: 本地 Ollama、DeepSeek 官方 API"
                  className="w-full rounded-xl border border-edge bg-canvas px-3 py-2 text-xs text-main focus:border-accent focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-sub block mb-1">接口地址 (Base URL)</label>
              <input
                type="text"
                value={draft.baseUrl}
                aria-label={tr("ai:v2.baseUrl")}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder="例如: http://127.0.0.1:11434/v1"
                className="w-full font-mono rounded-xl border border-edge bg-canvas px-3 py-2 text-xs text-main focus:border-accent focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold text-sub">API 密钥 (API Key)</label>
                {draft.hasCredential && (
                  <span className="text-[11px] text-success flex items-center gap-1 font-semibold">
                    <Check className="w-3 h-3" /> 已加密保存凭据
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  aria-label={tr("ai:v2.apiKey")}
                  disabled={clearKey}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={clearKey ? tr("ai:v2.clearCredential") : draft.hasCredential ? tr("ai:v2.credentialSaved") : tr("ai:v2.credentialOptional")}
                  className="flex-1 font-mono rounded-xl border border-edge bg-canvas px-3 py-2 text-xs text-main focus:border-accent focus:outline-none disabled:opacity-40"
                />
                {draft.hasCredential && (
                  <button
                    type="button"
                    onClick={() => {
                      setClearKey(!clearKey);
                      setKeyInput("");
                    }}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold border transition-colors ${
                      clearKey
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-edge bg-canvas text-sub hover:bg-hover hover:text-main"
                    }`}
                  >
                    {clearKey ? "取消清除" : "清除密钥"}
                  </button>
                )}
              </div>
            </div>

            {/* 模型列表管理 (参考 Image 2) */}
            <div className="rounded-2xl border border-edge bg-canvas/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-main text-xs">模型列表 *</span>
                    <span className="rounded-full bg-card px-2 py-0.2 text-[10px] text-quiet font-mono border border-edge/60">
                      已选 {draft.models.length} 个
                    </span>
                  </div>
                  <p className="text-[11px] text-quiet mt-0.5">
                    此渠道支持的模型列表。点击下方从上游自动获取，或直接手动添加。
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleFetchUpstreamModels}
                    className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-colors disabled:opacity-50 shadow-soft"
                  >
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    <span>从上游获取模型</span>
                  </button>

                  {draft.models.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllModels}
                      className="rounded-xl border border-edge bg-surface px-2.5 py-1.5 text-xs font-semibold text-quiet hover:text-danger hover:border-danger/30 transition-colors"
                      title="清空当前所有选中的模型"
                    >
                      清除所有模型
                    </button>
                  )}
                </div>
              </div>

              {/* 选中的模型标签流 (Tag Chips Cloud, 参考 Image 2) */}
              <div className="min-h-16 rounded-xl border border-edge bg-surface p-3 flex flex-wrap items-center gap-1.5">
                {draft.models.length === 0 ? (
                  <span className="text-quiet text-xs">
                    暂未配置可用模型，请点击右上方「从上游获取模型」进行勾选，或在下方手动输入添加
                  </span>
                ) : (
                  draft.models.map((m) => (
                    <span
                      key={m.id || m.remoteModelId}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-canvas px-2.5 py-1 text-xs font-mono text-main hover:border-accent/40 transition-colors"
                    >
                      <span>{m.displayName || m.remoteModelId}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveModel(m.remoteModelId)}
                        className="text-quiet hover:text-danger transition-colors"
                        title="移除模型"
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
                  placeholder="手动输入模型 ID (如 gpt-4o, qwen2.5:14b) 并回车添加..."
                  className="flex-1 font-mono rounded-xl border border-edge bg-surface px-3 py-1.5 text-xs text-main focus:border-accent focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!customModelInput.trim()}
                  className="rounded-xl border border-edge bg-surface px-3 py-1.5 text-xs font-semibold text-sub hover:bg-hover hover:text-main disabled:opacity-40 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>

          {/* 弹窗底部操作栏 */}
          <div className="flex items-center justify-end gap-2.5 border-t border-edge bg-canvas/40 px-6 py-3.5">
            <button
              type="button"
              disabled={busy}
              onClick={cancelEdit}
              className="rounded-xl border border-edge bg-surface px-4 py-2 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={saveDraft}
              className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-colors disabled:opacity-50 shadow-soft"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>保存供应商</span>
            </button>
          </div>
        </div>
      </div>
      ) : null}

      {/* ===================== 上半部分：已配置的模型供应商卡片列表 ===================== */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-main">已配置供应商</h3>
            <span className="rounded-full bg-accent/15 px-2 py-0.2 text-xs font-mono font-bold text-accent">
              {catalog.connections.length}
            </span>
          </div>
        </div>

        {catalog.connections.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-edge bg-canvas/30 p-8 text-center text-xs text-quiet">
            <p>暂未添加任何模型供应商连接</p>
            <p className="mt-1 text-[11px]">请在下方选择常用预设面板快速创建</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3.5">
            {catalog.connections.map((c) => {
              const presetInfo = PRESETS[c.providerType] || { icon: "⚙️", badge: "自定义" };
              const isDeleting = deletingId === c.id;

              return (
                <div
                  key={c.id}
                  className="group relative flex flex-col justify-between rounded-2xl border border-edge bg-surface p-4 shadow-soft hover:border-accent/40 transition-all"
                >
                  <div>
                    {/* 卡片头部 */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">{presetInfo.icon}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-main text-xs">{c.name}</span>
                            <span className="rounded bg-accent/15 px-1.5 py-0.2 text-[10px] font-semibold text-accent uppercase">
                              {c.providerType}
                            </span>
                          </div>
                          <span className="text-[11px] text-quiet font-mono truncate max-w-[240px] block" title={c.baseUrl}>
                            {c.baseUrl}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          c.enabled
                            ? "bg-success/15 text-success border border-success/20"
                            : "bg-canvas text-quiet border border-edge"
                        }`}
                      >
                        {c.enabled ? "已启用" : "已停用"}
                      </span>
                    </div>

                    {/* 卡片中间：模型数量与预览 tags */}
                    <div className="my-2.5 flex flex-wrap gap-1 items-center">
                      <span className="rounded-md bg-card px-2 py-0.5 text-[11px] font-mono text-sub border border-edge/60">
                        {c.models.length} 个模型
                      </span>
                      {c.models.slice(0, 3).map((m) => (
                        <span
                          key={m.id || m.remoteModelId}
                          className="rounded-md bg-canvas px-1.5 py-0.5 text-[10px] font-mono text-quiet truncate max-w-[120px]"
                          title={m.remoteModelId}
                        >
                          {m.displayName || m.remoteModelId}
                        </span>
                      ))}
                      {c.models.length > 3 && (
                        <span className="text-[10px] text-quiet font-mono">+{c.models.length - 3}</span>
                      )}
                    </div>
                  </div>

                  {/* 卡片右下角操作按钮：测试、编辑、删除（仅图标） */}
                  <div className="flex items-center justify-end gap-1.5 border-t border-edge/60 pt-2.5 mt-2">
                    {/* 测试按钮 */}
                    <button
                      type="button"
                      onClick={() => setTestModalConnection(c)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-edge bg-canvas/60 text-sub hover:bg-hover hover:text-accent hover:border-accent/40 transition-colors"
                      title="测试连接与模型可用性"
                    >
                      <Gauge className="w-3.5 h-3.5" />
                    </button>

                    {/* 编辑按钮 */}
                    <button
                      type="button"
                      onClick={() => startEditConnection(c)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-edge bg-canvas/60 text-sub hover:bg-hover hover:text-main transition-colors"
                      title="编辑供应商"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    {/* 删除按钮 */}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDeleteConnection(c)}
                      className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${
                        isDeleting
                          ? "border-danger bg-danger text-on-accent animate-pulse"
                          : "border-edge bg-canvas/60 text-sub hover:bg-danger/10 hover:text-danger hover:border-danger/30"
                      }`}
                      title={isDeleting ? "再次点击确认删除" : "删除供应商"}
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
            添加新的模型供应商 · 选择快捷预设
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
    </div>
  );
};
