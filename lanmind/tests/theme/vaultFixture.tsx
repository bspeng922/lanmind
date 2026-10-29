import React from 'react';
import { createRoot } from 'react-dom/client';
import VaultApp from '../../plugins/password-vault/components/VaultApp';
import { VaultClient, blankEntry, defaultPolicy, type VaultEntry, type VaultFolder, type VaultStatus } from '../../plugins/password-vault/client';
import { ThemeProvider } from '../../src/context/ThemeContext';
import { initializeLocale, setLocalePreference } from '../../src/i18n';
import { initializeFeatures } from '../../src/modules/state';
import '../../src/index.css';

// An explicit UI fixture, never included by the production entry. Cryptography is tested in Rust.
const status: VaultStatus = { configured: false, locked: true, sessionVersion: 0, idleMinutes: 5 };
let master = ''; let entries: VaultEntry[] = []; let folders: VaultFolder[] = [];
const client = new VaultClient(async (action, payload, version) => {
  if (action === 'status') return { ...status };
  if (action === 'create') { master = String(payload.password); status.configured = true; status.locked = false; status.sessionVersion++; return { ...status }; }
  if (action === 'unlock') { if (payload.password !== master) throw new Error('VAULT_PASSWORD'); status.locked = false; status.sessionVersion++; return { ...status }; }
  if (action === 'lock') { status.locked = true; status.sessionVersion++; return { ...status }; }
  if (status.locked || status.sessionVersion !== version) throw new Error('VAULT_LOCKED');
  if (action === 'activity') return { ...status };
  if (action === 'list') return { entries: entries.map(({ password, privateKey, publicKey, keyPassphrase, notes, sourceShareId, ...summary }) => summary), folders, policy: defaultPolicy, idleMinutes: 5 };
  if (action === 'save') { const entry = { ...blankEntry(), ...(payload.entry as VaultEntry), id: (payload.entry as VaultEntry).id || crypto.randomUUID(), revision: ((payload.entry as VaultEntry).revision || 0) + 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; entries = [...entries.filter(e => e.id !== entry.id), entry]; return entry; }
  if (action === 'get') return structuredClone(entries.find(e => e.id === payload.id));
  if (action === 'clone') { const entry = structuredClone(entries.find(e => e.id === payload.id)!); entry.id = ''; entry.revision = 0; entry.name += payload.suffix; return entry; }
  if (action === 'saveFolder') { const folder = { ...(payload.folder as VaultFolder), id: (payload.folder as VaultFolder).id || crypto.randomUUID() }; folders = [...folders.filter(f => f.id !== folder.id), folder]; return folder; }
  if (action === 'delete' || action === 'restore') { const entry = entries.find(e => e.id === payload.id)!; entry.deletedAt = action === 'delete' ? new Date().toISOString() : null; entry.revision++; return null; }
  if (action === 'purge') { entries = entries.filter(e => e.id !== payload.id); return null; }
  if (action === 'search') return entries.filter(e => `${e.name} ${e.username} ${e.notes}`.toLowerCase().includes(String(payload.query).toLowerCase())).map(e => e.id);
  if (action === 'generate') return 'R7!vQ9@kN4#tP8$xW2%z';
  if (action === 'copy' || action === 'copyGenerated' || action === 'settings' || action === 'openUrl') return null;
  throw new Error('VAULT_INVALID');
}, false);
async function start() {
  const params = new URLSearchParams(location.search);
  await initializeLocale(); await setLocalePreference(params.get('locale') === 'en-US' ? 'en-US' : 'zh-CN'); await initializeFeatures();
  if (['light', 'dark'].includes(params.get('theme') || '')) localStorage.setItem('lanmind-theme', params.get('theme')!);
  createRoot(document.getElementById('root')!).render(<ThemeProvider><div className="h-screen bg-canvas text-main"><VaultApp client={client} /></div></ThemeProvider>);
}
void start();
