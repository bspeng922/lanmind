import { scopedStorageKey, getWorkspaceContext, type WorkspaceContext } from "../../utils/workspaceContext";
import { ApiService } from "../../services/api";
import { isTauri } from "@tauri-apps/api/core";
/**
 * 知识库持久化边界。
 *
 * 存储形状（localStorage，键 `lanmind_wiki_documents_v2`）：
 * ```json
 * { "version": 2, "selectedId": "…", "expandedIds": ["…"], "documents": [WikiDocument] }
 * ```
 *
 * 版本历史：
 * - v1（旧键 `lanmind_wiki_documents_v1`）：纯数组，字段为 id/title/category/content/updatedAt/favorite。
 *   无 `parentId`、无 `sortOrder`，`category` 已废弃。迁移时补齐字段并保留原内容，不丢弃数据。
 * - v2：引入嵌套与排序，`projectId` 取代 `category`。
 *
 * 迁移策略：优先读取 v2 信封；不存在时读取 v1 数组并升级，随后删除旧键。
 * 全部键都不存在（首次启动）时生成一篇空起始页——产品约束是首次启动不写入示例数据，
 * 因此这里只有一篇空白页，不含任何演示内容。
 *
 * 后续把持久化搬进 ApiService 时，只需要替换本文件的 `loadWikiState` / `saveWikiState`，
 * 视图契约（`WikiView` 无 props、状态形状）保持不变。
 */

import { enqueueWikiSave, rememberWikiBaseline } from './wikiPersistence';
import type { WikiDocument, WikiState } from './wikiTypes';

export const WIKI_STORAGE_KEY = 'lanmind_wiki_documents_v2';
/** v1 键。仅用于一次性升级，迁移成功后删除。 */
export const WIKI_LEGACY_STORAGE_KEY = 'lanmind_wiki_documents_v1';
export const WIKI_SCHEMA_VERSION = 2;

