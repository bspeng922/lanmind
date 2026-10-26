import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../../src/context/ThemeContext';
import { setLocalePreference, type LocalePreference } from '../../src/i18n';
import { WikiView } from '../../src/components/wiki/WikiView';
import { ApiService } from '../../src/services/api';
import { setWorkspaceContext } from '../../src/utils/workspaceContext';
import '../../src/index.css';

// Load the Wiki integration without the unrelated full-application fixture graph.
const params = new URLSearchParams(location.search);
const locale = (params.get('locale') || 'en-US') as LocalePreference;
localStorage.setItem('lanmind-locale-preference', locale);
if (params.has('theme')) localStorage.setItem('lanmind-theme', params.get('theme')!);
void setLocalePreference(locale).then(() => {
  createRoot(document.getElementById('root')!).render(<ThemeProvider><WikiFixture /></ThemeProvider>);
});

ApiService.getProjects = async () => [];
let revision = 1;
function WikiFixture() {
  const [scope, setScope] = useState(() => {
    const value = { workspaceId: 'A', userId: 'alice', revision };
    setWorkspaceContext(value);
    return value;
  });
  const switchTo = (workspaceId: string, userId = scope.userId) => {
    const next = { workspaceId, userId, revision: ++revision };
    setWorkspaceContext(next);
    setScope(next);
  };
  return <div className="flex h-screen flex-col">
    <nav>
      <button onClick={() => switchTo('A', 'alice')}>Workspace A</button>
      <button onClick={() => switchTo('B', 'alice')}>Workspace B</button>
      <button onClick={() => switchTo('A', 'bob')}>User Bob in A</button>
    </nav>
    <div className="flex min-h-0 flex-1" key={`${scope.workspaceId}:${scope.userId}:${scope.revision}`}>
      <WikiView workspaceId={scope.workspaceId} />
    </div>
  </div>;
}
