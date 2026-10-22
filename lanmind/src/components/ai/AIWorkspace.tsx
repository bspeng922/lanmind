import { getWorkspaceContext, sameWorkspace } from "../../utils/workspaceContext";
/**
 * LegacyAIWorkspace — 旧版对话界面，仅保留旧数据迁移和兼容代码。
 * 正式入口在文件末尾导出 AgentWorkspace，会话以 SQLite 为权威存储，
 * 支持多模型、Skills、MCP、目录授权和工具审批。
 *
 * CALLING SPEC:
 *   <AIWorkspace
 *     tasks={tasks}
 *     projects={projects}
 *     currentUser={currentUser}
 *     onOpenCreateTask={(initialTitle) => void}
 *     onOpenReport={() => void}
 *   />
 *
 * TOOL CONTRACT:
 *   - 输入：工作区的工作项、项目与当前用户。仅用于构造提问上下文，不修改它们。
 *   - 输出：对话界面。会话与消息保存在本机 localStorage（见 aiStore.ts），
 *     不参与局域网同步，首次启动为空状态。
 *   - 模型调用使用 ApiService.sendAIChat 进行自然语言对话与上下文问答。
 *     模型由选定模型或系统设置决定。
 *   - 助手显示名读取 useAssistantName()，改名后即时更新。
 *   - 第一阶段范围：仅对话与记录管理，不包含 skill / MCP / 工具调用与审批。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Sparkles,
  AlertTriangle,
  CalendarClock,
  ListChecks,
  Users,
  Cpu,
  ChevronDown,
  Check,
  Building2,
} from 'lucide-react';
import type { Project, Task, User } from '../../types';
import { ApiService } from '../../services/api';
import { tr, useLocale } from '../../i18n';
import { AI, type Catalog } from './aiClient';
import { isCancelled, isCompleted } from '../../utils/workItemState';
import {
  appendMessage,
  createConversation,
  deleteConversation,
  editUserMessageAndTruncateAfter,
  getConversationSummaries,
  getMessages,
  patchMessage,
  removeMessage,
  renameConversation,
  retitleFromFirstUserMessage,
  searchConversations,
  setAIWorkspace,
  togglePinned,
  useAIConversations,
  type AIMessage,
  type ConversationSummary,
} from './aiStore';
import { AIConversationList } from './AIConversationList';
import { AIMessageList } from './AIMessageList';
import { AIComposer } from './AIComposer';
import { useAssistantName } from './useAssistantName';

interface AIWorkspaceProps {
  tasks: Task[];
  projects: Project[];
  currentUser: User;
  workspaceId?: string | null;
  onOpenCreateTask?: (initialTitle?: string, initialDescription?: string) => void;
  onOpenCreateWiki?: (initialContent: string, initialTitle?: string) => void | Promise<void>;
  onOpenReport?: () => void;
}

/** 工作区概览。用于欢迎页的四个起点与提问上下文。 */
interface WorkspaceOverview {
  openCount: number;
  inProgressCount: number;
  overdueCount: number;
  projectNames: string[];
}

const buildOverview = (tasks: Task[], projects: Project[]): WorkspaceOverview => {
  const open = tasks.filter((task) => !isCompleted(task) && !isCancelled(task));
  const overdue = open.filter((task) => task.dueDate && Date.parse(task.dueDate) < Date.now());
  return {
    openCount: open.length,
    inProgressCount: open.filter((task) => task.stateGroup === 'started').length,
    overdueCount: overdue.length,
    projectNames: projects.map((project) => project.name),
  };
};

/** 系统提示。工作区数据只用来给模型提供上下文，不写入本机存储。 */
const buildSystemPrompt = (
  overview: WorkspaceOverview,
  taskCount: number,
  currentUser: User,
): string =>
  [
    '这是一个运行在局域网协作客户端内的对话助手。请使用严谨、简洁的中文或与提问一致的语言回答。',
    `当前用户：${currentUser.nickname}`,
    `工作区规模：工作项 ${taskCount} 个，未完成 ${overview.openCount} 个，进行中 ${overview.inProgressCount} 个，已逾期 ${overview.overdueCount} 个`,
    `涉及项目：${overview.projectNames.join('、') || '（暂无项目）'}`,
    '回答时优先给出结论，再给出必要的依据；不要编造工作区中不存在的数据。',
  ].join('\n');

