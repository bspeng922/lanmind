import React, { createContext, useCallback, useContext, useState, useEffect } from 'react';
import { ThemeConfig, ThemePreference } from '../types';
import {
  applyTheme,
  DEFAULT_THEME_ID,
  isThemePreference,
  resolveThemePreference,
} from '../utils/theme';

import { THEME_PRESETS } from '../styles/themes/registry';
export { THEME_PRESETS } from '../styles/themes/registry';

const systemPrefersLight = () => window.matchMedia('(prefers-color-scheme: light)').matches;

interface ThemeContextType {
  currentTheme: ThemeConfig;
  themePreference: ThemePreference;
  setThemeId: (id: ThemePreference) => void;
  allThemes: ThemeConfig[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem('lanmind-theme') || localStorage.getItem('p2p_studio_theme');
    return isThemePreference(saved) ? saved : DEFAULT_THEME_ID;
  });
  const [prefersLight, setPrefersLight] = useState(systemPrefersLight);

  const resolvedThemeId = resolveThemePreference(themePreference, prefersLight);
  const currentTheme = THEME_PRESETS.find((theme) => theme.id === resolvedThemeId) || THEME_PRESETS[0];

  const setThemeId = useCallback((id: ThemePreference) => {
    setThemePreference(id);
    localStorage.setItem('lanmind-theme', id);
    localStorage.setItem('p2p_studio_theme', id);
    window.dispatchEvent(new CustomEvent('lanmind-theme-change', { detail: id }));
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const handleSystemThemeChange = () => {
      setPrefersLight(mediaQuery.matches);
    };
    handleSystemThemeChange();
    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, []);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (
        (e.key === 'lanmind-theme' || e.key === 'p2p_studio_theme')
        && isThemePreference(e.newValue)
      ) {
        setThemePreference(e.newValue);
      }
    };
    const handleCustom = (e: Event) => {
      const custom = e as CustomEvent<ThemePreference>;
      if (isThemePreference(custom.detail)) {
        setThemePreference(custom.detail);
      }
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('lanmind-theme-change', handleCustom);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('lanmind-theme-change', handleCustom);
    };
  }, []);

  useEffect(() => {
    applyTheme(resolvedThemeId);
  }, [resolvedThemeId]);

  return (
    <ThemeContext.Provider value={{ currentTheme, themePreference, setThemeId, allThemes: THEME_PRESETS }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
