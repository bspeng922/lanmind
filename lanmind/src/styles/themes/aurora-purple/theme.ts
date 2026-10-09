import { tr } from '../../../i18n/core';
import type { ThemeConfig } from '../../../types';

const theme: ThemeConfig = {
    id: 'aurora-purple',
    get name() { return tr('settings:themes.aurora-purple.name'); },
    get description() { return tr('settings:themes.aurora-purple.description'); },
    previewColor: 'linear-gradient(135deg, #18181b 0%, #a855f7 100%)',
    bgCanvas: 'bg-canvas',
    bgHeader: 'bg-surface',
    bgSidebar: 'bg-surface',
    bgCard: 'bg-card',
    textPrimary: 'text-main',
    textSecondary: 'text-sub',
    borderAccent: 'border-accent/40',
    primaryButton: 'theme-btn-primary',
    primaryBadge: 'theme-badge-accent',
    accentColor: '#a855f7',
    gradient: 'linear-gradient(135deg, #9333ea 0%, #c084fc 100%)',
  };

export default theme;
