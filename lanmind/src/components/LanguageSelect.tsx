import { useState } from 'react';
import { languages, tr, useLocale, type LocalePreference } from '../i18n';
import { ThemeSelect } from './ThemeSelect';

export function LanguageSelect() {
  const { preference, setLocalePreference } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return <div className="language-select min-w-0">
    <ThemeSelect portal ariaLabel={tr('settings:language.label')} value={preference} disabled={busy}
      options={[{ value: 'system', label: tr('settings:language.system') }, ...languages.map((language) => ({ value: language.code, label: language.nativeName }))]}
      onChange={(value) => {
        setBusy(true); setError(false);
        void setLocalePreference(value as LocalePreference).catch(() => setError(true)).finally(() => setBusy(false));
      }} />
    {error && <p role="alert" className="mt-1 text-xs text-danger">{tr('settings:language.saveFailed')}</p>}
  </div>;
}
