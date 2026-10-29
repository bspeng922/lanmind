import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../../src/context/ThemeContext';
import { SettingsModal } from '../../src/components/SettingsModal';
import { AppRail } from '../../src/app/AppRail';
import OpticalTransferPlugin from '../../plugins/optical-transfer/entry';
import { initializeFeatures } from '../../src/modules/state';
import { initializeLocale, setLocalePreference } from '../../src/i18n';
import '../../src/index.css';

async function start() {
  await initializeLocale();
  await setLocalePreference(new URLSearchParams(location.search).get('locale') === 'en-US' ? 'en-US' : 'zh-CN');
  await initializeFeatures();
  createRoot(document.getElementById('root')!).render(
    <ThemeProvider>
      <div className="flex h-screen bg-canvas text-main">
        <AppRail activeSection="settings" onWork={() => {}} onAI={() => {}} onWiki={() => {}} onChat={() => {}} onTransfer={() => {}} onSettings={() => {}} />
        <SettingsModal isOpen embedded defaultTab="features" shortcuts={[]} currentUserId="fixture-user" onSaveShortcuts={async () => {}} onTasksImported={async () => {}} />
        {new URLSearchParams(location.search).has('optical') && <aside className="h-screen w-[640px] shrink-0 overflow-auto border-l border-edge"><OpticalTransferPlugin /></aside>}
      </div>
    </ThemeProvider>,
  );
}
void start();
