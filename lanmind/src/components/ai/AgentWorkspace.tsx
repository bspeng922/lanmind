import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Bot,
  PanelLeftOpen,
  Paperclip,
  ArrowUp,
  Square,
  FolderPlus,
  X,
  RefreshCw,
  Copy,
  Check,
  FileText,
  Pencil,
  Loader2,
  Settings2,
  Share2,
  ChevronDown,
  Wrench,
  MessageSquare,
  Folder,
  Sparkles,
  Boxes,
  FolderLock,
  BookOpen,
  CheckSquare,
} from "lucide-react";
import type { Project, Task, User } from "../../types";
import { tr, useLocale } from "../../i18n";
import {
  getWorkspaceContext,
  sameWorkspace,
} from "../../utils/workspaceContext";
import {
  AI,
  activeRun,
  aiError,
  modelKey,
  parseModelKey,
  type Bootstrap,
  type Conversation,
  type Message,
  type View,
  type Run,
  type Root,
  type AIEvent,
  type RunRequest,
  type ToolCall,
  type Artifact,
} from "./aiClient";
import { GroupedModelSelect, detectModelBrand, BrandIcon } from "./GroupedModelSelect";
import { AIConversationList } from "./AIConversationList";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { ModelSettingsPanel } from "./ModelSettingsPanel";
import { AIShareModal } from "./AIShareModal";
import { useAssistantName } from "./useAssistantName";
import { ThemeSelect } from "../ThemeSelect";
import "./ai-v2.css";
import { BusinessPreview, BusinessToolResult, businessTools } from "./BusinessToolResult";

interface Props {
  tasks: Task[];
  projects: Project[];
  currentUser: User;
  workspaceId?: string | null;
  initialConversationId?: string | null;
  onOpenCreateTask?: (initialTitle?: string, initialDescription?: string) => void;
  onOpenCreateWiki?: (initialContent: string, initialTitle?: string) => void | Promise<void>;
  onOpenReport?: () => void;
}

