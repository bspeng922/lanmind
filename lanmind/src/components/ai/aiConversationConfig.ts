/**
 * aiConversationConfig — 会话配置的持久化与恢复（模式、模型、Skill、MCP、授权目录）。
 *
 * CALLING SPEC:
 *   saveConversationConfig(conversationId, { mode, model, skills, mcp, roots });
 *   getSavedConversationConfig(conversationId) -> ConversationConfig | null;
 *   saveLastActiveAiConversationId(conversationId);
 *   getLastActiveAiConversationId() -> string | null;
 *   inferConfigFromView(view) -> ConversationConfig;
 */

import { scopedStorageKey, getWorkspaceContext } from '../../utils/workspaceContext';
import { modelKey, type View } from './aiClient';

export interface ConversationConfig {
  mode: string; // 'chat' | 'workspace' | 'files'
  model: string;
  skills: string[];
  mcp: string[];
  roots: string[];
}

const CONFIG_PREFIX = 'ai-conv-config:';
const LAST_ACTIVE_KEY = 'ai-last-active-conversation';

export function getSavedConversationConfig(
  conversationId: string,
  scope = getWorkspaceContext()
): ConversationConfig | null {
  if (!conversationId) return null;
  try {
    const raw = localStorage.getItem(scopedStorageKey(`${CONFIG_PREFIX}${conversationId}`, scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      mode: typeof parsed.mode === 'string' ? parsed.mode : 'chat',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      mcp: Array.isArray(parsed.mcp) ? parsed.mcp : [],
      roots: Array.isArray(parsed.roots) ? parsed.roots : [],
    };
  } catch {
    return null;
  }
}

export function saveConversationConfig(
  conversationId: string,
  patch: Partial<ConversationConfig>,
  scope = getWorkspaceContext()
): void {
  if (!conversationId) return;
  try {
    const existing = getSavedConversationConfig(conversationId, scope) || {
      mode: 'chat',
      model: '',
      skills: [],
      mcp: [],
      roots: [],
    };
    const updated: ConversationConfig = {
      mode: patch.mode !== undefined ? patch.mode : existing.mode,
      model: patch.model !== undefined ? patch.model : existing.model,
      skills: patch.skills !== undefined ? patch.skills : existing.skills,
      mcp: patch.mcp !== undefined ? patch.mcp : existing.mcp,
      roots: patch.roots !== undefined ? patch.roots : existing.roots,
    };
    localStorage.setItem(
      scopedStorageKey(`${CONFIG_PREFIX}${conversationId}`, scope),
      JSON.stringify(updated)
    );
  } catch {}
}

export function getLastActiveAiConversationId(scope = getWorkspaceContext()): string | null {
  try {
    return localStorage.getItem(scopedStorageKey(LAST_ACTIVE_KEY, scope)) || null;
  } catch {
    return null;
  }
}

export function saveLastActiveAiConversationId(
  conversationId: string | null,
  scope = getWorkspaceContext()
): void {
  try {
    const key = scopedStorageKey(LAST_ACTIVE_KEY, scope);
    if (conversationId) {
      localStorage.setItem(key, conversationId);
    } else {
      localStorage.removeItem(key);
    }
  } catch {}
}

export function inferConfigFromView(view: View): ConversationConfig {
  const latestRun = view.runs?.[0];
  if (latestRun) {
    const runMode = latestRun.mode || 'chat';
    const runModel = latestRun.modelRef ? modelKey(latestRun.modelRef) : '';
    const ctx = (latestRun as unknown as { context?: { skillIds?: string[]; mcpIds?: string[]; rootIds?: string[] } }).context;
    return {
      mode: runMode,
      model: runModel,
      skills: Array.isArray(ctx?.skillIds) ? ctx!.skillIds! : [],
      mcp: Array.isArray(ctx?.mcpIds) ? ctx!.mcpIds! : [],
      roots: Array.isArray(ctx?.rootIds) ? ctx!.rootIds! : [],
    };
  }

  // 无运行记录的会话，检查是否有关联模型
  const models = view.conversation.models || {};
  if (models.agent) {
    return {
      mode: 'workspace',
      model: modelKey(models.agent),
      skills: [],
      mcp: [],
      roots: [],
    };
  }
  if (models.chat) {
    return {
      mode: 'chat',
      model: modelKey(models.chat),
      skills: [],
      mcp: [],
      roots: [],
    };
  }

  return {
    mode: 'chat',
    model: '',
    skills: [],
    mcp: [],
    roots: [],
  };
}
