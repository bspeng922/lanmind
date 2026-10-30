/**
 * GeneratorPanel — Password generator modal with rule configuration and persistent history.
 *
 * CALLING SPEC:
 *   <GeneratorPanel
 *     client={vaultClient}
 *     initial={defaultPolicy}
 *     idleMinutes={15}
 *     onUse={(pwd: string) => { ... }}
 *     onClose={() => { ... }}
 *   />
 */

import React, { useEffect, useState } from 'react';
import {
  Check as CheckIcon,
  Copy,
  History,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { tr } from '../../../src/i18n';
import {
  defaultPolicy,
  vaultError,
  type PasswordPolicy,
  type VaultClient,
} from '../client';
import { Button, Check, Field, Modal, inputClass } from './ui';

export interface GeneratedPasswordRecord {
  id: string;
  password: string;
  createdAt: number;
}

const STORAGE_KEY_GENERATOR_HISTORY = 'lanmind_vault_generator_history';
const MAX_HISTORY_ITEMS = 50;

export function loadGeneratorHistory(): GeneratedPasswordRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GENERATOR_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item) => item && typeof item.password === 'string' && typeof item.createdAt === 'number'
      );
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

export function saveGeneratorHistory(records: GeneratedPasswordRecord[]) {
  try {
    localStorage.setItem(
      STORAGE_KEY_GENERATOR_HISTORY,
      JSON.stringify(records.slice(0, MAX_HISTORY_ITEMS))
    );
  } catch {
    // ignore quota errors
  }
}

/**
 * Render password with character classification colors:
 * - Digits (0-9): blue
 * - Symbols / special: rose/coral
 * - Letters: main text
 */
export function renderHighlightedPassword(pwd: string) {
  if (!pwd) return null;
  return pwd.split('').map((char, index) => {
    let colorClass = 'text-main';
    if (/[0-9]/.test(char)) {
      colorClass = 'text-blue-500 dark:text-blue-400 font-semibold';
    } else if (/[^a-zA-Z0-9\s]/.test(char)) {
      colorClass = 'text-rose-500 dark:text-rose-400 font-bold';
    }
    return (
      <span key={index} className={colorClass}>
        {char}
      </span>
    );
  });
}

export function PolicyFields({
  value,
  onChange,
}: {
  value: PasswordPolicy;
  onChange: (value: PasswordPolicy) => void;
}) {
  const patch = (key: keyof PasswordPolicy, item: unknown) =>
    onChange({ ...value, [key]: item });

  return (
    <div className="space-y-4">
      <Field label={tr('vault:length')}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={4}
            max={128}
            value={value.length}
            onChange={(e) => patch('length', Number(e.target.value))}
            className="flex-1 accent-accent cursor-pointer"
          />
          <input
            type="number"
            min={4}
            max={128}
            value={value.length}
            onChange={(e) =>
              patch('length', Math.max(4, Math.min(128, Number(e.target.value))))
            }
            className={`${inputClass} w-20 text-center font-mono`}
          />
        </div>
      </Field>

      <div className="rounded-xl border border-edge bg-canvas/30 p-3.5 space-y-2.5">
        <span className="text-[11px] font-semibold text-sub block uppercase tracking-wider">
          {tr('vault:typeFilter')}
        </span>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {(['uppercase', 'lowercase', 'digits', 'symbols', 'avoidAmbiguous'] as const).map(
            (key) => (
              <Check
                key={key}
                label={tr(`vault:${key}`)}
                checked={value[key]}
                onChange={(item) => patch(key, item)}
              />
            )
          )}
        </div>
      </div>

      <Field label={tr('vault:symbolChars')}>
        <input
          value={value.symbolChars}
          onChange={(e) => patch('symbolChars', e.target.value)}
          className={`${inputClass} font-mono`}
          spellCheck={false}
        />
      </Field>
    </div>
  );
}

export interface GeneratorPanelProps {
  client: VaultClient;
  initial?: PasswordPolicy;
  idleMinutes: number;
  onUse?: (value: string) => void;
  onClose: () => void;
}

