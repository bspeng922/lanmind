import React, { createContext, useCallback, useContext, useState, useEffect } from 'react';
import { ThemeConfig, ThemePreference } from '../types';
import {
  DEFAULT_THEME_ID,
  isThemePreference,
  LIGHT_THEME_ID,
  resolveThemePreference,
  SYSTEM_THEME_PREFERENCE,
} from '../utils/theme';

const systemPrefersLight = () => window.matchMedia('(prefers-color-scheme: light)').matches;

export const THEME_PRESETS: ThemeConfig[] = [
  {
    id: 'navy-slate',
    name: '深蓝星空',
    description: '经典深蓝与 Slate 沉浸调色',
    previewColor: 'linear-gradient(135deg, #1e293b 0%, #3b82f6 100%)',
    bgCanvas: 'bg-slate-950',
    bgHeader: 'bg-slate-900',
    bgSidebar: 'bg-slate-900',
    bgCard: 'bg-slate-900/90',
    textPrimary: 'text-slate-100',
    textSecondary: 'text-slate-400',
    borderAccent: 'border-blue-500/40',
    primaryButton: 'bg-blue-600 hover:bg-blue-500 text-white',
    primaryBadge: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    accentColor: '#3b82f6',
    gradient: 'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)',
  },
  {
    id: 'aurora-purple',
    name: '极光紫境',
    description: '高雅的紫色极光与 Zinc 深色韵律',
    previewColor: 'linear-gradient(135deg, #18181b 0%, #a855f7 100%)',
    bgCanvas: 'bg-zinc-950',
    bgHeader: 'bg-zinc-900',
    bgSidebar: 'bg-zinc-900',
    bgCard: 'bg-zinc-900/90',
    textPrimary: 'text-zinc-100',
    textSecondary: 'text-zinc-400',
    borderAccent: 'border-purple-500/40',
    primaryButton: 'bg-purple-600 hover:bg-purple-500 text-white',
    primaryBadge: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    accentColor: '#a855f7',
    gradient: 'linear-gradient(135deg, #9333ea 0%, #c084fc 100%)',
  },
  {
    id: 'cyber-emerald',
    name: '赛博翡翠',
    description: '极客风翠绿与黑灰矩阵线条',
    previewColor: 'linear-gradient(135deg, #111827 0%, #10b981 100%)',
    bgCanvas: 'bg-gray-950',
    bgHeader: 'bg-gray-900',
    bgSidebar: 'bg-gray-900',
    bgCard: 'bg-gray-900/90',
    textPrimary: 'text-gray-100',
    textSecondary: 'text-gray-400',
    borderAccent: 'border-emerald-500/40',
    primaryButton: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    primaryBadge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    accentColor: '#10b981',
    gradient: 'linear-gradient(135deg, #059669 0%, #34d399 100%)',
  },
  {
    id: 'warm-amber',
    name: '琥珀暗夜',
    description: '温润的琥珀黑曜石与金黄微光',
    previewColor: 'linear-gradient(135deg, #1c1917 0%, #f59e0b 100%)',
    bgCanvas: 'bg-stone-950',
    bgHeader: 'bg-stone-900',
    bgSidebar: 'bg-stone-900',
    bgCard: 'bg-stone-900/90',
    textPrimary: 'text-stone-100',
    textSecondary: 'text-stone-400',
    borderAccent: 'border-amber-500/40',
    primaryButton: 'bg-amber-600 hover:bg-amber-500 text-white',
    primaryBadge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    accentColor: '#f59e0b',
    gradient: 'linear-gradient(135deg, #d97706 0%, #fbbf24 100%)',
  },
  {
    id: 'titanium-light',
    name: '钛白明亮',
    description: '极简高对比度白日明亮风',
    previewColor: 'linear-gradient(135deg, #f8fafc 0%, #2563eb 100%)',
    bgCanvas: 'bg-slate-100',
    bgHeader: 'bg-white',
    bgSidebar: 'bg-slate-50',
    bgCard: 'bg-white',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-600',
    borderAccent: 'border-blue-500/40',
    primaryButton: 'bg-blue-600 hover:bg-blue-700 text-white',
    primaryBadge: 'bg-blue-100 text-blue-700 border-blue-300',
    accentColor: '#2563eb',
    gradient: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
  },
];

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
    document.documentElement.setAttribute('data-theme', resolvedThemeId);
    if (resolvedThemeId === LIGHT_THEME_ID) {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
    }
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
