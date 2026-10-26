import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
import React, { useId, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react';
import { LanMindLogo } from './LanMindLogo';
import { LanguageSelect } from './LanguageSelect';

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
  useLocale();
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
        <LanMindLogo size="md" showText subtitle={tr("network:networkLogin.lanmindLanServices")} />
        <div className="ml-auto">
          <LanguageSelect />
        </div>
      </header>

      <div className="network-login-center">
        <section className="network-login-card" aria-labelledby={`${id}-title`}>
          <div className="network-login-intro">
            <h1 id={`${id}-title`} className="text-2xl font-bold tracking-tight text-main">
              {tr("network:networkLogin.accessYourTasks")}
            </h1>
            <p className="mt-2 text-xs leading-6 text-sub">
              {tr("network:networkLogin.enterTheAccessPasswordToViewAnd")}
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5" aria-busy={busy}>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor={`${id}-password`} className="block text-xs font-semibold text-sub">
                  {tr("network:networkLogin.accessPassword")}
                </label>
                {capsLock && (
                  <span className="text-[11px] font-medium text-warning animate-pulse">
                    {tr("network:networkLogin.capsLockIsOn")}
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
                  placeholder={tr("network:networkLogin.enterAccessPassword")}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${id}-error` : undefined}
                  className="h-11 w-full min-w-0 rounded-xl border border-subtle bg-input pl-10 pr-11 text-sm shadow-inner transition-all focus:border-info focus:outline-none focus:ring-2 focus:ring-info/20 disabled:opacity-60"
                />
                <button
                  type="button"
                  className="project-toolbar-icon absolute right-2 hover:bg-hover rounded-lg p-1"
                  disabled={busy}
                  aria-label={visible ? tr("network:networkLogin.hideAccessPassword") : tr("network:networkLogin.showAccessPassword")}
                  title={visible ? tr("network:networkLogin.hidePassword") : tr("network:networkLogin.showPassword")}
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
                  {localizeMessage(error)}
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
                  {tr("network:networkLogin.signingIn")}
                </>
              ) : (
                <>
                  {tr("network:networkLogin.signIn")}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>
        </section>
      </div>

      <footer className="network-login-footer text-xs text-quiet font-medium">
        {tr("network:networkLogin.lanmindOrganizeTeamAndPersonalTasks")}
      </footer>
    </main>
  );
};
