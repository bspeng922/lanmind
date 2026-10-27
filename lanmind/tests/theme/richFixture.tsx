import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../../src/context/ThemeContext';
import { AssistantMarkdown } from '../../src/components/ai/AssistantMarkdown';
import { WikiPagePreview } from '../../src/components/wiki/WikiPagePreview';
import { setLocalePreference } from '../../src/i18n';
import '../../src/index.css';

const query = new URLSearchParams(location.search);
localStorage.setItem('lanmind-theme', query.get('theme') || 'light');
void setLocalePreference('en-US').then(() => createRoot(document.getElementById('root')!).render(<ThemeProvider><Fixture /></ThemeProvider>));
function Fixture() {
  const [value, setValue] = useState('');
  (window as any).setRichContent = setValue;
  return <main style={{ padding: 24, width: query.get('narrow') ? 360 : 900, maxWidth: '100%' }}>
    <section data-testid="ai"><AssistantMarkdown value={value} /></section>
    <section data-testid="wiki"><WikiPagePreview content={value} /></section>
  </main>;
}
