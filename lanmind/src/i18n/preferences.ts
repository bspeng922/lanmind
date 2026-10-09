import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ApiService } from '../services/api';
import { currentLocale, i18n } from './core';
import { isLocalePreference, languages, resolveLocale, type LocaleCode, type LocalePreference } from './registry';

export interface LocaleState { preference: LocalePreference; locale: LocaleCode }
export const LOCALE_EVENT = 'i18n://changed';
export const LOCALE_STORAGE_KEY = 'lanmind-locale-preference';
const listeners = new Set<() => void>();
function cachedPreference(): LocalePreference {
  try { const value = localStorage.getItem(LOCALE_STORAGE_KEY); return isLocalePreference(value) ? value : 'system'; }
  catch { return 'system'; }
}
let state: LocaleState = { preference: cachedPreference(), locale: currentLocale() };
let initialized: Promise<void> | undefined;
let operation = 0;

export function getLocaleState(): LocaleState { return state; }
function publish(next: LocaleState) {
  if (!isLocalePreference(next?.preference) || !languages.some((item) => item.code === next?.locale)) return;
  if (state.preference === next.preference && state.locale === next.locale && currentLocale() === next.locale) return;
  state = next;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next.preference);
    localStorage.setItem('lanmind-resolved-locale', next.locale);
  } catch { /* A restricted browser can still change its session language. */ }
  void i18n.changeLanguage(next.locale);
  listeners.forEach((listener) => listener());
}

export async function setLocalePreference(preference: LocalePreference): Promise<void> {
  if (!isLocalePreference(preference)) throw new Error('Unsupported locale');
  const request = ++operation;
  const next = isTauri() ? await ApiService.setLocalePreference(preference)
    : { preference, locale: resolveLocale(preference, navigator.languages) };
  if (request === operation) publish(next);
}

export function initializeLocale(): Promise<void> {
  return initialized ??= (async () => {
    const refresh = async () => {
      const request = operation;
      if (isTauri()) {
        const next = await ApiService.getLocaleSettings();
        if (request === operation && next) publish(next);
      } else {
        const preference = cachedPreference();
        publish({ preference, locale: resolveLocale(preference, navigator.languages) });
      }
    };
    if (typeof window === 'undefined') return;
    window.addEventListener('languagechange', () => { void refresh().catch(() => {}); });
    window.addEventListener('focus', () => { void refresh().catch(() => {}); });
    window.addEventListener('storage', (event) => {
      if (!isTauri() && event.key === LOCALE_STORAGE_KEY) {
        ++operation;
        const preference = isLocalePreference(event.newValue) ? event.newValue : 'system';
        publish({ preference, locale: resolveLocale(preference, navigator.languages) });
      }
    });
    if (isTauri()) await listen<LocaleState>(LOCALE_EVENT, (event) => { ++operation; publish(event.payload); }).catch(() => {});
    await refresh().catch(() => {});
  })();
}

export function useLocale() {
  const snapshot = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLocaleState, getLocaleState);
  useEffect(() => { void initializeLocale(); }, []);
  return { ...snapshot, setLocalePreference };
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  useLocale();
  return children;
}
