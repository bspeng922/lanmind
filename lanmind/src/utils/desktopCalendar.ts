// Zero means the wallpaper calendar has no colored surface at all.  Keeping
// this as a supported value is important for the pinned-to-desktop mode:
// users can still raise the value when they need more contrast.
export const DESKTOP_CALENDAR_MIN_OPACITY = 0;
export const DESKTOP_CALENDAR_MAX_OPACITY = 90;
export const DESKTOP_CALENDAR_DEFAULT_OPACITY = 0;
export const DESKTOP_CALENDAR_SHOW_COMPLETED_KEY = 'lanmind_desktop_cal_show_completed';
export const DESKTOP_CALENDAR_THEME_TONE_KEY = 'lanmind_desktop_cal_theme_tone';
export const DESKTOP_CALENDAR_MIN_WIDTH = 520;
export const DESKTOP_CALENDAR_MIN_HEIGHT = 420;

export const DESKTOP_CALENDAR_CUSTOM_COLOR_KEY = 'lanmind_desktop_cal_custom_color';
export const DESKTOP_CALENDAR_DEFAULT_CUSTOM_COLOR = '#0f172a';

export type DesktopCalendarTone = 'system' | 'custom';

export function normalizeDesktopCalendarThemeTone(value: unknown): DesktopCalendarTone {
  if (value === 'custom') {
    return 'custom';
  }
  if (value === 'dark') {
    return 'custom';
  }
  return 'system';
}

export function normalizeDesktopCalendarCustomColor(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
      if (trimmed.length === 4) {
        return (
          '#' +
          trimmed[1] +
          trimmed[1] +
          trimmed[2] +
          trimmed[2] +
          trimmed[3] +
          trimmed[3]
        ).toLowerCase();
      }
      return trimmed.toLowerCase();
    }
  }
  return DESKTOP_CALENDAR_DEFAULT_CUSTOM_COLOR;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeDesktopCalendarCustomColor(hex);
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return { r, g, b };
}

export function isLightColor(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140;
}


export function isValidDesktopCalendarSize(width: number, height: number): boolean {
  return Number.isFinite(width)
    && Number.isFinite(height)
    && width >= DESKTOP_CALENDAR_MIN_WIDTH
    && height >= DESKTOP_CALENDAR_MIN_HEIGHT;
}

const PRIORITY_ORDER: Record<string, number> = {
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

export function normalizeDesktopCalendarOpacity(
  value: unknown,
  fallback = DESKTOP_CALENDAR_DEFAULT_OPACITY,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(
    DESKTOP_CALENDAR_MIN_OPACITY,
    Math.min(DESKTOP_CALENDAR_MAX_OPACITY, Math.round(parsed)),
  );
}

/** Keep unfinished work prominent while retaining a deterministic task order. */
export function sortDesktopCalendarOccurrences<T extends {
  task: { status: string; priority?: string };
}>(occurrences: T[], showCompleted = true): T[] {
  return occurrences
    .filter(({ task }) => showCompleted || task.status !== 'completed')
    .sort((left, right) => {
      const leftCompleted = left.task.status === 'completed' ? 1 : 0;
      const rightCompleted = right.task.status === 'completed' ? 1 : 0;
      if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
      return (PRIORITY_ORDER[left.task.priority || 'P4'] || 99)
        - (PRIORITY_ORDER[right.task.priority || 'P4'] || 99);
    });
}
