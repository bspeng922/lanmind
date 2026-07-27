import { ThemeId, ThemePreference } from '../types';

export const DEFAULT_THEME_ID: ThemeId = 'navy-slate';
export const LIGHT_THEME_ID: ThemeId = 'titanium-light';
export const SYSTEM_THEME_PREFERENCE: ThemePreference = 'system';

const THEME_IDS: ThemeId[] = [
  'navy-slate',
  'aurora-purple',
  'cyber-emerald',
  'warm-amber',
  'titanium-light',
];

export const isThemePreference = (value: string | null): value is ThemePreference =>
  value === SYSTEM_THEME_PREFERENCE || THEME_IDS.includes(value as ThemeId);

export const resolveThemePreference = (
  preference: ThemePreference,
  prefersLight: boolean,
): ThemeId => {
  if (preference !== SYSTEM_THEME_PREFERENCE) return preference;
  return prefersLight ? LIGHT_THEME_ID : DEFAULT_THEME_ID;
};
