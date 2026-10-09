import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Eye, EyeOff, Loader2, LockKeyhole, Minus, ShieldAlert, ShieldCheck, Sparkles, X } from 'lucide-react';
import { ApiService, AppLockStatus } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { StartupLockView } from './AppStartupReady';
import { LanMindLogo } from './LanMindLogo';

export const APP_LOCK_STATE_EVENT = 'app-lock://state';

export const AppLockGate: React.FC<{ children: React.ReactNode; primary?: boolean; desktop?: boolean; onReady?: (view: StartupLockView) => void }> = ({ children, primary = true, desktop = isTauri(), onReady }) => {
  const { currentTheme } = useTheme();
  const [status, setStatus] = useState<AppLockStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
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

  const handleKeyModifier = (event: React.KeyboardEvent) => {
    if (event.getModifierState) {
      setCapsLock(event.getModifierState('CapsLock'));
    }
  };

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
    {blocked && createPortal(<div ref={overlayRef} data-theme={currentTheme.id} data-app-lock-initializing={initializing || undefined} className="fixed inset-0 flex min-h-0 flex-col bg-canvas text-main overflow-hidden select-none" style={{ zIndex: 2147483646 }} role={initializing ? undefined : 'dialog'} aria-modal={initializing ? undefined : true} aria-label={initializing ? undefined : '程序锁定'} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') event.preventDefault(); }}>
      {/* Ambient background glow layers */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-info/10 blur-[100px]" />
        <div className="absolute right-1/4 bottom-1/4 h-[350px] w-[350px] rounded-full bg-accent/8 blur-[90px]" />
      </div>

      {!initializing && <>
      {primary && <div className="flex h-12 shrink-0 items-center justify-between border-b border-edge/80 bg-surface/80 backdrop-blur-md px-4" data-tauri-drag-region>
        <div className="flex items-center gap-2.5" data-tauri-drag-region>
          <LanMindLogo size="sm" showText subtitle="智域协同" />
          <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-info/20 bg-info/10 px-2 py-0.5 text-[10px] font-medium text-info ml-2">
            <ShieldCheck className="h-3 w-3" />安全锁定中
          </span>
        </div>
        {isTauri() && <div className="flex gap-1 items-center">
          <button type="button" title="最小化" aria-label="最小化锁定窗口" className="project-toolbar-icon rounded-md p-1.5 hover:bg-hover" onClick={() => void getCurrentWindow().minimize()}><Minus className="h-4 w-4" /></button>
          <button type="button" title="关闭" aria-label="关闭锁定窗口" className="project-toolbar-icon rounded-md p-1.5 hover:bg-hover" onClick={() => void getCurrentWindow().close()}><X className="h-4 w-4" /></button>
        </div>}
      </div>}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        <div className="w-full max-w-[420px] rounded-2xl border border-edge/80 bg-surface/90 backdrop-blur-2xl p-7 shadow-2xl relative">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-info/30 to-transparent" aria-hidden="true" />
          
          <div className="mb-5 flex items-center justify-center">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-info/20 via-accent/15 to-feature/10 text-info border border-info/30 shadow-lg shadow-info/10">
              <LockKeyhole className="h-7 w-7" />
              <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface border border-edge text-success shadow-xs">
                <ShieldCheck className="h-3 w-3" />
              </div>
            </div>
          </div>

          <h1 className="text-xl font-bold tracking-tight text-center text-main">
            {loadError ? '暂时无法读取锁定状态' : status ? '程序已锁定' : '正在读取锁定状态'}
          </h1>

          {!status || loadError ? (
            <div className="mt-4 text-center text-xs text-sub">
              {loadError ? (
                <>
                  <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-danger font-medium">{loadError}</p>
                  <button className="ui-cancel-button mt-4 rounded-xl px-4 py-2 font-medium" onClick={() => void refresh()}>重新读取</button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-info" />
                  <span className="text-quiet text-xs">正在校验安全状态...</span>
                </div>
              )}
            </div>
          ) : primary ? (
            <form onSubmit={unlock} className="mt-3 space-y-4">
              <p className="text-center text-xs leading-5 text-sub">输入解锁密码，继续使用 LanMind。</p>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="app-unlock-password" className="block text-xs font-semibold text-sub">解锁密码</label>
                  {capsLock && <span className="text-[11px] font-medium text-warning animate-pulse">大写锁定已开启</span>}
                </div>
                <div className="relative flex items-center group">
                  <LockKeyhole className="pointer-events-none absolute left-3.5 h-4 w-4 text-quiet transition-colors group-focus-within:text-info" />
                  <input
                    ref={passwordRef}
                    id="app-unlock-password"
                    aria-label="解锁密码"
                    type={visible ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    maxLength={128}
                    disabled={busy}
                    onKeyDown={handleKeyModifier}
                    onKeyUp={handleKeyModifier}
                    onChange={(event) => { setPassword(event.target.value); setError(''); }}
                    placeholder="输入解锁密码"
                    className="h-11 w-full min-w-0 rounded-xl border border-subtle bg-input pl-10 pr-11 text-sm shadow-inner transition-all focus:border-info focus:outline-none focus:ring-2 focus:ring-info/20"
                  />
                  <button
                    type="button"
                    aria-label={visible ? '隐藏解锁密码' : '显示解锁密码'}
                    title={visible ? '隐藏密码' : '显示密码'}
                    className="project-toolbar-icon absolute right-2 hover:bg-hover rounded-lg p-1"
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2 text-xs font-medium text-danger animate-in fade-in">{error}</p>}
              <button
                type="submit"
                disabled={busy || !password}
                className="theme-btn-primary flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold shadow-lg shadow-info/20 transition-all active:scale-[0.99] disabled:opacity-50"
              >
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" />正在解锁</> : '解锁'}
              </button>
            </form>
          ) : (
            <div className="mt-4 space-y-4 text-center text-xs text-sub">
              <div className="rounded-xl border border-edge bg-canvas/60 p-4">
                <ShieldAlert className="h-5 w-5 text-warning mx-auto mb-2" />
                <p className="font-medium text-main">请在主界面输入密码解锁。</p>
                <p className="mt-1 text-[11px] text-quiet">主界面解锁后，所有关联窗口将自动同步解除锁定。</p>
              </div>
              <button
                type="button"
                className="theme-btn-primary flex h-10 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold shadow-md"
                onClick={() => void invoke('reveal_main_window')}
              >
                打开主界面
              </button>
            </div>
          )}
        </div>
      </div>
      </>}
    </div>, document.body)}
  </>;
};
