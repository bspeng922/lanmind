import React, { useRef, useState } from 'react';
import { WikiView } from '../../src/components/wiki/WikiView';
// This fixture exercises the legacy sendAIChatStream callback and cache migration.
// The SQLite Agent UI uses the dedicated aiFixture IPC facade.
import { LegacyAIWorkspace as AIWorkspace } from '../../src/components/ai/AIWorkspace';
import { setAIWorkspace } from '../../src/components/ai/aiStore';
import { setWorkspaceContext } from '../../src/utils/workspaceContext';
import { ApiService } from '../../src/services/api';
import { WorkspaceModal } from '../../src/components/workspace/WorkspaceModal';
import { WorkspaceSwitcher } from '../../src/components/workspace/WorkspaceSwitcher';
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import type { User, Workspace, WorkspaceMember } from '../../src/types';

let nativeHandler: Parameters<typeof mockIPC>[0] = () => null;
const nativeSwitchWorkspace = ApiService.switchWorkspace;
if (new URLSearchParams(location.search).get('view') === 'workspace-management') {
  mockIPC((command, args) => nativeHandler(command, args), { shouldMockEvents: true });
  Object.defineProperty(window, 'isTauri', { value: true, configurable: true });
}

const user: User = { id: 'alice', username: 'alice', nickname: 'Alice', deviceId: 'fixture', role: 'user', ip: '', isOnline: true, lastActive: '' };
let revision = 1;
let finishStream: (() => void) | undefined;
if (new URLSearchParams(location.search).get('view') === 'workspace-isolation') {
ApiService.getProjects = async () => [];
ApiService.getLLMConfig = async () => ({ baseUrl: '', apiKey: '', modelName: 'fixture' } as any);
ApiService.sendAIChatStream = async (_prompt, onChunk) => new Promise<void>(resolve => {
  finishStream = () => { onChunk('Late reply from A'); resolve(); };
});

}

export function WorkspaceIsolationFixture() {
  const [scope, setScope] = useState(() => {
    const scope = { workspaceId: 'A', userId: 'alice', revision };
    setWorkspaceContext(scope); setAIWorkspace('A'); return scope;
  });
  const [feature, setFeature] = useState('wiki');
  const switchTo = (workspaceId: string, userId = scope.userId) => {
    const next = { workspaceId, userId, revision: ++revision };
    setWorkspaceContext(next); setAIWorkspace(workspaceId); setScope(next);
  };
  return <div className="flex h-screen flex-col">
    <nav>
      <button onClick={() => switchTo('A', 'alice')}>Workspace A</button>
      <button onClick={() => switchTo('B', 'alice')}>Workspace B</button>
      <button onClick={() => switchTo('A', 'bob')}>User Bob in A</button>
      <button onClick={() => setFeature('wiki')}>Wiki module</button>
      <button onClick={() => setFeature('ai')}>AI module</button>
      <button onClick={() => finishStream?.()}>Finish old stream</button>
    </nav>
    <div className="flex min-h-0 flex-1" key={`${scope.workspaceId}:${scope.userId}:${scope.revision}:${feature}`}>
      {feature === 'wiki' ? <WikiView workspaceId={scope.workspaceId} /> : <AIWorkspace workspaceId={scope.workspaceId} tasks={[]} projects={[]} currentUser={{ ...user, id: scope.userId }} />}
    </div>
  </div>;
}

export function WorkspaceDissolutionFixture() {
  const params = new URLSearchParams(location.search);
  const role = params.get('role') || 'owner';
  const [workspace, setWorkspace] = useState<Workspace>({ id: 'workspace-a', name: 'Design Team', slug: 'design-team', ownerId: role === 'owner' ? user.id : 'other-owner', timezone: 'Asia/Tokyo', createdAt: '', updatedAt: '' });
  const [open, setOpen] = useState(true);
  const [calls, setCalls] = useState(0);
  const [fail, setFail] = useState(params.has('fail'));
  const [lastRequest, setLastRequest] = useState('');
  const [pending, setPending] = useState<(() => void) | null>(null);
  ApiService.getWorkspaceMembers = async () => [{ workspaceId: workspace.id, userId: user.id, role: role as 'owner' | 'admin' | 'member', status: 'member', requestedAt: '' }];
  ApiService.dissolveWorkspace = async (workspaceId, userId, confirmationName) => {
    setCalls(value => value + 1);
    setLastRequest(JSON.stringify({ workspaceId, userId, confirmationName }));
    if (params.has('defer')) await new Promise<void>(resolve => setPending(() => resolve));
    if (fail) throw new Error('Unable to dissolve workspace. Try again.');
    return { ...workspace, id: 'workspace-b', name: 'My Workspace', slug: 'personal', ownerId: user.id };
  };
  return <div className="min-h-screen bg-canvas p-4 text-main">
    <button onClick={() => setOpen(true)}>Open workspace settings</button>
    <button onClick={() => setFail(false)}>Allow retry</button>
    <button onClick={() => pending?.()}>Finish request</button>
    <output data-testid="dissolution-calls">{calls}</output>
    <output data-testid="dissolution-request">{lastRequest}</output>
    <output data-testid="active-workspace">{workspace.name}</output>
    <WorkspaceModal isOpen={open} onClose={() => setOpen(false)} workspace={workspace} users={[user]} currentUser={user} onWorkspaceUpdated={setWorkspace} />
  </div>;
}

