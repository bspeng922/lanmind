import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, Loader2, LockKeyhole, X } from 'lucide-react';

export const AppLockPasswordDialog: React.FC<{ title: string; description: string; busy: boolean; error: string; onCancel: () => void; onConfirm: (password: string) => void }> = ({ title, description, busy, error, onCancel, onConfirm }) => {
  useLocale();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="fixed inset-0 z-[90] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onCancel(); }
    if (event.key === 'Tab') {
      const controls = Array.from((event.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}>
    <form className="w-full max-w-sm overflow-hidden rounded-xl border border-edge bg-surface text-main shadow-popover" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); if (!busy && password) onConfirm(password); }}>
      <header className="flex items-center justify-between gap-3 border-b border-edge px-5 py-4"><h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole className="h-4 w-4 text-info" />{title}</h3><button type="button" className="ui-modal-close-btn" aria-label={tr("settings:appLockPasswordDialog.closePasswordVerification")} disabled={busy} onClick={onCancel}><X className="h-4 w-4" /></button></header>
      <div className="space-y-4 px-5 py-4">
        <p id={`${id}-description`} className="text-xs leading-6 text-sub">{description}</p>
        <div><label htmlFor={`${id}-password`} className="mb-2 block text-xs font-medium text-sub">{tr("settings:appLockPasswordDialog.currentUnlockPassword")}</label><div className="relative"><input ref={input} id={`${id}-password`} required disabled={busy} type={visible ? 'text' : 'password'} autoComplete="current-password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className="h-10 w-full rounded-lg border border-subtle bg-input pl-3 pr-10 text-sm" /><button type="button" className="project-toolbar-icon absolute right-1 top-1" disabled={busy} aria-label={visible ? tr("settings:appLockPasswordDialog.hideCurrentUnlockPassword") : tr("settings:appLockPasswordDialog.showCurrentUnlockPassword")} onClick={() => setVisible(!visible)}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>
        {error && <p id={`${id}-error`} role="alert" className="text-xs leading-5 text-danger">{localizeMessage(error)}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-edge px-5 py-3"><button type="button" className="ui-cancel-button rounded-lg px-3 py-2 text-xs" disabled={busy} onClick={onCancel}>{tr("settings:appLockPasswordDialog.cancel")}</button><button type="submit" className="theme-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs disabled:opacity-50" disabled={busy || !password}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{busy ? tr("settings:appLockPasswordDialog.verifying") : tr("settings:appLockPasswordDialog.verifyAndContinue")}</button></footer>
    </form>
  </div>, document.body);
};
