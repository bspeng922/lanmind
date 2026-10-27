import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { tr, useLocale } from '../../i18n';
import { localizeMessage } from '../../i18n/messages';
import { ApiService } from '../../services/api';
import type { Workspace } from '../../types';

interface Props {
  workspace: Workspace;
  currentUserId: string;
  onCancel: () => void;
  onDissolved: (next: Workspace) => void;
}

export const WorkspaceDissolveDialog: React.FC<Props> = ({ workspace, currentUserId, onCancel, onDissolved }) => {
  useLocale();
  const { currentTheme } = useTheme();
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const callbacks = useRef({ busy, onCancel });
  callbacks.current = { busy, onCancel };

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!callbacks.current.busy) callbacks.current.onCancel();
      }
      if (event.key === 'Tab') {
        const controls = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled)') || []) as HTMLElement[];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); dialogRef.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || confirmation !== workspace.name) return;
    setBusy(true);
    setError('');
    try {
      const next = await ApiService.dissolveWorkspace(workspace.id, currentUserId, confirmation);
      onDissolved(next);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
      setBusy(false);
    }
  };

  return createPortal(
    <div data-theme={currentTheme.id} className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay backdrop-blur-sm p-4 font-sans" onClick={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} tabIndex={-1} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-edge bg-surface p-5 text-main shadow-popover">
        <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 shrink-0 text-danger" />{tr('settings:workspaceSettings.dissolveWorkspace')}</h2>
        <p className="mt-3 break-words text-sm font-medium [overflow-wrap:anywhere]">{workspace.name}</p>
        <div id={descriptionId} className="mt-3 space-y-2 text-xs leading-5 text-sub">
          <p>{tr('settings:workspaceSettings.dissolveConfirm')}</p>
          <p>{tr('settings:workspaceSettings.dissolveOfflineNote')}</p>
          <p>{tr('settings:workspaceSettings.dissolveFilesNote')}</p>
        </div>
        <form onSubmit={event => void submit(event)} className="mt-4">
          <label htmlFor={inputId} className="mb-2 block text-xs font-medium text-main">{tr('settings:workspaceSettings.dissolveNameLabel')}</label>
          <input ref={inputRef} id={inputId} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" className="h-9 w-full rounded-lg border border-edge bg-canvas px-3 text-sm text-main outline-none focus:border-danger disabled:opacity-50" />
          {error && <p role="alert" className="mt-3 text-xs leading-5 text-danger">{localizeMessage(error)}</p>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy} onClick={onCancel} className="ui-cancel-button rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-50">{tr('settings:workspaceSettings.cancel')}</button>
            <button type="submit" disabled={busy || confirmation !== workspace.name} className="inline-flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-xs font-semibold text-on-solid hover:opacity-90 disabled:opacity-50">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {tr(busy ? 'settings:workspaceSettings.dissolving' : 'settings:workspaceSettings.dissolveWorkspace')}
            </button>
          </div>
        </form>
      </div>
    </div>, document.body,
  );
};
