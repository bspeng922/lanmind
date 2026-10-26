import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../../src/context/ThemeContext';
import { setLocalePreference } from '../../src/i18n';
import { WikiShareModal } from '../../src/components/wiki/WikiShareModal';
import { AIShareModal } from '../../src/components/ai/AIShareModal';
import { ApiService } from '../../src/services/api';
import { AI } from '../../src/components/ai/aiClient';
import { setWorkspaceContext } from '../../src/utils/workspaceContext';
import type { WikiDocument } from '../../src/components/wiki/wikiTypes';
import type { Conversation } from '../../src/components/ai/aiClient';
import '../../src/index.css';

setWorkspaceContext({ workspaceId: 'A', userId: 'alice', revision: 1 });
ApiService.getWebStatus = async () => ({ running: true, endpoint: location.origin }) as any;
AI.call = (async (action: string, payload: unknown) => {
  const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }) });
  if (!response.ok) throw new Error('Share failed');
  return response.json();
}) as typeof AI.call;

function ShareFixture() {
  const [kind, setKind] = useState('');
  const [doc, setDoc] = useState({ id: 'wiki-1', workspaceId: 'A', title: 'LAN guide', content: '' } as WikiDocument);
  return <>
    <textarea aria-label="Fixture content" value={doc.content} onChange={event => setDoc({ ...doc, content: event.target.value })} />
    <button onClick={() => setKind('wiki')}>Share Wiki</button>
    <button onClick={() => setKind('ai')}>Share AI</button>
    <WikiShareModal document={doc} isOpen={kind === 'wiki'} onClose={() => setKind('')} />
    <AIShareModal conversation={{ id: 'conversation-1', title: 'Shared conversation', revision: 1 } as Conversation} workspaceId="A" isOpen={kind === 'ai'} onClose={() => setKind('')} />
  </>;
}
void setLocalePreference('en-US').then(() => createRoot(document.getElementById('root')!).render(<ThemeProvider><ShareFixture /></ThemeProvider>));
