import { tr } from '../../../i18n/core';
import type { ThemeConfig } from '../../../types';

const theme: ThemeConfig = {
    id: 'cyber-emerald',
    get name() { return tr('settings:themes.cyber-emerald.name'); },
    get description() { return tr('settings:themes.cyber-emerald.description'); },
    previewColor: 'linear-gradient(135deg, #111827 0%, #10b981 100%)',
    bgCanvas: 'bg-canvas',
    bgHeader: 'bg-surface',
    bgSidebar: 'bg-surface',
    bgCard: 'bg-card',
    textPrimary: 'text-main',
    textSecondary: 'text-sub',
    borderAccent: 'border-accent/40',
    primaryButton: 'theme-btn-primary',
    primaryBadge: 'theme-badge-accent',
    accentColor: '#10b981',
    gradient: 'linear-gradient(135deg, #059669 0%, #34d399 100%)',
  };

export default theme;
