import { invoke, isTauri } from "@tauri-apps/api/core";
import { ensureWorkspaceContext } from "../../services/api";
import {
  getWorkspaceContext,
  sameWorkspace,
  scopedStorageKey,
} from "../../utils/workspaceContext";

export interface ModelRef {
  connectionId: string;
  modelEntryId: string;
}
export interface Parameters {
  temperature?: number | null;
  topP?: number | null;
  maxOutputTokens?: number | null;
  extra?: Record<string, unknown>;
}
export interface Model {
  id: string;
  remoteModelId: string;
  displayName: string;
  enabled: boolean;
  missing: boolean;
  parameters: Parameters;
  capabilities: {
    tools?: boolean | null;
    streaming?: boolean | null;
    vision?: boolean | null;
    configRevision?: number | null;
    verifiedAt?: string | null;
  };
}
export interface Connection {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  enabled: boolean;
  bound: boolean;
  revision: number;
  configRevision: number;
  hasCredential: boolean;
  referenceCount: number;
  parameters: Parameters;
  models: Model[];
}
export interface Catalog {
  schemaVersion: number;
  connections: Connection[];
  defaults: Record<string, ModelRef>;
}
export interface Conversation {
  id: string;
  title: string;
  titleLocked: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  revision: number;
  branchId: string;
  headMessageId: string | null;
  models: Record<string, ModelRef>;
}
export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  branchId: string;
  parentMessageId: string | null;
  runId: string | null;
  userMessageId: string | null;
  status: string;
  error?: string | null;
  modelLabel?: string | null;
  protocol?: unknown;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: string;
  result: unknown;
  approvalId: string | null;
  summary: string;
  preview?: { before: unknown; after: unknown; labels?: unknown } | null;
}
export interface Artifact {
  artifact: true;
  rootId: string;
  rootPath: string;
  path: string;
  beforeHash: string | null;
  afterHash: string;
  backupId: string | null;
  bytes: number;
}
export interface Run {
  id: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  branchId: string;
  modelRef: ModelRef;
  modelLabel: string;
  mode: string;
  status: string;
  seq: number;
  toolCalls: ToolCall[];
  artifacts: Artifact[];
  finishReason: string | null;
  error?: { code: string; message: string } | null;
  usage?: Record<string, number> | null;
}
export interface View {
  conversation: Conversation;
  messages: Message[];
  alternatives: Message[];
  runs: Run[];
}
export interface Extension {
  id: string;
  kind: "skill" | "mcp";
  name: string;
  description: string;
  enabled: boolean;
  revision: number;
  config: Record<string, unknown>;
  hasCredential: boolean;
}
export interface Root {
  id: string;
  path: string;
  allowCreate: boolean;
  expires: string;
}
export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  frequency: string;
  nextRunAt: string;
  enabled: boolean;
  modelRef: ModelRef;
  skillIds: string[];
  lastRunId: string | null;
  lastError: string | null;
  revision: number;
}
export interface Bootstrap {
  schemaVersion: number;
  catalog: Catalog;
  conversations: Conversation[];
  extensions: Extension[];
  schedules: Schedule[];
  roots: Root[];
}
export interface RunRequest {
  clientRequestId: string;
  conversationId: string;
  branchId: string;
  expectedHeadMessageId: string | null;
  expectedConversationVersion: number;
  input:
    | { kind: "new_message"; clientMessageId: string; text: string }
    | { kind: "retry"; userMessageId: string; runId: string }
    | { kind: "continue"; runId: string };
  modelRef: ModelRef | null;
  mode: string;
  skillIds: string[];
  rootIds: string[];
  mcpIds: string[];
  parameters?: Parameters;
}
export interface AIEvent {
  schemaVersion: number;
  workspaceId: string;
  userId: string;
  contextRevision: number;
  conversationId: string;
  runId: string;
  seq: number;
  type: string;
  payload: { text?: string; run?: Run; message?: Message };
}
export const modelKey = (reference?: ModelRef | null) =>
  reference && reference.connectionId && reference.modelEntryId
    ? JSON.stringify({
        connectionId: reference.connectionId,
        modelEntryId: reference.modelEntryId,
      })
    : "";
export const parseModelKey = (key: string): ModelRef | null => {
  try {
    return key ? (JSON.parse(key) as ModelRef) : null;
  } catch {
    return null;
  }
};
export const activeRun = (run?: Run) =>
  !!run &&
  [
    "queued",
    "running",
    "waiting_approval",
    "waiting_input",
    "cancelling",
  ].includes(run.status);
export const aiError = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : String(error);

export const AI = {
  async call<T>(action: string, payload: unknown = {}): Promise<T> {
    if (!isTauri())
      throw new Error(
        "此功能需要 LanMind 桌面端 / This feature requires the LanMind desktop app.",
      );
    const scope = await ensureWorkspaceContext();
    try {
      const result = await invoke<T>("ai_api", {
        action,
        payload,
        workspaceContext: scope,
      });
      if (!sameWorkspace(scope, getWorkspaceContext()))
        throw new Error("工作区已切换 / Workspace changed");
      return result;
    } catch (error) {
      throw new Error(aiError(error));
    }
  },
  async bootstrap(): Promise<Bootstrap> {
    const scope = await ensureWorkspaceContext();
    let legacy: unknown = {};
    try {
      const raw = localStorage.getItem(
        scopedStorageKey("lanmind_ai_conversations_v1", scope),
      );
      const index = raw
        ? (JSON.parse(raw) as { conversations?: { id: string }[] })
        : { conversations: [] };
      const messages: Record<string, unknown> = {};
      for (const conv of index.conversations ?? []) {
        const value = localStorage.getItem(
          scopedStorageKey(`lanmind_ai_messages_v1:${conv.id}`, scope),
        );
        if (value) messages[conv.id] = JSON.parse(value);
      }
      legacy = { index, messages };
    } catch {
      /* SQLite remains authoritative when a legacy cache is corrupt. */
    }
    return AI.call<Bootstrap>("bootstrap", legacy);
  },
};
