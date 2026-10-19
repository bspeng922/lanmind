import { scopedStorageKey, getWorkspaceContext, sameWorkspace, type WorkspaceContext } from "../../utils/workspaceContext";
import { ApiService } from "../../services/api";
import { isTauri } from "@tauri-apps/api/core";
/**
 * aiStore.ts — AI 对话记录的本地持久化与订阅层。
 *
 * CALLING SPEC:
 *   import { useAIConversations, startAIConversation } from './aiStore';
 *   const list = useAIConversations();          // 会话摘要，已按置顶 + 更新时间排序
 *
 *   // 查询
 *   getConversationSummaries()                  // ConversationSummary[]
 *   getMessages(conversationId)                 // AIMessage[]
 *   searchConversations(query)                  // AIConversationMatch[]
 *   subscribe(listener)                         // () => void，取消订阅
 *
 *   // 写入
 *   createConversation(title?)                  // ConversationSummary
 *   appendMessage(conversationId, message)      // 写入并刷新 updatedAt
 *   patchMessage(conversationId, id, patch)
 *   renameConversation(conversationId, title)   // 用户改名后置 titleLocked
 *   togglePinned(conversationId)
 *   deleteConversation(conversationId)
 *   retitleFromFirstUserMessage(conversationId) // 仅在未改名时生效
 *
 * TOOL CONTRACT:
 *   - 存储：localStorage。会话索引键 `lanmind_ai_conversations_v1`，
 *     每个会话的消息单独存于 `lanmind_ai_messages_v1:<conversationId>`，
 *     避免每次追加消息重写整段历史。
 *   - 索引结构：{ version: 1, conversations: ConversationSummary[] }，
 *     其中 summary 为 { id, title, titleLocked, pinned, createdAt, updatedAt, messageCount }。
 *   - 迁移：`migrateIndex` 接受任意历史结构，缺失字段补默认值；无法识别的记录被丢弃
 *     而不是让整份记录作废。旧版无版本号的 `conversations` 数组同样会被升级。
 *   - 写入失败（隐私模式、配额耗尽）保持静默并继续更新内存状态，界面不因此中断。
 *   - 首次启动不做任何写入，因此不会生成示例数据。
 */

import { useSyncExternalStore } from 'react';

/** 单条消息的角色。第一阶段只区分本机用户与助手。 */
export type AIRole = 'user' | 'assistant';

export interface AIMessage {
  id: string;
  role: AIRole;
  content: string;
  /** ISO 时间戳，展示时交给 chatTime 的格式化函数。 */
  createdAt: string;
  /** 请求失败时记录的错误文案，用于在气泡内展示重试提示。 */
  error?: string | null;
}

/** 会话摘要。列表与搜索只依赖它，读消息内容时才展开。 */
export interface ConversationSummary {
  id: string;
  title: string;
  /** 用户手动改名后置为 true，自动标题不再覆盖。 */
  titleLocked: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface AIConversationMatch {
  conversation: ConversationSummary;
  /** 命中位置的来源：标题或消息正文。 */
  scope: 'title' | 'message';
  /** 消息命中的片段，供结果行预览。 */
  snippet: string;
}

const INDEX_KEY = 'lanmind_ai_conversations_v1';
const MESSAGES_KEY_PREFIX = 'lanmind_ai_messages_v1:';
const SCHEMA_VERSION = 1;

let currentWorkspaceId: string | null = null;
let currentScope: WorkspaceContext | null = null;
let generation=0;

const getIndexKey = () => scopedStorageKey(INDEX_KEY, currentScope);
const getMessagesKeyPrefix = () => scopedStorageKey(MESSAGES_KEY_PREFIX, currentScope);

export const setAIWorkspace = (workspaceId?: string | null): void => {
  const next = workspaceId || null;
  if (currentWorkspaceId === next && currentScope?.userId === getWorkspaceContext()?.userId) return;
  currentWorkspaceId = next;
  const ctx=getWorkspaceContext();
  currentScope=next ? {...(ctx ?? {userId:"uninitialized",revision:0}),workspaceId:next} : null;
  summaries=[];
  generation++;
  loaded = false;
  messageCache.clear();
  loadFromStorage();
  emit();
  if (isTauri() && currentScope) {
    const scope=currentScope; const started=generation;
    void ApiService.getWorkspaceData('ai').then(value => {
      if (!sameWorkspace(scope,currentScope) || generation!==started) return;
      if (!value) { if (summaries.length) persistIndex(); return; }
      const data=value as { index:StoredIndex; messages:Record<string,AIMessage[]> };
      localStorage.setItem(getIndexKey(),JSON.stringify(data.index));
      for (const [id,messages] of Object.entries(data.messages)) localStorage.setItem(getMessagesKeyPrefix()+id,JSON.stringify(messages));
      reloadAIConversations();
    }).catch(console.error);
  }
};

/** 会话数量上限，超出后丢弃最旧的未置顶会话。 */
const MAX_CONVERSATIONS = 200;
/** 单个会话保留的消息条数上限。 */
const MAX_MESSAGES_PER_CONVERSATION = 500;
/** 搜索返回的结果条数上限。 */
export const SEARCH_RESULT_LIMIT = 30;
/** 自动标题截断长度。 */
const AUTO_TITLE_MAX_LENGTH = 40;

interface StoredIndex {
  version: number;
  conversations: ConversationSummary[];
}

let summaries: ConversationSummary[] = [];
let loaded = false;
const messageCache = new Map<string, AIMessage[]>();
const listeners = new Set<() => void>();

export const formatAITimestamp = (value: string | Date = new Date()): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

const safeCreateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

/** 把任意来源的标题收敛成可显示的一行。 */
const normalizeTitle = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return fallback;
  return collapsed.length > AUTO_TITLE_MAX_LENGTH
    ? `${collapsed.slice(0, AUTO_TITLE_MAX_LENGTH).trimEnd()}…`
    : collapsed;
};