export { AgentWorkspace as AIWorkspace } from './AgentWorkspace';
/** Legacy renderer retained only for reading old cache formats during migration. */
export const LegacyAIWorkspace: React.FC<AIWorkspaceProps> = ({
  tasks,
  projects,
  currentUser,
  workspaceId,
  onOpenCreateTask,
  onOpenReport,
}) => {
  useLocale();
  const alive=useRef(true);
  useEffect(() => { alive.current=true; return () => { alive.current=false; }; }, []);
  const assistantName = useAssistantName();
  const conversations = useAIConversations();

  useEffect(() => {
    setAIWorkspace(workspaceId);
  }, [workspaceId]);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** 最近一次用户提问，供「重新生成」使用。 */
  const lastPromptRef = useRef<string>('');
  const activeIdRef = useRef<string | null>(null);

  const [defaultModel, setDefaultModel] = useState<string>('gpt-4o-mini');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const loadLLM = async () => {
      try {
        const cfg = await ApiService.getLLMConfig();
        if (cancelled) return;
        const def = cfg?.modelName?.trim() || 'gpt-4o-mini';
        setDefaultModel(def);
        setSelectedModel((prev) => prev || def);

        // 加载多供应商模型目录 (Catalog)
        try {
          const cat = await AI.call<Catalog>('catalog');
          if (!cancelled && cat) {
            setCatalog(cat);
          }
        } catch {
          // ignore catalog listing error
        }

        if (cfg?.baseUrl) {
          try {
            const res = await ApiService.fetchLLMModels({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey || '' });
            if (!cancelled && res.success && res.models && res.models.length > 0) {
              setAvailableModels(res.models);
            }
          } catch {
            // ignore model listing error
          }
        }
      } catch (e) {
        console.warn('Failed to load LLM config in AIWorkspace', e);
      }
    };
    void loadLLM();
    return () => { cancelled = true; };
  }, []);

  // 按模型供应商分组
  const groupedModels = useMemo(() => {
    const filterLower = modelFilter.trim().toLowerCase();
    const currentDef = defaultModel || 'gpt-4o-mini';
    const groups: Array<{
      providerId: string;
      providerName: string;
      providerType?: string;
      models: Array<{
        id: string;
        displayName: string;
        isDefault: boolean;
      }>;
    }> = [];
    const seenModelIds = new Set<string>();

    // 1. 基于已配置并绑定的多供应商连接
    if (catalog?.connections && catalog.connections.length > 0) {
      for (const conn of catalog.connections) {
        if (!conn.enabled && !conn.bound) continue;
        const validModels = (conn.models || []).filter((m) => m.enabled !== false);
        const filtered = validModels.filter((m) => {
          if (!filterLower) return true;
          return (
            m.displayName.toLowerCase().includes(filterLower) ||
            m.remoteModelId.toLowerCase().includes(filterLower) ||
            conn.name.toLowerCase().includes(filterLower)
          );
        });

        if (filtered.length > 0) {
          const items = filtered.map((m) => {
            const id = m.remoteModelId || m.displayName;
            seenModelIds.add(id);
            seenModelIds.add(m.displayName);
            return {
              id,
              displayName: m.displayName || id,
              isDefault: id === currentDef || m.displayName === currentDef,
            };
          });
          groups.push({
            providerId: conn.id,
            providerName: conn.name,
            providerType: conn.providerType,
            models: items,
          });
        }
      }
    }

    // 2. 补充尚未包含在连接列表中的可用模型或默认模型
    const extraModels = Array.from(new Set([defaultModel, ...availableModels])).filter(
      (m) => Boolean(m) && !seenModelIds.has(m)
    );
    const filteredExtra = extraModels.filter((m) => {
      if (!filterLower) return true;
      return m.toLowerCase().includes(filterLower);
    });

    if (filteredExtra.length > 0) {
      groups.push({
        providerId: '__other__',
        providerName: groups.length > 0 ? '其他模型' : '默认模型供应商',
        providerType: 'standard',
        models: filteredExtra.map((m) => ({
          id: m,
          displayName: m,
          isDefault: m === currentDef,
        })),
      });
    }

    return groups;
  }, [catalog, defaultModel, availableModels, modelFilter]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    if (isModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isModelDropdownOpen]);

  const overview = useMemo(() => buildOverview(tasks, projects), [tasks, projects]);
  const matches = useMemo(
    () => (searchQuery.trim() ? searchConversations(searchQuery) : []),
    [searchQuery, conversations],
  );

  /** 会话切换后重新读取消息。localStorage 是唯一数据源，故直接读取而非维护镜像。 */
  const syncMessages = useCallback((conversationId: string | null) => {
    setMessages(conversationId ? getMessages(conversationId) : []);
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
    syncMessages(activeId);
    setSendError(null);
  }, [activeId, syncMessages]);

  // 首屏不自动创建会话：产品约定首次启动为空状态。
  useEffect(() => {
    if (activeId || conversations.length === 0) return;
    setActiveId(conversations[0].id);
  }, [activeId, conversations]);

  const selectConversation = useCallback((conversationId: string) => {
    setActiveId(conversationId);
    setSearchQuery('');
  }, []);

  const handleCreate = useCallback(() => {
    const conversation = createConversation('');
    setActiveId(conversation.id);
    setMessages([]);
    setDraft('');
    setSendError(null);
    setSearchQuery('');
  }, []);

  const handleRename = useCallback((conversationId: string, title: string) => {
    renameConversation(conversationId, title, true);
  }, []);

  const handleDelete = useCallback(
    (conversationId: string) => {
      const remaining = getConversationSummaries().filter((item) => item.id !== conversationId);
      deleteConversation(conversationId);
      if (activeIdRef.current === conversationId) {
        const next: ConversationSummary | undefined = remaining[0];
        setActiveId(next ? next.id : null);
        setMessages(next ? getMessages(next.id) : []);
      }
    },
    [],
  );

  /**
   * 执行单次流式对话并填充助手回复。
   */
  const streamChat = useCallback(
    async (conversationId: string, question: string, assistantMessageId: string) => {
      const scope = getWorkspaceContext();
      const valid = () => alive.current && (!scope || sameWorkspace(scope));
      setIsSending(true);

      let accumulated = '';
      try {
        const systemPrompt = buildSystemPrompt(overview, tasks.length, currentUser);
        const currentModel = (selectedModel || defaultModel).trim();
        await ApiService.sendAIChatStream(
          question,
          (chunk) => {
            if (!valid()) return;
            accumulated += chunk;
            patchMessage(conversationId, assistantMessageId, { content: accumulated }, false);
            if (activeIdRef.current === conversationId) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId ? { ...msg, content: accumulated } : msg
                )
              );
            }
          },
          systemPrompt,
          currentModel || undefined,
        );
        if (!valid()) return;
        const reply = accumulated.trim();
        if (!reply) throw new Error(tr('ai:message.emptyResponse'));
        patchMessage(conversationId, assistantMessageId, { content: reply }, true);
      } catch (error) {
        if (!valid()) return;
        const detail = error instanceof Error && error.message
          ? error.message
          : tr('ai:error.unknown');
        patchMessage(
          conversationId,
          assistantMessageId,
          {
            content: accumulated,
            error: detail,
          },
          true,
        );
        if (activeIdRef.current === conversationId) setSendError(detail);
      } finally {
        if (!valid()) return;
        // 标题取自首条用户消息；用户改过名则不会再被覆盖。
        retitleFromFirstUserMessage(conversationId, tr('ai:conversation.untitled'));
        if (activeIdRef.current === conversationId) syncMessages(conversationId);
        setIsSending(false);
      }
    },
    [currentUser, defaultModel, overview, selectedModel, syncMessages, tasks.length],
  );

  /**
   * 发送一次提问。默认使用流式输出（Streaming），并在请求失败时把错误写进气泡，用户可直接重新生成。
   */
  const send = useCallback(
    async (rawText: string) => {
      const question = rawText.trim();
      if (!question || isSending) return;

      let conversationId = activeIdRef.current;
      if (!conversationId) {
        conversationId = createConversation('').id;
        setActiveId(conversationId);
        activeIdRef.current = conversationId;
      }

      lastPromptRef.current = question;
      setSendError(null);
      setDraft('');
      appendMessage(conversationId, { role: 'user', content: question });
      const assistantMessage = appendMessage(conversationId, { role: 'assistant', content: '' });
      syncMessages(conversationId);
      await streamChat(conversationId, question, assistantMessage.id);
    },
    [isSending, streamChat, syncMessages],
  );

  /** 编辑某条用户消息，截断其后的历史并重新生成新版本回复。 */
  const handleEditAndResend = useCallback(
    async (messageId: string, newText: string) => {
      const question = newText.trim();
      if (!question || isSending) return;
      const conversationId = activeIdRef.current;
      if (!conversationId) return;

      lastPromptRef.current = question;
      setSendError(null);
      editUserMessageAndTruncateAfter(conversationId, messageId, question);
      const assistantMessage = appendMessage(conversationId, { role: 'assistant', content: '' });
      syncMessages(conversationId);
      await streamChat(conversationId, question, assistantMessage.id);
    },
    [isSending, streamChat, syncMessages],
  );

  const handleSend = useCallback(() => {
    void send(draft);
  }, [draft, send]);

  /** 重新生成：删掉最后一对问答中的助手消息后重发同一个问题。 */
  const handleRetry = useCallback(() => {
    const prompt = lastPromptRef.current;
    if (!prompt || isSending) return;
    const conversationId = activeIdRef.current;
    if (!conversationId) return;
    const current = getMessages(conversationId);
    const lastMessage = current[current.length - 1];
    if (lastMessage?.role === 'assistant') {
      removeMessage(conversationId, lastMessage.id);
      syncMessages(conversationId);
    }
    void send(prompt);
  }, [isSending, send, syncMessages]);

  const activeConversation = conversations.find((item) => item.id === activeId) ?? null;
  const showWelcome = messages.length === 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-canvas text-main">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-edge bg-surface">
          <AIConversationList
            conversations={conversations}
            activeId={activeId}
            searchQuery={searchQuery}
            matches={matches}
            onSelect={selectConversation}
            onCreate={handleCreate}
            onSearchQueryChange={setSearchQuery}
            onRename={handleRename}
            onTogglePinned={togglePinned}
            onDelete={handleDelete}
          />
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas">

          <header className="flex h-11 shrink-0 items-center gap-2 border-b border-edge bg-surface px-4">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent text-on-accent">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 truncate text-xs font-semibold text-main">
              {activeConversation?.title || assistantName}
            </span>
            {activeConversation?.titleLocked && (
              <span className="shrink-0 rounded border border-subtle px-1 text-[10px] text-quiet">
                {tr('ai:conversation.renamedBadge')}
              </span>
            )}

            {/* Model Selector Dropdown */}
            <div ref={modelDropdownRef} className="relative ml-2">
              <button
                type="button"
                onClick={() => setIsModelDropdownOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-subtle bg-input/60 px-2 py-1 text-xs text-sub transition-colors hover:border-accent/40 hover:bg-hover hover:text-main"
                title={tr('ai:workspace.switchModel')}
              >
                <Cpu className="h-3.5 w-3.5 text-accent" />
                <span className="max-w-36 truncate font-mono text-[11px] font-medium text-main">
                  {selectedModel || defaultModel}
                </span>
                {selectedModel === defaultModel && (
                  <span className="rounded bg-accent/15 px-1 text-[9px] font-semibold text-accent">
                    {tr('ai:workspace.default')}
                  </span>
                )}
                <ChevronDown className="h-3 w-3 text-quiet" />
              </button>

              {isModelDropdownOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-subtle bg-surface/98 p-2 shadow-popover backdrop-blur-md">
                  <div className="mb-1.5 flex items-center justify-between border-b border-edge px-1 pb-1.5">
                    <span className="text-[11px] font-semibold text-main">
                      {tr('ai:workspace.selectModel')}
                    </span>
                    <span className="text-[10px] text-quiet">
                      {tr('ai:workspace.defaultModelNote')}
                    </span>
                  </div>

                  <div className="mb-2">
                    <input
                      type="text"
                      value={modelFilter}
                      onChange={(e) => setModelFilter(e.target.value)}
                      placeholder={tr('ai:workspace.filterModels')}
                      className="w-full rounded-md border border-edge bg-canvas px-2 py-1 text-[11px] text-main outline-none focus:border-accent/50"
                    />
                  </div>

                  <div className="max-h-72 space-y-2.5 overflow-y-auto pr-0.5 scrollbar-thin">
                    {groupedModels.length === 0 ? (
                      <div className="py-6 text-center text-xs text-quiet">未找到匹配的模型</div>
                    ) : (
                      groupedModels.map((group) => (
                        <div key={group.providerId} className="space-y-1">
                          {/* 供应商分组标题 */}
                          <div className="flex items-center gap-1.5 px-1.5 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-quiet">
                            <Building2 className="h-3 w-3 text-accent/70 shrink-0" />
                            <span className="truncate">{group.providerName}</span>
                            {group.providerType && group.providerType !== 'standard' && (
                              <span className="rounded bg-card px-1 py-0.2 text-[9px] font-mono text-sub border border-edge/60">
                                {group.providerType}
                              </span>
                            )}
                          </div>

                          {/* 分组下的模型选项 */}
                          <div className="space-y-0.5 pl-1">
                            {group.models.map((m) => {
                              const isCurrent =
                                (selectedModel || defaultModel) === m.id ||
                                (selectedModel || defaultModel) === m.displayName;
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedModel(m.id);
                                    setIsModelDropdownOpen(false);
                                  }}
                                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                                    isCurrent
                                      ? 'bg-accent/15 font-semibold text-accent'
                                      : 'text-main hover:bg-hover'
                                  }`}
                                >
                                  <div className="flex min-w-0 items-center gap-1.5 truncate">
                                    <Cpu className={`h-3 w-3 shrink-0 ${isCurrent ? 'text-accent' : 'text-quiet'}`} />
                                    <span className="truncate font-mono text-[11px]">{m.displayName}</span>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0 ml-2">
                                    {m.isDefault && (
                                      <span className="rounded bg-accent/10 px-1 py-0.2 text-[9px] font-semibold text-accent">
                                        {tr('ai:workspace.default')}
                                      </span>
                                    )}
                                    {isCurrent && <Check className="h-3.5 w-3.5 text-accent" />}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-3 text-[10px] text-quiet">
              <span
                className="flex items-center gap-1"
                title={tr('ai:workspace.workspaceSummary', {
                  value0: tasks.length,
                  value1: projects.length,
                })}
              >
                <ListChecks className="h-3 w-3" />
                <span>{tr('ai:workspace.workspaceSummary', { value0: tasks.length, value1: projects.length })}</span>
              </span>
              {overview.overdueCount > 0 && (
                <span className="flex items-center gap-1 text-warning">
                  <AlertTriangle className="h-3 w-3" />
                  <span>{overview.overdueCount}</span>
                </span>
              )}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {showWelcome ? (
              <div className="mx-auto w-full max-w-3xl px-6 py-8">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-main">
                      {assistantName} · {tr('ai:welcome.title')}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-sub">
                      {tr('ai:welcome.body', { value0: assistantName })}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <SuggestionCard
                    icon={CalendarClock}
                    label={tr('ai:welcome.suggestionOverdue')}
                    onSelect={(value) => void send(value)}
                    disabled={isSending}
                  />
                  <SuggestionCard
                    icon={ListChecks}
                    label={tr('ai:welcome.suggestionReport')}
                    onSelect={(value) => void send(value)}
                    disabled={isSending}
                  />
                  <SuggestionCard
                    icon={Sparkles}
                    label={tr('ai:welcome.suggestionBreakdown')}
                    onSelect={(value) => void send(value)}
                    disabled={isSending}
                  />
                  <SuggestionCard
                    icon={Users}
                    label={tr('ai:welcome.suggestionWorkload')}
                    onSelect={(value) => void send(value)}
                    disabled={isSending}
                  />
                </div>

                <p className="mt-4 text-[10px] leading-5 text-quiet">
                  {tr('ai:welcome.contextHint')} {tr('ai:workspace.subtitle')}
                </p>
              </div>
            ) : (
              <AIMessageList
                messages={messages}
                assistantName={assistantName}
                isSending={isSending}
                onRetry={handleRetry}
                onEditAndResend={handleEditAndResend}
                onCreateWorkItem={onOpenCreateTask}
                onOpenReport={onOpenReport}
              />
            )}
          </div>

          <AIComposer
            value={draft}
            onChange={setDraft}
            onSend={handleSend}
            disabled={false}
            sending={isSending}
            error={sendError}
            assistantName={assistantName}
            onDismissError={() => setSendError(null)}
          />
        </section>
      </div>
    </div>
  );
};

/** 欢迎页的起点卡片。点击后直接把该问题作为首条消息发送。 */
const SuggestionCard: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect: (value: string) => void;
  disabled: boolean;
}> = ({ icon: Icon, label, onSelect, disabled }) => (
  <button
    type="button"
    onClick={() => onSelect(label)}
    disabled={disabled}
    className="flex items-start gap-2 rounded-lg border border-edge bg-card px-3 py-2.5 text-left transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
  >
    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
    <span className="min-w-0 flex-1 text-[11px] leading-5 text-sub">{label}</span>
  </button>
);
