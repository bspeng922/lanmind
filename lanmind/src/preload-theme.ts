/**
 * preload-theme.ts — Fast synchronous theme attribute initialization.
 */

import {
  applyTheme,
  DEFAULT_THEME_ID,
  isThemePreference,
  resolveThemePreference,
} from './utils/theme';
import './styles/themes/index.css';

const savedTheme = localStorage.getItem('lanmind-theme') || localStorage.getItem('p2p_studio_theme');
const themePreference = isThemePreference(savedTheme) ? savedTheme : DEFAULT_THEME_ID;
const themeId = resolveThemePreference(
  themePreference,
  window.matchMedia('(prefers-color-scheme: light)').matches,
);

applyTheme(themeId);
