import React, { useState } from 'react';
import { AlertTriangle, KeyRound, RotateCcw, ShieldAlert } from 'lucide-react';
import { tr } from '../../../src/i18n';
import { vaultError, type VaultClient } from '../client';
import { Button, Field, Modal, inputClass } from './ui';
import { ErrorLine } from './Panels';

export interface ForgotPasswordModalProps {
  client: VaultClient;
  hasRecoveryKey: boolean;
  onRecovered: (newRecoveryKey?: string) => void;
  onReset: () => void;
  onClose: () => void;
}

export function ForgotPasswordModal({
  client,
  hasRecoveryKey,
  onRecovered,
  onReset,
  onClose,
}: ForgotPasswordModalProps) {
  const [tab, setTab] = useState<'recover' | 'reset'>(hasRecoveryKey ? 'recover' : 'reset');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hint, setHint] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resetConfirmed = /^RESET$/i.test(resetConfirm.trim());

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !hasRecoveryKey) return;
    setError('');
    if (newPassword !== confirmPassword) {
      setError(tr('vault:mismatch'));
      return;
    }
    setBusy(true);
    try {
      const result = await client.call('recoverWithKey', {
        recoveryKey: recoveryKey.trim(),
        newPassword,
        ...(hint.trim() ? { hint: hint.trim() } : {}),
      });
      onRecovered(typeof result?.recoveryKey === 'string' ? result.recoveryKey : undefined);
    } catch (err) {
      setError(vaultError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !resetConfirmed) return;
    setError('');
    setBusy(true);
    try {
      await client.call('resetVault', { confirmText: resetConfirm.trim() });
      onReset();
    } catch (err) {
      setError(vaultError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      icon={<KeyRound className="h-4 w-4 text-accent" />}
      title={tr('vault:forgotPasswordTitle')}
      description={tr('vault:forgotPasswordSubtitle')}
      onClose={() => { if (!busy) onClose(); }}
      footer={
        <>
          <Button onClick={onClose} className="ui-cancel-button" disabled={busy}>
            {tr('vault:cancel')}
          </Button>
          {tab === 'recover' ? (
            <Button
              type="submit"
              form="vault-recover-form"
              primary
              disabled={busy || !hasRecoveryKey || !recoveryKey.trim() || !newPassword || !confirmPassword}
            >
              {busy ? tr('vault:loading') : tr('vault:recoverSubmit')}
            </Button>
          ) : (
            <Button
              type="submit"
              form="vault-reset-form"
              danger
              disabled={busy || !resetConfirmed}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {busy ? tr('vault:loading') : tr('vault:resetVaultSubmit')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-1.5 border-b border-edge pb-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => { setTab('recover'); setError(''); }}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
              tab === 'recover'
                ? 'border border-accent/20 bg-accent/15 text-accent'
                : 'text-sub hover:bg-hover'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {tr('vault:tabRecover')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setTab('reset'); setError(''); }}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
              tab === 'reset'
                ? 'border border-rose-500/30 bg-rose-500/10 text-rose-500'
                : 'text-sub hover:bg-hover'
            }`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {tr('vault:tabResetVault')}
          </button>
        </div>

        {tab === 'recover' ? (
          <form id="vault-recover-form" className="space-y-3.5" autoComplete="off" onSubmit={(e) => void handleRecover(e)}>
            {!hasRecoveryKey ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-600 dark:text-amber-400">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="leading-relaxed font-medium">{tr('vault:noRecoveryKeyHint')}</p>
              </div>
            ) : (
              <>
                <p className="text-xs leading-relaxed text-sub">{tr('vault:recoverHelp')}</p>
                <Field label={tr('vault:recoveryKey')} required>
                  <input
                    type="text"
                    required
                    value={recoveryKey}
                    onChange={(e) => setRecoveryKey(e.target.value)}
                    placeholder={tr('vault:recoveryKeyPlaceholder')}
                    className={`${inputClass} font-mono uppercase`}
                    autoFocus
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={tr('vault:newPassword')} required>
                    <input
                      type="password"
                      required
                      minLength={12}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      className={inputClass}
                    />
                  </Field>
                  <Field label={tr('vault:confirmPassword')} required>
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      className={inputClass}
                    />
                  </Field>
                </div>
                <Field label={tr('vault:passwordHint')}>
                  <input
                    type="text"
                    maxLength={200}
                    value={hint}
                    onChange={(e) => setHint(e.target.value)}
                    placeholder={tr('vault:passwordHintPlaceholder')}
                    className={inputClass}
                  />
                </Field>
              </>
            )}
          </form>
        ) : (
          <form id="vault-reset-form" className="space-y-4" autoComplete="off" onSubmit={(e) => void handleReset(e)}>
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-500">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="leading-relaxed font-medium">{tr('vault:resetVaultHelp')}</p>
            </div>
            <Field label={tr('vault:resetVaultConfirmLabel')} required>
              <input
                type="text"
                required
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                placeholder="RESET"
                className={`${inputClass} font-mono uppercase`}
                autoFocus
              />
            </Field>
          </form>
        )}

        <ErrorLine error={error} />
      </div>
    </Modal>
  );
}
