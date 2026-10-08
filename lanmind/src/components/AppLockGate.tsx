import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Eye, EyeOff, Loader2, LockKeyhole, Minus, X } from 'lucide-react';
import { ApiService, AppLockStatus } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { StartupLockView } from './AppStartupReady';

export const APP_LOCK_STATE_EVENT = 'app-lock://state';

export const AppLockGate: React.FC<{ children: React.ReactNode; primary?: boolean; desktop?: boolean; onReady?: (view: StartupLockView) => void }> = ({ children, primary = true, desktop = isTauri(), onReady }) => {
  const { currentTheme } = useTheme();
  const [status, setStatus] = useState<AppLockStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const statusRef = useRef(status);
  const passwordRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);
  const lifecycleRef = useRef(0);
  const startupDeadlineRef = useRef(0);
  const requestRef = useRef<{ lifecycle: number; promise: Promise<void> } | null>(null);
  const apply = useCallback((next: AppLockStatus) => {
    if (!activeRef.current) return;
    // A delayed activity/poll reply must not undo a newer native lock event.
    if (statusRef.current && next.revision < statusRef.current.revision) return;
    statusRef.current = next;
    setStatus((previous) => previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    setLoadError('');
  }, []);
  const refresh = useCallback(() => {
    const lifecycle = lifecycleRef.current;
    if (requestRef.current?.lifecycle === lifecycle) return requestRef.current.promise;
    const promise = (async () => {
      try {
        const next = await ApiService.getAppLockStatus();
        if (lifecycle === lifecycleRef.current) apply(next);
      } catch (reason) {
        if (activeRef.current && lifecycle === lifecycleRef.current && (statusRef.current || Date.now() >= startupDeadlineRef.current)) {
          setLoadError(String(reason instanceof Error ? reason.message : reason));
        }
      } finally { if (requestRef.current?.promise === promise) requestRef.current = null; }
    })();
    requestRef.current = { lifecycle, promise };
    return promise;
  }, [apply]);

  useEffect(() => {
    if (!desktop) return;
    activeRef.current = true;
    lifecycleRef.current++;
    startupDeadlineRef.current = Date.now() + 5000;
    void refresh();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void listen<AppLockStatus>(APP_LOCK_STATE_EVENT, (event) => apply(event.payload)).then((fn) => {
        if (disposed) fn(); else unlisten = fn;
      }).catch(() => {});
    }
    const custom = (event: Event) => apply((event as CustomEvent<AppLockStatus>).detail);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    if (!isTauri()) window.addEventListener(APP_LOCK_STATE_EVENT, custom);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    // Also query periodically so a missed native event cannot reveal a locked app.
    const poll = window.setInterval(() => void refresh(), 1000);
    let lastActivitySent = -Infinity;
    const activity = (event: Event) => {
      if (!event.isTrusted || !statusRef.current?.enabled || statusRef.current.locked) return;
      const now = Date.now();
      if (now - lastActivitySent < 250) return;
      lastActivitySent = now;
      void ApiService.recordAppActivity().then(apply).catch(() => void refresh());
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel', 'touchstart'] as const;
    events.forEach((name) => document.addEventListener(name, activity, { capture: true, passive: true }));
    return () => {
      activeRef.current = false;
      lifecycleRef.current++;
      disposed = true;
      unlisten?.();
      window.clearInterval(poll);
      window.removeEventListener(APP_LOCK_STATE_EVENT, custom);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
      events.forEach((name) => document.removeEventListener(name, activity, true));
    };
  }, [desktop, apply, refresh]);

  const blocked = desktop && (!status || status.locked || Boolean(loadError));
  const initializing = desktop && !status && !loadError;
  useEffect(() => {
    if (!initializing) onReady?.(loadError ? 'error' : status?.locked ? 'locked' : 'unlocked');
  }, [initializing, loadError, status?.locked, onReady]);
  useEffect(() => {
    if (!blocked) { setPassword(''); setError(''); setVisible(false); return; }
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousInert = new Map<HTMLElement, boolean>();
    const shield = () => {
      for (const node of Array.from(document.body.children)) {
        if (!(node instanceof HTMLElement) || node.id === 'app-splash' || node === overlayRef.current || node.contains(overlayRef.current)) continue;
        if (!previousInert.has(node)) previousInert.set(node, node.inert);
        node.inert = true;
      }
    };
    shield();
    const observer = new MutationObserver(shield);
    observer.observe(document.body, { childList: true });
    passwordRef.current?.focus();
    return () => {
      observer.disconnect();
      previousInert.forEach((inert, node) => { node.inert = inert; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [blocked, Boolean(status?.locked), Boolean(loadError)]);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true); setError('');
    try { apply(await ApiService.unlockApp(password)); }
    catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); setPassword(''); passwordRef.current?.focus(); }
    finally { setBusy(false); }
  };

  return <>
    <div className="contents" inert={blocked || undefined} aria-hidden={blocked || undefined}>{children}</div>
    {blocked && createPortal(<div ref={overlayRef} data-theme={currentTheme.id} data-app-lock-initializing={initializing || undefined} className="fixed inset-0 flex min-h-0 flex-col bg-canvas text-main" style={{ zIndex: 2147483646 }} role={initializing ? undefined : 'dialog'} aria-modal={initializing ? undefined : true} aria-label={initializing ? undefined : '程序锁定'} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') event.preventDefault(); }}>
      {!initializing && <>
      {primary && <div className="flex h-12 shrink-0 items-center justify-between border-b border-edge bg-surface px-4" data-tauri-drag-region>
        <span className="text-sm font-semibold" data-tauri-drag-region>LanMind</span>
        {isTauri() && <div className="flex gap-1">
          <button type="button" title="最小化" aria-label="最小化锁定窗口" className="project-toolbar-icon" onClick={() => void getCurrentWindow().minimize()}><Minus className="h-4 w-4" /></button>
          <button type="button" title="隐藏到托盘" aria-label="隐藏锁定窗口到托盘" className="project-toolbar-icon" onClick={() => void getCurrentWindow().hide()}><X className="h-4 w-4" /></button>
        </div>}
      </div>}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-6 shadow-panel">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-card text-info"><LockKeyhole className="h-5 w-5" /></div>
          <h1 className="text-lg font-semibold">{loadError ? '暂时无法读取锁定状态' : status ? '程序已锁定' : '正在读取锁定状态'}</h1>
          {!status || loadError ? <div className="mt-3 text-xs text-sub">{loadError ? <><p role="alert">{loadError}</p><button className="ui-cancel-button mt-4 rounded-lg px-3 py-2" onClick={() => void refresh()}>重新读取</button></> : <Loader2 className="h-5 w-5 animate-spin" />}</div>
            : primary ? <form onSubmit={unlock} className="mt-2 space-y-4">
              <p className="text-xs leading-5 text-sub">输入解锁密码，继续使用 LanMind。</p>
              <div>
                <label htmlFor="app-unlock-password" className="mb-2 block text-xs font-medium text-sub">解锁密码</label>
                <div className="flex items-center gap-2">
                  <input ref={passwordRef} id="app-unlock-password" aria-label="解锁密码" type={visible ? 'text' : 'password'} autoComplete="current-password" value={password} maxLength={128} disabled={busy} onChange={(event) => { setPassword(event.target.value); setError(''); }} className="min-w-0 flex-1 rounded-lg border border-subtle bg-input px-3 py-2.5 text-sm" />
                  <button type="button" aria-label={visible ? '隐藏解锁密码' : '显示解锁密码'} title={visible ? '隐藏密码' : '显示密码'} className="project-toolbar-icon" onClick={() => setVisible(!visible)}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
              </div>
              {error && <p role="alert" className="text-xs text-danger">{error}</p>}
              <button type="submit" disabled={busy || !password} className="theme-btn-primary flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm disabled:opacity-50">{busy ? <><Loader2 className="h-4 w-4 animate-spin" />正在解锁</> : '解锁'}</button>
            </form> : <div className="mt-3 space-y-4 text-xs text-sub"><p>请在主界面输入密码解锁。</p><button type="button" className="theme-btn-primary rounded-lg px-3 py-2" onClick={() => void invoke('reveal_main_window')}>打开主界面</button></div>}
        </div>
      </div>
      </>}
    </div>, document.body)}
  </>;
};