/** 由首条用户消息推导标题。命令行式输入会被截到第一个换行。 */
export const deriveTitleFromMessage = (content: string, fallback: string): string => {
  const firstLine = content.split('\n').find((line) => line.trim()) ?? '';
  const stripped = firstLine.replace(/^(?:\d{1,3}[.)]\s+|[#>\-*+]\s*)+/, '').trim();
  return normalizeTitle(stripped, fallback);
};

const normalizeSummary = (raw: unknown): ConversationSummary | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) return null;
  const createdAt = isIsoDate(record.createdAt) ? record.createdAt : formatAITimestamp();
  const updatedAt = isIsoDate(record.updatedAt) ? record.updatedAt : createdAt;
  return {
    id,
    title: typeof record.title === 'string' ? record.title : '',
    titleLocked: record.titleLocked === true,
    pinned: record.pinned === true,
    createdAt,
    updatedAt,
    messageCount: typeof record.messageCount === 'number' && record.messageCount > 0
      ? Math.floor(record.messageCount)
      : 0,
  };
};

/**
 * 把已保存的任意结构升级为当前版本。
 * 缺失字段补默认值，损坏的记录单独丢弃；无版本号的旧结构同样按 v1 规则读取。
 */
export const migrateIndex = (raw: unknown): ConversationSummary[] => {
  if (!raw || typeof raw !== 'object') return [];
  const record = raw as Record<string, unknown>;
  const list = Array.isArray(record.conversations)
    ? record.conversations
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  const seen = new Set<string>();
  const migrated: ConversationSummary[] = [];
  for (const item of list) {
    const summary = normalizeSummary(item);
    if (!summary || seen.has(summary.id)) continue;
    seen.add(summary.id);
    migrated.push(summary);
  }
  // version 缺省或低于当前版本时按同一份规则升级：字段级补全已在上面完成。
  void record.version;
  return migrated;
};

const normalizeMessage = (raw: unknown): AIMessage | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const content = typeof record.content === 'string' ? record.content : '';
  const role: AIRole = record.role === 'user' ? 'user' : 'assistant';
  if (!content.trim() && role === 'user') return null;
  return {
    id: typeof record.id === 'string' && record.id ? record.id : `msg-${safeCreateId()}`,
    role,
    content,
    createdAt: isIsoDate(record.createdAt) ? record.createdAt : formatAITimestamp(),
    error: typeof record.error === 'string' ? record.error : null,
  };
};

/**
 * 排序：置顶优先，其次按最近更新时间倒序。
 * 同一毫秒内产生的会话以创建时间、再以 id 作为次序依据，
 * 保证排序是全序，列表不会因为写入时机不同而抖动。
 */
const compareSummaries = (left: ConversationSummary, right: ConversationSummary): number => {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const byUpdate = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (byUpdate !== 0) return byUpdate;
  const byCreated = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (byCreated !== 0) return byCreated;
  return right.id.localeCompare(left.id);
};

const sortSummaries = (list: ConversationSummary[]): ConversationSummary[] =>
  [...list].sort(compareSummaries);

const persistIndex = () => {
  try {
    const payload: StoredIndex = { version: SCHEMA_VERSION, conversations: summaries };
    localStorage.setItem(getIndexKey(), JSON.stringify(payload));
    generation++;
    if (isTauri() && currentScope && sameWorkspace(currentScope)) {
      const messages=Object.fromEntries(summaries.map(summary => [summary.id, readMessages(summary.id)]));
      void ApiService.saveWorkspaceData('ai',{index:payload,messages},currentScope).catch(console.error);
    }
  } catch {
    // 配额或权限受限时保持静默：内存状态仍然可用，界面不应因此报错。
  }
};

