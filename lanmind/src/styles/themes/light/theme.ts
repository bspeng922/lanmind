import type { ThemeConfig } from '../../../types';
import { tr } from '../../../i18n';

/** 亮色主题的元数据。色值与 light/tokens.css 保持一致。 */
const light: ThemeConfig = {
  id: 'light',
  get name() { return tr('settings:theme.light.name'); },
  get description() { return tr('settings:theme.light.desc'); },
  previewColor: '#f3f4f6',
  bgCanvas: '#f3f4f6',
  bgHeader: '#f8f9fb',
  bgSidebar: '#f8f9fb',
  bgCard: '#ffffff',
  textPrimary: '#111318',
  textSecondary: '#4b5563',
  borderAccent: '#dfe3e8',
  primaryButton: '#1d4ed8',
  primaryBadge: 'rgba(29, 78, 216, 0.08)',
  accentColor: '#1d4ed8',
};

export default light;
