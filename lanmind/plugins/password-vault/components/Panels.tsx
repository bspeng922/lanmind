import React, { useMemo, useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { AlertCircle, AlertTriangle, ArrowDownUp, Check as CheckIcon, Copy, Edit3, Eye, EyeOff, History, KeyRound, Lock, Plus, RefreshCw, RotateCw, Settings, Share2, Shield, Sparkles, Trash2, Upload, User as UserIcon } from 'lucide-react';
import { tr } from '../../../src/i18n';
import type { User } from '../../../src/types';
import { useFeatures } from '../../../src/modules/state';
import { ThemeSelect } from '../../../src/components/ThemeSelect';
import { defaultPolicy, folderPath, vaultError, type PasswordPolicy, type RecipientKey, type VaultClient, type VaultEntry, type VaultFolder, type VaultList } from '../client';
import { Button, Check, Field, FolderSelect, Modal, inputClass, textareaClass } from './ui';
import {
  GeneratorPanel,
  PolicyFields,
  renderHighlightedPassword,
  loadGeneratorHistory,
  saveGeneratorHistory,
  type GeneratedPasswordRecord,
} from './GeneratorPanel';

function useOperation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (e) {
      setError(vaultError(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function ErrorLine({ error }: { error: string }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-medium text-rose-500">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="flex-1 min-w-0">{error}</span>
    </div>
  );
}

export {
  GeneratorPanel,
  PolicyFields,
  renderHighlightedPassword,
  loadGeneratorHistory,
  saveGeneratorHistory,
  type GeneratedPasswordRecord,
} from './GeneratorPanel';

export function EditPanel({
  client,
  initial,
  data,
  onSaved,
  onClose,
}: {
  client: VaultClient;
  initial: VaultEntry;
  data: VaultList;
  onSaved: (id: string) => void;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState(initial);
  const [generator, setGenerator] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const { busy, error, run } = useOperation();
  const patch = <K extends keyof VaultEntry>(key: K, value: VaultEntry[K]) => setEntry((e) => ({ ...e, [key]: value }));

  const handleCopyPassword = () => {
    if (!entry.password) return;
    void client
      .call('copyGenerated', { value: entry.password })
      .catch(() => {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(entry.password).catch(() => {});
        }
      });
    setCopiedPassword(true);
    setTimeout(() => setCopiedPassword(false), 2000);
  };

  const kindOptions = useMemo(() => [
    { value: 'login', label: tr('vault:login') },
    { value: 'ssh', label: tr('vault:sshKey') },
  ], []);

  return (
    <Modal
      icon={initial.id ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      title={tr(initial.id ? 'vault:edit' : 'vault:newRecord')}
      description={tr('vault:draftNotice')}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose} className="ui-cancel-button">
            {tr('vault:cancel')}
          </Button>
          <Button type="submit" form="vault-edit-form" primary disabled={busy}>
            {tr('vault:save')}
          </Button>
        </>
      }
    >
      <form
        id="vault-edit-form"
        className="space-y-4"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const result = await client.call('save', { entry });
            onSaved(result.id);
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr('vault:typeFilter')}>
            <ThemeSelect
              portal
              disabled={!!entry.id}
              ariaLabel={tr('vault:typeFilter')}
              value={entry.kind}
              options={kindOptions}
              onChange={(next) => patch('kind', next as VaultEntry['kind'])}
            />
          </Field>
          <Field label={tr('vault:folder')}>
            <FolderSelect folders={data.folders} value={entry.folderId} onChange={(value) => patch('folderId', value)} />
          </Field>
        </div>

        <Field label={tr('vault:name')} required>
          <input
            required
            value={entry.name}
            maxLength={1024}
            onChange={(e) => patch('name', e.target.value)}
            className={inputClass}
            placeholder={tr('vault:name')}
          />
        </Field>

        {entry.kind === 'login' ? (
          <>
            <Field label={tr('vault:urls')}>
              <textarea
                rows={2}
                value={entry.urls.join('\n')}
                onChange={(e) => patch('urls', e.target.value.split('\n'))}
                className={textareaClass}
                spellCheck={false}
                placeholder="https://example.com"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={tr('vault:username')}>
                <input
                  value={entry.username}
                  onChange={(e) => patch('username', e.target.value)}
                  className={inputClass}
                  autoComplete="off"
                  placeholder="admin@example.com"
                />
              </Field>
              <div className="space-y-1.5">
                <span className="block text-xs text-sub font-medium">{tr('vault:password')}</span>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1 flex items-center min-w-0">
                    <input
                      aria-label={tr('vault:password')}
                      type={showPassword ? 'text' : 'password'}
                      value={entry.password}
                      onChange={(e) => patch('password', e.target.value)}
                      className={`${inputClass} font-mono pr-16`}
                      autoComplete="new-password"
                      placeholder={tr('vault:password')}
                    />
                    <div className="absolute right-1.5 flex items-center gap-0.5 text-sub">
                      <button
                        type="button"
                        title={tr(showPassword ? 'vault:hide' : 'vault:reveal')}
                        aria-label={tr(showPassword ? 'vault:hide' : 'vault:reveal')}
                        onClick={() => setShowPassword((s) => !s)}
                        className="p-1.5 rounded-lg hover:text-main hover:bg-hover transition-colors"
                      >
                        {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        disabled={!entry.password}
                        title={copiedPassword ? tr('vault:copied') : tr('vault:copy')}
                        aria-label={tr('vault:copy')}
                        onClick={handleCopyPassword}
                        className="p-1.5 rounded-lg hover:text-main hover:bg-hover transition-colors disabled:opacity-30"
                      >
                        {copiedPassword ? <CheckIcon className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    title={tr('vault:generate')}
                    aria-label={tr('vault:generate')}
                    onClick={() => setGenerator(true)}
                    className="flex items-center justify-center p-2 h-9 w-9 rounded-xl border border-edge bg-surface hover:bg-hover text-sub hover:text-main shrink-0 transition-colors shadow-soft"
                  >
                    <RotateCw className="h-4 w-4 text-accent" />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-edge bg-canvas/30 p-3.5 text-xs text-sub leading-relaxed">
              {tr('vault:sshHelp')}
            </div>
            <Field label={tr('vault:keyPassphrase')}>
              <input
                type="password"
                value={entry.keyPassphrase}
                autoComplete="new-password"
                onChange={(e) => patch('keyPassphrase', e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => void run(async () => {
                  const result = await client.call('generateSsh', { passphrase: entry.keyPassphrase });
                  setEntry((e) => ({ ...e, ...result }));
                })}
              >
                <KeyRound className="h-3.5 w-3.5" />
                {tr('vault:generateSsh')}
              </Button>
              <Button
                disabled={busy}
                onClick={() => void run(async () => {
                  const path = await open({ multiple: false, directory: false });
                  if (typeof path !== 'string') return;
                  const value: string = await client.call('readSshFile', { path });
                  patch(value.includes('PRIVATE KEY') ? 'privateKey' : 'publicKey', value);
                })}
              >
                <Upload className="h-3.5 w-3.5" />
                {tr('vault:importSsh')}
              </Button>
            </div>
            <Field label={tr('vault:publicKey')}>
              <textarea
                value={entry.publicKey}
                onChange={(e) => patch('publicKey', e.target.value)}
                rows={3}
                className={`${textareaClass} font-mono`}
                spellCheck={false}
              />
            </Field>
            <Field label={tr('vault:privateKey')}>
              <textarea
                value={entry.privateKey}
                onChange={(e) => patch('privateKey', e.target.value)}
                rows={4}
                className={`${textareaClass} font-mono`}
                spellCheck={false}
              />
            </Field>
          </>
        )}

        <Field label={tr('vault:notes')}>
          <textarea
            value={entry.notes}
            onChange={(e) => patch('notes', e.target.value)}
            rows={3}
            className={textareaClass}
          />
        </Field>

        <ErrorLine error={error} />
      </form>
      {generator && (
        <GeneratorPanel
          client={client}
          initial={data.policy}
          idleMinutes={data.idleMinutes}
          onUse={(value) => patch('password', value)}
          onClose={() => setGenerator(false)}
        />
      )}
    </Modal>
  );
}

export function SettingsPanel({ client, data, onClose }: { client: VaultClient; data: VaultList; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'general' | 'policy' | 'password'>('general');
  const [idleMinutes, setIdle] = useState(data.idleMinutes);
  const [policy, setPolicy] = useState(data.policy);
  const [currentPassword, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [notice, setNotice] = useState('');
  const { busy, error, run } = useOperation();

  const idleOptions = useMemo(() => [
    { value: '1', label: tr('vault:idleMinutesUnit', { count: 1 }) },
    { value: '5', label: tr('vault:idleMinutesUnit', { count: 5 }) },
    { value: '15', label: tr('vault:idleMinutesUnit', { count: 15 }) },
    { value: '30', label: tr('vault:idleMinutesUnit', { count: 30 }) },
    { value: '60', label: tr('vault:idleMinutesUnit', { count: 60 }) },
  ], []);

  const saveSettings = () => void run(async () => {
    await client.call('settings', { policy, idleMinutes });
    setNotice(tr('vault:saveDefaults'));
    onClose();
  });

  return (
    <Modal
      icon={<Settings className="h-4 w-4" />}
      title={tr('vault:settings')}
      description={tr('vault:subtitle')}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose} className="ui-cancel-button">
            {tr('vault:close')}
          </Button>
          {activeTab === 'general' && (
            <Button primary disabled={busy} onClick={saveSettings}>
              {tr('vault:save')}
            </Button>
          )}
          {activeTab === 'policy' && (
            <Button primary disabled={busy} onClick={saveSettings}>
              {tr('vault:saveDefaults')}
            </Button>
          )}
          {activeTab === 'password' && (
            <Button
              type="submit"
              form="vault-change-password-form"
              primary
              disabled={busy || !currentPassword || !password || !confirm}
            >
              {tr('vault:changePassword')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 border-b border-edge pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'general' ? 'bg-accent/15 text-accent border border-accent/20' : 'text-sub hover:bg-hover'
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            {tr('vault:tabGeneral')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('policy')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'policy' ? 'bg-accent/15 text-accent border border-accent/20' : 'text-sub hover:bg-hover'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {tr('vault:tabPolicy')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('password')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'password' ? 'bg-accent/15 text-accent border border-accent/20' : 'text-sub hover:bg-hover'
            }`}
          >
            <Lock className="h-3.5 w-3.5" />
            {tr('vault:changePassword')}
          </button>
        </div>

        {/* Tab 1: General & Inactivity */}
        {activeTab === 'general' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <Field label={tr('vault:idleMinutes')}>
              <ThemeSelect
                portal
                ariaLabel={tr('vault:idleMinutes')}
                value={String(idleMinutes)}
                options={idleOptions}
                onChange={(next) => setIdle(Number(next))}
              />
            </Field>

            <div className="rounded-xl border border-edge bg-canvas/30 p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-main">
                <Shield className="h-4 w-4 text-accent" />
                <span>{tr('vault:plugin.name')}</span>
              </div>
              <p className="text-xs leading-relaxed text-sub">
                {tr('vault:securityNote')}
              </p>
            </div>
          </div>
        )}

        {/* Tab 2: Password Generator Policy */}
        {activeTab === 'policy' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <PolicyFields value={policy} onChange={setPolicy} />
          </div>
        )}

        {/* Tab 3: Change Master Password */}
        {activeTab === 'password' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            {/* Change Password Form */}
            <form
              id="vault-change-password-form"
              className="space-y-3 rounded-xl border border-edge bg-surface/40 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (password !== confirm) throw new Error('mismatch');
                  await client.call('changePassword', { currentPassword, password });
                  setCurrent('');
                  setPassword('');
                  setConfirm('');
                  setNotice(tr('vault:changedPassword'));
                });
              }}
            >
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-sub" />
                <h3 className="text-xs font-bold text-main">{tr('vault:changePassword')}</h3>
              </div>
              <Field label={tr('vault:currentPassword')}>
                <input
                  required
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrent(e.target.value)}
                  className={inputClass}
                  autoComplete="off"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tr('vault:newPassword')}>
                  <input
                    required
                    minLength={12}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label={tr('vault:confirmPassword')}>
                  <input
                    required
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={inputClass}
                    autoComplete="new-password"
                  />
                </Field>
              </div>
            </form>
          </div>
        )}

        <ErrorLine error={error} />
        {notice && <p role="status" className="text-xs text-accent font-semibold">{notice}</p>}
      </div>
    </Modal>
  );
}

export function TransferPanel({
  client,
  direction,
  ids,
  visibleIds,
  allowSshExport,
  onClose,
}: {
  client: VaultClient;
  direction: 'import' | 'export';
  ids: string[];
  visibleIds: string[];
  allowSshExport?: boolean;
  onClose: () => void;
}) {
  const [format, setFormat] = useState('encrypted');
  const [path, setPath] = useState('');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrent] = useState('');
  const [scope, setScope] = useState('all');
  const [preview, setPreview] = useState<any>(null);
  const [skipDuplicates, setSkip] = useState(true);
  const [notice, setNotice] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({
    name: 'name',
    url: 'url',
    username: 'username',
    password: 'password',
    notes: 'notes',
    folder: 'folder',
  });
  const { busy, error, run } = useOperation();
  const payload = { path, format, password, currentPassword, mapping, skipDuplicates, fileHash: preview?.fileHash };
  const clearPreview = () => {
    setPreview(null);
    setNotice('');
  };

  const formatOptions = useMemo(() => [
    { value: 'encrypted', label: tr('vault:encrypted') },
    { value: 'bitwarden', label: tr('vault:bitwarden') },
    { value: 'csv', label: tr('vault:csv') },
    ...(direction === 'export' && allowSshExport ? [{ value: 'ssh', label: tr('vault:sshExport') }] : []),
  ], [direction, allowSshExport]);

  const scopeOptions = useMemo(() => [
    { value: 'all', label: tr('vault:exportAll') },
    { value: 'visible', label: tr('vault:exportVisible') },
    ...(ids.length ? [{ value: 'selected', label: tr('vault:exportSelected') }] : []),
  ], [ids.length]);

  return (
    <Modal
      icon={<ArrowDownUp className="h-4 w-4" />}
      title={tr(`vault:${direction}`)}
      description={tr('vault:draftNotice')}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose} className="ui-cancel-button">
            {tr('vault:cancel')}
          </Button>
          {direction === 'import' ? (
            <>
              <Button disabled={busy || !path} onClick={() => void run(async () => setPreview(await client.call('importPreview', payload)))}>
                {tr('vault:preview')}
              </Button>
              <Button
                disabled={busy || !preview}
                primary
                onClick={() => void run(async () => {
                  const result = await client.call('import', payload);
                  setNotice(tr('vault:importDone', { count: result.added }));
                  setPreview(null);
                })}
              >
                {tr('vault:importNow')}
              </Button>
            </>
          ) : (
            <Button
              disabled={busy || !path}
              primary
              onClick={() => void run(async () => {
                const result = await client.call('export', {
                  ...payload,
                  ...(format === 'ssh' || scope === 'selected' ? { ids } : scope === 'visible' ? { ids: visibleIds } : {}),
                });
                setNotice(tr('vault:exportDone', { count: result.count, excluded: result.excludedSsh }));
                setCurrent('');
                setPassword('');
                setPath('');
              })}
            >
              {tr('vault:export')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Field label={tr('vault:format')}>
          <ThemeSelect
            portal
            ariaLabel={tr('vault:format')}
            value={format}
            options={formatOptions}
            onChange={(next) => {
              setFormat(next);
              setPath('');
              clearPreview();
            }}
          />
        </Field>

        {format === 'encrypted' && (
          <Field label={tr('vault:backupPassword')} required>
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              className={inputClass}
              onChange={(e) => {
                setPassword(e.target.value);
                clearPreview();
              }}
            />
          </Field>
        )}

        {direction === 'export' && format !== 'encrypted' && (
          <>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-500 font-medium">
              {tr('vault:plainWarning')}
            </div>
            <Field label={tr('vault:currentPassword')} required>
              <input
                type="password"
                value={currentPassword}
                autoComplete="off"
                onChange={(e) => setCurrent(e.target.value)}
                className={inputClass}
              />
            </Field>
          </>
        )}

        {direction === 'export' && format !== 'ssh' && (
          <Field label={tr('vault:exportScope')}>
            <ThemeSelect
              portal
              ariaLabel={tr('vault:exportScope')}
              value={scope}
              options={scopeOptions}
              onChange={setScope}
            />
          </Field>
        )}

        <div className="flex items-center gap-3">
          <Button
            disabled={busy}
            onClick={() => void run(async () => {
              const chosen = direction === 'import'
                ? await open({ multiple: false, directory: false })
                : await save({ defaultPath: `vault-${Date.now()}.${format === 'encrypted' ? 'lmvault' : format === 'ssh' ? 'key' : format === 'csv' ? 'csv' : 'json'}` });
              if (typeof chosen === 'string') {
                setPath(chosen);
                clearPreview();
              }
            })}
          >
            {tr('vault:chooseFile')}
          </Button>
          <span className="min-w-0 flex-1 truncate text-xs text-sub font-mono">{path || '—'}</span>
        </div>

        {direction === 'import' && format === 'csv' && (
          <fieldset className="space-y-3 rounded-xl border border-edge bg-canvas/30 p-3.5">
            <legend className="text-xs font-semibold px-1">{tr('vault:columnMapping')}</legend>
            <p className="text-[11px] text-sub">{tr('vault:columnHelp')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(mapping).map(([key, value]) => (
                <Field key={key} label={tr(`vault:${key}`)}>
                  <input
                    className={inputClass}
                    value={value}
                    onChange={(e) => {
                      setMapping((m) => ({ ...m, [key]: e.target.value }));
                      clearPreview();
                    }}
                  />
                </Field>
              ))}
            </div>
          </fieldset>
        )}

        {direction === 'import' && (
          <Check label={tr('vault:skipDuplicates')} checked={skipDuplicates} onChange={setSkip} />
        )}

        {preview && (
          <div className="space-y-2.5 rounded-xl border border-edge bg-surface/50 p-3.5">
            <p className="text-xs font-semibold text-main">
              {tr('vault:previewCounts', { count: preview.count, folders: preview.folderCount, duplicates: preview.duplicates })}
            </p>
            {preview.warnings.length > 0 && (
              <p className="text-xs font-medium text-warning">
                {tr('vault:warnings', { count: preview.warnings.length })}
              </p>
            )}
            {preview.warnings.length > 0 && (
              <div className="max-h-28 overflow-auto text-xs text-sub custom-scrollbar">
                {preview.warnings.map((warning: { code: string; name: string }, index: number) => (
                  <p key={index}>{tr(`vault:importWarnings.${warning.code}`)}: {warning.name || '—'}</p>
                ))}
              </div>
            )}
            <div className="max-h-36 overflow-auto text-xs text-sub custom-scrollbar border-t border-edge/50 pt-2 space-y-1">
              {preview.entries.map((item: any) => (
                <p key={item.id} className="truncate">{item.name} · {item.kind === 'ssh' ? tr('vault:sshKey') : item.username}</p>
              ))}
            </div>
          </div>
        )}

        <ErrorLine error={error} />
        {notice && <p role="status" className="text-xs text-accent font-semibold">{notice}</p>}
      </div>
    </Modal>
  );
}

export function SharePanel({
  client,
  entry,
  users,
  currentUserId,
  onClose,
}: {
  client: VaultClient;
  entry: VaultEntry;
  users: User[];
  currentUserId: string;
  onClose: () => void;
}) {
  const chatEnabled = useFeatures().chat;
  const [recipientId, setRecipientId] = useState('');
  const [recipient, setRecipient] = useState<RecipientKey | null>(null);
  const [verified, setVerified] = useState(false);
  const [includePassword, setInclude] = useState(false);
  const [notice, setNotice] = useState('');
  const { busy, error, run } = useOperation();

  const recipientOptions = useMemo(() => [
    { value: '', label: tr('vault:chooseRecipient') },
    ...users
      .filter((u) => u.id !== currentUserId)
      .map((u) => ({
        value: u.id,
        label: u.nickname || u.username,
      })),
  ], [users, currentUserId]);

  return (
    <Modal
      icon={<Share2 className="h-4 w-4" />}
      title={tr('vault:share')}
      description={entry.name}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} className="ui-cancel-button">
            {tr('vault:cancel')}
          </Button>
          <Button
            disabled={busy || !recipient || !verified || !chatEnabled}
            primary
            onClick={() => void run(async () => {
              await client.call('share', {
                id: entry.id,
                userId: recipientId,
                recipient,
                verifiedFingerprint: recipient!.fingerprint,
                includePassword,
              });
              setNotice(tr('vault:shareSent'));
              setInclude(false);
              setVerified(false);
            })}
          >
            {tr('vault:sendShare')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-sub">{tr('vault:shareHelp')}</p>

        {!chatEnabled && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 font-medium">
            {tr('vault:chatDisabled')}
          </div>
        )}

        <Field label={tr('vault:recipient')}>
          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <ThemeSelect
                portal
                disabled={busy}
                ariaLabel={tr('vault:recipient')}
                value={recipientId}
                options={recipientOptions}
                onChange={(next) => {
                  setRecipientId(next);
                  setRecipient(null);
                  setVerified(false);
                }}
              />
            </div>
            <Button
              disabled={busy || !recipientId || !chatEnabled}
              onClick={() => void run(async () => {
                setVerified(false);
                setRecipient(await client.call('recipient', { userId: recipientId }));
              })}
            >
              <UserIcon className="h-3.5 w-3.5" />
              {tr('vault:lookupRecipient')}
            </Button>
          </div>
        </Field>

        {entry.kind === 'login' ? (
          <Check label={tr('vault:includePassword')} checked={includePassword} onChange={setInclude} />
        ) : (
          <p className="text-xs text-sub">{tr('vault:sharePublicOnly')}</p>
        )}

        {recipient && (
          <div className="space-y-3 rounded-xl border border-edge bg-canvas/30 p-3.5">
            <Field label={tr('vault:recipientFingerprint')}>
              <code className="block break-all rounded-lg border border-edge bg-surface px-2.5 py-1.5 font-mono text-xs text-main">
                {recipient.fingerprint}
              </code>
            </Field>
            {recipient.knownFingerprint && recipient.knownFingerprint !== recipient.fingerprint && (
              <>
                <p className="text-xs text-warning font-semibold">{tr('vault:keyChanged')}</p>
                <Field label={tr('vault:previousFingerprint')}>
                  <code className="block break-all rounded-lg border border-edge bg-surface px-2.5 py-1.5 font-mono text-xs text-main">
                    {recipient.knownFingerprint}
                  </code>
                </Field>
              </>
            )}
            <Check label={tr('vault:verifyFingerprint')} checked={verified} onChange={setVerified} />
          </div>
        )}

        <ErrorLine error={error} />
        {notice && <p role="status" className="text-xs text-accent font-semibold">{notice}</p>}
      </div>
    </Modal>
  );
}
