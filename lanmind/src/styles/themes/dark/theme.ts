import type { ThemeConfig } from '../../../types';
import { tr } from '../../../i18n';

/** 暗色主题的元数据。色值与 dark/tokens.css 保持一致。 */
const dark: ThemeConfig = {
  id: 'dark',
  get name() { return tr('settings:theme.dark.name'); },
  get description() { return tr('settings:theme.dark.desc'); },
  previewColor: '#0f1115',
  bgCanvas: '#0f1115',
  bgHeader: '#15181e',
  bgSidebar: '#15181e',
  bgCard: '#1b1f27',
  textPrimary: '#f1f3f5',
  textSecondary: '#a3adb8',
  borderAccent: 'rgba(255, 255, 255, 0.10)',
  primaryButton: '#356cf4',
  primaryBadge: 'rgba(59, 130, 246, 0.15)',
  accentColor: '#356cf4',
};

export default dark;
