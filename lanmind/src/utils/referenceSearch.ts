/**
 * referenceSearch — 跨业务实体（Wiki文档、任务、AI对话）的快速引用检索。
 *
 * CALLING SPEC:
 *   const results = await searchReferenceItems(query, {
 *     tasks?: Task[];
 *     documents?: WikiDocument[];
 *     conversations?: Conversation[];
 *     projects?: Project[];
 *     kind?: 'all' | 'wiki' | 'task' | 'ai';
 *     limit?: number;
 *   });
 */

import { ApiService } from '../services/api';
import { featureEnabled } from '../modules/state';
import { AI, type Conversation } from '../components/ai/aiClient';
import { loadWikiState } from '../components/wiki/wikiStore';
import { getWorkspaceContext } from './workspaceContext';
import { wikiReferenceMarkdown, wikiReferenceUrl } from '../components/wiki/wikiLinks';
import { taskReferenceMarkdown, taskReferenceUrl } from './taskLinks';
import { aiConversationReferenceMarkdown, aiConversationReferenceUrl } from '../components/ai/aiLinks';
import type { WikiDocument } from '../components/wiki/wikiTypes';
import type { Task, Project } from '../types';

export type ReferenceKind = 'all' | 'wiki' | 'task' | 'ai';

export interface ReferenceItem {
  id: string;
  kind: 'wiki' | 'task' | 'ai';
  title: string;
  subtitle: string;
  badge: string;
  markdown: string;
}

export interface SearchReferenceOptions {
  tasks?: Task[];
  documents?: WikiDocument[];
  conversations?: Conversation[];
  projects?: Project[];
  kind?: ReferenceKind;
  limit?: number;
  excludeId?: string;
}

/** 统一获取或补齐数据源并执行模糊检索 */
export async function searchReferenceItems(
  query: string,
  options: SearchReferenceOptions = {}
): Promise<ReferenceItem[]> {
  const q = query.trim().toLowerCase();
  const limit = options.limit ?? 25;
  const targetKind = options.kind ?? 'all';
  const scope = getWorkspaceContext();
  const results: ReferenceItem[] = [];

  // 1. 文档 (Wiki)
  if (featureEnabled('wiki') && (targetKind === 'all' || targetKind === 'wiki')) {
    let docs = options.documents;
    if (!docs) {
      try {
        const state = loadWikiState(scope?.workspaceId, scope);
        docs = state.documents;
      } catch {
        docs = [];
      }
    }
    const docMap = new Map<string, WikiDocument>(docs.map((d) => [d.id, d]));
    const getPath = (doc: WikiDocument) => {
      const parts: string[] = [];
      let cursor = doc.parentId;
      let guard = 0;
      while (cursor && guard++ < 20) {
        const parent = docMap.get(cursor);
        if (!parent) break;
        parts.unshift(parent.title || '未命名');
        cursor = parent.parentId;
      }
      return parts.length ? parts.join(' / ') : '';
    };

    for (const doc of docs) {
      if (options.excludeId && doc.id === options.excludeId) continue;
      const title = (doc.title || '').trim();
      const path = getPath(doc);
      if (!q || title.toLowerCase().includes(q) || path.toLowerCase().includes(q)) {
        const url = wikiReferenceUrl(doc);
        results.push({
          id: doc.id,
          kind: 'wiki',
          title: title || '未命名页面',
          subtitle: path || '知识库文档',
          badge: '文档',
          markdown: wikiReferenceMarkdown(doc, url),
        });
      }
    }
  }

  // 2. 任务 (Task)
  if (targetKind === 'all' || targetKind === 'task') {
    let tasks = options.tasks;
    if (!tasks) {
      try {
        tasks = await ApiService.getTasks();
      } catch {
        tasks = [];
      }
    }
    const projects = options.projects || [];
    const projectMap = new Map<string, Project>(projects.map((p) => [p.id, p]));

    for (const task of tasks) {
      if (options.excludeId && task.id === options.excludeId) continue;
      const title = (task.title || '').trim();
      const project = task.projectId ? projectMap.get(task.projectId)?.name : '';
      if (!q || title.toLowerCase().includes(q) || (project && project.toLowerCase().includes(q))) {
        const url = taskReferenceUrl(task);
        results.push({
          id: task.id,
          kind: 'task',
          title: title || '未命名任务',
          subtitle: project ? `项目: ${project}` : '个人任务',
          badge: '任务',
          markdown: taskReferenceMarkdown(task, url),
        });
      }
    }
  }

  // 3. AI 对话 (Conversation)
  if (featureEnabled('ai') && (targetKind === 'all' || targetKind === 'ai')) {
    let convs = options.conversations;
    if (!convs) {
      try {
        convs = await AI.call<Conversation[]>('conversations');
      } catch {
        convs = [];
      }
    }
    for (const conv of convs) {
      if (options.excludeId && conv.id === options.excludeId) continue;
      const title = (conv.title || '').trim();
      if (!q || title.toLowerCase().includes(q)) {
        const url = aiConversationReferenceUrl(conv);
        const dateStr = conv.updatedAt ? new Date(conv.updatedAt).toLocaleDateString() : '';
        results.push({
          id: conv.id,
          kind: 'ai',
          title: title || '未命名对话',
          subtitle: dateStr ? `AI 对话 · ${dateStr}` : 'AI 对话',
          badge: 'AI 对话',
          markdown: aiConversationReferenceMarkdown(conv, url),
        });
      }
    }
  }

  return results.slice(0, limit);
}
