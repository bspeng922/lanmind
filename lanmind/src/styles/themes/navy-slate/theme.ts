import { tr } from '../../../i18n/core';
import type { ThemeConfig } from '../../../types';

const theme: ThemeConfig = {
    id: 'navy-slate',
    get name() { return tr('settings:themes.navy-slate.name'); },
    get description() { return tr('settings:themes.navy-slate.description'); },
    previewColor: 'linear-gradient(135deg, #1e293b 0%, #3b82f6 100%)',
    bgCanvas: 'bg-canvas',
    bgHeader: 'bg-surface',
    bgSidebar: 'bg-surface',
    bgCard: 'bg-card',
    textPrimary: 'text-main',
    textSecondary: 'text-sub',
    borderAccent: 'border-accent/40',
    primaryButton: 'theme-btn-primary',
    primaryBadge: 'theme-badge-accent',
    accentColor: '#3b82f6',
    gradient: 'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)',
  };

export default theme;
