import type { ThemeConfig } from '../../types';
import dark from './dark/theme';
import light from './light/theme';

/** 亮/暗两套基准主题。数组顺序决定主题选择器里的展示顺序。 */
export const THEME_PRESETS: ThemeConfig[] = [
  dark,
  light,
];
