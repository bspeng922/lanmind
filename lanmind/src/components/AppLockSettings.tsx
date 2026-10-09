import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
import React, { useEffect, useId, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Eye, EyeOff, Loader2, LockKeyhole, Save, Trash2 } from 'lucide-react';
import { ApiService, AppLockStatus } from '../services/api';
import { AppLockPasswordDialog } from './AppLockPasswordDialog';

type LockConfigChange = Parameters<typeof ApiService.updateAppLockConfig>[0];
interface PendingChange { action: 'save' | 'disable' | 'clear'; config: LockConfigChange }

export const AppLockSettings: React.FC<{ available?: boolean }> = ({ available = isTauri() }) => {
  useLocale();
  const id = useId();
  const [saved, setSaved] = useState<AppLockStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [minutes, setMinutes] = useState('5');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(available);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [verificationError, setVerificationError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const status = await ApiService.getAppLockStatus();
      setSaved(status); setEnabled(status.enabled); setMinutes(String(status.idleMinutes));
    } catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (available) void load(); }, [available]);
  const changed = () => { setSuccess(false); setError(''); };
  const applyChange = async (config: LockConfigChange, currentPassword?: string) => {
    if (busy) return;
    setBusy(true); setVerificationError('');
    try {
      const status = await ApiService.updateAppLockConfig({ ...config, currentPassword });
      setSaved(status); setEnabled(status.enabled); setMinutes(String(status.idleMinutes));
      setPassword(''); setConfirmation(''); setVisible(false); setSuccess(true); setPending(null);
    } catch (reason) {
      const message = String(reason instanceof Error ? reason.message : reason);
      if (currentPassword !== undefined) setVerificationError(message); else setError(message);
    } finally { setBusy(false); }
  };
  const requestChange = (action: PendingChange['action'], config: LockConfigChange) => {
    changed(); setVerificationError('');
    if (saved?.passwordConfigured) setPending({ action, config });
    else void applyChange(config);
  };
  const save = async () => {
    if (busy || !saved) return;
    changed();
    const idleMinutes = Number(minutes);
    if (!Number.isInteger(idleMinutes) || idleMinutes < 1 || idleMinutes > 1440) { setError(tr("settings:appLockSettings.autoLockTimeoutMustBeBetween1")); return; }
    if (enabled && !saved.passwordConfigured && !password) { setError(tr("settings:appLockSettings.setAnUnlockPasswordBeforeEnablingAuto")); return; }
    if (password && (Array.from(password).length < 8 || Array.from(password).length > 128)) { setError(tr("settings:appLockSettings.unlockPasswordMustContain8To128")); return; }
    if (password !== confirmation) { setError(tr("settings:appLockSettings.theNewPasswordsDoNotMatch")); return; }
    requestChange('save', { enabled, idleMinutes, password: password || undefined });
  };
  const lock = async () => {
    setBusy(true); changed();
    try { await ApiService.lockApp(); }
    catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); }
    finally { setBusy(false); }
  };
  const disabled = !available || loading || busy || !saved || Boolean(pending);
  const inputClass = 'w-full rounded-lg border border-subtle bg-input px-3 py-2 text-xs text-main disabled:opacity-50';
  return <div className="rounded-xl border border-edge bg-canvas/60 p-4" aria-labelledby={`${id}-heading`}>
    <div className="flex items-center justify-between gap-5">
      <div className="min-w-0">
        <h5 id={`${id}-heading`} className="flex items-center gap-1.5 text-xs font-bold text-main"><LockKeyhole className="h-3.5 w-3.5 text-info" />{tr("settings:appLockSettings.automaticallyLockTheInterface")}</h5>
        <p className="mt-1 text-[11px] leading-5 text-sub">{tr("settings:appLockSettings.lockAfterTheSelectedPeriodOfInactivity")}</p>
      </div>
      <button type="button" role="switch" aria-label={tr("settings:appLockSettings.automaticallyLockTheInterface")} aria-checked={enabled} disabled={disabled} className="ui-switch" data-state={enabled ? 'checked' : 'unchecked'} onClick={() => {
        if (enabled && saved?.enabled && saved.passwordConfigured) requestChange('disable', { enabled: false, idleMinutes: saved.idleMinutes });
        else { setEnabled(!enabled); changed(); }
      }}><span className="ui-switch-thumb">{loading && <Loader2 className="h-3 w-3 animate-spin" />}</span></button>
    </div>
    {!available ? <p className="mt-2 text-[11px] text-quiet">{tr("settings:appLockSettings.autoLockIsOnlyAvailableInThe")}</p> : <>
      {saved && <>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-minutes`} className="mb-2 block text-xs text-sub">{tr("settings:appLockSettings.inactivityTimeoutMinutes")}</label>
            <input id={`${id}-minutes`} type="number" min={1} max={1440} step={1} value={minutes} disabled={disabled} className={inputClass} onChange={(event) => { setMinutes(event.target.value); changed(); }} />
            <p className="mt-1 text-[11px] text-quiet">{tr("settings:appLockSettings.between1And1440MinutesDefault5")}</p>
          </div>
          {(enabled || saved.passwordConfigured) && <div className="grid grid-cols-2 gap-4 sm:col-span-2" aria-label={tr("settings:appLockSettings.setAndConfirmUnlockPassword")}>
            <div className="min-w-0">
              <label htmlFor={`${id}-new`} className="mb-2 block text-xs text-sub">{saved.passwordConfigured ? tr("settings:appLockSettings.newUnlockPasswordLeaveBlankToKeep") : tr("settings:appLockSettings.setUnlockPassword")}</label>
              <input id={`${id}-new`} type={visible ? 'text' : 'password'} autoComplete="new-password" maxLength={128} value={password} disabled={disabled} className={inputClass} onChange={(event) => { setPassword(event.target.value); changed(); }} />
              <p className="mt-1 text-[11px] text-quiet">{tr("settings:appLockSettings.8128CharactersIndependentOfTheWeb")}</p>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-confirmation`} className="mb-2 block text-xs text-sub">{tr("settings:appLockSettings.confirmNewUnlockPassword")}</label>
              <input id={`${id}-confirmation`} type={visible ? 'text' : 'password'} autoComplete="new-password" maxLength={128} value={confirmation} disabled={disabled} className={inputClass} onChange={(event) => { setConfirmation(event.target.value); changed(); }} />
            </div>
          </div>}
        </div>
        {saved.passwordConfigured && <div className="mt-4 flex items-center justify-between gap-3 border-t border-edge pt-3"><p className="text-[11px] leading-5 text-sub">{tr("settings:appLockSettings.anUnlockPasswordIsSetVerifyIt")}</p><button type="button" disabled={disabled} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-50" onClick={() => requestChange('clear', { enabled: false, idleMinutes: saved.idleMinutes, clearPassword: true })}><Trash2 className="h-3.5 w-3.5" />{tr("settings:appLockSettings.clearUnlockPassword")}</button></div>}
        <p className="mt-3 text-[11px] leading-5 text-sub">{tr("settings:appLockSettings.whenEnabledRestartingAlsoRequiresUnlockingThe")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="theme-btn-primary flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs disabled:opacity-50" disabled={disabled} onClick={() => void save()}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{tr("settings:appLockSettings.saveLockSettings")}</button>
          {saved.enabled && saved.passwordConfigured && <button type="button" className="ui-cancel-button flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs" disabled={disabled} onClick={() => void lock()}><LockKeyhole className="h-3.5 w-3.5" />{tr("settings:appLockSettings.lockNow")}</button>}
          {(enabled || saved.passwordConfigured) && <button type="button" disabled={disabled} className="project-toolbar-icon" aria-label={visible ? tr("settings:appLockSettings.hidePasswordInSettings") : tr("settings:appLockSettings.showPasswordInSettings")} title={visible ? tr("settings:appLockSettings.hidePassword") : tr("settings:appLockSettings.showPassword")} onClick={() => setVisible(!visible)}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>}
          {success && <span role="status" className="text-xs text-success">{tr("settings:appLockSettings.lockSettingsSaved")}</span>}
        </div>
      </>}
      {error && <p role="alert" className="mt-3 text-xs text-danger">{localizeMessage(error)}</p>}
      {!saved && !loading && <button type="button" className="ui-cancel-button mt-3 rounded-lg px-3 py-2 text-xs" onClick={() => void load()}>{tr("settings:appLockSettings.reloadLockSettings")}</button>}
    </>}
    {pending && <AppLockPasswordDialog title={pending.action === 'clear' ? tr("settings:appLockSettings.clearUnlockPassword") : pending.action === 'disable' ? tr("settings:appLockSettings.disableAutoLock") : tr("settings:appLockSettings.verifyCurrentUnlockPassword")} description={pending.action === 'clear' ? tr("settings:appLockSettings.verifyYourCurrentPasswordToClearIt") : pending.action === 'disable' ? tr("settings:appLockSettings.enterYourCurrentPasswordToDisableAuto") : tr("settings:appLockSettings.enterYourCurrentUnlockPasswordToSave")} busy={busy} error={verificationError} onCancel={() => { if (!busy) { setPending(null); setVerificationError(''); } }} onConfirm={(currentPassword) => void applyChange(pending.config, currentPassword)} />}
  </div>;
};