const persistMessages = (conversationId: string, messages: AIMessage[]) => {
  try {
    localStorage.setItem(getMessagesKeyPrefix() + conversationId, JSON.stringify(messages));
  } catch {
    // 同上，写入失败不阻断当前会话。
  }
};

const emit = () => {
  summaries = sortSummaries(summaries);
  listeners.forEach((listener) => listener());
};

const loadFromStorage = (): void => {
  if (loaded) return;
  loaded = true;
  try {
    let raw = localStorage.getItem(getIndexKey());
    summaries = raw ? migrateIndex(JSON.parse(raw)) : [];
  } catch {
    summaries = [];
  }
  summaries = sortSummaries(summaries);
  if (summaries.length > MAX_CONVERSATIONS) {
    const kept = new Set(summaries.slice(0, MAX_CONVERSATIONS).map((item) => item.id));
    summaries
      .filter((item) => !kept.has(item.id))
      .forEach((item) => {
        messageCache.delete(item.id);
        try {
          localStorage.removeItem(getMessagesKeyPrefix() + item.id);
        } catch {
          /* 清理失败不影响当前列表。 */
        }
      });
    summaries = summaries.filter((item) => kept.has(item.id));
    persistIndex();
  }
};

const readMessages = (conversationId: string): AIMessage[] => {
  const cached = messageCache.get(conversationId);
  if (cached) return cached;
  let parsed: AIMessage[] = [];
  try {
    let raw = localStorage.getItem(getMessagesKeyPrefix() + conversationId);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(list)) {
      parsed = list
        .map(normalizeMessage)
        .filter((item): item is AIMessage => item !== null)
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    }
  } catch {
    parsed = [];
  }
  messageCache.set(conversationId, parsed);
  return parsed;
};

/* ------------------------------------------------------------------ *
 * 读取接口
 * ------------------------------------------------------------------ */

