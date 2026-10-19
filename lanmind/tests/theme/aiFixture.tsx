import React from "react";
import { AgentWorkspace } from "../../src/components/ai/AgentWorkspace";
import {
  AI,
  type Bootstrap,
  type Conversation,
  type Message,
  type Run,
  type RunRequest,
  type View,
  type Connection,
  type Extension,
  type Schedule,
} from "../../src/components/ai/aiClient";
import type { User } from "../../src/types";

// Browser UI fixture only. Protocol, files and SQLite are tested in Rust.
let initialized = false;
export const state = {
  data: null as Bootstrap | null,
  views: new Map<string, View>(),
  all: new Map<string, Message[]>(),
  requests: [] as RunRequest[],
  writes: 0,
  serial: 0,
};
const id = (prefix: string) => `${prefix}-${++state.serial}`;
const now = () => new Date().toISOString();
function connection(id: string, name: string, baseUrl: string): Connection {
  return {
    id,
    name,
    providerType: id === "local" ? "ollama" : "vllm",
    baseUrl,
    enabled: true,
    bound: true,
    revision: 1,
    configRevision: 1,
    hasCredential: false,
    referenceCount: 1,
    parameters: {},
    models: [
      {
        id: `${id}-model`,
        remoteModelId: "same-model",
        displayName: "Same model",
        enabled: true,
        missing: false,
        parameters: {},
        capabilities: { tools: true, streaming: true, configRevision: 1 },
      },
    ],
  };
}
function initialize() {
  if (initialized) return;
  initialized = true;
  const connections = [
    connection("local", "Local Ollama", "http://127.0.0.1:11434/v1"),
    connection("gpu", "GPU vLLM", "http://127.0.0.1:8000/v1"),
  ];
  state.data = {
    schemaVersion: 2,
    catalog: {
      schemaVersion: 2,
      connections,
      defaults: {
        chat: { connectionId: "local", modelEntryId: "local-model" },
        agent: { connectionId: "gpu", modelEntryId: "gpu-model" },
      },
    },
    conversations: [],
    extensions: [
      {
        id: "planner",
        name: "Workspace planner",
        description: "Offline planning skill",
        kind: "skill",
        enabled: true,
        revision: 1,
        hasCredential: false,
        config: {
          body: "Read tasks and cite their IDs.",
          version: "version-one",
          files: {},
          builtin: true,
        },
      },
    ],
    schedules: [],
    roots: [],
  };
  const data = state.data;
  const sync = (view: View) => {
    view.conversation.messageCount = view.messages.length;
    data.conversations = [
      view.conversation,
      ...data.conversations.filter((c) => c.id !== view.conversation.id),
    ];
  };
  const chain = (view: View) => {
    const all = state.all.get(view.conversation.id)!;
    const messages: Message[] = [];
    let head = view.conversation.headMessageId;
    while (head) {
      const message = all.find((m) => m.id === head);
      if (!message) break;
      messages.unshift(message);
      head = message.parentMessageId;
    }
    view.messages = messages;
    view.alternatives = all.filter((m) => m.role === "assistant");
    sync(view);
  };
  const finish = (view: View, run: Run, text: string, status = "completed") => {
    if (!["running", "waiting_approval"].includes(run.status)) return;
    run.status = status;
    run.seq++;
    const message = state.all
      .get(run.conversationId)!
      .find((m) => m.id === run.assistantMessageId)!;
    message.content = text;
    message.status = status;
    chain(view);
  };
  AI.bootstrap = async () => structuredClone(data);
  AI.call = async <T,>(action: string, payload: unknown = {}): Promise<T> => {
    const p = payload as Record<string, any>;
    let result: unknown;
    switch (action) {
      case "catalog":
        result = data.catalog;
        break;
      case "conversations":
        result = data.conversations;
        break;
      case "extensions":
        result = data.extensions;
        break;
      case "schedules":
        result = data.schedules;
        break;
      case "roots":
        result = data.roots;
        break;
      case "conversation.create": {
        const conv: Conversation = {
          id: id("conv"),
          title: "",
          titleLocked: false,
          pinned: false,
          createdAt: now(),
          updatedAt: now(),
          messageCount: 0,
          revision: 1,
          branchId: id("branch"),
          headMessageId: null,
          models: {},
        };
        const view: View = {
          conversation: conv,
          messages: [],
          alternatives: [],
          runs: [],
        };
        state.views.set(conv.id, view);
        state.all.set(conv.id, []);
        sync(view);
        result = conv;
        break;
      }
      case "conversation.view":
        result = state.views.get(p.id);
        break;
      case "conversation.poll": {
        const v = state.views.get(p.id)!;
        const last = v.runs[0];
        result =
          v.conversation.revision === p.knownRevision &&
          (last?.id ?? null) === p.knownRunId &&
          (last?.seq ?? null) === p.knownRunSeq
            ? null
            : v;
        break;
      }
      case "conversations.search":
        result = data.conversations
          .filter(
            (c) =>
              c.title.toLowerCase().includes(p.query.toLowerCase()) ||
              state.all
                .get(c.id)
                ?.some((m) =>
                  m.content.toLowerCase().includes(p.query.toLowerCase()),
                ),
          )
          .map((conversation) => ({
            conversation,
            scope: "title",
            snippet: "",
          }));
        break;
      case "conversation.patch": {
        const view = state.views.get(p.id)!;
        Object.assign(view.conversation, p.patch);
        if (p.patch.headMessageId) {
          view.conversation.branchId = state.all
            .get(p.id)!
            .find((m) => m.id === p.patch.headMessageId)!.branchId;
          chain(view);
        }
        view.conversation.revision++;
        sync(view);
        result = view.conversation;
        break;
      }
      case "conversation.delete":
        data.conversations = data.conversations.filter((c) => c.id !== p.id);
        state.views.delete(p.id);
        state.all.delete(p.id);
        result = null;
        break;
      case "run.start": {
        const request = payload as RunRequest;
        const old = state.requests.find(
          (r) => r.clientRequestId === request.clientRequestId,
        );
        const view = state.views.get(request.conversationId)!;
        if (old) {
          result = view.runs.find(
            (r) =>
              (r as Run & { clientRequestId: string }).clientRequestId ===
              request.clientRequestId,
          );
          break;
        }
        state.requests.push(request);
        const all = state.all.get(request.conversationId)!;
        const runId = id("run");
        let user: Message;
        if (request.input.kind === "retry") {
          const userId = request.input.userMessageId;
          user = all.find((m) => m.id === userId)!;
          view.conversation.branchId = id("branch");
        } else {
          const text =
            request.input.kind === "new_message"
              ? request.input.text
              : "Continue";
          user = {
            id: id("message"),
            role: "user",
            content: text,
            createdAt: now(),
            branchId: view.conversation.branchId,
            parentMessageId: view.conversation.headMessageId,
            runId,
            userMessageId: null,
            status: "completed",
          };
          all.push(user);
        }
        const ref = request.modelRef || data.catalog.defaults.chat;
        const c = data.catalog.connections.find(
          (c) => c.id === ref.connectionId,
        )!;
        const message: Message = {
          id: id("message"),
          role: "assistant",
          content: "",
          createdAt: now(),
          branchId: view.conversation.branchId,
          parentMessageId: user.id,
          runId,
          userMessageId: user.id,
          status: "running",
          modelLabel: `Same model · ${c.name}`,
        };
        all.push(message);
        const run: Run & { clientRequestId: string } = {
          id: runId,
          clientRequestId: request.clientRequestId,
          conversationId: request.conversationId,
          userMessageId: user.id,
          assistantMessageId: message.id,
          branchId: view.conversation.branchId,
          modelRef: ref,
          modelLabel: message.modelLabel!,
          mode: request.mode,
          status: "running",
          seq: 1,
          toolCalls: [],
          artifacts: [],
          finishReason: "stop",
        };
        view.runs.unshift(run);
        view.conversation.headMessageId = message.id;
        view.conversation.revision++;
        view.conversation.title ||= user.content.slice(0, 40);
        view.conversation.models[request.mode === "chat" ? "chat" : "agent"] =
          ref;
        chain(view);
        result = run;
        const requestedWrite = workspaceWrites.find(f => user.content.toLowerCase().includes(f.prompt));
        const requestedRead = workspaceReads.find(f => user.content.toLowerCase().includes(f.prompt));
        if (request.mode !== 'chat' && request.input.kind === 'new_message' && requestedWrite) {
          run.status = 'waiting_approval';
          run.toolCalls = [{ id: 'business-call', name: requestedWrite.name, arguments: {}, status: 'waiting_approval', approvalId: 'business-approval', summary: requestedWrite.name, preview: requestedWrite.preview, result: requestedWrite.preview }];
        } else if (request.mode !== 'chat' && requestedRead) {
          run.toolCalls = [{ id: 'business-read', name: requestedRead.name, arguments: {}, status: 'completed', approvalId: null, summary: requestedRead.name, result: requestedRead.result }];
          window.setTimeout(() => finish(view, run, 'Workspace result.'), 100);
        } else if (
          user.content.toLowerCase().includes("create task") &&
          request.mode !== "chat" &&
          request.input.kind === "new_message"
        ) {
          run.status = "waiting_approval";
          run.toolCalls = [
            {
              id: "call1",
              name: "create_task",
              arguments: { title: "Review plan" },
              status: "waiting_approval",
              approvalId: "approval1",
              summary: "Create task",
              preview: { before: null, after: { title: 'Review plan', projectId: null, assigneeId: 'fixture-user', stateName: 'Todo', priority: 'P4', dueDate: '2026-10-19' }, labels: { users: [{ id: 'fixture-user', name: 'Alex' }] } },
              result: {
                tool: "create_task",
                arguments: { title: "Review plan" },
              },
            },
          ];
        } else if (!user.content.toLowerCase().includes("wait"))
          window.setTimeout(
            () =>
              finish(
                view,
                run,
                `Answer ${view.runs.length}: code 42. ${user.content}`,
              ),
            100,
          );
        break;
      }
      case "run.cancel": {
        const view = [...state.views.values()].find((v) =>
          v.runs.some((r) => r.id === p.id),
        )!;
        const run = view.runs.find((r) => r.id === p.id)!;
        finish(view, run, "", "cancelled");
        result = null;
        break;
      }
      case "run.decide": {
        const view = [...state.views.values()].find((v) =>
          v.runs.some((r) => r.id === p.id),
        )!;
        const run = view.runs.find((r) => r.id === p.id)!;
        if (run.status !== "waiting_approval") throw Error("Approval expired");
        const approved = p.decision.approved === true;
        if (approved) state.writes++;
        run.toolCalls[0].status = approved ? "completed" : "failed";
        const fixture = workspaceWrites.find(f => f.name === run.toolCalls[0].name);
        run.toolCalls[0].result = approved ? fixture?.result ?? { task: fixtureTask } : { error: 'Operation rejected.' };
        finish(view, run, approved ? "Task created." : "Operation rejected.");
        result = null;
        break;
      }
      case "connection.save": {
        let c = data.catalog.connections.find((c) => c.id === p.id);
        if (c && c.revision !== p.expectedRevision)
          throw Error("CONFIG_CONFLICT");
        const models = p.models.map((m: any) => ({
          ...m,
          id: m.id || id("model"),
        }));
        const saved = {
          ...p,
          id: p.id || id("connection"),
          models,
          revision: (c?.revision || 0) + 1,
          configRevision: (c?.configRevision || 0) + 1,
          hasCredential:
            p.credentialChange.action === "replace" ||
            (p.credentialChange.action === "keep" && !!c?.hasCredential),
          referenceCount: 1,
        } as Connection;
        delete (saved as any).credentialChange;
        data.catalog.connections = [
          ...data.catalog.connections.filter((c) => c.id !== saved.id),
          saved,
        ];
        result = saved;
        break;
      }
      case "connection.discover":
        result = ["same-model", "another-model"];
        break;
      case "connection.delete":
        data.catalog.connections = data.catalog.connections.filter(
          (c) => c.id !== p.id,
        );
        result = null;
        break;
      case "default.set":
        data.catalog.defaults[p.purpose] = p.modelRef;
        result = null;
        break;
      case "model.test":
        result = { success: true };
        break;
      case "extension.save": {
        const saved: Extension = {
          id: p.id || id("mcp"),
          name: p.name,
          kind: p.kind,
          description: p.description,
          config: p.config,
          enabled: p.enabled,
          revision: (p.expectedRevision || 0) + 1,
          hasCredential: p.credentialChange?.action === "replace",
        };
        data.extensions = [
          ...data.extensions.filter((e) => e.id !== saved.id),
          saved,
        ];
        result = saved;
        break;
      }
      case "extension.delete":
        data.extensions = data.extensions.filter((e) => e.id !== p.id);
        result = null;
        break;
      case "mcp.discover":
        result = [
          {
            name: "echo",
            description: "Read back supplied text",
            inputSchema: { type: "object" },
          },
        ];
        break;
      case "schedule.save": {
        const saved: Schedule = {
          ...p,
          id: p.id || id("schedule"),
          revision: (p.revision || 0) + 1,
        } as Schedule;
        data.schedules = [
          ...data.schedules.filter((s) => s.id !== saved.id),
          saved,
        ];
        result = saved;
        break;
      }
      case "schedule.delete":
        data.schedules = data.schedules.filter((s) => s.id !== p.id);
        result = null;
        break;
      case "document.extract":
        result = atob(p.data);
        break;
      default:
        throw Error(`Unhandled AI fixture action: ${action}`);
    }
    return structuredClone(result) as T;
  };
  (window as any).__aiFixture = state;
}
export const AIFixture: React.FC<{ user: User }> = ({ user }) => {
  initialize();
  return (
    <div className="h-screen">
      <AgentWorkspace
        tasks={[]}
        projects={[]}
        currentUser={user}
        workspaceId="fixture-ai"
      />
    </div>
  );
};

