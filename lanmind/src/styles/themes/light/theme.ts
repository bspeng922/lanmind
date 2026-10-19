import type { ThemeConfig } from '../../../types';
import { tr } from '../../../i18n';

/** 亮色主题的元数据。色值与 light/tokens.css 保持一致。 */
const light: ThemeConfig = {
  id: 'light',
  get name() { return tr('settings:theme.light.name'); },
  get description() { return tr('settings:theme.light.desc'); },
  previewColor: '#fafafa',
  bgCanvas: '#fafafa',
  bgHeader: '#ffffff',
  bgSidebar: '#ffffff',
  bgCard: '#ffffff',
  textPrimary: '#171717',
  textSecondary: '#525252',
  borderAccent: '#e5e5e5',
  primaryButton: '#2563eb',
  primaryBadge: '#dbeafe',
  accentColor: '#2563eb',
};

export default light;
