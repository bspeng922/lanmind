import React, { useId, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Network, ShieldCheck, Sparkles } from 'lucide-react';
import { LanMindLogo } from './LanMindLogo';

interface NetworkLoginProps {
  password: string;
  onPasswordChange: (password: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  busy: boolean;
  error: string;
}

export const NetworkLogin: React.FC<NetworkLoginProps> = ({
  password,
  onPasswordChange,
  onSubmit,
  busy,
  error,
}) => {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.getModifierState) {
      setCapsLock(event.getModifierState('CapsLock'));
    }
  };

  return (
    <main className="network-login bg-canvas text-main">
      <header className="network-login-brand">
        <LanMindLogo size="lg" showText subtitle="智域协同 · 局域网服务" />
      </header>

      <section className="network-login-card" aria-labelledby={`${id}-title`}>
        <div className="network-login-intro">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-info/20 bg-info/10 px-3 py-1 text-[11px] font-semibold text-info">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <Network className="h-3 w-3" />
              局域网 Web 伺服
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-quiet">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              受保护通道
            </span>
          </div>

          <h1 id={`${id}-title`} className="mt-4 text-2xl font-bold tracking-tight text-main">
            连接你的协同任务
          </h1>
          <p className="mt-2 text-xs leading-6 text-sub">
            输入访问密码，在当前浏览器中实时查看与协同管理这台设备上的项目。
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5" aria-busy={busy}>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor={`${id}-password`} className="block text-xs font-semibold text-sub">
                访问密码
              </label>
              {capsLock && (
                <span className="text-[11px] font-medium text-warning animate-pulse">
                  大写锁定已开启
                </span>
              )}
            </div>

            <div className="relative flex items-center group">
              <LockKeyhole className="pointer-events-none absolute left-3.5 h-4 w-4 text-quiet transition-colors group-focus-within:text-info" />
              <input
                id={`${id}-password`}
                required
                type={visible ? 'text' : 'password'}
                autoComplete="current-password"
                autoCapitalize="none"
                spellCheck={false}
                value={password}
                disabled={busy}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyDown}
                onChange={(event) => onPasswordChange(event.target.value)}
                placeholder="请输入访问密码"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                className="h-11 w-full min-w-0 rounded-xl border border-subtle bg-input pl-10 pr-11 text-sm shadow-inner transition-all focus:border-info focus:outline-none focus:ring-2 focus:ring-info/20 disabled:opacity-60"
              />
              <button
                type="button"
                className="project-toolbar-icon absolute right-2 hover:bg-hover rounded-lg p-1"
                disabled={busy}
                aria-label={visible ? '隐藏访问密码' : '显示访问密码'}
                title={visible ? '隐藏密码' : '显示密码'}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {error && (
              <p
                id={`${id}-error`}
                role="alert"
                className="mt-3 break-words rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-xs leading-5 text-danger font-medium animate-in fade-in slide-in-from-top-1"
              >
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={busy || !password.trim()}
            className="theme-btn-primary flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold shadow-lg shadow-info/20 transition-all hover:shadow-xl hover:shadow-info/30 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在建立安全连接...
              </>
            ) : (
              <>
                登录
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 border-t border-edge/80 pt-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[11px] text-quiet">
            <Sparkles className="h-3 w-3 text-info shrink-0" />
            <span>使用本机 LanMind「网络伺服」中设置的访问密码。</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-quiet/80 pt-1">
            <span>端到端局域网通信</span>
            <span>·</span>
            <span>Argon2 凭据保护</span>
            <span>·</span>
            <span>无云端中转</span>
          </div>
        </div>
      </section>

      <footer className="network-login-footer text-xs text-quiet font-medium">
        LanMind · 让团队与个人任务井然有序
      </footer>
    </main>
  );
};
