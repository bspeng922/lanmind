/**
 * 知识库数据形状。
 *
 * 调用约定：
 * - `WikiDocument` 是持久化单元，`parentId` 为空表示顶层页面，`sortOrder` 只在同一父级内比较。
 * - `WikiState` 是 wikiStore 的读写单元，`documents` 之外的字段只影响界面状态，缺失时按默认值回退。
 * - 该文件不引入 React 与 localStorage，便于后续把持久化边界搬到 ApiService。
 */

/** 单篇知识库页面。 */
export interface WikiDocument {
  workspaceId?: string;
  version?: number;
  id: string;
  title: string;
  /** Markdown 原文。 */
  content: string;
  /** 父页面 id。为空表示顶层页面。 */
  parentId: string | null;
  /** 同一父级内的排序序号，越小越靠前。 */
  sortOrder: number;
  /** 是否收藏。收藏结果固定在文档树顶部单独列出。 */
  favorite: boolean;
  /** 关联的协作项目 id。为空表示未关联。 */
  projectId: string | null;
  /** 是否只读锁定（防手滑误修改）。 */
  isLocked?: boolean;
  /** 页面图标（Notion 风格 emoji 或图标）。 */
  icon?: string;
  /** 页面标签。旧页面未设置时视为空列表。 */
  tags?: string[];
  /** 创建者用户 ID 与姓名。 */
  createdBy?: string;
  createdByName?: string;
  /** 最后修改者用户 ID 与姓名。 */
  updatedBy?: string;
  updatedByName?: string;
  createdAt: string;
  updatedAt: string;
}

/** 页面历史修改记录（版本快照）。 */
export interface WikiRevision {
  id: string;
  documentId: string;
  version: number;
  title: string;
  content: string;
  authorId: string;
  authorName: string;
  comment?: string;
  createdAt: string;
}

/** 页面评论引用快照。 */
export interface WikiCommentQuote {
  commentId: string;
  authorId: string;
  authorName: string;
  content: string;
}

/** 页面协同评论。 */
export interface WikiComment {
  id: string;
  documentId: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  content: string;
  replyToCommentId?: string;
  replyTo?: WikiCommentQuote | null;
  createdAt: string;
}

/** 持久化的知识库状态。 */
export interface WikiState {
  documents: WikiDocument[];
  /** 上次打开的页面 id。指向已删除的页面时由视图回退到第一篇。 */
  selectedId: string | null;
  /** 展开的父页面 id 列表。 */
  expandedIds: string[];
}

/** 关联项目选择器需要的最小项目信息。 */
export interface WikiProjectOption {
  id: string;
  name: string;
  color?: string;
}
