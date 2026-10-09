import { tr } from '../../../i18n/core';
import type { ThemeConfig } from '../../../types';

const theme: ThemeConfig = {
    id: 'warm-amber',
    get name() { return tr('settings:themes.warm-amber.name'); },
    get description() { return tr('settings:themes.warm-amber.description'); },
    previewColor: 'linear-gradient(135deg, #1c1917 0%, #f59e0b 100%)',
    bgCanvas: 'bg-canvas',
    bgHeader: 'bg-surface',
    bgSidebar: 'bg-surface',
    bgCard: 'bg-card',
    textPrimary: 'text-main',
    textSecondary: 'text-sub',
    borderAccent: 'border-accent/40',
    primaryButton: 'theme-btn-primary',
    primaryBadge: 'theme-badge-accent',
    accentColor: '#f59e0b',
    gradient: 'linear-gradient(135deg, #d97706 0%, #fbbf24 100%)',
  };

export default theme;
