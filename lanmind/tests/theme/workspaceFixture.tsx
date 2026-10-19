import React, { useState } from 'react';
import { WikiView } from '../../src/components/wiki/WikiView';
// This fixture exercises the legacy sendAIChatStream callback and cache migration.
// The SQLite Agent UI uses the dedicated aiFixture IPC facade.
import { LegacyAIWorkspace as AIWorkspace } from '../../src/components/ai/AIWorkspace';
import { setAIWorkspace } from '../../src/components/ai/aiStore';
import { setWorkspaceContext } from '../../src/utils/workspaceContext';
import { ApiService } from '../../src/services/api';
import type { User } from '../../src/types';

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