export function GeneratorPanel({
  client,
  initial = defaultPolicy,
  idleMinutes,
  onUse,
  onClose,
}: GeneratorPanelProps) {
  const [policy, setPolicy] = useState(initial);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState<'settings' | 'history'>('settings');
  const [history, setHistory] = useState<GeneratedPasswordRecord[]>(() =>
    loadGeneratorHistory()
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generateWithPolicy = async (activePolicy: PasswordPolicy) => {
    setBusy(true);
    setError('');
    try {
      const next: string = await client.call('generate', { policy: activePolicy });
      setPassword(next);
      const newRecord: GeneratedPasswordRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        password: next,
        createdAt: Date.now(),
      };
      setHistory((prev) => {
        const updated = [newRecord, ...prev.filter((r) => r.password !== next)].slice(
          0,
          MAX_HISTORY_ITEMS
        );
        saveGeneratorHistory(updated);
        return updated;
      });
    } catch (e) {
      setError(vaultError(e));
    } finally {
      setBusy(false);
    }
  };

  // 挂载时自动生成一次初始密码
  useEffect(() => {
    void generateWithPolicy(initial);
  }, []);

  const handleClearHistory = () => {
    saveGeneratorHistory([]);
    setHistory([]);
  };

  const copyPassword = async (pwd: string, id: string = 'current') => {
    try {
      await client.call('copyGenerated', { value: pwd });
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      setNotice(tr('vault:copied'));
      setTimeout(() => setNotice(''), 2500);
    } catch (e) {
      setError(vaultError(e));
    }
  };

  return (
    <Modal
      icon={<RotateCw className="h-4 w-4" />}
      title={tr('vault:generate')}
      description={tr('vault:generatedPassword')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} className="ui-cancel-button">
            {tr('vault:close')}
          </Button>
          {activeTab === 'settings' ? (
            <>
              {onUse && (
                <Button
                  disabled={!password || busy}
                  primary
                  onClick={() => {
                    onUse(password);
                    onClose();
                  }}
                >
                  {tr('vault:usePassword')}
                </Button>
              )}
              <Button
                disabled={busy}
                onClick={async () => {
                  try {
                    await client.call('settings', { policy, idleMinutes });
                    setNotice(tr('vault:saveDefaults'));
                    setTimeout(() => setNotice(''), 2500);
                  } catch (e) {
                    setError(vaultError(e));
                  }
                }}
              >
                {tr('vault:saveDefaults')}
              </Button>
            </>
          ) : (
            <>
              {history.length > 0 && (
                <Button danger onClick={handleClearHistory}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  {tr('vault:clearHistory')}
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* Tab 导航切换 */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-canvas border border-edge">
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${activeTab === 'settings'
                ? 'bg-surface text-main shadow-soft border border-edge/60'
                : 'text-sub hover:text-main'
              }`}
          >
            {tr('vault:generatorSettings')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${activeTab === 'history'
                ? 'bg-surface text-main shadow-soft border border-edge/60'
                : 'text-sub hover:text-main'
              }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>{tr('vault:generatorHistory')}</span>
            {history.length > 0 && (
              <span className="rounded-full bg-accent/15 px-1.5 py-0.2 text-[10px] font-bold text-accent">
                {history.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'settings' ? (
          <>
            {/* 生成的密码显示框：左侧高亮文本，右侧【重新生成】与【复制】紧凑按钮 */}
            <Field label={tr('vault:generatedPassword')}>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-canvas/80 px-3.5 py-2.5 min-h-[48px] shadow-sm">
                <div className="flex-1 min-w-0 font-mono text-sm tracking-wide select-all overflow-x-auto whitespace-nowrap custom-scrollbar py-0.5">
                  {password ? (
                    renderHighlightedPassword(password)
                  ) : (
                    <span className="text-quiet text-xs italic">
                      {tr('vault:empty')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void generateWithPolicy(policy)}
                    title={tr('vault:regenerate')}
                    aria-label={tr('vault:regenerate')}
                    className="p-1.5 rounded-lg text-sub hover:text-main hover:bg-hover active:scale-95 transition-all disabled:opacity-40"
                  >
                    <RotateCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    type="button"
                    disabled={busy || !password}
                    onClick={() => void copyPassword(password, 'current')}
                    title={copiedId === 'current' ? tr('vault:copied') : tr('vault:copy')}
                    aria-label={tr('vault:copy')}
                    className={`p-1.5 rounded-lg transition-all active:scale-95 disabled:opacity-40 ${copiedId === 'current'
                        ? 'text-emerald-500 bg-emerald-500/10'
                        : 'text-sub hover:text-main hover:bg-hover'
                      }`}
                  >
                    {copiedId === 'current' ? (
                      <CheckIcon className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </Field>

            <PolicyFields
              value={policy}
              onChange={(value) => {
                setPolicy(value);
              }}
            />
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-sub">
              <span>
                {tr('vault:generatorHistory')} ({history.length})
              </span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="flex items-center gap-1 text-[11px] font-medium text-rose-500 hover:text-rose-600 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>{tr('vault:clearHistory')}</span>
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="py-10 text-center text-xs text-quiet">
                <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>{tr('vault:noGeneratorHistory')}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-edge bg-surface shadow-soft"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-quiet">
                        <span>{new Date(item.createdAt).toLocaleString()}</span>
                        {copiedId === item.id && (
                          <span className="flex items-center gap-1 text-accent font-semibold animate-in fade-in">
                            <CheckIcon className="h-3 w-3" />
                            {tr('vault:copied')}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs break-all select-all tracking-wide">
                        {renderHighlightedPassword(item.password)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      <button
                        type="button"
                        aria-label={tr('vault:copy')}
                        title={tr('vault:copy')}
                        onClick={() => void copyPassword(item.password, item.id)}
                        className={`p-1.5 rounded-lg transition-colors ${copiedId === item.id
                            ? 'text-emerald-500 bg-emerald-500/10'
                            : 'text-sub hover:text-main hover:bg-hover'
                          }`}
                      >
                        {copiedId === item.id ? (
                          <CheckIcon className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {onUse && (
                        <button
                          type="button"
                          title={tr('vault:usePassword')}
                          onClick={() => {
                            onUse(item.password);
                            onClose();
                          }}
                          className="px-2 py-1 rounded-lg bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 text-xs font-semibold transition-colors"
                        >
                          {tr('vault:use')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-medium text-rose-500"
          >
            <span className="flex-1 min-w-0">{error}</span>
          </div>
        )}
        {notice && (
          <p role="status" className="text-xs text-accent font-medium">
            {notice}
          </p>
        )}
      </div>
    </Modal>
  );
}
