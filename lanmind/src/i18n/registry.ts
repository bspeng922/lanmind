import { languageMetadata, localeCodes } from './resources';

export type LocaleCode = typeof localeCodes[number];
export type LocalePreference = 'system' | LocaleCode;
export const DEFAULT_LOCALE: LocaleCode = 'zh-CN';
export const languages = languageMetadata;

export function matchLocale(value: string | null | undefined): LocaleCode | undefined {
  const normalized = value?.replace(/_/g, '-').toLowerCase();
  if (!normalized) return undefined;
  return languages.find((item) => item.code.toLowerCase() === normalized)?.code
    ?? languages.find((item) => item.aliases.some((alias: string) => normalized === alias.toLowerCase() || normalized.startsWith(`${alias.toLowerCase()}-`)))?.code;
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || localeCodes.includes(value as LocaleCode);
}

export function resolveLocale(preference: LocalePreference, systemLanguages: readonly string[]): LocaleCode {
  if (preference !== 'system') return preference;
  for (const candidate of systemLanguages) {
    const locale = matchLocale(candidate);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
