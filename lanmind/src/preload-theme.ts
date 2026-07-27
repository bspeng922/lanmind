/**
 * preload-theme.ts — Fast synchronous theme attribute initialization.
 */

import {
  DEFAULT_THEME_ID,
  isThemePreference,
  resolveThemePreference,
} from './utils/theme';

const savedTheme = localStorage.getItem('lanmind-theme') || localStorage.getItem('p2p_studio_theme');
const themePreference = isThemePreference(savedTheme) ? savedTheme : DEFAULT_THEME_ID;
const themeId = resolveThemePreference(
  themePreference,
  window.matchMedia('(prefers-color-scheme: light)').matches,
);

document.documentElement.setAttribute('data-theme', themeId);