/** 生成页面 id。桌面端与浏览器端都可用。 */
export function createWikiId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // 受限环境下退回时间戳方案。
  }
  return `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 新建一篇空白页面。标题缺省为空，界面统一显示为「未命名页面」。 */
export function createWikiDocument(input: {
  title?: string;
  content?: string;
  parentId?: string | null;
  sortOrder?: number;
  createdBy?: string;
  createdByName?: string;
  updatedBy?: string;
  updatedByName?: string;
}): WikiDocument {
  const timestamp = nowIso();
  return {
    id: createWikiId(),
    title: input.title ?? '',
    content: input.content ?? '',
    parentId: input.parentId ?? null,
    sortOrder: input.sortOrder ?? 0,
    favorite: false,
    projectId: null,
    isLocked: false,
    tags: [],
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    updatedBy: input.updatedBy ?? input.createdBy,
    updatedByName: input.updatedByName ?? input.createdByName,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** 规范化单篇页面。字段缺失或类型不符时回退，不抛错。 */
function normalizeDocument(input: unknown, index: number): WikiDocument | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : createWikiId();
  const timestamp = typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : nowIso();
  return {
    id,
    version: typeof raw.version === "number" ? raw.version : undefined,
    workspaceId:typeof raw.workspaceId === "string" ? raw.workspaceId : undefined,
    title: typeof raw.title === 'string' ? raw.title : '',
    content: typeof raw.content === 'string' ? raw.content : '',
    // 父级先原样保留，环与悬空引用在 normalizeState 中统一处理。
    parentId: typeof raw.parentId === 'string' && raw.parentId ? raw.parentId : null,
    sortOrder:
      typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder) ? raw.sortOrder : index,
    favorite: raw.favorite === true,
    projectId: typeof raw.projectId === 'string' && raw.projectId ? raw.projectId : null,
    isLocked: raw.isLocked === true,
    icon: typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon : undefined,
    tags: Array.isArray(raw.tags)
      ? [...new Set(raw.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean))]
      : [],
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : undefined,
    createdByName: typeof raw.createdByName === 'string' ? raw.createdByName : undefined,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : undefined,
    updatedByName: typeof raw.updatedByName === 'string' ? raw.updatedByName : undefined,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : timestamp,
    updatedAt: timestamp,
  };
}

/**
 * 清理父子关系：
 * - 指向不存在页面的父级回退为顶层，避免页面从树中消失；
 * - 检测并打断父级环（断开的节点回退为顶层）；
 * - 同一父级内按 sortOrder 重排，保证序号连续。
 */
function repairHierarchy(documents: WikiDocument[]): WikiDocument[] {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  for (const doc of documents) {
    if (!doc.parentId) continue;
    if (doc.parentId === doc.id || !byId.has(doc.parentId)) {
      doc.parentId = null;
      continue;
    }
    // 沿父链上溯，遇到自身说明存在环。
    let cursor = byId.get(doc.parentId);
    let guard = 0;
    while (cursor && guard++ < documents.length + 1) {
      if (cursor.id === doc.id) {
        doc.parentId = null;
        break;
      }
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }

  const groups = new Map<string, WikiDocument[]>();
  for (const doc of documents) {
    const key = doc.parentId ?? '';
    const list = groups.get(key);
    if (list) list.push(doc);
    else groups.set(key, [doc]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    list.forEach((doc, index) => {
      doc.sortOrder = index;
    });
  }
  return documents;
}

function normalizeState(raw: unknown): WikiState | null {
  if (!raw || typeof raw !== 'object') return null;
  const envelope = raw as Record<string, unknown>;
  if (!Array.isArray(envelope.documents)) return null;
  const documents = repairHierarchy(
    envelope.documents.map(normalizeDocument).filter((doc): doc is WikiDocument => Boolean(doc)),
  );
  const ids = new Set(documents.map((doc) => doc.id));
  const selectedId = typeof envelope.selectedId === 'string' && ids.has(envelope.selectedId) ? envelope.selectedId : null;
  const expandedIds = Array.isArray(envelope.expandedIds)
    ? envelope.expandedIds.filter((value): value is string => typeof value === 'string' && ids.has(value))
    : [];
  return { documents, selectedId, expandedIds };
}

/** 把 v1 的纯数组升级为 v2 信封。v1 没有嵌套，全部落在顶层。 */
export function migrateLegacyDocuments(raw: unknown): WikiState | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const documents = repairHierarchy(
    raw
      .map((item, index) =>
        normalizeDocument(
          item && typeof item === 'object'
            ? { ...(item as Record<string, unknown>), parentId: null, sortOrder: index, projectId: null }
            : null,
          index,
        ),
      )
      .filter((doc): doc is WikiDocument => Boolean(doc)),
  );
  if (!documents.length) return null;
  return { documents, selectedId: documents[0].id, expandedIds: [] };
}

/** 首次启动时的唯一内容：一篇空白起始页，不含示例数据。 */
export function createStarterState(): WikiState {
  const page = createWikiDocument({ title: '' });
  return { documents: [page], selectedId: page.id, expandedIds: [] };
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getWikiStorageKey(workspaceId?: string | null, current = getWorkspaceContext()): string {
  return scopedStorageKey(WIKI_STORAGE_KEY, workspaceId ? { workspaceId, userId:current?.userId ?? "uninitialized", revision:current?.revision ?? 0 } : current);
}

/**
 * 读取知识库状态。
 * 读取顺序：对应工作区的 v2 信封 → 已迁移的用户命名空间内 v1 数组→ 首次启动空白页。
 */
export function loadWikiState(workspaceId?: string | null, scope = getWorkspaceContext()): WikiState {
  const wsKey = getWikiStorageKey(workspaceId, scope);
  const current = readRaw(wsKey);
  if (current !== null) {
    try {
      const parsed = normalizeState(JSON.parse(current));
      if (parsed) { const allowed=parsed.documents.filter(doc => !(doc as WikiDocument & {workspaceId?:string}).workspaceId || (doc as WikiDocument & {workspaceId?:string}).workspaceId===workspaceId); return {...parsed,documents:allowed}; }
    } catch {
      // 数据损坏时继续尝试
    }
  }

  const legacy = readRaw(scopedStorageKey(WIKI_LEGACY_STORAGE_KEY, scope));
  if (legacy !== null) {
    try {
      const migrated = migrateLegacyDocuments(JSON.parse(legacy));
      if (migrated) {
        saveWikiState(migrated, workspaceId, scope);
        return migrated;
      }
    } catch {
      // 旧数据无法解析，按首次启动处理。
    }
  }

  return createStarterState();
}

/** 写入知识库状态。存储被禁用（隐私模式、配额超限）时静默失败，界面保留内存副本。 */
export function saveWikiState(state: WikiState, workspaceId?: string | null, scope = getWorkspaceContext(), persistBackend = true): boolean {
  try {
    const wsKey = getWikiStorageKey(workspaceId, scope);
    const previous=localStorage.getItem(wsKey);
    const oldDocs: WikiDocument[]=previous ? (JSON.parse(previous).documents ?? []) : [];
    const documents=state.documents.map(doc => ({...doc, workspaceId}));
    if (documents.some(doc => doc.parentId && !documents.some(parent => parent.id===doc.parentId))) return false;
    localStorage.setItem(
      wsKey,
      JSON.stringify({
        version: WIKI_SCHEMA_VERSION,
        selectedId: state.selectedId,
        expandedIds: state.expandedIds,
        workspaceId,
        documents,
      }),
    );

    if (!persistBackend) rememberWikiBaseline(wsKey, documents);
    if (persistBackend && isTauri() && workspaceId && scope?.workspaceId === workspaceId) {
      enqueueWikiSave(wsKey, { ...state, documents }, oldDocs, scope);
    }
    return true;
  } catch {
    return false;
  }
}

/** 取某个父级下的直接子页面，已按 sortOrder 排序。 */
export function childrenOf(documents: WikiDocument[], parentId: string | null): WikiDocument[] {
  return documents
    .filter((doc) => doc.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** 取某页面的所有后代 id（含自身）。 */
export function collectSubtreeIds(documents: WikiDocument[], rootId: string): string[] {
  const byParent = new Map<string | null, WikiDocument[]>();
  for (const doc of documents) {
    const list = byParent.get(doc.parentId);
    if (list) list.push(doc);
    else byParent.set(doc.parentId, [doc]);
  }
  const result: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    for (const child of byParent.get(id) ?? []) stack.push(child.id);
  }
  return result;
}

/** 取从顶层到该页面的祖先链（不含自身）。 */
export function ancestorsOf(documents: WikiDocument[], pageId: string): WikiDocument[] {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const chain: WikiDocument[] = [];
  let cursor = byId.get(pageId)?.parentId;
  let guard = 0;
  while (cursor && guard++ <= documents.length) {
    const doc = byId.get(cursor);
    if (!doc) break;
    chain.unshift(doc);
    cursor = doc.parentId;
  }
  return chain;
}

/** 把页面数组压缩成可直接用于片段的纯文本。 */
export function pagePlainText(doc: WikiDocument): string {
  return doc.content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/[*_>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface WikiSearchHit {
  document: WikiDocument;
  /** 标题命中标记。标题命中时片段省略，避免重复。 */
  titleMatched: boolean;
  snippet: string;
}

/**
 * 在标题与正文中检索。标题命中优先，其次是正文片段。
 * 中文没有词边界，因此使用大小写不敏感的朴素养匹配。
 */
export function searchWiki(documents: WikiDocument[], query: string): WikiSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: WikiSearchHit[] = [];
  for (const doc of documents) {
    const titleMatched = doc.title.toLowerCase().includes(needle);
    const text = pagePlainText(doc);
    const bodyIndex = text.toLowerCase().indexOf(needle);
    if (!titleMatched && bodyIndex === -1) continue;
    const snippet = bodyIndex === -1
      ? text.slice(0, 120)
      : `${bodyIndex > 28 ? '…' : ''}${text.slice(Math.max(0, bodyIndex - 28), bodyIndex + needle.length + 72)}${bodyIndex + needle.length + 72 < text.length ? '…' : ''}`;
    hits.push({ document: doc, titleMatched, snippet });
  }
  return hits.sort((a, b) => {
    if (a.titleMatched !== b.titleMatched) return a.titleMatched ? -1 : 1;
    return b.document.updatedAt.localeCompare(a.document.updatedAt);
  });
}