function extractTitleFromMarkdown(content: string, fallback: string = "未命名文档"): string {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return fallback;
  for (const line of lines) {
    const cleanHeading = line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
    if (cleanHeading && cleanHeading.length > 0) {
      return cleanHeading.slice(0, 50);
    }
  }
  return lines[0].replace(/[*_`]/g, '').trim().slice(0, 50) || fallback;
}
const empty: Bootstrap = {
  schemaVersion: 2,
  catalog: { schemaVersion: 2, connections: [], defaults: {} },
  conversations: [],
  extensions: [],
  schedules: [],
  roots: [],
};
const uid = () => crypto.randomUUID();
const ToolCard: React.FC<{
  call: ToolCall;
  run: Run;
  onDecision: (run: Run, call: ToolCall, decision: unknown) => Promise<void>;
}> = ({ call, run, onDecision }) => {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const waiting =
    ["waiting_approval", "waiting_input"].includes(call.status) &&
    activeRun(run);

  // 大模型的工具消息默认收缩起来，点击后再展开；如果处于等待审批/输入状态，自动展开方便交互
  const [isExpanded, setIsExpanded] = useState(waiting);

  useEffect(() => {
    if (waiting) {
      setIsExpanded(true);
    }
  }, [waiting]);

  const result = call.result as {
    before?: string;
    after?: string;
    question?: string;
    path?: string;
    action?: string;
  } | null;

  const decide = async (decision: unknown) => {
    setBusy(true);
    setError("");
    try {
      await onDecision(run, call, decision);
    } catch (e) {
      setError(aiError(e));
      setBusy(false);
    }
  };

  const toolDisplayName = businessTools.has(call.name)
    ? tr(`ai:business.tool_${call.name}`)
    : call.name;

  return (
    <div className="ai-v2-tool" data-status={call.status}>
      {/* 头部：可点击折叠/展开 */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-hover/60 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Wrench className="h-3.5 w-3.5 text-quiet shrink-0" />
          <strong className="text-xs text-main truncate">{toolDisplayName}</strong>
          <span
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${
              call.status === "completed"
                ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                : call.status === "running"
                ? "bg-accent/10 text-accent border border-accent/20"
                : call.status === "outcome_unknown"
                ? "bg-warning/10 text-warning border border-warning/20"
                : waiting
                ? "bg-accent/15 text-accent font-semibold border border-accent/30 animate-pulse"
                : "bg-surface text-quiet border border-edge"
            }`}
          >
            {tr(`ai:v2.status_${call.status}`)}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0 text-quiet">
          <span className="text-[11px] text-quiet/70">
            {isExpanded ? tr("common:labels.collapse") : tr("common:labels.expand")}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-150 ${
              isExpanded ? "rotate-180 text-main" : ""
            }`}
          />
        </div>
      </button>

      {/* 展开内容 */}
      {isExpanded && (
        <div className="border-t border-edge/60 px-3 py-2.5 space-y-2 bg-canvas/30 text-xs">
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] text-sub select-none hover:text-main font-medium">
              {tr("ai:v2.arguments")}
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-canvas p-2 font-mono text-[11px] text-sub border border-edge/50">
              {JSON.stringify(call.arguments, null, 2)}
            </pre>
          </details>

          {waiting && call.status === "waiting_approval" && (
            <div className="mt-2 space-y-2 rounded-lg bg-surface p-2.5 border border-edge/60">
              <p className="text-xs text-sub">{tr("ai:v2.approvalHint")}</p>
              {call.preview && <BusinessPreview value={call.preview} />}
              {result?.path && (
                <p className="font-mono text-xs">
                  {result.action} · {result.path}
                </p>
              )}
              {typeof result?.before === "string" && (
                <details open className="mt-1">
                  <summary className="text-xs text-sub select-none">
                    {tr("ai:v2.before")}
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-canvas p-2 font-mono text-xs border border-edge/40">
                    {result.before}
                  </pre>
                </details>
              )}
              {typeof result?.after === "string" && (
                <details open className="mt-1">
                  <summary className="text-xs text-sub select-none">
                    {tr("ai:v2.after")}
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-canvas p-2 font-mono text-xs border border-edge/40">
                    {result.after}
                  </pre>
                </details>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  className="ai-v2-btn primary"
                  disabled={busy}
                  onClick={() => void decide({ approved: true })}
                >
                  {tr("ai:v2.approve")}
                </button>
                <button
                  type="button"
                  className="ai-v2-btn"
                  disabled={busy}
                  onClick={() => void decide({ approved: false })}
                >
                  {tr("ai:v2.reject")}
                </button>
              </div>
            </div>
          )}

          {waiting && call.status === "waiting_input" && (
            <div className="mt-2 space-y-2 rounded-lg bg-surface p-2.5 border border-edge/60">
              <p className="text-xs font-medium text-main">{result?.question}</p>
              <textarea
                aria-label={tr("ai:v2.answer")}
                className="ai-v2-input w-full"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
              <button
                type="button"
                className="ai-v2-btn primary"
                disabled={busy || !answer.trim()}
                onClick={() => void decide({ answer })}
              >
                {tr("ai:v2.submitAnswer")}
              </button>
            </div>
          )}

          {!waiting && call.status === "completed" && businessTools.has(call.name) && (
            <BusinessToolResult
              name={call.name}
              value={call.result}
              labels={call.preview?.labels}
            />
          )}

          {!waiting && call.result != null && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-sub select-none hover:text-main font-medium">
                {tr("ai:v2.result")}
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-canvas p-2 font-mono text-[11px] text-sub border border-edge/50">
                {JSON.stringify(call.result, null, 2)}
              </pre>
            </details>
          )}

          {call.status === "outcome_unknown" && (
            <p className="mt-1 text-xs text-warning">
              {tr("ai:v2.outcomeUnknown")}
            </p>
          )}

          {error && (
            <p role="alert" className="ai-v2-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
export const AgentWorkspace: React.FC<Props> = ({
  currentUser,
  workspaceId,
  initialConversationId,
  onOpenCreateTask,
  onOpenCreateWiki,
  onOpenReport,
}) => {
  useLocale();
  const assistantName = useAssistantName();
  const [data, setData] = useState<Bootstrap>(empty);
  const [view, setView] = useState<View | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("chat");
  const [model, setModel] = useState("");

  const activeModelInfo = useMemo(() => {
    if (!model) return null;
    for (const c of data.catalog.connections) {
      for (const m of c.models) {
        const key = modelKey({ connectionId: c.id, modelEntryId: m.id });
        if (key === model) {
          const brandMeta = detectModelBrand(m.displayName || m.remoteModelId, c.name);
          return {
            displayName: m.displayName || m.remoteModelId,
            connectionName: c.name,
            brandMeta,
            hasTools: m.capabilities.tools === true,
          };
        }
      }
    }
    const fallbackName = model.includes(":") ? model.split(":").slice(1).join(":") : model;
    return {
      displayName: fallbackName,
      connectionName: "",
      brandMeta: detectModelBrand(fallbackName),
      hasTools: false,
    };
  }, [model, data.catalog.connections]);
  const [skills, setSkills] = useState<string[]>([]);
  const [mcp, setMcp] = useState<string[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [allowCreate, setAllowCreate] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [settings, setSettings] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<
    {
      conversation: Conversation;
      scope: "title" | "message";
      snippet: string;
    }[]
  >([]);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [attachments, setAttachments] = useState<
    { id: string; name: string; text: string }[]
  >([]);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
  const [mcpMenuOpen, setMcpMenuOpen] = useState(false);
  const [rootsMenuOpen, setRootsMenuOpen] = useState(false);
  const [wikiSavedMessageId, setWikiSavedMessageId] = useState("");

  const modeMenuRef = useRef<HTMLDivElement>(null);
  const skillsMenuRef = useRef<HTMLDivElement>(null);
  const mcpMenuRef = useRef<HTMLDivElement>(null);
  const rootsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!skillsMenuOpen && !mcpMenuOpen && !rootsMenuOpen && !modeMenuOpen) return;
    const handleOutside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (skillsMenuRef.current && !skillsMenuRef.current.contains(target)) setSkillsMenuOpen(false);
      if (mcpMenuRef.current && !mcpMenuRef.current.contains(target)) setMcpMenuOpen(false);
      if (rootsMenuRef.current && !rootsMenuRef.current.contains(target)) setRootsMenuOpen(false);
      if (modeMenuRef.current && !modeMenuRef.current.contains(target)) setModeMenuOpen(false);
    };
    document.addEventListener("pointerdown", handleOutside, true);
    return () => document.removeEventListener("pointerdown", handleOutside, true);
  }, [skillsMenuOpen, mcpMenuOpen, rootsMenuOpen, modeMenuOpen]);
  const [extracting, setExtracting] = useState(false);
  const [copied, setCopied] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const alive = useRef(true);
  const sending = useRef(false);
  const pending = useRef<RunRequest | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const loadCounter = useRef(0);
  const currentRun = view?.runs.find(activeRun);
  const busy = !!currentRun || submitting;
  const refreshList = useCallback(async () => {
    const conversations = await AI.call<Conversation[]>("conversations");
    if (alive.current) setData((d) => ({ ...d, conversations }));
  }, []);
  const refreshView = useCallback(async (id: string, poll = false) => {
    const known = viewRef.current;
    const last = known?.runs[0];
    const counter = ++loadCounter.current;
    const next = await AI.call<View | null>(
      poll ? "conversation.poll" : "conversation.view",
      {
        id,
        ...(poll
          ? {
              knownRevision: known?.conversation.revision,
              knownRunId: last?.id ?? null,
              knownRunSeq: last?.seq ?? null,
            }
          : {}),
      },
    );
    if (!next) return;
    if (
      !alive.current ||
      counter !== loadCounter.current ||
      activeIdRef.current !== id
    )
      return;
    setView((old) => {
      const running = old?.runs.find(activeRun);
      const incoming = next.runs.find((r) => r.id === running?.id);
      if (
        old?.conversation.id === id &&
        running &&
        incoming &&
        running.seq > incoming.seq
      )
        return old;
      return next;
    });
  }, []);
  const select = useCallback(
    (id: string | null) => {
      activeIdRef.current = id;
      setActiveId(id);
      setView(null);
      setError("");
      if (id) void refreshView(id).catch((e) => setError(aiError(e)));
    },
    [refreshView],
  );
  const bootstrap = useCallback(async () => {
    const result = await AI.bootstrap();
    if (!alive.current) return;
    setData(result);
    setLoading(false);
  }, []);
  useEffect(() => {
    alive.current = true;
    setLoading(true);
    select(initialConversationId ?? null);
    setData(empty);
    setSkills([]);
    setMcp([]);
    setRoots([]);
    setDraft("");
    setAttachments([]);
    pending.current = null;
    void bootstrap().catch((e) => {
      if (alive.current) {
        setError(aiError(e));
        setLoading(false);
      }
    });
    return () => {
      alive.current = false;
      loadCounter.current++;
    };
  }, [workspaceId, currentUser.id, bootstrap, select, initialConversationId]);
  useEffect(() => {
    if (initialConversationId && initialConversationId !== activeIdRef.current) {
      select(initialConversationId);
    }
  }, [initialConversationId, select]);
  useEffect(() => {
    const purpose = mode === "chat" ? "chat" : "agent";
    const chosen =
      view?.conversation.models[purpose] ||
      data.catalog.defaults[purpose] ||
      data.catalog.defaults.chat;
    setModel(modelKey(chosen));
  }, [
    view?.conversation.id,
    view?.conversation.models.chat?.connectionId,
    view?.conversation.models.chat?.modelEntryId,
    view?.conversation.models.agent?.connectionId,
    view?.conversation.models.agent?.modelEntryId,
    mode,
    data.catalog,
  ]);
  useEffect(() => {
    end.current?.scrollIntoView({
      behavior: busy ? "auto" : "smooth",
      block: "end",
    });
  }, [view?.messages.at(-1)?.content, busy, view?.messages.length]);
  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    if (isTauri())
      void listen<AIEvent>("ai://event", (event) => {
        const e = event.payload;
        const scope = getWorkspaceContext();
        if (
          !scope ||
          scope.workspaceId !== e.workspaceId ||
          scope.userId !== e.userId ||
          scope.revision !== e.contextRevision ||
          !alive.current
        )
          return;
        if (e.conversationId === activeIdRef.current) {
          setView((old) => {
            if (!old || old.conversation.id !== e.conversationId) return old;
            const existing = old.runs.find((r) => r.id === e.runId);
            if (existing && existing.seq >= e.seq) return old;
            if (e.payload.run && e.payload.message) {
              const run = e.payload.run;
              const message = e.payload.message;
              return {
                ...old,
                runs: [run, ...old.runs.filter((r) => r.id !== run.id)],
                messages: old.messages.some((m) => m.id === message.id)
                  ? old.messages.map((m) => (m.id === message.id ? message : m))
                  : [...old.messages, message],
              };
            }
            if (e.type === "text.delta" && existing) {
              return {
                ...old,
                runs: old.runs.map((r) =>
                  r.id === e.runId ? { ...r, seq: e.seq } : r,
                ),
                messages: old.messages.map((m) =>
                  m.id === existing.assistantMessageId
                    ? { ...m, content: m.content + (e.payload.text ?? "") }
                    : m,
                ),
              };
            }
            return old;
          });
          if (e.type === "run.finished")
            void refreshView(e.conversationId).catch(() => {});
        }
        if (e.type === "run.finished" || e.type === "run.updated")
          void refreshList().catch(() => {});
      }).then((f) => {
        if (disposed) f();
        else off = f;
      });
    const timer = window.setInterval(() => {
      if (activeIdRef.current)
        void refreshView(activeIdRef.current, true).catch(() => {});
      void refreshList().catch(() => {});
    }, 5000);
    return () => {
      disposed = true;
      off?.();
      window.clearInterval(timer);
    };
  }, [refreshList, refreshView]);
  const previousSettings = useRef(false);
  useEffect(() => {
    if (previousSettings.current && !settings)
      void bootstrap().catch((e) => {
        if (alive.current) setError(aiError(e));
      });
    previousSettings.current = settings;
  }, [settings, bootstrap]);
  const handle = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(aiError(e));
    }
  };
  const create = async () => {
    const conversation = await AI.call<Conversation>("conversation.create");
    await refreshList();
    select(conversation.id);
    return conversation;
  };
  const submit = async (inputValue?: RunRequest["input"]) => {
    if (sending.current || currentRun || extracting) return;
    if (!inputValue && !draft.trim() && !attachments.length && !pending.current)
      return;
    sending.current = true;
    setSubmitting(true);
    setError("");
    const scope = getWorkspaceContext();
    try {
      let request = pending.current;
      if (!request) {
        let conv = view?.conversation;
        if (!conv) {
          conv = await create();
        }
        const fresh = await AI.call<View>("conversation.view", { id: conv.id });
        const text = [
          draft.trim(),
          ...attachments.map(
            (a) =>
              `\n<attached_document name=${JSON.stringify(a.name)}>\n${a.text}\n</attached_document>`,
          ),
        ]
          .filter(Boolean)
          .join("\n");
        request = {
          clientRequestId: uid(),
          conversationId: conv.id,
          branchId: fresh.conversation.branchId,
          expectedHeadMessageId: fresh.conversation.headMessageId,
          expectedConversationVersion: fresh.conversation.revision,
          input: inputValue || {
            kind: "new_message",
            clientMessageId: uid(),
            text,
          },
          modelRef: parseModelKey(model),
          mode,
          skillIds: mode === "chat" ? [] : skills,
          rootIds: mode === "files" ? roots : [],
          mcpIds: mode === "chat" ? [] : mcp,
        };
        pending.current = request;
      }
      const run = await AI.call<Run>("run.start", request);
      if (scope && !sameWorkspace(scope)) return;
      pending.current = null;
      if (!inputValue) {
        setDraft("");
        setAttachments([]);
      }
      activeIdRef.current = run.conversationId;
      setActiveId(run.conversationId);
      await refreshView(run.conversationId);
      await refreshList();
    } catch (e) {
      if (alive.current) setError(aiError(e));
    } finally {
      sending.current = false;
      if (alive.current) setSubmitting(false);
    }
  };
  const patch = async (id: string, patchValue: unknown) => {
    const snapshot = await AI.call<View>("conversation.view", { id });
    await AI.call("conversation.patch", {
      id,
      revision: snapshot.conversation.revision,
      patch: patchValue,
    });
    await refreshList();
    if (activeIdRef.current === id) await refreshView(id);
  };
  const grant = async () => {
    const path = await open({
      directory: true,
      multiple: false,
      title: tr("ai:v2.authorizeRoot"),
    });
    if (typeof path !== "string") return;
    const root = await AI.call<Root>("root.grant", { path, allowCreate });
    setData((d) => ({ ...d, roots: [...d.roots, root] }));
    setRoots((ids) => [...ids, root.id]);
    return root;
  };
  const artifactRoot = async (artifact: Artifact) => {
    let root = data.roots.find(
      (r) => r.id === artifact.rootId || r.path === artifact.rootPath,
    );
    if (!root) root = await grant();
    if (!root) throw Error(tr("ai:v2.rootRequired"));
    return root;
  };
  const restore = async (run: Run, artifact: Artifact) => {
    const root = await artifactRoot(artifact);
    await AI.call("file.restore", { runId: run.id, rootId: root.id, artifact });
    setError(tr("ai:v2.restored"));
  };
  const extractFiles = async (files: FileList | null) => {
    if (!files) return;
    setExtracting(true);
    await handle(async () => {
      const selected = Array.from(files);
      if (selected.length + attachments.length > 5)
        throw Error(tr("ai:v2.attachmentLimit"));
      const added = [];
      for (const file of selected) {
        if (file.size > 20_000_000) throw Error(tr("ai:v2.attachmentLimit"));
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let n = 0; n < bytes.length; n += 8192)
          binary += String.fromCharCode(...bytes.subarray(n, n + 8192));
        const text = await AI.call<string>("document.extract", {
          name: file.name,
          data: btoa(binary),
        });
        added.push({ id: uid(), name: file.name, text });
      }
      if (
        [...attachments, ...added].reduce((n, a) => n + a.text.length, 0) >
        800_000
      )
        throw Error(tr("ai:v2.attachmentLimit"));
      setAttachments((a) => [...a, ...added]);
    });
    setExtracting(false);
    if (input.current) input.current.value = "";
  };
  const handleSaveEdit = async (message: Message) => {
    const newContent = editDraft.trim();
    if (!newContent || busy) return;
    setEditingMessageId("");
    setEditDraft("");
    await handle(async () => {
      await AI.call("message.patch", {
        conversationId: view?.conversation.id,
        id: message.id,
        content: newContent,
      });
      const userRun = view?.runs.find((r) => r.userMessageId === message.id);
      if (userRun) {
        await submit({
          kind: "retry",
          runId: userRun.id,
          userMessageId: message.id,
        });
      } else {
        await submit({
          kind: "new_message",
          clientMessageId: uid(),
          text: newContent,
        });
      }
    });
  };
  useEffect(() => {
    let disposed = false;
    if (!query.trim()) {
      setSearchMatches([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void AI.call<typeof searchMatches>("conversations.search", { query })
        .then((matches) => {
          if (!disposed) setSearchMatches(matches);
        })
        .catch((e) => {
          if (!disposed) setError(aiError(e));
        });
    }, 250);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [query, data.conversations]);
  const matches = searchMatches;
  const toggle = (list: string[], id: string, checked: boolean) =>
    checked ? [...list, id] : list.filter((value) => value !== id);
  return (
    <section
      className="ai-v2 flex h-full min-h-0 overflow-hidden bg-canvas"
      aria-label={tr("ai:v2.workspace")}
    >
      {sidebar && (
        <aside className="h-full w-64 shrink-0 border-r border-subtle bg-surface">
          <AIConversationList
            conversations={data.conversations}
            activeId={activeId}
            searchQuery={query}
            matches={matches}
            onSelect={select}
            onCreate={() =>
              void handle(async () => {
                await create();
              })
            }
            onSearchQueryChange={setQuery}
            onRename={(id, title) => void handle(() => patch(id, { title }))}
            onTogglePinned={(id) =>
              void handle(() =>
                patch(id, {
                  pinned: !data.conversations.find((c) => c.id === id)?.pinned,
                }),
              )
            }
            onDelete={(id) =>
              void handle(async () => {
                await AI.call("conversation.delete", { id });
                if (activeId === id) select(null);
                await refreshList();
              })
            }
            onCollapse={() => setSidebar(false)}
          />
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 items-center gap-2 border-b border-subtle bg-surface px-4 py-2">
          <button
            type="button"
            className="ai-v2-btn"
            aria-label={tr("ai:v2.conversations")}
            onClick={() => setSidebar((v) => !v)}
          >
            <PanelLeftOpen size={15} />
          </button>
          <Bot size={17} className="text-feature" />
          <span className="truncate text-sm font-semibold">
            {assistantName}
          </span>
          {activeModelInfo && (
            <div
              className="inline-flex items-center gap-1.5 rounded-full border border-subtle/80 bg-input/40 px-2.5 py-0.5 text-xs text-sub ml-1 max-w-64"
              title={`当前模型: ${activeModelInfo.displayName}${activeModelInfo.connectionName ? ` (${activeModelInfo.connectionName})` : ""}`}
            >
              <div
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${activeModelInfo.brandMeta.bgClass} ${activeModelInfo.brandMeta.borderClass}`}
              >
                <BrandIcon brand={activeModelInfo.brandMeta.brand} className="h-2 w-2" />
              </div>
              <span className="font-medium text-main truncate text-xs">
                {activeModelInfo.displayName}
              </span>
              {activeModelInfo.hasTools && (
                <span
                  className="text-[9px] font-mono text-emerald-600 bg-emerald-500/10 px-1 py-0.2 rounded shrink-0"
                  title="支持工具调用 (Tools)"
                >
                  Tools
                </span>
              )}
            </div>
          )}
          {currentRun && (
            <span role="status" className="inline-flex items-center gap-1.5 text-xs text-sub ml-2">
              <Loader2 size={12} className="animate-spin text-accent" />
              <span>{tr(`ai:v2.status_${currentRun.status}`)}</span>
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            className="ai-v2-btn"
            aria-label={tr("ai:share.shareConversation")}
            title={activeId ? tr("ai:share.shareConversation") : tr("ai:share.shareDisabledHint")}
            disabled={!activeId}
            onClick={() => setShareOpen(true)}
          >
            <Share2 size={15} />
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-auto" aria-live="polite">
          {!view?.messages.length && (
            <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-16 text-center">
              <span className="rounded-xl border border-subtle bg-surface p-4">
                <Bot size={28} className="text-feature" />
              </span>
              <h2 className="text-lg font-semibold">{tr("ai:v2.welcome")}</h2>
              <p className="text-xs leading-6 text-sub">
                {tr("ai:v2.welcomeHint")}
              </p>
              {mode === "workspace" && !loading && <div className="flex flex-wrap justify-center gap-2">
                {["today", "create", "members", "wiki"].map(key => <button type="button" key={key} className="ai-v2-btn" onClick={() => setDraft(tr(`ai:business.prompt_${key}`))}>{tr(`ai:business.suggestion_${key}`)}</button>)}
              </div>}
              {loading ? (
                <p role="status" className="text-xs text-sub">
                  {tr("ai:v2.working")}
                </p>
              ) : (
                !data.catalog.connections.some(
                  (c) =>
                    c.bound && c.enabled && c.models.some((m) => m.enabled),
                ) && (
                  <button
                    type="button"
                    className="ai-v2-btn primary"
                    onClick={() => setSettings(true)}
                  >
                    {tr("ai:v2.addConnection")}
                  </button>
                )
              )}
            </div>
          )}
          <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
            {view?.messages
              .filter((m) => !m.protocol)
              .map((message) => {
                const run =
                  message.role === "assistant"
                    ? view.runs.find((r) => r.id === message.runId)
                    : undefined;
                const versions = view.alternatives.filter(
                  (m) =>
                    m.userMessageId === message.userMessageId &&
                    message.role === "assistant",
                );
                const isEditing = editingMessageId === message.id;
                if (message.role === "user") {
                  return (
                    <div
                      key={message.id}
                      className="group ml-auto flex max-w-[90%] flex-col items-end"
                    >
                      <article
                        className="w-full rounded-xl border border-subtle bg-surface p-3 transition-all"
                        data-message-role="user"
                      >
                        <header className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-quiet">
                          <strong className="text-sub">
                            {currentUser.nickname}
                          </strong>
                          <time>
                            {new Date(message.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                          {message.modelLabel && <span>{message.modelLabel}</span>}
                          {message.status !== "completed" && (
                            <span>{tr(`ai:v2.status_${message.status}`)}</span>
                          )}
                        </header>
                        {isEditing ? (
                          <div className="w-full rounded-xl border border-accent bg-surface p-2.5 shadow-soft transition-all">
                            <textarea
                              autoFocus
                              rows={Math.min(8, Math.max(2, editDraft.split("\n").length))}
                              value={editDraft}
                              disabled={busy}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing || (e as any).keyCode === 229) return;
                                if (e.key === "Enter") {
                                  if (e.shiftKey) return;
                                  if (e.ctrlKey || e.metaKey) {
                                    e.preventDefault();
                                    const target = e.currentTarget;
                                    const start = target.selectionStart;
                                    const end = target.selectionEnd;
                                    const nextVal = editDraft.slice(0, start) + "\n" + editDraft.slice(end);
                                    setEditDraft(nextVal);
                                    requestAnimationFrame(() => {
                                      target.selectionStart = target.selectionEnd = start + 1;
                                    });
                                    return;
                                  }
                                  e.preventDefault();
                                  if (editDraft.trim() && !busy) {
                                    void handleSaveEdit(message);
                                  }
                                }
                              }}
                              className="block w-full resize-none bg-transparent text-xs leading-5 text-main outline-none placeholder:text-quiet"
                              placeholder={tr("ai:v2.composerHint")}
                            />
                            <div className="mt-2 flex items-center justify-between border-t border-edge/30 pt-2 px-0.5">
                              <Paperclip size={13} className="text-quiet" />
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="rounded-full border border-edge bg-card px-3 py-1 text-xs text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-50"
                                  disabled={busy}
                                  onClick={() => {
                                    setEditingMessageId("");
                                    setEditDraft("");
                                  }}
                                >
                                  {tr("ai:v2.cancel")}
                                </button>
                                <button
                                  type="button"
                                  className="rounded-full bg-accent px-4 py-1 text-xs font-medium text-on-accent hover:opacity-90 transition-opacity disabled:opacity-50"
                                  disabled={!editDraft.trim() || busy}
                                  onClick={() => void handleSaveEdit(message)}
                                >
                                  {tr("ai:v2.send")}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap break-words text-xs leading-6 select-text cursor-text" data-selectable="true">
                            {message.content}
                          </p>
                        )}
                        {message.error && (
                          <p className="ai-v2-error mt-2">{message.error}</p>
                        )}
                      </article>

                      {!isEditing && (
                        <footer className="mt-1 flex items-center justify-end gap-1 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100 focus-within:opacity-100 pr-1">
                          <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center rounded text-quiet hover:bg-hover hover:text-main transition-colors"
                            aria-label={tr("ai:v2.copy")}
                            title={tr("ai:v2.copy")}
                            onClick={() =>
                              void handle(async () => {
                                await navigator.clipboard.writeText(message.content);
                                setCopied(message.id);
                                window.setTimeout(() => setCopied(""), 1800);
                              })
                            }
                          >
                            {copied === message.id ? (
                              <Check size={13} className="text-success" />
                            ) : (
                              <Copy size={13} />
                            )}
                          </button>
                          <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center rounded text-quiet hover:bg-hover hover:text-main transition-colors disabled:opacity-40"
                            disabled={busy}
                            aria-label={tr("ai:v2.edit")}
                            title={tr("ai:v2.edit")}
                            onClick={() => {
                              setEditingMessageId(message.id);
                              setEditDraft(message.content);
                            }}
                          >
                            <Pencil size={13} />
                          </button>
                        </footer>
                      )}
                    </div>
                  );
                }

                const isActiveAssistant =
                  (activeRun(run) || message.status === "running" || message.status === "queued") && busy;

                return (
                  <article
                    key={message.id}
                    className="min-w-0"
                    data-message-role="assistant"
                  >
                    <header className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-quiet">
                      <strong className="text-sub">
                        {assistantName}
                      </strong>
                      <time>
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      {message.modelLabel && <span>{message.modelLabel}</span>}
                      {isActiveAssistant ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-accent font-medium">
                          <Loader2 size={10} className="animate-spin" />
                          <span>{tr("ai:v2.working")}</span>
                        </span>
                      ) : message.status !== "completed" ? (
                        <span>{tr(`ai:v2.status_${message.status}`)}</span>
                      ) : null}
                    </header>

                    {/* 工具调用过程与工件生成：放置在回复文本之前 */}
                    {run && run.toolCalls.length > 0 && (
                      <div className="mb-3 space-y-2">
                        {run.toolCalls.map((call) => (
                          <ToolCard
                            key={call.id}
                            call={call}
                            run={run}
                            onDecision={async (run, call, decision) => {
                              await AI.call("run.decide", {
                                id: run.id,
                                approvalId: call.approvalId,
                                decision,
                              });
                              await refreshView(run.conversationId);
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {run && run.artifacts.length > 0 && (
                      <div className="mb-3 space-y-1.5">
                        {run.artifacts.map((artifact, n) => (
                          <div className="ai-v2-artifact mt-2" key={n}>
                            <FileText size={15} className="text-feature" />
                            <span
                              className="min-w-0 flex-1 truncate font-mono text-xs"
                              title={artifact.path}
                            >
                              {artifact.path}
                            </span>
                            <button
                              type="button"
                              className="ai-v2-btn"
                              onClick={() =>
                                void handle(async () => {
                                  const root = await artifactRoot(artifact);
                                  await AI.call("file.open", {
                                    rootId: root.id,
                                    path: artifact.path,
                                  });
                                })
                              }
                            >
                              {tr("ai:v2.reveal")}
                            </button>
                            {artifact.backupId && (
                              <button
                                type="button"
                                className="ai-v2-btn"
                                disabled={busy}
                                onClick={() =>
                                  void handle(() => restore(run, artifact))
                                }
                              >
                                {tr("ai:v2.restore")}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 最终回复文本 / Markdown（支持流式光标与处理提示） */}
                    {message.content ? (
                      <div className="select-text cursor-text" data-selectable="true">
                        <AssistantMarkdown value={message.content} />
                        {isActiveAssistant && (
                          <span className="inline-block h-3.5 w-1.5 translate-y-0.5 ml-1 bg-accent animate-pulse align-middle" />
                        )}
                      </div>
                    ) : isActiveAssistant ? (
                      <div className="flex items-center gap-2 py-1.5 text-xs text-sub">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent/15 text-accent">
                          <Loader2 size={13} className="animate-spin" />
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-quiet">
                          <span>{assistantName} 正在思考与处理</span>
                          <span className="inline-flex gap-0.5 ml-0.5">
                            <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:0ms]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
                          </span>
                        </span>
                      </div>
                    ) : null}

                    {message.error && (
                      <p className="ai-v2-error mt-2">{message.error}</p>
                    )}

                    <footer className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="ai-v2-btn"
                        aria-label={tr("ai:v2.copy")}
                        onClick={() =>
                          void handle(async () => {
                            await navigator.clipboard.writeText(
                              message.content,
                            );
                            setCopied(message.id);
                            window.setTimeout(() => setCopied(""), 1800);
                          })
                        }
                      >
                        {copied === message.id ? (
                          <Check size={12} />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                      {run && !busy && (
                        <>
                          <button
                            type="button"
                            className="ai-v2-btn"
                            onClick={() =>
                              void submit({
                                kind: "retry",
                                runId: run.id,
                                userMessageId: run.userMessageId,
                              })
                            }
                          >
                            <RefreshCw size={12} />
                            {tr("ai:v2.regenerate")}
                          </button>
                          {(run.finishReason === "length" ||
                            run.status === "interrupted" ||
                            run.error?.code === "RUN_BUDGET_EXCEEDED") && (
                            <button
                              type="button"
                              className="ai-v2-btn"
                              onClick={() =>
                                void submit({
                                  kind: "continue",
                                  runId: run.id,
                                })
                              }
                            >
                              {tr("ai:v2.continue")}
                            </button>
                          )}
                        </>
                      )}
                      {versions.length > 1 && (
                        <div className="w-28 shrink-0">
                          <ThemeSelect
                            portal
                            value={message.id}
                            disabled={busy}
                            options={versions.map((version, index) => ({
                              value: version.id,
                              label: tr("ai:v2.version", { count: index + 1 }),
                              tone: "slate",
                            }))}
                            onChange={(val) =>
                              void handle(() =>
                                patch(view.conversation.id, {
                                  headMessageId: val,
                                }),
                              )
                            }
                            ariaLabel={tr("ai:v2.versions")}
                          />
                        </div>
                      )}
                      {onOpenCreateTask && (
                        <button
                          type="button"
                          className="ai-v2-btn"
                          onClick={() => {
                            const title = extractTitleFromMarkdown(
                              message.content,
                              tr("ai:message.createWorkItem"),
                            );
                            onOpenCreateTask(title, message.content);
                          }}
                        >
                          <CheckSquare size={12} className="inline mr-1" />
                          {tr("ai:message.createWorkItem")}
                        </button>
                      )}
                      {onOpenCreateWiki && (
                        <button
                          type="button"
                          className="ai-v2-btn"
                          onClick={async () => {
                            const title = extractTitleFromMarkdown(
                              message.content,
                              tr("ai:message.saveToWiki"),
                            );
                            await onOpenCreateWiki(message.content, title);
                            setWikiSavedMessageId(message.id);
                            setTimeout(() => {
                              setWikiSavedMessageId((cur) =>
                                cur === message.id ? "" : cur,
                              );
                            }, 3000);
                          }}
                        >
                          <BookOpen size={12} className="inline mr-1" />
                          {wikiSavedMessageId === message.id
                            ? tr("ai:message.savedToWiki")
                            : tr("ai:message.saveToWiki")}
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })}

            {/* 当处于发送/处理中，且当前末尾尚未有助手消息时，在最下方展示转圈与“正在思考与处理...”动态占位 */}
            {busy &&
              (!view?.messages.length ||
                view.messages.filter((m) => !m.protocol).at(-1)?.role === "user") && (
                <article
                  className="min-w-0"
                  data-message-role="assistant"
                >
                  <header className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-quiet">
                    <strong className="text-sub">{assistantName}</strong>
                    <span className="inline-flex items-center gap-1 text-[10px] text-accent font-medium">
                      <Loader2 size={10} className="animate-spin" />
                      <span>{tr("ai:v2.working")}</span>
                    </span>
                  </header>
                  <div className="flex items-center gap-2 py-1.5 text-xs text-sub">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent/15 text-accent">
                      <Loader2 size={13} className="animate-spin" />
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-quiet">
                      <span>{assistantName} 正在思考与处理</span>
                      <span className="inline-flex gap-0.5 ml-0.5">
                        <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:0ms]" />
                        <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
                        <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
                      </span>
                    </span>
                  </div>
                </article>
              )}
            <div ref={end} />
          </div>
        </main>
        <div className="mx-auto w-full max-w-5xl px-6 pb-4 pt-2">
          {error && (
            <div className="ai-v2-error mb-2" role="alert">
              {error}
              {pending.current && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="ai-v2-btn"
                    disabled={busy}
                    onClick={() => void submit()}
                  >
                    {tr("ai:v2.recoverRequest")}
                  </button>
                  <button
                    type="button"
                    className="ai-v2-btn"
                    onClick={() => {
                      pending.current = null;
                      setError("");
                    }}
                  >
                    {tr("ai:v2.dismiss")}
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="rounded-2xl border border-edge bg-card p-3 shadow-soft focus-within:border-accent/80 focus-within:ring-1 focus-within:ring-accent/20 transition-all">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 px-0.5">
                {attachments.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface/90 px-2 py-1 text-xs text-sub shadow-2xs">
                    <FileText size={13} className="text-accent shrink-0" />
                    <span className="max-w-[200px] truncate">{a.name}</span>
                    <button
                      type="button"
                      aria-label={tr("ai:v2.removeAttachment")}
                      className="ml-0.5 rounded p-0.5 text-quiet hover:bg-hover hover:text-danger transition-colors"
                      onClick={() =>
                        setAttachments((list) =>
                          list.filter((item) => item.id !== a.id),
                        )
                      }
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              aria-label={tr("ai:v2.prompt")}
              className="w-full resize-none bg-transparent px-1 pt-1 pb-1 text-xs leading-6 text-main outline-none placeholder:text-quiet min-h-[46px] max-h-48 overflow-y-auto"
              rows={2}
              value={draft}
              disabled={submitting}
              placeholder={tr("ai:v2.composerHint")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || (e as any).keyCode === 229) {
                  return;
                }
                if (e.key === "Enter") {
                  if (e.shiftKey) {
                    return;
                  }
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const target = e.currentTarget;
                    const start = target.selectionStart;
                    const end = target.selectionEnd;
                    const nextVal = draft.slice(0, start) + "\n" + draft.slice(end);
                    setDraft(nextVal);
                    requestAnimationFrame(() => {
                      target.selectionStart = target.selectionEnd = start + 1;
                    });
                    return;
                  }
                  e.preventDefault();
                  if (!busy && !extracting && (draft.trim() || attachments.length) && model) {
                    void submit();
                  }
                }
              }}
            />
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-edge/30 pt-2 px-0.5">
              <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                <input
                  ref={input}
                  type="file"
                  multiple
                  hidden
                  accept=".txt,.md,.csv,.json,.pdf,.docx,.xlsx,.xls,.ods,.ts,.tsx,.js,.py,.rs,.yaml,.yml,.toml,.log"
                  onChange={(e) => void extractFiles(e.target.files)}
                />
                <button
                  type="button"
                  className="chat-tool-btn flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-accent transition-colors disabled:cursor-not-allowed disabled:opacity-40 shrink-0"
                  aria-label={tr("ai:v2.attach")}
                  title={tr("ai:v2.attach")}
                  disabled={extracting || busy}
                  onClick={() => input.current?.click()}
                >
                  <Paperclip size={14} />
                </button>

                {/* 1. Agent 模式切换 */}
                <div className="relative" ref={modeMenuRef}>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={
                      mode === "chat"
                        ? tr("ai:v2.mode_chat")
                        : mode === "workspace"
                        ? tr("ai:v2.mode_workspace")
                        : tr("ai:v2.mode_files")
                    }
                    onClick={() => setModeMenuOpen((o) => !o)}
                    className="inline-flex items-center justify-center gap-1 h-7 px-2 rounded-lg border border-edge/60 bg-surface/80 hover:bg-hover text-sub hover:text-main text-xs font-medium transition-colors disabled:opacity-40 shrink-0"
                    title={
                      mode === "chat"
                        ? tr("ai:v2.mode_chat")
                        : mode === "workspace"
                        ? tr("ai:v2.mode_workspace")
                        : tr("ai:v2.mode_files")
                    }
                  >
                    {mode === "chat" && <MessageSquare size={13} className="text-feature" />}
                    {mode === "workspace" && <Sparkles size={13} className="text-accent" />}
                    {mode === "files" && <Folder size={13} className="text-warning" />}
                    <ChevronDown size={10} className="text-quiet" />
                  </button>

                  {modeMenuOpen && (
                    <div className="absolute bottom-full mb-1.5 left-0 z-50 w-64 rounded-xl border border-edge bg-surface p-1.5 shadow-xl">
                      <div className="px-2 py-1 text-[11px] font-semibold text-quiet">
                        {tr("ai:v2.mode")}
                      </div>
                      {[
                        {
                          key: "chat",
                          icon: MessageSquare,
                          iconColor: "text-feature",
                          label: tr("ai:v2.mode_chat"),
                          desc: "纯对话交流，不调用工作区数据",
                        },
                        {
                          key: "workspace",
                          icon: Sparkles,
                          iconColor: "text-accent",
                          label: tr("ai:v2.mode_workspace"),
                          desc: "可调用任务、成员和知识库等工具",
                        },
                        {
                          key: "files",
                          icon: Folder,
                          iconColor: "text-warning",
                          label: tr("ai:v2.mode_files"),
                          desc: "可授权读取和修改本地工程目录",
                        },
                      ].map((opt) => {
                        const Icon = opt.icon;
                        const active = mode === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            role="option"
                            aria-label={opt.label}
                            aria-selected={active}
                            className={`w-full flex items-start gap-2.5 rounded-lg p-2 text-left transition-colors ${
                              active ? "bg-accent/10 text-accent font-semibold" : "hover:bg-hover text-main"
                            }`}
                            onClick={() => {
                              setMode(opt.key);
                              setModeMenuOpen(false);
                            }}
                          >
                            <Icon size={15} className={`mt-0.5 shrink-0 ${opt.iconColor}`} />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs flex items-center justify-between">
                                <span>{opt.label}</span>
                                {active && <Check size={12} className="text-accent" />}
                              </div>
                              <div className="text-[11px] text-quiet leading-tight mt-0.5">
                                {opt.desc}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 2. 模型选择（只展示图标） */}
                <GroupedModelSelect
                  catalog={data.catalog}
                  value={model}
                  onChange={(val) => {
                    setModel(val);
                    if (view?.conversation.id) {
                      const purpose = mode === "chat" ? "chat" : "agent";
                      void handle(() =>
                        patch(view.conversation.id, {
                          models: {
                            ...view.conversation.models,
                            [purpose]: parseModelKey(val),
                          },
                        }),
                      );
                    }
                  }}
                  agent={mode !== "chat"}
                  disabled={busy}
                  iconOnly={true}
                />

                {/* 3. Skills 配置 */}
                {mode !== "chat" && (
                  <div className="relative" ref={skillsMenuRef}>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={tr("ai:v2.skills")}
                      onClick={() => setSkillsMenuOpen((o) => !o)}
                      className={`inline-flex items-center justify-center gap-1 h-7 px-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 shrink-0 ${
                        skills.length > 0
                          ? "border-accent/40 bg-accent/10 text-accent font-semibold"
                          : "border-edge/60 bg-surface/80 hover:bg-hover text-sub hover:text-main"
                      }`}
                      title={skills.length > 0 ? `Skills (${skills.length})` : tr("ai:v2.skills")}
                    >
                      <Wrench size={13} className={skills.length > 0 ? "text-accent" : "text-sub"} />
                      {skills.length > 0 && (
                        <span className="text-[10px] font-bold text-accent">{skills.length}</span>
                      )}
                      <ChevronDown size={10} className="text-quiet" />
                    </button>

                    {skillsMenuOpen && (
                      <div className="absolute bottom-full mb-1.5 left-0 z-50 w-72 max-h-80 overflow-y-auto rounded-xl border border-edge bg-surface p-2.5 shadow-xl">
                        <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-edge/40">
                          <span className="text-xs font-semibold text-main">{tr("ai:v2.skills")}</span>
                          <span className="text-[11px] text-quiet">
                            {skills.length} / {data.extensions.filter((e) => e.kind === "skill" && e.enabled).length} 已选
                          </span>
                        </div>
                        {data.extensions.filter((e) => e.kind === "skill" && e.enabled).length === 0 ? (
                          <div className="py-4 text-center text-xs text-quiet">
                            暂无已启用的 Skill，可在设置中导入
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {data.extensions
                              .filter((e) => e.kind === "skill" && e.enabled)
                              .map((skill) => {
                                const checked = skills.includes(skill.id);
                                return (
                                  <label
                                    key={skill.id}
                                    className={`flex items-start gap-2 rounded-lg p-2 cursor-pointer transition-colors ${
                                      checked ? "bg-accent/10 text-main" : "hover:bg-hover text-sub"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="mt-0.5 rounded border-edge text-accent focus:ring-accent"
                                      checked={checked}
                                      onChange={(e) =>
                                        setSkills((s) => toggle(s, skill.id, e.target.checked))
                                      }
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs font-medium text-main truncate">
                                        {skill.name}
                                      </div>
                                      {skill.description && (
                                        <div className="text-[11px] text-quiet line-clamp-2 mt-0.5">
                                          {skill.description}
                                        </div>
                                      )}
                                    </div>
                                  </label>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 4. MCP 配置 */}
                {mode !== "chat" && (
                  <div className="relative" ref={mcpMenuRef}>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={tr("ai:v2.mcp")}
                      onClick={() => setMcpMenuOpen((o) => !o)}
                      className={`inline-flex items-center justify-center gap-1 h-7 px-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 shrink-0 ${
                        mcp.length > 0
                          ? "border-accent/40 bg-accent/10 text-accent font-semibold"
                          : "border-edge/60 bg-surface/80 hover:bg-hover text-sub hover:text-main"
                      }`}
                      title={mcp.length > 0 ? `MCP (${mcp.length})` : tr("ai:v2.mcp")}
                    >
                      <Boxes size={13} className={mcp.length > 0 ? "text-accent" : "text-sub"} />
                      {mcp.length > 0 && (
                        <span className="text-[10px] font-bold text-accent">{mcp.length}</span>
                      )}
                      <ChevronDown size={10} className="text-quiet" />
                    </button>

                    {mcpMenuOpen && (
                      <div className="absolute bottom-full mb-1.5 left-0 z-50 w-72 max-h-80 overflow-y-auto rounded-xl border border-edge bg-surface p-2.5 shadow-xl">
                        <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-edge/40">
                          <span className="text-xs font-semibold text-main">{tr("ai:v2.mcp")}</span>
                          <span className="text-[11px] text-quiet">
                            {mcp.length} / {data.extensions.filter((e) => e.kind === "mcp" && e.enabled).length} 已选
                          </span>
                        </div>
                        {data.extensions.filter((e) => e.kind === "mcp" && e.enabled).length === 0 ? (
                          <div className="py-4 text-center text-xs text-quiet">
                            暂无已启用的 MCP 服务，可在设置中添加
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {data.extensions
                              .filter((e) => e.kind === "mcp" && e.enabled)
                              .map((item) => {
                                const checked = mcp.includes(item.id);
                                return (
                                  <label
                                    key={item.id}
                                    className={`flex items-start gap-2 rounded-lg p-2 cursor-pointer transition-colors ${
                                      checked ? "bg-accent/10 text-main" : "hover:bg-hover text-sub"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      aria-label={`${item.name} MCP`}
                                      className="mt-0.5 rounded border-edge text-accent focus:ring-accent"
                                      checked={checked}
                                      onChange={(e) =>
                                        setMcp((m) => toggle(m, item.id, e.target.checked))
                                      }
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs font-medium text-main truncate">
                                        {item.name}
                                      </div>
                                      {item.description && (
                                        <div className="text-[11px] text-quiet line-clamp-2 mt-0.5">
                                          {item.description}
                                        </div>
                                      )}
                                    </div>
                                  </label>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 5. 目录授权 */}
                {mode === "files" && (
                  <div className="relative" ref={rootsMenuRef}>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={tr("ai:v2.authorizeRoot")}
                      onClick={() => setRootsMenuOpen((o) => !o)}
                      className={`inline-flex items-center justify-center gap-1 h-7 px-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 shrink-0 ${
                        roots.length > 0
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold"
                          : "border-edge/60 bg-surface/80 hover:bg-hover text-sub hover:text-main"
                      }`}
                      title={roots.length > 0 ? `目录授权 (${roots.length})` : tr("ai:v2.authorizeRoot")}
                    >
                      <FolderLock size={13} className={roots.length > 0 ? "text-amber-500" : "text-sub"} />
                      {roots.length > 0 && (
                        <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">{roots.length}</span>
                      )}
                      <ChevronDown size={10} className="text-quiet" />
                    </button>

                    {rootsMenuOpen && (
                      <div className="absolute bottom-full mb-1.5 left-0 z-50 w-80 max-h-80 overflow-y-auto rounded-xl border border-edge bg-surface p-2.5 shadow-xl">
                        <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-edge/40">
                          <span className="text-xs font-semibold text-main">{tr("ai:v2.authorizeRoot")}</span>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline font-medium"
                            onClick={() => void grant()}
                          >
                            <FolderPlus size={12} />
                            <span>添加授权</span>
                          </button>
                        </div>
                        <label className="flex items-center gap-2 px-1 py-1 text-[11px] text-sub select-none cursor-pointer">
                          <input
                            type="checkbox"
                            className="rounded border-edge text-accent focus:ring-accent"
                            checked={allowCreate}
                            onChange={(e) => setAllowCreate(e.target.checked)}
                          />
                          <span>{tr("ai:v2.allowCreate")}</span>
                        </label>
                        {data.roots.length === 0 ? (
                          <div className="py-4 text-center text-xs text-quiet">
                            尚未授权本地目录，点击右上角“添加授权”进行选择
                          </div>
                        ) : (
                          <div className="mt-2 space-y-1">
                            {data.roots.map((root) => {
                              const checked = roots.includes(root.id);
                              return (
                                <div
                                  key={root.id}
                                  className={`flex items-center justify-between gap-2 rounded-lg p-2 text-xs transition-colors ${
                                    checked ? "bg-accent/10" : "hover:bg-hover"
                                  }`}
                                >
                                  <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      className="rounded border-edge text-accent focus:ring-accent"
                                      checked={checked}
                                      onChange={(e) =>
                                        setRoots((list) => toggle(list, root.id, e.target.checked))
                                      }
                                    />
                                    <span className="truncate font-mono text-[11px] text-main" title={root.path}>
                                      {root.path}
                                    </span>
                                  </label>
                                  <button
                                    type="button"
                                    className="text-[11px] text-quiet hover:text-danger p-1 rounded transition-colors"
                                    title={tr("ai:v2.revoke")}
                                    onClick={() =>
                                      void handle(async () => {
                                        await AI.call("root.revoke", { id: root.id });
                                        setData((d) => ({
                                          ...d,
                                          roots: d.roots.filter((r) => r.id !== root.id),
                                        }));
                                        setRoots((list) => list.filter((id) => id !== root.id));
                                      })
                                    }
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-quiet hidden sm:inline select-none">
                  {extracting ? tr("ai:v2.extracting") : tr("ai:v2.sendHint")}
                </span>
                {currentRun ? (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/20 transition-colors shadow-2xs"
                    onClick={() =>
                      void handle(async () => {
                        await AI.call("run.cancel", { id: currentRun.id });
                        await refreshView(currentRun.conversationId);
                      })
                    }
                  >
                    <Square size={13} />
                    <span>{tr("ai:v2.stop")}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="theme-btn-primary px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label={tr("ai:v2.send")}
                    disabled={
                      busy ||
                      extracting ||
                      (!draft.trim() && !attachments.length) ||
                      !model
                    }
                    onClick={() => void submit()}
                  >
                    <ArrowUp size={14} />
                    <span>{tr("ai:v2.send")}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {settings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={() => setSettings(false)}
        >
          <section
            className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-subtle bg-surface p-5"
            role="dialog"
            aria-modal="true"
            aria-label={tr("ai:v2.settings")}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{tr("ai:v2.settings")}</h2>
              <button
                type="button"
                className="ai-v2-btn"
                aria-label={tr("ai:v2.close")}
                onClick={() => setSettings(false)}
              >
                <X size={16} />
              </button>
            </header>
            <ModelSettingsPanel />
          </section>
        </div>
      )}
      <AIShareModal
        conversation={view?.conversation ?? data.conversations.find((c) => c.id === activeId) ?? null}
        workspaceId={workspaceId}
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
      />
    </section>
  );
};
