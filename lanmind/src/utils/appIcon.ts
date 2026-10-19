/**
 * appIcon — Application Icon Themes & Preferences.
 *
 * CALLING SPEC:
 *   const { iconTheme, setIconTheme, appIconOptions } = useAppIcon();
 *   const style = getAppIconStyle(iconId);
 *
 * INPUTS:
 *   - iconId: AppIconId ('blue' | 'black' | 'gold' | 'emerald' | 'purple' | 'rose')
 *
 * OUTPUTS:
 *   - AppIconConfig: { id, nameKey, gradient, glow, bg, textColor }
 *
 * SIDE EFFECTS:
 *   - Persists chosen icon ID in localStorage('lanmind_app_icon')
 *   - Dispatches 'lanmind-app-icon-change' window event
 */

import { useEffect, useState } from 'react';
import { tr } from '../i18n';

export type AppIconId = 'blue' | 'black' | 'gold' | 'emerald' | 'purple' | 'rose';

export interface AppIconConfig {
  id: AppIconId;
  name: string;
  gradient: string;
  glow: string;
  badgeBg: string;
  textColor: string;
}

export const APP_ICON_STORAGE_KEY = 'lanmind_app_icon';
export const APP_ICON_CHANGE_EVENT = 'lanmind-app-icon-change';

export const APP_ICONS: Record<AppIconId, Omit<AppIconConfig, 'name'> & { get name(): string }> = {
  blue: {
    id: 'blue',
    get name() { return tr('settings:appIcon.blue'); },
    gradient: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%)',
    glow: 'rgba(37, 99, 235, 0.45)',
    badgeBg: '#2563eb',
    textColor: '#ffffff',
  },
  black: {
    id: 'black',
    get name() { return tr('settings:appIcon.black'); },
    gradient: 'linear-gradient(135deg, #334155 0%, #1e293b 50%, #0f172a 100%)',
    glow: 'rgba(15, 23, 42, 0.55)',
    badgeBg: '#0f172a',
    textColor: '#ffffff',
  },
  gold: {
    id: 'gold',
    get name() { return tr('settings:appIcon.gold'); },
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
    glow: 'rgba(245, 158, 11, 0.45)',
    badgeBg: '#f59e0b',
    textColor: '#ffffff',
  },
  emerald: {
    id: 'emerald',
    get name() { return tr('settings:appIcon.emerald'); },
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)',
    glow: 'rgba(16, 185, 129, 0.45)',
    badgeBg: '#10b981',
    textColor: '#ffffff',
  },
  purple: {
    id: 'purple',
    get name() { return tr('settings:appIcon.purple'); },
    gradient: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #6d28d9 100%)',
    glow: 'rgba(139, 92, 246, 0.45)',
    badgeBg: '#8b5cf6',
    textColor: '#ffffff',
  },
  rose: {
    id: 'rose',
    get name() { return tr('settings:appIcon.rose'); },
    gradient: 'linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%)',
    glow: 'rgba(239, 68, 68, 0.45)',
    badgeBg: '#ef4444',
    textColor: '#ffffff',
  },
};

export function getAppIconConfig(id: string | null | undefined): AppIconConfig {
  if (id && id in APP_ICONS) {
    const item = APP_ICONS[id as AppIconId];
    return {
      id: item.id,
      name: item.name,
      gradient: item.gradient,
      glow: item.glow,
      badgeBg: item.badgeBg,
      textColor: item.textColor,
    };
  }
  const fallback = APP_ICONS.blue;
  return {
    id: fallback.id,
    name: fallback.name,
    gradient: fallback.gradient,
    glow: fallback.glow,
    badgeBg: fallback.badgeBg,
    textColor: fallback.textColor,
  };
}

export function getStoredAppIcon(): AppIconId {
  if (typeof window === 'undefined') return 'blue';
  try {
    const saved = localStorage.getItem(APP_ICON_STORAGE_KEY);
    if (saved && saved in APP_ICONS) return saved as AppIconId;
  } catch {
    // ignore localStorage errors
  }
  return 'blue';
}

export function setStoredAppIcon(id: AppIconId): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(APP_ICON_STORAGE_KEY, id);
    window.dispatchEvent(new CustomEvent(APP_ICON_CHANGE_EVENT, { detail: id }));
  } catch {
    // ignore
  }
}

export function useAppIcon() {
  const [iconId, setIconId] = useState<AppIconId>(getStoredAppIcon);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AppIconId>).detail;
      if (detail && detail in APP_ICONS) {
        setIconId(detail);
      }
    };
    window.addEventListener(APP_ICON_CHANGE_EVENT, handler);
    return () => window.removeEventListener(APP_ICON_CHANGE_EVENT, handler);
  }, []);

  const setIcon = (id: AppIconId) => {
    setIconId(id);
    setStoredAppIcon(id);
  };

  return {
    iconId,
    iconConfig: getAppIconConfig(iconId),
    setIconTheme: setIcon,
    availableIcons: (Object.keys(APP_ICONS) as AppIconId[]).map((k) => getAppIconConfig(k)),
  };
}
