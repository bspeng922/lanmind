/**
 * NotificationWindow — Desktop toast notification popup component with theme synchronization.
 *
 * CALLING SPEC:
 *   <NotificationWindow />
 *
 * TOOL CONTRACT / SIDE EFFECTS:
 *   - Fully synchronizes with active theme tokens (Navy Slate, Aurora Purple, Cyber Emerald, Warm Amber, Titanium Light).
 *   - Listens to 'notification://show' and 'notification://dismiss-current' Tauri events.
 *   - Calls Tauri invoke('notification_window_ready') on mount.
 *   - Calls Tauri invoke('reveal_main_window') when clicking "查看任务" / "打开应用".
 *   - Auto-dismisses with configurable countdown duration (default 10s, 3-30s, pauses on hover, supports manual close mode).
 *   - Plays a harmonious chime upon arrival.
 *   - When in standalone browser mode, provides interactive demo cards & theme switcher.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  AlarmClock,
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronDown,
  Clock,
  Clock3,
  MessageSquare,
  Pause,
  Sparkles,
  X,
} from 'lucide-react';
import { useTheme } from './context/ThemeContext';
import { ThemeId, ThemePreference } from './types';
import { playNotificationSound } from './utils/notificationSound';
import {
  NotificationSettings,
  NOTIFICATION_SETTINGS_CHANGED_EVENT,
  getNotificationSettings,
} from './utils/notificationSettings';

export type NotificationKind = 'assignment' | 'message' | 'reminder';

export interface DesktopNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  themeId?: ThemeId;
  themePreference?: ThemePreference;
}

interface NotificationAppearance {
  Icon: typeof Bell;
  badgeLabel: string;
  badgeClass: string;
  iconClass: string;
  iconBg: string;
  borderGlow: string;
  shadowGlow: string;
  radialGradient: string;
  progressGradient: string;
}

const isTauriEnv = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

/**
 * Pure function: Map notification kind to distinct aesthetics.
 */
export function getNotificationAppearance(kind: NotificationKind): NotificationAppearance {
  switch (kind) {
    case 'reminder':
      return {
        Icon: AlarmClock,
        badgeLabel: '到期提醒',
        badgeClass: 'bg-amber-500/15 text-warning border-amber-500/30',
        iconClass: 'text-warning',
        iconBg: 'bg-amber-500/10 border border-amber-500/25 shadow-[0_0_12px_rgba(245,158,11,0.2)]',
        borderGlow: 'rgba(245, 158, 11, 0.45)',
        shadowGlow: 'rgba(245, 158, 11, 0.22)',
        radialGradient: 'radial-gradient(ellipse at 85% 15%, rgba(245, 158, 11, 0.12), transparent 65%)',
        progressGradient: 'linear-gradient(90deg, #d97706, #fbbf24)',
      };
    case 'assignment':
      return {
        Icon: CheckCircle2,
        badgeLabel: '任务指派',
        badgeClass: 'bg-emerald-500/15 text-success border-emerald-500/30',
        iconClass: 'text-success',
        iconBg: 'bg-emerald-500/10 border border-emerald-500/25 shadow-[0_0_12px_rgba(16,185,129,0.2)]',
        borderGlow: 'rgba(16, 185, 129, 0.45)',
        shadowGlow: 'rgba(16, 185, 129, 0.22)',
        radialGradient: 'radial-gradient(ellipse at 85% 15%, rgba(16, 185, 129, 0.12), transparent 65%)',
        progressGradient: 'linear-gradient(90deg, #059669, #34d399)',
      };
    case 'message':
      return {
        Icon: MessageSquare,
        badgeLabel: '新消息',
        badgeClass: 'bg-sky-500/15 text-info border-sky-500/30',
        iconClass: 'text-info',
        iconBg: 'bg-sky-500/10 border border-sky-500/25 shadow-[0_0_12px_rgba(14,165,233,0.2)]',
        borderGlow: 'rgba(14, 165, 233, 0.45)',
        shadowGlow: 'rgba(14, 165, 233, 0.22)',
        radialGradient: 'radial-gradient(ellipse at 85% 15%, rgba(14, 165, 233, 0.12), transparent 65%)',
        progressGradient: 'linear-gradient(90deg, #0284c7, #38bdf8)',
      };
    default:
      return {
        Icon: Bell,
        badgeLabel: '系统提醒',
        badgeClass: 'bg-muted/15 text-quiet dark:text-sub border-subtle/30',
        iconClass: 'text-quiet dark:text-sub',
        iconBg: 'bg-muted/10 border border-subtle/25 shadow-none',
        borderGlow: 'rgba(148, 163, 184, 0.3)',
        shadowGlow: 'rgba(148, 163, 184, 0.15)',
        radialGradient: 'none',
        progressGradient: 'linear-gradient(90deg, #64748b, #94a3b8)',
      };
  }
}

