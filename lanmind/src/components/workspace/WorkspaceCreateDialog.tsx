import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Loader2 } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import { localizeMessage } from '../../i18n/messages';
import { useTheme } from '../../context/ThemeContext';
import { ApiService } from '../../services/api';
import { getDeviceTimezone } from '../../utils/timeFormat';
import { WorkspaceTimezoneSelect } from './WorkspaceTimezoneSelect';
import type { Workspace } from '../../types';

interface Props { currentUserId: string; onClose: () => void; onCreated: (workspace: Workspace) => void }

export const WorkspaceCreateDialog: React.FC<Props> = ({ currentUserId, onClose, onCreated }) => {
  useLocale();
  const { currentTheme } = useTheme();
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(getDeviceTimezone);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!busyRef.current) closeRef.current();
      }
      if (event.key === 'Tab') {
        const controls = Array.from(dialogRef.current?.querySelectorAll('input:not(:disabled), select:not(:disabled), button:not(:disabled)') || []) as HTMLElement[];
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); dialogRef.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busyRef.current || !name.trim()) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const next = created || await ApiService.createWorkspace(name.trim(), undefined, timezone, currentUserId);
      setCreated(next);
      onCreated(next);
      await ApiService.switchWorkspace(next.id, currentUserId);
      onClose();
    } catch (error) {
      setError(localizeMessage(error instanceof Error ? error.message : String(error)));
    } finally { busyRef.current = false; setBusy(false); }
  };

  return createPortal(<div data-theme={currentTheme.id} className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay backdrop-blur-sm p-4 font-sans" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} tabIndex={-1} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-edge bg-surface p-5 text-main shadow-popover">
      <h2 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4 text-accent" />{tr('settings:workspaceSettings.createWorkspace')}</h2>
      <p id={`${id}-description`} className="mt-3 text-xs leading-5 text-sub">{tr('settings:workspaceSettings.createDescription')}</p>
      <form onSubmit={event => void submit(event)} className="mt-4 space-y-4">
        <div><label htmlFor={`${id}-name`} className="mb-2 block text-xs font-medium">{tr('settings:workspaceSettings.name')}</label>
          <input ref={nameRef} id={`${id}-name`} value={name} maxLength={120} disabled={busy || !!created} onChange={event => setName(event.target.value)} autoComplete="off" placeholder={tr('settings:workspaceSettings.workspaceNamePlaceholder')} className="h-9 w-full rounded-lg border border-edge bg-canvas px-3 text-sm outline-none focus:border-accent disabled:opacity-60" /></div>
        <div>
          <label htmlFor={`${id}-timezone`} className="mb-2 block text-xs font-medium">{tr('settings:workspaceSettings.timezone')}</label>
          <WorkspaceTimezoneSelect
            id={`${id}-timezone`}
            value={timezone}
            disabled={busy || !!created}
            onChange={(newTz) => setTimezone(newTz)}
          />
        </div>
        {created && error && <p className="text-xs leading-5 text-sub">{tr('settings:workspaceSettings.createdSwitchFailed')}</p>}
        {error && <p role="alert" className="text-xs leading-5 text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" disabled={busy} onClick={onClose} className="ui-cancel-button rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-50">{tr('settings:workspaceSettings.cancel')}</button>
          <button type="submit" disabled={busy || !name.trim()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-on-accent disabled:opacity-50">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{tr(busy ? 'settings:workspaceSettings.creating' : created ? 'settings:workspaceSettings.retryEnter' : 'settings:workspaceSettings.createAndEnter')}</button>
        </div>
      </form>
    </div>
  </div>, document.body);
};