export function WorkspaceManagementFixture() {
  const params = new URLSearchParams(location.search);
  const role = (params.get('role') || 'owner') as WorkspaceMember['role'];
  const initial: Workspace = { id: 'workspace-a', name: 'Design Team', slug: 'design-team', ownerId: role === 'owner' ? user.id : 'other-owner', timezone: 'Asia/Tokyo', createdAt: '', updatedAt: '' };
  const nativeContext = useRef({ workspaceId: initial.id, userId: user.id, revision: 1 });
  useState(() => { if (params.has('nativeSwitchFailure')) setWorkspaceContext(nativeContext.current); });
  const bob: User = { ...user, id: 'bob', username: 'bob', nickname: 'Bob', deviceId: 'offline-device', isOnline: false };
  const [workspace, setWorkspace] = useState(initial);
  const [workspaces, setWorkspaces] = useState([initial]);
  const [members, setMembers] = useState<WorkspaceMember[]>([{ workspaceId: initial.id, userId: user.id, role, status: params.has('pending') ? 'pending' : 'member', requestedAt: '' }]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createCalls, setCreateCalls] = useState(0);
  const [switchCalls, setSwitchCalls] = useState(0);
  const [createRequest, setCreateRequest] = useState('');
  const [memberRequest, setMemberRequest] = useState('');
  const [failCreate, setFailCreate] = useState(params.has('failCreate'));
  const [failSwitch, setFailSwitch] = useState(params.has('failSwitch'));
  nativeHandler = (command, args) => {
    if (command === 'get_workspace_context') return nativeContext.current;
    if (command === 'switch_workspace') {
      const payload = args as { workspaceContext: typeof nativeContext.current; workspaceId: string };
      setSwitchCalls(value => value + 1);
      if (payload.workspaceContext.revision !== nativeContext.current.revision) throw new Error('Stale workspace context');
      if (failSwitch) {
        nativeContext.current = { ...nativeContext.current, revision: nativeContext.current.revision + 2 };
        throw new Error('Unable to enter workspace. Try again.');
      }
      const next = workspaces.find(item => item.id === payload.workspaceId)!;
      setWorkspace(next);
      return next;
    }
    return null;
  };
  ApiService.getWorkspaces = async () => workspaces;
  ApiService.getWorkspaceMemberCandidates = async () => [bob];
  ApiService.getWorkspaceMembers = async () => members;
  ApiService.createWorkspace = async (name, slug, timezone, currentUserId) => {
    setCreateCalls(value => value + 1);
    setCreateRequest(JSON.stringify({ name, slug, timezone, currentUserId }));
    if (failCreate) throw new Error('Unable to create workspace. Try again.');
    const created = { ...initial, id: 'workspace-new', name, slug: 'new-team', timezone: timezone!, ownerId: currentUserId! };
    setWorkspaces(previous => [...previous, created]);
    return created;
  };
  ApiService.switchWorkspace = async (id) => {
    setSwitchCalls(value => value + 1);
    if (failSwitch) throw new Error('Unable to enter workspace. Try again.');
    const next = workspaces.find(item => item.id === id) || { ...initial, id, name: 'New Team' };
    setWorkspace(next);
    return next;
  };
  if (params.has('nativeSwitchFailure')) ApiService.switchWorkspace = nativeSwitchWorkspace;
  ApiService.addWorkspaceMember = async (userId, memberRole, operator) => {
    setMemberRequest(JSON.stringify({ userId, role: memberRole, operator }));
    const member: WorkspaceMember = { workspaceId: initial.id, userId, role: memberRole as WorkspaceMember['role'], status: 'member', requestedAt: '' };
    setMembers(previous => [...previous, member]);
    return member;
  };
  const receive = async () => {
    const added = { ...initial, id: 'received-workspace', name: 'Research Team' };
    setWorkspaces(previous => [...previous.filter(item => item.id !== added.id), added]);
    await emit('workspace://changed', { action: 'added', workspace: added });
  };
  return <div className="min-h-screen bg-canvas p-4 text-main">
    <WorkspaceSwitcher workspace={workspace} members={members} currentUserId={user.id} onOpenWorkspaceSettings={() => setSettingsOpen(true)} />
    <button onClick={() => { setFailCreate(false); setFailSwitch(false); }}>Allow retry</button>
    <button onClick={() => void receive()}>Receive workspace</button>
    <output data-testid="active-workspace">{workspace.name}</output>
    <output data-testid="create-calls">{createCalls}</output>
    <output data-testid="switch-calls">{switchCalls}</output>
    <output data-testid="create-request">{createRequest}</output>
    <output data-testid="member-request">{memberRequest}</output>
    <WorkspaceModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} workspace={workspace} users={[user, bob]} currentUser={user} onWorkspaceUpdated={setWorkspace} />
  </div>;
}
