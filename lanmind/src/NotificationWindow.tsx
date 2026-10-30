import { tr, useLocale, currentLocale } from "./i18n";
import { ApiService } from './services/api';
import { featureEnabled, useFeatures } from './modules/state';
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
import { invoke, ensureWorkspaceContext } from './services/api';
import { getWorkspaceContext } from './utils/workspaceContext';
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
import {
  NotificationKind,
  DesktopNotification,
  NotificationAppearance,
  getNotificationAppearance,
  parseNotificationContent,
  SnoozeOption,
  SNOOZE_OPTIONS,
  DEMO_NOTIFICATIONS,
} from './utils/notificationAppearance';

export type { NotificationKind, DesktopNotification, SnoozeOption };
export { getNotificationAppearance, parseNotificationContent, SNOOZE_OPTIONS, playNotificationSound };

const isTauriEnv = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

const TICK_INTERVAL_MS = 50;

export function NotificationWindow() {
  const { locale } = useLocale();
  const enabledFeatures = useFeatures();
  const contentRef = useRef<HTMLDivElement>(null);
  const { currentTheme, setThemeId, allThemes } = useTheme();
  const [notificationSettings, setNotificationSettingsState] = useState<NotificationSettings>(() =>
    getNotificationSettings(),
  );
  const [notifications, setNotifications] = useState<DesktopNotification[]>(() =>
    isTauriEnv() ? [] : DEMO_NOTIFICATIONS,
  );
  const [progress, setProgress] = useState(100);
  useEffect(() => {
    if (!enabledFeatures.chat) setNotifications(items => items.filter(item => item.kind !== 'message' && item.feature !== 'chat'));
  }, [enabledFeatures.chat]);
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
  const hadNotifications = useRef(false);

  useEffect(() => {
    if (notifications.length > 0) {
      hadNotifications.current = true;
      return;
    }

    // Hiding a native window need not produce a DOM mouseleave. A subsequent
    // popup must not inherit the previous popup's paused countdown or menu.
    isPausedRef.current = false;
    isSnoozeOpenRef.current = false;
    setIsPaused(false);
    setIsSnoozeOpen(false);
    if (hadNotifications.current && isTauriEnv()) {
      void getCurrentWindow().hide()
        .catch((error) => console.error('Failed to hide notification window', error));
    }
    hadNotifications.current = false;
  }, [notifications.length]);

  const dismiss = useCallback(() => {
    setIsSnoozeOpen(false);
    setNotifications((prev) => prev.slice(1));
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
        window.alert(tr("common:notificationWindow.requestedMainWindowFocus"));
      }
    } catch (error) {
      console.warn('Failed to reveal main window', error);
    }
    dismiss();
  }, [dismiss]);

  const seenNotificationIds = useRef<Set<string>>(new Set());

  const handleNotification = useCallback(async (payload: DesktopNotification) => {
    if (!payload || !payload.id) return;
    if (!featureEnabled('chat') && (payload.kind === 'message' || payload.feature === 'chat')) return;
    let scope = getWorkspaceContext();
    if (isTauriEnv() && !scope) {
      try {
        scope = await ensureWorkspaceContext();
      } catch {
        // ignore
      }
    }
    if (isTauriEnv() && scope && payload.workspaceId && (payload.workspaceId !== scope.workspaceId || (typeof payload.workspaceRevision === 'number' && payload.workspaceRevision !== scope.revision))) {
      return;
    }
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
      try {
        await ensureWorkspaceContext();
      } catch {
        // ignore
      }
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

  // Receiving content and revealing the native window are separate operations.
  // In particular, polling can recover an event after the window was hidden.
  useEffect(() => {
    if (!current || !isTauriEnv()) return;
    void invoke('reveal_notification_window')
      .catch((error) => console.error('Failed to reveal notification window', error));
  }, [current?.id, notifications.length]);

  // Auto-dismiss countdown timer
  useEffect(() => {
    if (!current || !notificationSettings.autoDismiss) {
      setProgress(100);
      return;
    }

    setProgress(100);
    const durationMs = Math.max(3, notificationSettings.durationSeconds) * 1000;
    let remainingMs = durationMs;

    const timer = window.setInterval(() => {
      if (isPausedRef.current || isSnoozeOpenRef.current) return;
      remainingMs = Math.max(0, remainingMs - TICK_INTERVAL_MS);
      setProgress((remainingMs / durationMs) * 100);
      if (remainingMs === 0) {
        clearInterval(timer);
        dismiss();
      }
    }, TICK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [current?.id, notificationSettings.autoDismiss, notificationSettings.durationSeconds, dismiss]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || !isTauriEnv()) return;
    let lastHeight = 0;
    const measure = () => {
      const height = Math.max(210, Math.ceil(content.scrollHeight) + 12);
      if (height !== lastHeight) { lastHeight = height; void ApiService.resizeNotificationWindow(height).catch(() => {}); }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content); measure();
    return () => observer.disconnect();
  }, [current?.id, notifications.length, locale, isSnoozeOpen]);

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
            {tr("common:notificationWindow.reloadDemoNotification")}</button>
        )}
      </div>
    );
  }

  const appearance = getNotificationAppearance(current.kind);
  const { Icon } = appearance;
  const { headline, dueMeta, detail } = parseNotificationContent(current);

  const createdAt = new Date(current.createdAt);
  const timeStr = Number.isNaN(createdAt.getTime())
    ? tr("common:notificationWindow.justNow")
    : createdAt.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });

  return (
    <main
      className="relative flex h-screen w-screen select-none flex-col overflow-hidden p-1.5 bg-transparent"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      data-tauri-drag-region
    >
      {/* Outer border & subtle glow wrapper (strictly contains radial lighting & avoids clipping artifacts) */}
      <div
        ref={contentRef}
        className="notification-content relative flex min-h-[198px] w-full flex-col justify-between rounded-2xl border p-3.5 transition-all duration-300"
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
                <span>{tr("common:notificationWindow.more", { value0: notifications.length - 1 })}</span>
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
                title={tr("common:notificationWindow.chooseSnoozeDuration")}
                aria-expanded={isSnoozeOpen}
              >
                <Clock className="h-3 w-3" />
                <span>{tr("common:notificationWindow.snooze")}</span>
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
              title={tr("common:notificationWindow.dismissNotification")}
              aria-label={tr("common:notificationWindow.dismissNotification")}
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
                  <span>{tr("common:notificationWindow.due", { value0: dueMeta })}</span>
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
                <span className="flex items-center gap-1 opacity-85 font-medium" title={tr("common:notificationWindow.manualDismissalIsEnabled")}>
                  <Clock className="h-3.5 w-3.5 opacity-70" />
                  <span>{tr("common:notificationWindow.waitingForDismissal")}</span>
                </span>
              ) : isPaused || isSnoozeOpen ? (
                <span className="flex items-center gap-1 font-medium" style={{ color: 'var(--accent)' }}>
                  <Pause className="h-3.5 w-3.5" />
                  <span>{isSnoozeOpen ? tr("common:notificationWindow.chooseSnoozeDuration2") : tr("common:notificationWindow.pausedWhileHovering")}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 font-medium">
                  <Clock className="h-3 w-3 opacity-60" />
                  <span>{tr("common:notificationWindow.closesInS", { value0: Math.ceil((progress / 100) * notificationSettings.durationSeconds) })}</span>
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
                {tr("common:notificationWindow.dismiss")}</button>
              <button
                type="button"
                onClick={handleOpenMain}
                className="theme-btn-primary flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold shadow-soft"
              >
                <span>{tr("common:notificationWindow.viewTask")}</span>
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
          <span className="text-sub mr-1">{tr("common:notificationWindow.testTheme")}</span>
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
