import React, { useEffect, useId, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Eye, EyeOff, Loader2, LockKeyhole, Save, Trash2 } from 'lucide-react';
import { ApiService, AppLockStatus } from '../services/api';
import { AppLockPasswordDialog } from './AppLockPasswordDialog';

type LockConfigChange = Parameters<typeof ApiService.updateAppLockConfig>[0];
interface PendingChange { action: 'save' | 'disable' | 'clear'; config: LockConfigChange }

export const AppLockSettings: React.FC<{ available?: boolean }> = ({ available = isTauri() }) => {
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
    if (!Number.isInteger(idleMinutes) || idleMinutes < 1 || idleMinutes > 1440) { setError('自动锁定时间必须为 1 到 1440 分钟'); return; }
    if (enabled && !saved.passwordConfigured && !password) { setError('启用自动锁定前请设置解锁密码'); return; }
    if (password && (Array.from(password).length < 8 || Array.from(password).length > 128)) { setError('解锁密码长度必须为 8 到 128 个字符'); return; }
    if (password !== confirmation) { setError('两次输入的新密码不一致'); return; }
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
        <h5 id={`${id}-heading`} className="flex items-center gap-1.5 text-xs font-bold text-main"><LockKeyhole className="h-3.5 w-3.5 text-info" />自动锁定界面</h5>
        <p className="mt-1 text-[11px] leading-5 text-sub">无操作达到设定时间后锁定，需要输入密码才能继续使用。</p>
      </div>
      <button type="button" role="switch" aria-label="自动锁定界面" aria-checked={enabled} disabled={disabled} className="ui-switch" data-state={enabled ? 'checked' : 'unchecked'} onClick={() => {
        if (enabled && saved?.enabled && saved.passwordConfigured) requestChange('disable', { enabled: false, idleMinutes: saved.idleMinutes });
        else { setEnabled(!enabled); changed(); }
      }}><span className="ui-switch-thumb">{loading && <Loader2 className="h-3 w-3 animate-spin" />}</span></button>
    </div>
    {!available ? <p className="mt-2 text-[11px] text-quiet">自动锁定仅在桌面客户端中可用。</p> : <>
      {saved && <>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-minutes`} className="mb-2 block text-xs text-sub">无操作锁定时间（分钟）</label>
            <input id={`${id}-minutes`} type="number" min={1} max={1440} step={1} value={minutes} disabled={disabled} className={inputClass} onChange={(event) => { setMinutes(event.target.value); changed(); }} />
            <p className="mt-1 text-[11px] text-quiet">可设置 1–1440 分钟，默认 5 分钟。</p>
          </div>
          {(enabled || saved.passwordConfigured) && <div className="grid grid-cols-2 gap-4 sm:col-span-2" aria-label="设置与确认解锁密码">
            <div className="min-w-0">
              <label htmlFor={`${id}-new`} className="mb-2 block text-xs text-sub">{saved.passwordConfigured ? '新解锁密码（留空保留原密码）' : '设置解锁密码'}</label>
              <input id={`${id}-new`} type={visible ? 'text' : 'password'} autoComplete="new-password" maxLength={128} value={password} disabled={disabled} className={inputClass} onChange={(event) => { setPassword(event.target.value); changed(); }} />
              <p className="mt-1 text-[11px] text-quiet">8–128 个字符，与网络伺服密码独立。</p>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-confirmation`} className="mb-2 block text-xs text-sub">确认新解锁密码</label>
              <input id={`${id}-confirmation`} type={visible ? 'text' : 'password'} autoComplete="new-password" maxLength={128} value={confirmation} disabled={disabled} className={inputClass} onChange={(event) => { setConfirmation(event.target.value); changed(); }} />
            </div>
          </div>}
        </div>
        {saved.passwordConfigured && <div className="mt-4 flex items-center justify-between gap-3 border-t border-edge pt-3"><p className="text-[11px] leading-5 text-sub">已设置解锁密码。修改设置或清除密码时需验证当前密码。</p><button type="button" disabled={disabled} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-50" onClick={() => requestChange('clear', { enabled: false, idleMinutes: saved.idleMinutes, clearPassword: true })}><Trash2 className="h-3.5 w-3.5" />清除解锁密码</button></div>}
        <p className="mt-3 text-[11px] leading-5 text-sub">启用后，重新启动程序也需要解锁；缩到托盘仍会计时，锁定期间后台同步继续运行。</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="theme-btn-primary flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs disabled:opacity-50" disabled={disabled} onClick={() => void save()}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存锁定设置</button>
          {saved.enabled && saved.passwordConfigured && <button type="button" className="ui-cancel-button flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs" disabled={disabled} onClick={() => void lock()}><LockKeyhole className="h-3.5 w-3.5" />立即锁定</button>}
          {(enabled || saved.passwordConfigured) && <button type="button" disabled={disabled} className="project-toolbar-icon" aria-label={visible ? '隐藏设置中的密码' : '显示设置中的密码'} title={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>}
          {success && <span role="status" className="text-xs text-success">锁定设置已保存</span>}
        </div>
      </>}
      {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
      {!saved && !loading && <button type="button" className="ui-cancel-button mt-3 rounded-lg px-3 py-2 text-xs" onClick={() => void load()}>重新读取锁定设置</button>}
    </>}
    {pending && <AppLockPasswordDialog title={pending.action === 'clear' ? '清除解锁密码' : pending.action === 'disable' ? '关闭自动锁定' : '验证当前解锁密码'} description={pending.action === 'clear' ? '验证当前密码后，将清除解锁密码并关闭自动锁定。以后可重新设置密码并启用。' : pending.action === 'disable' ? '输入当前解锁密码，验证后关闭自动锁定。已设置的密码会保留。' : '输入当前解锁密码，验证通过后保存本次锁定设置。'} busy={busy} error={verificationError} onCancel={() => { if (!busy) { setPending(null); setVerificationError(''); } }} onConfirm={(currentPassword) => void applyChange(pending.config, currentPassword)} />}
  </div>;
};
