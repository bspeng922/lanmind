/**
 * preload-theme.ts — Fast synchronous theme attribute initialization.
 */

import {
  applyTheme,
  DEFAULT_THEME_ID,
  migrateThemePreference,
  resolveThemePreference,
} from './utils/theme';
import './styles/themes/index.css';

const savedTheme = localStorage.getItem('lanmind-theme') || localStorage.getItem('p2p_studio_theme');
// 已保存的取值可能是收敛前的旧主题标识，需要先映射再解析。
const themePreference = migrateThemePreference(savedTheme) ?? DEFAULT_THEME_ID;
const themeId = resolveThemePreference(
  themePreference,
  window.matchMedia('(prefers-color-scheme: light)').matches,
);

applyTheme(themeId);
