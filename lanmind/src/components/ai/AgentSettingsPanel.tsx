import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, FolderOpen, RefreshCw, Trash2, X, Wrench } from "lucide-react";
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
import { ScheduleSettingsPanel } from "./ScheduleSettingsPanel";
import { formMcpConfig, parseMcpJson, serializeMcpJson, validateMcpConnection } from "./mcpConfig";
import { EnabledSwitch } from "./EnabledSwitch";
const newMcp = (): Extension => ({
  id: "",
  kind: "mcp",
  name: "MCP",
  description: "",
  enabled: true,
  revision: 0,
  hasCredential: false,
  config: {
    transport: "http",
    url: "http://127.0.0.1:8000/mcp",
    command: "",
    args: [],
    enabledTools: [],
    readOnlyTools: [],
    trustedStdio: false,
  },
});
type DiscoveredTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};
export function AgentSettingsPanel({
  tab,
  catalog,
}: {
  tab: string;
  catalog: Catalog;
}) {
  useLocale();
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [draft, setDraft] = useState<Extension | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [environment, setEnvironment] = useState("");
  const [argsText, setArgsText] = useState("[]");
  const [mcpMode, setMcpMode] = useState<"form" | "json">("form");
  const [mcpJson, setMcpJson] = useState("");
  const [tools, setTools] = useState<DiscoveredTool[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState("");
  const load = useCallback(async () => {
    const [e, s] = await Promise.all([
      AI.call<Extension[]>("extensions"),
      AI.call<Schedule[]>("schedules"),
    ]);
    setExtensions(e);
    setSchedules(s);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(aiError(e)));
  }, [load]);
  useEffect(() => {
    setDraft(null);
    setSchedule(null);
    setTools([]);
    setError("");
    setNotice("");
  }, [tab]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(aiError(e));
    } finally {
      setBusy(false);
    }
  };
  const edit = (e: Extension) => {
    setDraft(structuredClone(e));
    setToken("");
    setClearToken(false);
    setEnvironment("");
    setArgsText(JSON.stringify(e.config.args ?? []));
    setMcpMode("form");
    setMcpJson("");
    setError("");
    setNotice("");
    setTools([]);
  };
  const switchMcpMode = (mode: "form" | "json") => {
    if (!draft || mode === mcpMode) return;
    setError("");
    try {
      if (mode === "json") {
        setMcpJson(serializeMcpJson(draft.name, draft.description,
          formMcpConfig(draft.config, argsText, environment), clearToken ? "" : token));
      } else {
        const parsed = parseMcpJson(mcpJson);
        const { env, ...connection } = parsed.config;
        setDraft({ ...draft, name: parsed.name ?? draft.name,
          description: parsed.description ?? draft.description,
          config: { ...draft.config, ...connection } });
        setArgsText(JSON.stringify(connection.args ?? [], null, 2));
        setEnvironment(env === undefined ? "" : JSON.stringify(env, null, 2));
        setToken(parsed.token ?? "");
        if (parsed.token) setClearToken(false);
      }
      setMcpMode(mode);
    } catch (e) {
      if (mcpMode !== "json") setError(aiError(e));
    }
  };
  const saveExtension = async (e: Extension, withSecret = false) => {
    let config = e.config;
    let name = e.name;
    let description = e.description;
    let credential = token;
    if (e.kind === "mcp" && withSecret) {
      if (mcpMode === "json") {
        const parsed = parseMcpJson(mcpJson);
        config = { ...config, ...parsed.config };
        name = parsed.name ?? name;
        description = parsed.description ?? description;
        credential = parsed.token ?? "";
      } else config = formMcpConfig(config, argsText, environment);
      if (!name.trim() || name.length > 160) throw new Error(tr("ai:v2.mcpInvalidField", { field: "name" }));
      validateMcpConnection(config);
    }
    const result = await AI.call<Extension>("extension.save", {
      id: e.id || null,
      expectedRevision: e.id ? e.revision : null,
      kind: e.kind,
      name,
      description,
      enabled: e.enabled,
      config,
      credentialChange: withSecret
        ? credential
          ? { action: "replace", value: credential }
          : clearToken
            ? { action: "clear" }
            : { action: "keep" }
        : { action: "keep" },
    });
    await load();
    if (withSecret) {
      edit(result);
      setNotice(tr("ai:v2.saved"));
    }
    return result;
  };
  const config = (patch: Record<string, unknown>) =>
    setDraft((e) => (e ? { ...e, config: { ...e.config, ...patch } } : e));
  const selected = (key: string) =>
    Array.isArray(draft?.config[key]) ? (draft!.config[key] as string[]) : [];
  const toggleTool = (key: string, name: string, checked: boolean) =>
    config({
      [key]: checked
        ? [...selected(key), name]
        : selected(key).filter((n) => n !== name),
    });
  const localDate = (iso: string) => {
    const date = new Date(iso);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  let jsonError = "";
  let jsonTransport = "";
  if (draft?.kind === "mcp" && mcpMode === "json") {
    try { jsonTransport = String(parseMcpJson(mcpJson).config.transport); }
    catch (e) { jsonError = aiError(e); }
  }
  const mcpTransport = mcpMode === "json" ? jsonTransport : draft?.config.transport;
  return (
    <div className="space-y-3">
      {error && !draft && (
        <p role="alert" className="ai-v2-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="ai-v2-success">
          {notice}
        </p>
      )}
      {tab === "skills" && (
        <>
          <p className="text-xs leading-5 text-sub">{tr("ai:v2.skillsHint")}</p>
          <button
            type="button"
            className="ai-v2-btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const path = await open({
                  directory: true,
                  multiple: false,
                  title: tr("ai:v2.importSkill"),
                });
                if (typeof path !== "string") return;
                await AI.call("skill.import", { path });
                await load();
                setNotice(tr("ai:v2.saved"));
              })
            }
          >
            <FolderOpen size={14} />
            {tr("ai:v2.importSkill")}
          </button>
        </>
      )}
      {tab === "mcp" && (
        <>
          <p className="text-xs leading-5 text-sub">{tr("ai:v2.mcpHint")}</p>
          <button
            type="button"
            className="ai-v2-btn"
            onClick={() => edit(newMcp())}
          >
            <Plus size={14} />
            {tr("ai:v2.addMcp")}
          </button>
        </>
      )}
      {(tab === "skills" || tab === "mcp") &&
        extensions
          .filter((e) => e.kind === (tab === "skills" ? "skill" : "mcp"))
          .map((e) => (
            <article key={e.id} className="ai-v2-card space-y-2">
              <div className="flex items-center gap-2">
                <strong className="flex-1 text-main">{e.name}</strong>
                <EnabledSwitch
                    checked={e.enabled}
                    disabled={busy}
                    label={tr("ai:v2.toggleNamed", { name: e.name })}
                    onChange={(enabled) =>
                      void run(async () => {
                        await saveExtension({
                          ...e,
                          enabled,
                        });
                      })
                    }
                />
                <button
                  type="button"
                  className="ai-v2-btn"
                  onClick={() => edit(e)}
                >
                  {tr("ai:v2.edit")}
                </button>
                {e.config.builtin !== true && (
                  <button
                    type="button"
                    className="ai-v2-btn"
                    disabled={busy}
                    aria-label={tr("ai:v2.delete")}
                    onClick={() => {
                      if (deleting !== e.id) {
                        setDeleting(e.id);
                        return;
                      }
                      void run(async () => {
                        await AI.call("extension.delete", {
                          id: e.id,
                          revision: e.revision,
                        });
                        if (draft?.id === e.id) setDraft(null);
                        await load();
                        setDeleting("");
                      });
                    }}
                  >
                    {deleting === e.id ? (
                      tr("ai:v2.confirmDelete")
                    ) : (
                      <Trash2 size={13} />
                    )}
                  </button>
                )}
              </div>
              <p className="text-xs text-sub">
                {e.description ||
                  String(e.config.url || e.config.command || "")}
              </p>
              {e.kind === "skill" && (
                <small className="font-mono text-quiet">
                  {String(e.config.version || "").slice(0, 16)}
                </small>
              )}
              {e.kind === "mcp" && (
                <div className="mt-1.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-quiet">
                    <span>{tr("ai:v2.allowedTools")}</span>
                    <span className="rounded bg-muted/60 px-1 py-0.2 text-[10px] font-mono">
                      {((e.config.enabledTools as string[]) || []).length}
                    </span>
                  </div>
                  {((e.config.enabledTools as string[]) || []).length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {((e.config.enabledTools as string[]) || []).map((toolName) => (
                        <span
                          key={toolName}
                          className="inline-flex items-center gap-1 rounded bg-accent/10 border border-accent/20 px-1.5 py-0.5 font-mono text-[10px] text-accent"
                          title={toolName}
                        >
                          <Wrench size={8} />
                          <span className="truncate max-w-[140px]">{toolName}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-quiet italic">—</span>
                  )}
                </div>
              )}
            </article>
          ))}
      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setDraft(null);
          }}
        >
          <div className="relative flex max-h-[90vh] w-[720px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-strong animate-in zoom-in-95 duration-150">
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between border-b border-edge px-6 py-4 bg-canvas/30">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-bold text-main">
                  {draft.kind === "skill"
                    ? (draft.id ? tr("ai:agentSettings.editSkillTitle", { name: draft.name }) : tr("ai:agentSettings.newSkillTitle"))
                    : (draft.id ? tr("ai:agentSettings.editMcpTitle", { name: draft.name }) : tr("ai:agentSettings.newMcpTitle"))}
                </span>
                <span className="rounded bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent uppercase font-mono">
                  {draft.kind}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={busy}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors"
                title={tr("ai:schedules.close")}
              >
                <X size={16} />
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 scrollbar-thin">
              <fieldset disabled={busy} className="space-y-4 text-xs border-0 p-0 m-0 min-w-0">
          {error && <p role="alert" className="ai-v2-error">{error}</p>}
          <div className="flex items-center justify-between gap-4 rounded-lg border border-edge p-3">
            <div className="space-y-1">
              <span className="font-semibold text-main">{tr("ai:v2.enableConfiguration")}</span>
              <p className="text-[11px] text-quiet">{tr("ai:v2.extensionEnabledHint")}</p>
            </div>
            <EnabledSwitch checked={draft.enabled} disabled={busy}
              label={tr("ai:v2.enableConfiguration")}
              onChange={(enabled) => setDraft({ ...draft, enabled })} />
          </div>
          {draft.kind === "mcp" && (
            <div role="group" aria-label={tr("ai:v2.mcpConfigMode")} className="flex gap-1 rounded-lg border border-edge bg-canvas p-1">
              {(["form", "json"] as const).map((mode) => (
                <button key={mode} type="button" aria-pressed={mcpMode === mode}
                  className={`ai-v2-tab flex-1 ${mcpMode === mode ? "is-active" : ""}`}
                  onClick={() => switchMcpMode(mode)}>
                  {mode === "form" ? tr("ai:v2.mcpFormMode") : tr("ai:v2.mcpJsonMode")}
                </button>
              ))}
            </div>
          )}
          {(draft.kind === "skill" || mcpMode === "form") && <>
          <label className="ai-v2-label">
            {tr("ai:v2.connectionName")}
            <input
              className="ai-v2-input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="ai-v2-label">
            {tr("ai:v2.description")}
            <input
              className="ai-v2-input"
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          </>}
          {draft.kind === "skill" ? (
            <>
              <details open>
                <summary className="text-xs text-sub">SKILL.md</summary>
                <textarea
                  className="ai-v2-input mt-2 min-h-52 font-mono"
                  value={String(draft.config.body || "")}
                  onChange={(e) => config({ body: e.target.value })}
                />
              </details>
              <p className="text-[11px] text-quiet">
                {tr("ai:v2.skillSnapshotHint")}
              </p>
              <details>
                <summary className="text-xs text-sub">
                  {tr("ai:v2.references")}
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-sub">
                  {Object.keys((draft.config.files as object) || {}).map(
                    (path) => (
                      <li key={path}>{path}</li>
                    ),
                  )}
                </ul>
              </details>
            </>
          ) : (
            <>
              {mcpMode === "json" ? (
                <div className="space-y-2">
                  <label className="ai-v2-label">
                    {tr("ai:v2.mcpJsonConfig")}
                    <textarea className="ai-v2-input min-h-64 resize-y font-mono leading-5"
                      rows={12} spellCheck={false} autoComplete="off"
                      value={mcpJson} aria-invalid={!!jsonError}
                      aria-describedby="mcp-json-hint mcp-json-error"
                      onChange={(event) => {
                        setMcpJson(event.target.value);
                        setError("");
                        try { if (parseMcpJson(event.target.value).token) setClearToken(false); }
                        catch { /* Keep the text while the JSON is incomplete. */ }
                      }} />
                  </label>
                  <p id="mcp-json-hint" className="text-[11px] leading-5 text-quiet">{tr("ai:v2.mcpJsonHint")}</p>
                  <p id="mcp-json-error" role={jsonError ? "alert" : undefined} className={jsonError ? "ai-v2-error" : "hidden"}>{jsonError}</p>
                </div>
              ) : <>
              <label className="ai-v2-label">
                {tr("ai:v2.transport")}
                <ThemeSelect
                  portal
                  value={String(draft.config.transport || "http")}
                  options={[
                    { value: "http", label: "HTTP (Streamable)", tone: "blue" },
                    { value: "stdio", label: "stdio (Subprocess)", tone: "amber" },
                  ]}
                  onChange={(transport) => config({ transport })}
                  ariaLabel={tr("ai:v2.transport")}
                />
              </label>
              {draft.config.transport === "http" ? (
                <>
                  <label className="ai-v2-label">
                    URL
                    <input
                      className="ai-v2-input"
                      value={String(draft.config.url || "")}
                      onChange={(e) => config({ url: e.target.value })}
                    />
                  </label>
                  <label className="ai-v2-label">
                    Bearer token
                    <input
                      type="password"
                      autoComplete="new-password"
                      className="ai-v2-input"
                      value={token}
                      placeholder={
                        draft.hasCredential
                          ? tr("ai:v2.credentialSaved")
                          : tr("ai:v2.credentialOptional")
                      }
                      onChange={(e) => {
                        setToken(e.target.value);
                        setClearToken(false);
                      }}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="ai-v2-label">
                    {tr("ai:v2.executable")}
                    <input
                      className="ai-v2-input font-mono"
                      value={String(draft.config.command || "")}
                      onChange={(e) => config({ command: e.target.value })}
                    />
                  </label>
                  <label className="ai-v2-label">
                    {tr("ai:v2.arguments")}
                    <textarea
                      rows={4}
                      className="ai-v2-input font-mono min-h-[96px] resize-y"
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                    />
                  </label>
                  <label className="ai-v2-label">
                    {tr("ai:v2.workingDirectory")}
                    <input
                      className="ai-v2-input"
                      value={String(draft.config.cwd || "")}
                      onChange={(e) => config({ cwd: e.target.value })}
                    />
                  </label>
                  <label className="ai-v2-label">
                    {tr("ai:v2.environment")}
                    <textarea
                      rows={4}
                      className="ai-v2-input font-mono min-h-[96px] resize-y"
                      value={environment}
                      onChange={(e) => setEnvironment(e.target.value)}
                      placeholder={JSON.stringify(
                        draft.config.environmentKeys || [],
                      )}
                    />
                  </label>
                </>
              )}
              </>}
              {mcpTransport === "http" && draft.hasCredential && (
                <label className="ai-v2-check">
                  <input type="checkbox" checked={clearToken}
                    onChange={(event) => {
                      setClearToken(event.target.checked);
                      setToken("");
                      if (event.target.checked && mcpMode === "json") {
                        const parsed = parseMcpJson(mcpJson);
                        setMcpJson(serializeMcpJson(parsed.name ?? draft.name,
                          parsed.description ?? draft.description, parsed.config, ""));
                      }
                    }} />
                  {tr("ai:v2.clearCredential")}
                </label>
              )}
              {mcpTransport === "stdio" && (
                <div className="space-y-2">
                  <p className="text-xs leading-5 text-warning">{tr("ai:v2.stdioTrustHint")}</p>
                  <label className="ai-v2-check">
                    <input
                      type="checkbox"
                      checked={draft.config.trustedStdio === true}
                      onChange={(e) =>
                        config({ trustedStdio: e.target.checked })
                      }
                    />
                    {tr("ai:v2.trustStdio")}
                  </label>
                </div>
              )}
              <button
                type="button"
                className="ai-v2-btn"
                disabled={!draft.id}
                onClick={() =>
                  void run(async () => {
                    const result = await AI.call<DiscoveredTool[]>(
                      "mcp.discover",
                      { id: draft.id },
                    );
                    setTools(result);
                    setNotice(tr("ai:v2.discovered", { count: result.length }));
                  })
                }
              >
                <RefreshCw size={14} />
                {tr("ai:v2.discoverTools")}
              </button>
              <p className="text-[11px] text-quiet">
                {tr("ai:v2.mcpDiscoveryHint")}
              </p>
              {[
                ...new Set([
                  ...tools.map((t) => t.name),
                  ...selected("enabledTools"),
                ]),
              ].map((name) => (
                <div
                  className="rounded-lg border border-subtle p-2 space-y-2"
                  key={name}
                >
                  <label className="ai-v2-check">
                    <input
                      type="checkbox"
                      checked={selected("enabledTools").includes(name)}
                      onChange={(e) =>
                        toggleTool("enabledTools", name, e.target.checked)
                      }
                    />
                    <strong className="font-mono text-main">{name}</strong>
                  </label>
                  <p className="text-[11px] text-sub">
                    {tools.find((t) => t.name === name)?.description}
                  </p>
                  <label className="ai-v2-check">
                    <input
                      type="checkbox"
                      checked={selected("readOnlyTools").includes(name)}
                      onChange={(e) =>
                        toggleTool("readOnlyTools", name, e.target.checked)
                      }
                    />
                    {tr("ai:v2.trustReadOnly")}
                  </label>
                </div>
              ))}
            </>
          )}
              </fieldset>
            </div>

            {/* 弹窗底部操作栏 */}
            <div className="flex items-center justify-end gap-2.5 border-t border-edge bg-canvas/40 px-6 py-3.5">
              <button
                type="button"
                className="rounded-xl border border-edge bg-surface px-4 py-2 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-50"
                onClick={() => setDraft(null)}
                disabled={busy}
              >
                {tr("ai:v2.cancel")}
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-colors disabled:opacity-50 shadow-soft"
                disabled={busy || (draft.kind === "mcp" && mcpMode === "json" ? !!jsonError : !draft.name.trim())}
                onClick={() =>
                  void run(async () => {
                    await saveExtension(draft, true);
                    setDraft(null);
                  })
                }
              >
                {busy && <RefreshCw size={13} className="animate-spin" />}
                <span>{tr("ai:v2.save")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {tab === "schedules" && <ScheduleSettingsPanel catalog={catalog} />}
      {busy && (
        <p role="status" className="text-xs text-sub">
          {tr("ai:v2.working")}
        </p>
      )}
    </div>
  );
}
