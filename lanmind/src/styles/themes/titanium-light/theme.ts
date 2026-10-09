import { tr } from '../../../i18n/core';
import type { ThemeConfig } from '../../../types';

const theme: ThemeConfig = {
    id: 'titanium-light',
    get name() { return tr('settings:themes.titanium-light.name'); },
    get description() { return tr('settings:themes.titanium-light.description'); },
    previewColor: 'linear-gradient(135deg, #f8fafc 0%, #2563eb 100%)',
    bgCanvas: 'bg-canvas',
    bgHeader: 'bg-surface',
    bgSidebar: 'bg-surface',
    bgCard: 'bg-card',
    textPrimary: 'text-main',
    textSecondary: 'text-sub',
    borderAccent: 'border-accent/40',
    primaryButton: 'theme-btn-primary',
    primaryBadge: 'theme-badge-accent',
    accentColor: '#1d4ed8',
    gradient: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
  };

export default theme;
