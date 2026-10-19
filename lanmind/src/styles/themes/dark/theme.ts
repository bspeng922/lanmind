import type { ThemeConfig } from '../../../types';
import { tr } from '../../../i18n';

/** 暗色主题的元数据。色值与 dark/tokens.css 保持一致。 */
const dark: ThemeConfig = {
  id: 'dark',
  get name() { return tr('settings:theme.dark.name'); },
  get description() { return tr('settings:theme.dark.desc'); },
  previewColor: '#191b1b',
  bgCanvas: '#191b1b',
  bgHeader: '#1c1f1f',
  bgSidebar: '#1c1f1f',
  bgCard: '#232626',
  textPrimary: '#f5f5f5',
  textSecondary: '#a1a1a1',
  borderAccent: '#2e3234',
  primaryButton: '#3f76ff',
  primaryBadge: 'rgba(63, 118, 255, 0.14)',
  accentColor: '#3f76ff',
};

export default dark;
