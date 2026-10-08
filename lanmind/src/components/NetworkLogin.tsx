import React, { useId, useState } from 'react';
import { ArrowRight, CheckSquare, Eye, EyeOff, Loader2, LockKeyhole, Network } from 'lucide-react';

interface NetworkLoginProps {
  password: string;
  onPasswordChange: (password: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  busy: boolean;
  error: string;
}

export const NetworkLogin: React.FC<NetworkLoginProps> = ({ password, onPasswordChange, onSubmit, busy, error }) => {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return <main className="network-login bg-canvas text-main">
    <header className="network-login-brand">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-edge bg-surface text-info shadow-soft"><CheckSquare className="h-5 w-5" /></span>
      <span className="text-base font-semibold tracking-tight">LanMind</span>
    </header>
    <section className="network-login-card" aria-labelledby={`${id}-title`}>
      <div className="network-login-intro">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-canvas px-2.5 py-1 text-[11px] font-medium text-sub"><Network className="h-3 w-3 text-info" />网络伺服</span>
        <h1 id={`${id}-title`} className="mt-5 text-2xl font-semibold tracking-tight">连接你的任务</h1>
        <p className="mt-2 text-xs leading-6 text-sub">输入访问密码，查看这台设备上的任务与协作项目。</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-5" aria-busy={busy}>
        <div>
          <label htmlFor={`${id}-password`} className="mb-2 block text-xs font-medium text-sub">访问密码</label>
          <div className="relative flex items-center">
            <LockKeyhole className="pointer-events-none absolute left-3 h-4 w-4 text-quiet" />
            <input id={`${id}-password`} required type={visible ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="none" spellCheck={false} value={password} disabled={busy} onChange={(event) => onPasswordChange(event.target.value)} placeholder="请输入访问密码" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className="h-11 w-full min-w-0 rounded-lg border border-subtle bg-input pl-10 pr-11 text-sm disabled:opacity-60" />
            <button type="button" className="project-toolbar-icon absolute right-1.5" disabled={busy} aria-label={visible ? '隐藏访问密码' : '显示访问密码'} title={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
          </div>
          {error && <p id={`${id}-error`} role="alert" className="mt-3 break-words rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs leading-5 text-danger">{error}</p>}
        </div>
        <button type="submit" disabled={busy} className="theme-btn-primary flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium disabled:opacity-60">{busy ? <><Loader2 className="h-4 w-4 animate-spin" />连接中</> : <>登录<ArrowRight className="h-4 w-4" /></>}</button>
      </form>
      <p className="mt-6 border-t border-edge pt-4 text-[11px] leading-5 text-quiet">使用本机 LanMind「网络伺服」中设置的访问密码。</p>
    </section>
    <footer className="network-login-footer text-[11px] text-quiet">LanMind · 让任务井然有序</footer>
  </main>;
};