const fixtureTask = { id: 'business-task', identifier: 'LAN-42', title: 'Review plan', stateName: 'In Progress', priority: 'P2', dueDate: '2026-10-19', assigneeId: 'fixture-user' };
const fixtureWiki = { id: 'runbook', title: 'Release runbook', content: '## Release checklist\nVerify the package.' };
const workspaceReads = [
  { prompt: 'show today', name: 'list_today_tasks', result: { items: [fixtureTask], total: 1 } },
  { prompt: 'show members', name: 'list_project_members', result: { items: [{ userId: 'fixture-user', user: { nickname: 'Alex' }, role: 'admin', isLead: true }], total: 1 } },
  { prompt: 'find wiki', name: 'search_wiki', result: { items: [{ ...fixtureWiki, content: undefined, snippet: 'Verify the package.' }], total: 1 } },
  { prompt: 'project progress', name: 'get_project_summary', result: { project: { name: 'LanMind' }, total: 10, completed: 7, overdue: 1, riskCount: 2, completionRate: .7 } },
];
const workspaceWrites = [
  { prompt: 'edit task', name: 'update_task', preview: { before: { title: 'Old title' }, after: { title: 'Review plan' } }, result: { task: fixtureTask } },
  { prompt: 'assign task', name: 'update_task', preview: { before: { assigneeId: 'old' }, after: { assigneeId: 'fixture-user' }, labels: { users: [{ id: 'old', name: 'Sam' }, { id: 'fixture-user', name: 'Alex' }] } }, result: { task: fixtureTask } },
  { prompt: 'set task state', name: 'update_task', preview: { before: { stateName: 'Todo' }, after: { stateName: 'In Progress' } }, result: { task: fixtureTask } },
  { prompt: 'add comment', name: 'create_task_comment', preview: { before: null, after: { content: 'Ready for review' } }, result: { comment: { id: 'comment', content: 'Ready for review', authorId: 'Alex' } } },
  { prompt: 'edit comment', name: 'update_task_comment', preview: { before: { content: 'Draft' }, after: { content: 'Ready for review' } }, result: { comment: { id: 'comment', content: 'Ready for review', authorId: 'Alex' } } },
  { prompt: 'create wiki', name: 'create_wiki_page', preview: { before: null, after: { title: fixtureWiki.title, content: fixtureWiki.content } }, result: { page: fixtureWiki } },
  { prompt: 'edit wiki', name: 'update_wiki_page', preview: { before: { content: 'Draft' }, after: { content: fixtureWiki.content } }, result: { page: fixtureWiki } },
];
