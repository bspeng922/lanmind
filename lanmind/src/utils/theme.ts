import { THEME_PRESETS } from '../styles/themes/registry';
import { ThemeId, ThemePreference } from '../types';

export const DEFAULT_THEME_ID: ThemeId = 'navy-slate';
export const LIGHT_THEME_ID: ThemeId = 'titanium-light';
export const SYSTEM_THEME_PREFERENCE: ThemePreference = 'system';

const THEME_IDS = THEME_PRESETS.map((theme) => theme.id);

export const isThemePreference = (value: string | null): value is ThemePreference =>
  value === SYSTEM_THEME_PREFERENCE || THEME_IDS.includes(value as ThemeId);

export const resolveThemePreference = (
  preference: ThemePreference,
  prefersLight: boolean,
): ThemeId => {
  if (preference !== SYSTEM_THEME_PREFERENCE) return preference;
  return prefersLight ? LIGHT_THEME_ID : DEFAULT_THEME_ID;
};

/** Shared by the startup script and React, before/after the application mounts. */
export const applyTheme = (themeId: ThemeId) => {
  const root = document.documentElement;
  root.setAttribute('data-theme', themeId);
  root.classList.toggle('light', themeId === LIGHT_THEME_ID);
  root.classList.toggle('dark', themeId !== LIGHT_THEME_ID);
};