export const subscribe = (listener: () => void) => {
  loadFromStorage();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getConversationSummaries = (): ConversationSummary[] => {
  loadFromStorage();
  return summaries;
};

export const getConversationSummary = (conversationId: string): ConversationSummary | null =>
  getConversationSummaries().find((item) => item.id === conversationId) ?? null;

export const getMessages = (conversationId: string): AIMessage[] => {
  loadFromStorage();
  return readMessages(conversationId);
};

/**
 * 跨标题与消息正文搜索。
 * 命中消息时返回该条消息的片段，供结果行直接展示上下文。
 */
export const searchConversations = (query: string): AIConversationMatch[] => {
  loadFromStorage();
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return [];
  const matches: AIConversationMatch[] = [];
  for (const conversation of summaries) {
    if (matches.length >= SEARCH_RESULT_LIMIT) break;
    if (conversation.title.toLocaleLowerCase().includes(keyword)) {
      matches.push({ conversation, scope: 'title', snippet: conversation.title });
      continue;
    }
    const hit = readMessages(conversation.id).find((message) =>
      message.role === 'user' && message.content.toLocaleLowerCase().includes(keyword)
    );
    if (hit) {
      const index = hit.content.toLocaleLowerCase().indexOf(keyword);
      const start = Math.max(0, index - 24);
      const snippet = `${start > 0 ? '…' : ''}${hit.content.slice(start, start + 90).replace(/\s+/g, ' ').trim()}${
        hit.content.length > start + 90 ? '…' : ''
      }`;
      matches.push({ conversation, scope: 'message', snippet });
    }
  }
  return matches;
};

/* ------------------------------------------------------------------ *
 * 写入接口
 * ------------------------------------------------------------------ */

export const createConversation = (title = ''): ConversationSummary => {
  loadFromStorage();
  const now = formatAITimestamp();
  const conversation: ConversationSummary = {
    id: `conv-${now.replace(/[-:.]/g, '')}-${safeCreateId().slice(0, 6)}`,
    title,
    titleLocked: false,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
  summaries = sortSummaries([conversation, ...summaries]);
  messageCache.set(conversation.id, []);
  persistIndex();
  emit();
  return conversation;
};

export const appendMessage = (
  conversationId: string,
  message: Omit<AIMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
): AIMessage => {
  loadFromStorage();
  const stored: AIMessage = {
    id: message.id || `msg-${Date.now()}-${safeCreateId().slice(0, 6)}`,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt || formatAITimestamp(),
    error: message.error ?? null,
  };
  const next = [...readMessages(conversationId), stored];
  const trimmed = next.length > MAX_MESSAGES_PER_CONVERSATION
    ? next.slice(next.length - MAX_MESSAGES_PER_CONVERSATION)
    : next;
  messageCache.set(conversationId, trimmed);
  persistMessages(conversationId, trimmed);
  summaries = summaries.map((item) =>
    item.id === conversationId
      ? { ...item, updatedAt: stored.createdAt, messageCount: trimmed.length }
      : item
  );
  persistIndex();
  emit();
  return stored;
};

export const patchMessage = (
  conversationId: string,
  messageId: string,
  patch: Partial<Pick<AIMessage, 'content' | 'error'>>,
  persist = true
): void => {
  loadFromStorage();
  const current = readMessages(conversationId);
  if (!current.some((message) => message.id === messageId)) return;
  const next = current.map((message) => (message.id === messageId ? { ...message, ...patch } : message));
  messageCache.set(conversationId, next);
  if (persist) {
    persistMessages(conversationId, next);
    persistIndex();
  }
  emit();
};

/** 从会话中移除一条消息。用于重试时删除失败的助手回复。 */
export const removeMessage = (conversationId: string, messageId: string): void => {
  loadFromStorage();
  const current = readMessages(conversationId);
  const next = current.filter((message) => message.id !== messageId);
  if (next.length === current.length) return;
  messageCache.set(conversationId, next);
  persistMessages(conversationId, next);
  summaries = summaries.map((item) =>
    item.id === conversationId ? { ...item, messageCount: next.length } : item
  );
  persistIndex();
  emit();
};

/**
 * 截断指定消息之后的所有后续消息，并将该消息的内容更新为 newContent。
 * 供编辑消息并重新生成新版本回复时使用。
 */
export const editUserMessageAndTruncateAfter = (
  conversationId: string,
  messageId: string,
  newContent: string,
): AIMessage[] => {
  loadFromStorage();
  const current = readMessages(conversationId);
  const targetIndex = current.findIndex((message) => message.id === messageId);
  if (targetIndex === -1) return current;

  const targetMsg = current[targetIndex];
  const updatedMsg: AIMessage = {
    ...targetMsg,
    content: newContent,
    error: null,
  };

  const next = [...current.slice(0, targetIndex), updatedMsg];
  messageCache.set(conversationId, next);
  persistMessages(conversationId, next);
  summaries = summaries.map((item) =>
    item.id === conversationId ? { ...item, messageCount: next.length, updatedAt: formatAITimestamp() } : item
  );
  persistIndex();
  emit();
  return next;
};

/** 重命名。用户主动改名后锁定标题，自动标题不再覆盖。 */
export const renameConversation = (conversationId: string, title: string, lock = true): void => {
  loadFromStorage();
  summaries = summaries.map((item) =>
    item.id === conversationId
      ? { ...item, title: normalizeTitle(title, ''), titleLocked: lock, updatedAt: formatAITimestamp() }
      : item
  );
  persistIndex();
  emit();
};

export const togglePinned = (conversationId: string): void => {
  loadFromStorage();
  summaries = summaries.map((item) =>
    item.id === conversationId ? { ...item, pinned: !item.pinned } : item
  );
  persistIndex();
  emit();
};

export const deleteConversation = (conversationId: string): void => {
  loadFromStorage();
  summaries = summaries.filter((item) => item.id !== conversationId);
  messageCache.delete(conversationId);
  try {
    localStorage.removeItem(getMessagesKeyPrefix() + conversationId);
  } catch {
    // 已删除的索引项不会再被读取，残留数据不影响使用。
  }
  persistIndex();
  emit();
};

/**
 * 依据首条用户消息生成标题。
 * 仅在标题未被用户改过、且会话内只有一条用户消息时生效，避免覆盖已确认的名称。
 */
export const retitleFromFirstUserMessage = (conversationId: string, fallback: string): void => {
  loadFromStorage();
  const conversation = summaries.find((item) => item.id === conversationId);
  if (!conversation || conversation.titleLocked) return;
  const firstUserMessage = readMessages(conversationId).find((message) => message.role === 'user');
  if (!firstUserMessage) return;
  const title = deriveTitleFromMessage(firstUserMessage.content, fallback);
  if (!title || title === conversation.title) return;
  summaries = summaries.map((item) => (item.id === conversationId ? { ...item, title } : item));
  persistIndex();
  emit();
};

/**
 * 丢弃内存缓存后重新读取存储，等同于一次重载。
 * 用于测试模拟「重新打开应用」，不会删除任何已保存的内容。
 */
export const reloadAIConversations = (): void => {
  messageCache.clear();
  loaded = false;
  summaries = [];
  loadFromStorage();
  emit();
};

/** React 订阅入口。所有会话摘要共用一个快照。 */
export const useAIConversations = (): ConversationSummary[] =>
  useSyncExternalStore(subscribe, getConversationSummaries, getConversationSummaries);
