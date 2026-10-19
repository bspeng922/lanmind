import { THEME_PRESETS } from '../styles/themes/registry';
import { ThemeId, ThemePreference } from '../types';

export const DEFAULT_THEME_ID: ThemeId = 'dark';
export const LIGHT_THEME_ID: ThemeId = 'light';
export const SYSTEM_THEME_PREFERENCE: ThemePreference = 'system';

const THEME_IDS = THEME_PRESETS.map((theme) => theme.id);

/**
 * 主题收敛前共有 5 套主题，现已合并为亮/暗两套。
 * 本机可能仍保存着旧标识，必须映射而不是丢弃，否则老用户会掉回默认主题。
 */
const LEGACY_THEME_MAP: Record<string, ThemeId> = {
  'navy-slate': 'dark',
  'aurora-purple': 'dark',
  'cyber-emerald': 'dark',
  'warm-amber': 'light',
  'titanium-light': 'light',
};

/** 把已保存的偏好（可能含旧标识）规范为当前支持的取值。 */
export const migrateThemePreference = (value: string | null): ThemePreference | null => {
  if (!value) return null;
  if (value === SYSTEM_THEME_PREFERENCE) return SYSTEM_THEME_PREFERENCE;
  if (THEME_IDS.includes(value as ThemeId)) return value as ThemeId;
  return LEGACY_THEME_MAP[value] ?? null;
};

export const isThemePreference = (value: string | null): value is ThemePreference =>
  migrateThemePreference(value) !== null;

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
