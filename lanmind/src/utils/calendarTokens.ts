/**
 * calendarTokens.ts — Visual design tokens and paired color styling for calendar events.
 *
 * CALLING SPEC:
 *   import { getTaskEventStyle } from './calendarTokens';
 *   const style = getTaskEventStyle(task, projectColor, isDark);
 *   // style: { background, color, borderColor, dotColor }
 */

import { Priority, Task } from '../types';
import { hexToRgb } from './desktopCalendar';

export interface EventStyle {
  background: string;
  color: string;
  borderColor: string;
  dotColor: string;
}

/** Fallback palette by priority */
const PRIORITY_THEMES: Record<
  Priority,
  {
    lightBg: string;
    lightFg: string;
    lightBorder: string;
    darkBg: string;
    darkFg: string;
    darkBorder: string;
    dot: string;
  }
> = {
  P1: {
    // Urgent / Red
    lightBg: '#fee2e2',
    lightFg: '#991b1b',
    lightBorder: '#fca5a5',
    darkBg: '#450a0a',
    darkFg: '#fca5a5',
    darkBorder: '#7f1d1d',
    dot: '#ef4444',
  },
  P2: {
    // High / Orange
    lightBg: '#ffedd5',
    lightFg: '#9a3412',
    lightBorder: '#fdba74',
    darkBg: '#431407',
    darkFg: '#fdba74',
    darkBorder: '#7c2d12',
    dot: '#f97316',
  },
  P3: {
    // Medium / Blue
    lightBg: '#e0f2fe',
    lightFg: '#075985',
    lightBorder: '#7dd3fc',
    darkBg: '#082f49',
    darkFg: '#7dd3fc',
    darkBorder: '#0c4a6e',
    dot: '#0284c7',
  },
  P4: {
    // Low / Neutral
    lightBg: '#f1f5f9',
    lightFg: '#334155',
    lightBorder: '#cbd5e1',
    darkBg: '#1e293b',
    darkFg: '#94a3b8',
    darkBorder: '#334155',
    dot: '#64748b',
  },
};

/**
 * Returns paired background and foreground styling for an event block.
 * Uses project color if available; otherwise falls back to priority-based theme.
 */
export function getTaskEventStyle(
  task: Pick<Task, 'priority' | 'stateGroup' | 'status'>,
  projectColor?: string | null,
  isDark = false,
  isWallpaper = false
): EventStyle {
  const isCompleted = task.stateGroup === 'completed' || task.status === 'completed';

  if (isCompleted) {
    return isDark || isWallpaper
      ? {
          background: 'rgba(51, 65, 85, 0.45)',
          color: '#94a3b8',
          borderColor: 'rgba(71, 85, 105, 0.4)',
          dotColor: '#64748b',
        }
      : {
          background: '#f8fafc',
          color: '#94a3b8',
          borderColor: '#e2e8f0',
          dotColor: '#94a3b8',
        };
  }

  // If a custom project hex color is provided, generate a tinted background & border
  if (projectColor && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(projectColor)) {
    const rgb = hexToRgb(projectColor);
    if (rgb) {
      const bgOpacity = isWallpaper ? 0.35 : isDark ? 0.25 : 0.14;
      const borderOpacity = isWallpaper ? 0.5 : isDark ? 0.4 : 0.3;
      return {
        background: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${bgOpacity})`,
        color: isDark || isWallpaper ? '#f8fafc' : projectColor,
        borderColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${borderOpacity})`,
        dotColor: projectColor,
      };
    }
  }

  // Fallback to priority themes
  const theme = PRIORITY_THEMES[task.priority] || PRIORITY_THEMES.P4;
  if (isWallpaper) {
    return {
      background: isDark ? theme.darkBg : 'rgba(255, 255, 255, 0.22)',
      color: isDark ? theme.darkFg : '#0f172a',
      borderColor: isDark ? theme.darkBorder : 'rgba(255, 255, 255, 0.3)',
      dotColor: theme.dot,
    };
  }

  return isDark
    ? {
        background: theme.darkBg,
        color: theme.darkFg,
        borderColor: theme.darkBorder,
        dotColor: theme.dot,
      }
    : {
        background: theme.lightBg,
        color: theme.lightFg,
        borderColor: theme.lightBorder,
        dotColor: theme.dot,
      };
}