/**
 * Pure function: Parse title and body into display sections (task name, due time meta, body).
 */
export function parseNotificationContent(notification: DesktopNotification): {
  headline: string;
  dueMeta: string | null;
  detail: string | null;
} {
  const { kind, title, body } = notification;

  if (kind === 'reminder') {
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      return {
        headline: lines[0],
        dueMeta: lines[1].replace(/^到期时间[：:]\s*/, ''),
        detail: lines.slice(2).join(' ') || null,
      };
    }
    if (lines.length === 1) {
      if (lines[0].startsWith('到期时间')) {
        return { headline: title, dueMeta: lines[0].replace(/^到期时间[：:]\s*/, ''), detail: null };
      }
      return { headline: lines[0], dueMeta: null, detail: null };
    }
    return { headline: title, dueMeta: null, detail: null };
  }

  return {
    headline: title,
    dueMeta: null,
    detail: body.trim() || null,
  };
}

export { playNotificationSound };

export interface SnoozeOption {
  label: string;
  minutes: number;
}

export const SNOOZE_OPTIONS: readonly SnoozeOption[] = [
  { label: '5 分钟后', minutes: 5 },
  { label: '10 分钟后', minutes: 10 },
  { label: '15 分钟后', minutes: 15 },
] as const;

const DEMO_NOTIFICATIONS: DesktopNotification[] = [
  {
    id: 'demo-reminder-1',
    kind: 'reminder',
    title: '任务到期提醒',
    body: '完成跨端架构设计与重构评审\n到期时间：今天 17:30',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'demo-assignment-2',
    kind: 'assignment',
    title: '李工 指派了新任务',
    body: '局域网心跳丢失后自动重连逻辑修复与验证',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'demo-message-3',
    kind: 'message',
    title: '王经理 发来新消息',
    body: '下周一的项目里程碑汇报材料准备好了吗？',
    createdAt: new Date().toISOString(),
  },
];

const TICK_INTERVAL_MS = 50;

