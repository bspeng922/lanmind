import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources';
import { DEFAULT_LOCALE, isLocalePreference, languages, resolveLocale, type LocaleCode } from './registry';

function initialLocale(): LocaleCode {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return DEFAULT_LOCALE;
  try {
    const preference = localStorage.getItem('lanmind-locale-preference');
    const cached = localStorage.getItem('lanmind-resolved-locale');
    if (preference === 'system' && isLocalePreference(cached) && cached !== 'system') return cached;
    return resolveLocale(isLocalePreference(preference) ? preference : 'system', navigator.languages);
  } catch { return resolveLocale('system', navigator.languages); }
}

export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: 'common',
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function tr(key: string, params?: Record<string, unknown>): string {
  return String(i18n.t(key as never, params as never));
}

export function currentLocale(): LocaleCode { return i18n.resolvedLanguage as LocaleCode || DEFAULT_LOCALE; }

export function applyDocumentLocale() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = currentLocale();
  document.documentElement.dir = languages.find((item) => item.code === currentLocale())?.direction || 'ltr';
  const path = location.pathname;
  const titleKey = path.includes('receiver') ? 'native:titles.receiver'
    : path.includes('network') ? 'native:titles.network'
    : path.includes('quick-add') ? 'native:titles.quickAdd'
    : path.includes('notification') ? 'native:titles.notification'
    : path.includes('tray-unread') ? 'native:titles.trayUnread'
    : path.includes('desktop-calendar') ? 'native:titles.calendar'
    : path.includes('optical-transfer') ? 'native:titles.optical' : 'native:titles.main';
  document.title = tr(titleKey);
  const splash = document.getElementById('app-splash');
  if (splash) {
    splash.setAttribute('aria-label', tr('common:startup.accessibleLabel'));
    const name = splash.querySelector('.app-splash__name');
    const tagline = splash.querySelector('.app-splash__tagline');
    if (name) name.textContent = tr('native:titles.main');
    if (tagline) tagline.textContent = tr('common:startup.tagline');
  }
}
i18n.on('languageChanged', applyDocumentLocale);
applyDocumentLocale();
