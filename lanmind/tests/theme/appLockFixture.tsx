// Development-only IPC simulator. Never uses the real app database or password.
import React, { useEffect, useRef, useState } from 'react';
import { ApiService, AppLockStatus } from '../../src/services/api';
import { AppLockGate, APP_LOCK_STATE_EVENT } from '../../src/components/AppLockGate';
import { AppLockSettings } from '../../src/components/AppLockSettings';
import { ThemeSelect } from '../../src/components/ThemeSelect';
import { AppStartupReady, StartupLockView } from '../../src/components/AppStartupReady';
import { createAppStartup } from '../../src/utils/appStartup';
import startupDocument from '../../index.html?raw';

export function configureAppLockFixture(params: URLSearchParams) {
  const stored = JSON.parse(localStorage.getItem('test-app-lock-config') || 'null');
  const startup = params.get('startup') === 'locked';
  let configuredPassword = stored?.password || (startup ? 'correct password' : '');
  let state: AppLockStatus = { revision: 0, enabled: stored?.enabled ?? startup, idleMinutes: stored?.idleMinutes || 1, passwordConfigured: Boolean(configuredPassword), locked: stored?.enabled ?? startup };
  let lastActivity = Date.now();
  const controls = { saves: [] as unknown[], activities: 0, failNextSave: false, failReads: params.has('initial-read-error'), reveals: [] as unknown[], completions: [] as unknown[], emitStale: () => {}, lock: () => {} };
  if (params.get('view') === 'app-startup') {
    const template = new DOMParser().parseFromString(startupDocument, 'text/html');
    document.head.append(template.querySelector('style')!.cloneNode(true));
    document.body.append(template.getElementById('app-splash')!.cloneNode(true));
  }
  const publish = () => window.dispatchEvent(new CustomEvent(APP_LOCK_STATE_EVENT, { detail: { ...state } }));
  const expire = () => {
    if (state.enabled && !state.locked && Date.now() - lastActivity >= state.idleMinutes * 60000) {
      state = { ...state, locked: true, revision: state.revision + 1 }; publish();
    }
  };
  ApiService.getAppLockStatus = async () => {
    if (params.has('read-delay')) await new Promise((resolve) => setTimeout(resolve, Number(params.get('read-delay'))));
    if (controls.failReads) throw new Error('无法读取本机锁定状态');
    expire(); return { ...state };
  };
  ApiService.recordAppActivity = async () => {
    expire(); controls.activities++;
    if (!state.locked) lastActivity = Date.now();
    return { ...state };
  };
  ApiService.updateAppLockConfig = async (config) => {
    expire(); controls.saves.push(config);
    if (controls.failNextSave) { controls.failNextSave = false; throw new Error('保存失败，请重试'); }
    if (state.locked) throw new Error('请先解锁程序界面');
    if (configuredPassword && config.currentPassword !== configuredPassword) throw new Error('当前解锁密码不正确');
    configuredPassword = config.clearPassword ? '' : config.password || configuredPassword;
    state = { ...state, revision: state.revision + 1, enabled: config.enabled, idleMinutes: config.idleMinutes, passwordConfigured: Boolean(configuredPassword) };
    localStorage.setItem('test-app-lock-config', JSON.stringify({ enabled: state.enabled, idleMinutes: state.idleMinutes, password: configuredPassword }));
    lastActivity = Date.now(); publish(); return { ...state };
  };
  ApiService.lockApp = async () => { state = { ...state, locked: true, revision: state.revision + 1 }; publish(); return { ...state }; };
  ApiService.unlockApp = async (password) => {
    if (password !== configuredPassword) throw new Error('解锁密码不正确');
    state = { ...state, locked: false, revision: state.revision + 1 }; lastActivity = Date.now(); publish(); return { ...state };
  };
  controls.lock = () => void ApiService.lockApp();
  controls.emitStale = () => window.dispatchEvent(new CustomEvent(APP_LOCK_STATE_EVENT, { detail: { ...state, revision: state.revision - 1, locked: false } }));
  (window as any).__appLockFixture = controls;
}

export function StartupFixture({ params }: { params: URLSearchParams }) {
  const [lockView, setLockView] = useState<StartupLockView | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const finalState = useRef({ lockView, sessionReady });
  finalState.current = { lockView, sessionReady };
  const [startup] = useState(() => createAppStartup({ desktop: true, reveal: async () => {
    const splash = document.getElementById('app-splash');
    (window as any).__appLockFixture.reveals.push({ splashPresent: Boolean(splash), splashOnTop: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#app-splash') === splash });
  } }));
  useEffect(() => { void startup.start(); }, [startup]);
  useEffect(() => {
    const timer = setTimeout(() => setSessionReady(true), Number(params.get('session-delay') || 1500));
    return () => clearTimeout(timer);
  }, [params]);
  const ready = () => { void startup.finish().then(() => {
    (window as any).__appLockFixture.completions.push({ ...finalState.current, splashRemoved: !document.getElementById('app-splash'), initializing: Boolean(document.querySelector('[data-app-lock-initializing]')) });
  }); };
  return <>
    <AppStartupReady lockView={lockView} sessionReady={sessionReady} onReady={ready} />
    <AppLockGate desktop onReady={setLockView}><textarea aria-label="任务草稿" defaultValue="私有任务内容" /><p>{sessionReady ? '主界面已就绪' : '本机身份初始化'}</p></AppLockGate>
  </>;
}

export function AppLockFixture({ primary = true, children }: { primary?: boolean; children?: React.ReactNode }) {
  const [draft, setDraft] = useState('正在编辑的任务内容');
  const [priority, setPriority] = useState('normal');
  return <AppLockGate desktop primary={primary}>
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <AppLockSettings available />
      <label className="block text-xs text-sub">任务草稿<textarea aria-label="任务草稿" value={draft} onChange={(event) => setDraft(event.target.value)} className="mt-2 block h-24 w-full rounded-lg border border-subtle bg-input p-3 text-main" /></label>
      <ThemeSelect ariaLabel="测试优先级" portal value={priority} onChange={setPriority} options={[{ value: 'normal', label: '普通' }, { value: 'high', label: '紧急' }]} />
      {children}
    </div>
  </AppLockGate>;
}