export function NotificationWindow() {
  const { currentTheme, setThemeId, allThemes } = useTheme();
  const [notificationSettings, setNotificationSettingsState] = useState<NotificationSettings>(() =>
    getNotificationSettings(),
  );
  const [notifications, setNotifications] = useState<DesktopNotification[]>(() =>
    isTauriEnv() ? [] : DEMO_NOTIFICATIONS,
  );
  const [progress, setProgress] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [isSnoozeOpen, setIsSnoozeOpen] = useState(false);
  const isSnoozeOpenRef = useRef(false);
  const snoozeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    isSnoozeOpenRef.current = isSnoozeOpen;
  }, [isSnoozeOpen]);

  // Synchronize notification settings changes across windows in real time
  useEffect(() => {
    const handleLocalChange = (e: Event) => {
      const customEvent = e as CustomEvent<NotificationSettings>;
      if (customEvent.detail) {
        setNotificationSettingsState(customEvent.detail);
      } else {
        setNotificationSettingsState(getNotificationSettings());
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('lanmind_notification_')) {
        setNotificationSettingsState(getNotificationSettings());
      }
    };

    window.addEventListener(NOTIFICATION_SETTINGS_CHANGED_EVENT, handleLocalChange);
    window.addEventListener('storage', handleStorage);

    let unlistenTauri: (() => void) | undefined;
    if (isTauriEnv()) {
      void listen<NotificationSettings>('notification://settings-changed', (event) => {
        if (event.payload) {
          setNotificationSettingsState(event.payload);
        } else {
          setNotificationSettingsState(getNotificationSettings());
        }
      }).then((unlisten) => {
        unlistenTauri = unlisten;
      });
    }

    return () => {
      window.removeEventListener(NOTIFICATION_SETTINGS_CHANGED_EVENT, handleLocalChange);
      window.removeEventListener('storage', handleStorage);
      unlistenTauri?.();
    };
  }, []);

  // Click outside listener to dismiss snooze dropdown
  useEffect(() => {
    if (!isSnoozeOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (snoozeRef.current && !snoozeRef.current.contains(event.target as Node)) {
        setIsSnoozeOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [isSnoozeOpen]);

  const current = notifications[0];

  const dismiss = useCallback(() => {
    setNotifications((prev) => {
      const remaining = prev.slice(1);
      if (remaining.length === 0 && isTauriEnv()) {
        void getCurrentWindow()
          .hide()
          .catch((error) => console.error('Failed to hide notification window', error));
      }
      return remaining;
    });
  }, []);

  const handleSnooze = useCallback(
    async (minutes: number) => {
      if (!current) return;
      setIsSnoozeOpen(false);
      if (isTauriEnv()) {
        try {
          await emit('notification://snooze', {
            id: current.id,
            title: current.title,
            body: current.body,
            kind: current.kind,
            snoozeMinutes: minutes,
          });
        } catch (error) {
          console.warn('Failed to emit snooze event', error);
        }
      } else {
        const snoozedItem = { ...current };
        window.setTimeout(() => {
          setNotifications((prev) => [...prev, snoozedItem]);
        }, minutes * 60 * 1000);
      }
      dismiss();
    },
    [current, dismiss],
  );

  const handleOpenMain = useCallback(async () => {
    try {
      if (isTauriEnv()) {
        await invoke('reveal_main_window');
      } else {
        window.alert('已请求聚焦主程序窗口');
      }
    } catch (error) {
      console.warn('Failed to reveal main window', error);
    }
    dismiss();
  }, [dismiss]);

  const seenNotificationIds = useRef<Set<string>>(new Set());

  const handleNotification = useCallback((payload: DesktopNotification) => {
    if (!payload || !payload.id) return;
    if (seenNotificationIds.current.has(payload.id)) return;
    seenNotificationIds.current.add(payload.id);
    if (seenNotificationIds.current.size > 200) {
      const arr = Array.from(seenNotificationIds.current);
      seenNotificationIds.current = new Set(arr.slice(-100));
    }

    const requestedTheme = payload.themePreference || payload.themeId;
    if (requestedTheme) {
      setThemeId(requestedTheme);
    }
    setNotifications((prev) => {
      if (prev.some((n) => n.id === payload.id)) return prev;
      return [...prev, payload].slice(-50);
    });
    try {
      playNotificationSound();
    } catch (err) {
      console.warn('Failed to play notification sound', err);
    }
  }, [setThemeId]);

  // Tauri events listener
  useEffect(() => {
    if (!isTauriEnv()) return;

    let disposed = false;
    const appWindow = getCurrentWindow();
    let unlistenWindowShow: (() => void) | undefined;
    let unlistenShow: (() => void) | undefined;
    let unlistenDismiss: (() => void) | undefined;

    const setupListeners = async () => {
      // Register both scopes before notifying Rust that the window is ready.
      // This closes the startup race where queued reminders were emitted while
      // the hidden WebView was still installing its event listener.
      const [disposeWindowShow, disposeShow, disposeDismiss] = await Promise.all([
        appWindow.listen<DesktopNotification>('notification://show', (event) => {
          if (!disposed) handleNotification(event.payload);
        }),
        listen<DesktopNotification>('notification://show', (event) => {
          if (!disposed) handleNotification(event.payload);
        }),
        listen('notification://dismiss-current', dismiss),
      ]);
      if (disposed) {
        disposeWindowShow();
        disposeShow();
        disposeDismiss();
        return;
      }
      unlistenWindowShow = disposeWindowShow;
      unlistenShow = disposeShow;
      unlistenDismiss = disposeDismiss;

      try {
        await invoke('notification_window_ready');
      } catch (error) {
        console.warn('Failed to notify notification window ready', error);
      }

      // Proactively pull any pending notifications (closes race during startup/sleep)
      try {
        const pending = await invoke<DesktopNotification[]>('get_pending_notifications');
        if (Array.isArray(pending) && !disposed) {
          pending.forEach((item) => handleNotification(item));
        }
      } catch (error) {
        console.warn('Failed to get pending notifications', error);
      }
    };

    void setupListeners().catch((error) =>
      console.error('Failed to initialize notification window', error),
    );

    return () => {
      disposed = true;
      unlistenWindowShow?.();
      unlistenShow?.();
      unlistenDismiss?.();
    };
  }, [dismiss, handleNotification]);

  // Periodic fallback check when in desktop environment to ensure zero event loss
  useEffect(() => {
    if (!isTauriEnv()) return;
    const interval = window.setInterval(async () => {
      try {
        const pending = await invoke<DesktopNotification[]>('get_pending_notifications');
        if (Array.isArray(pending) && pending.length > 0) {
          pending.forEach((item) => handleNotification(item));
        }
      } catch {
        // silent fallback
      }
    }, 1200);
    return () => window.clearInterval(interval);
  }, [handleNotification]);

  // Auto-dismiss countdown timer
  useEffect(() => {
    if (!current || !notificationSettings.autoDismiss) {
      setProgress(100);
      return;
    }

    setProgress(100);
    const durationMs = Math.max(3, notificationSettings.durationSeconds) * 1000;
    const decrement = (TICK_INTERVAL_MS / durationMs) * 100;

    const timer = window.setInterval(() => {
      if (isPausedRef.current || isSnoozeOpenRef.current) return;
      setProgress((prev) => {
        if (prev <= decrement) {
          clearInterval(timer);
          dismiss();
          return 0;
        }
        return prev - decrement;
      });
    }, TICK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [current?.id, notificationSettings.autoDismiss, notificationSettings.durationSeconds, dismiss]);

  if (!current) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center bg-transparent p-2 text-xs"
        style={{ color: 'var(--text-sub)' }}
      >
        {!isTauriEnv() && (
          <button
            type="button"
            onClick={() => setNotifications(DEMO_NOTIFICATIONS)}
            className="theme-btn-secondary px-3 py-1.5 text-xs rounded-lg"
          >
            重载演示提醒
          </button>
        )}
      </div>
    );
  }

  const appearance = getNotificationAppearance(current.kind);
  const { Icon } = appearance;
  const { headline, dueMeta, detail } = parseNotificationContent(current);

  const createdAt = new Date(current.createdAt);
  const timeStr = Number.isNaN(createdAt.getTime())
    ? '刚刚'
    : createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  return (
    <main
      className="relative flex h-screen w-screen select-none flex-col overflow-hidden p-1.5 bg-transparent"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      data-tauri-drag-region
    >
      {/* Outer border & subtle glow wrapper (strictly contains radial lighting & avoids clipping artifacts) */}
      <div
        className="relative flex h-full w-full flex-col justify-between overflow-hidden rounded-2xl border p-3.5 transition-all duration-300"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-main)',
          color: 'var(--text-main)',
          boxShadow: `var(--panel-shadow), 0 0 16px -2px ${appearance.shadowGlow}`,
        }}
      >
        {/* Decorative radial lighting safely contained inside the card */}
        <div
          className="pointer-events-none absolute inset-0 opacity-70 transition-all duration-500 rounded-2xl"
          style={{
            background: appearance.radialGradient,
          }}
        />

        {/* Top Header Row */}
        <div className="relative z-30 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {/* Type badge with glowing indicator */}
            <div
              className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide ${appearance.badgeClass}`}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
              </span>
              <span>{appearance.badgeLabel}</span>
            </div>

            {/* Time badge */}
            <span className="text-[11px]" style={{ color: 'var(--text-sub)' }}>{timeStr}</span>

            {/* Stack count indicator */}
            {notifications.length > 1 && (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium"
                style={{
                  backgroundColor: 'var(--bg-hover)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <Sparkles className="h-3 w-3" style={{ color: 'var(--accent)' }} />
                <span>还有 {notifications.length - 1} 条</span>
              </span>
            )}
          </div>

          {/* Right Header: Snooze Dropdown + Close Button */}
          <div className="flex items-center gap-1.5">
            {/* Snooze Dropdown */}
            <div ref={snoozeRef} className="relative z-40">
              <button
                type="button"
                onClick={() => setIsSnoozeOpen((prev) => !prev)}
                className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all"
                style={{
                  backgroundColor: isSnoozeOpen ? 'var(--bg-hover)' : 'color-mix(in srgb, var(--bg-card) 85%, transparent)',
                  border: '1px solid var(--border-subtle)',
                  color: isSnoozeOpen ? 'var(--text-main)' : 'var(--text-sub)',
                }}
                title="选择稍后提醒时间"
                aria-expanded={isSnoozeOpen}
              >
                <Clock className="h-3 w-3" />
                <span>稍后提醒</span>
                <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${isSnoozeOpen ? 'rotate-180' : ''}`} />
              </button>

              {isSnoozeOpen && (
                <div
                  className="absolute right-0 top-full z-50 mt-1 min-w-[116px] overflow-hidden rounded-xl border p-1 shadow-popover animate-in fade-in zoom-in-95 duration-100"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-main)',
                    boxShadow: 'var(--popover-shadow)',
                  }}
                >
                  {SNOOZE_OPTIONS.map((opt) => (
                    <button
                      key={opt.minutes}
                      type="button"
                      onClick={() => void handleSnooze(opt.minutes)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-hover"
                      style={{ color: 'var(--text-main)' }}
                    >
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Close button */}
            <button
              type="button"
              onClick={dismiss}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-hover"
              style={{ color: 'var(--text-sub)' }}
              title="关闭提醒"
              aria-label="关闭提醒"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Content Body Area: Compact framed task card */}
        <div
          className="relative z-10 my-auto flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--bg-card) 60%, var(--bg-surface))',
            borderColor: 'color-mix(in srgb, var(--border-subtle) 80%, transparent)',
            boxShadow: 'var(--soft-shadow)',
          }}
        >
          {/* Main icon with ringing micro-animation */}
          <div
            className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${appearance.iconBg}`}
          >
            {current.kind === 'reminder' && (
              <span className="pointer-events-none absolute -inset-0.5 rounded-xl border border-amber-500/30 animate-ping opacity-25" />
            )}
            <Icon
              className={`h-5 w-5 ${appearance.iconClass} ${
                current.kind === 'reminder' ? 'animate-alarm-ring' : ''
              }`}
            />
          </div>

          <div className="min-w-0 flex-1">
            {/* Primary Headline / Task Title */}
            <h1
              className="line-clamp-2 text-[13px] font-semibold leading-snug"
              style={{ color: 'var(--text-main)' }}
              title={headline}
            >
              {headline}
            </h1>

            {/* Due date pill or detail line */}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {dueMeta && (
                <div
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: 'var(--accent-subtle)',
                    borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
                    color: 'var(--accent)',
                  }}
                >
                  <Clock3 className="h-3 w-3" />
                  <span>到期：{dueMeta}</span>
                </div>
              )}

              {detail && (
                <p
                  className="line-clamp-1 text-xs"
                  style={{ color: 'var(--text-sub)' }}
                  title={detail}
                >
                  {detail}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Section: Action Bar & Integrated Progress Bar */}
        <div className="relative z-10 flex flex-col pt-0.5">
          {/* Footer Actions Row */}
          <div className="flex items-center justify-between text-xs">
            {/* Left: Pause / Countdown status */}
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-sub)' }}>
              {!notificationSettings.autoDismiss ? (
                <span className="flex items-center gap-1 opacity-85 font-medium" title="当前已开启手动关闭模式">
                  <Clock className="h-3.5 w-3.5 opacity-70" />
                  <span>等待手动确认</span>
                </span>
              ) : isPaused || isSnoozeOpen ? (
                <span className="flex items-center gap-1 font-medium" style={{ color: 'var(--accent)' }}>
                  <Pause className="h-3.5 w-3.5" />
                  <span>{isSnoozeOpen ? '选择稍后时间' : '悬停已暂停'}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 font-medium">
                  <Clock className="h-3 w-3 opacity-60" />
                  <span>{Math.ceil((progress / 100) * notificationSettings.durationSeconds)}s 后自动关闭</span>
                </span>
              )}
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={dismiss}
                className="ui-cancel-button px-3 py-1.5 text-xs rounded-lg font-medium"
              >
                知道了
              </button>
              <button
                type="button"
                onClick={handleOpenMain}
                className="theme-btn-primary flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold shadow-soft"
              >
                <span>查看任务</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Elegant Countdown Progress Bar */}
          {notificationSettings.autoDismiss && (
            <div className="mt-2.5 w-full">
              <div
                className="relative h-[3.5px] w-full overflow-hidden rounded-full"
                style={{ backgroundColor: 'color-mix(in srgb, var(--border-subtle) 75%, transparent)' }}
              >
                <div
                  className="h-full rounded-full transition-all ease-linear"
                  style={{
                    width: `${progress}%`,
                    background: appearance.progressGradient,
                    boxShadow: isPaused
                      ? `0 0 8px ${appearance.borderGlow}`
                      : `0 0 6px ${appearance.shadowGlow}`,
                    transitionDuration: `${TICK_INTERVAL_MS}ms`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Standalone browser mode: Mini theme test dock */}
      {!isTauriEnv() && (
        <div className="mt-2 flex items-center justify-center gap-1 text-[10px]">
          <span className="text-sub mr-1">切换主题测试:</span>
          {allThemes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setThemeId(t.id)}
              className={`px-1.5 py-0.5 rounded border transition-all ${
                currentTheme.id === t.id
                  ? 'border-blue-400 bg-blue-500/20 text-info font-bold'
                  : 'border-subtle bg-card text-sub hover:text-main'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
