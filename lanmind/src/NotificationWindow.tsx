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
 *   - Auto-dismisses after 8s with countdown progress bar (pauses on hover).
 *   - Plays a harmonious two-tone chime upon arrival.
 *   - When in standalone browser mode, provides interactive demo cards & theme switcher.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  AlarmClock,
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock3,
  MessageSquare,
  Pause,
  Sparkles,
  X,
} from 'lucide-react';
import { useTheme } from './context/ThemeContext';
import { ThemeId, ThemePreference } from './types';

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
        badgeClass: 'bg-amber-500/15 text-amber-500 dark:text-amber-300 border-amber-500/30',
        iconClass: 'text-amber-500 dark:text-amber-400',
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
        badgeClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
        iconClass: 'text-emerald-600 dark:text-emerald-400',
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
        badgeClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30',
        iconClass: 'text-sky-600 dark:text-sky-400',
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
        badgeClass: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30',
        iconClass: 'text-slate-600 dark:text-slate-300',
        iconBg: 'bg-slate-500/10 border border-slate-500/25 shadow-none',
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

/**
 * Pure function: Play harmonious two-tone notification chime.
 */
export function playNotificationSound(): void {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const context = new AudioCtx();
    const now = context.currentTime;

    const playTone = (freq: number, start: number, dur: number, peakGain: number) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(start);
      osc.stop(start + dur);
    };

    // Harmonic bell: E5 (659Hz) -> A5 (880Hz)
    playTone(659.25, now, 0.35, 0.12);
    playTone(880.0, now + 0.09, 0.42, 0.15);

    setTimeout(() => {
      void context.close().catch(() => {});
    }, 800);
  } catch (error) {
    console.warn('Failed to play notification sound', error);
  }
}

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

const AUTO_DISMISS_MS = 8000;
const TICK_INTERVAL_MS = 50;

export function NotificationWindow() {
  const { currentTheme, setThemeId, allThemes } = useTheme();
  const [notifications, setNotifications] = useState<DesktopNotification[]>(() =>
    isTauriEnv() ? [] : DEMO_NOTIFICATIONS,
  );
  const [progress, setProgress] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

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

  // Tauri events listener
  useEffect(() => {
    if (!isTauriEnv()) return;

    let disposed = false;
    let unlistenShow: (() => void) | undefined;
    let unlistenDismiss: (() => void) | undefined;

    listen<DesktopNotification>('notification://show', (event) => {
      if (disposed) return;
      const requestedTheme = event.payload.themePreference || event.payload.themeId;
      if (requestedTheme) {
        setThemeId(requestedTheme);
      }
      setNotifications((prev) => {
        if (prev.some((n) => n.id === event.payload.id)) return prev;
        return [...prev, event.payload].slice(-50);
      });
      playNotificationSound();
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlistenShow = dispose;
      void invoke('notification_window_ready').catch((error) =>
        console.error('Failed to initialize notification window', error),
      );
    });

    listen('notification://dismiss-current', dismiss).then((dispose) => {
      if (disposed) dispose();
      else unlistenDismiss = dispose;
    });

    return () => {
      disposed = true;
      unlistenShow?.();
      unlistenDismiss?.();
    };
  }, [dismiss, setThemeId]);

  // Auto-dismiss countdown timer
  useEffect(() => {
    if (!current) {
      setProgress(100);
      return;
    }

    setProgress(100);
    const decrement = (TICK_INTERVAL_MS / AUTO_DISMISS_MS) * 100;

    const timer = window.setInterval(() => {
      if (isPausedRef.current) return;
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
  }, [current?.id, dismiss]);

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
      {/* Decorative radial lighting */}
      <div
        className="pointer-events-none absolute inset-0 opacity-70 transition-all duration-500 rounded-2xl"
        style={{
          background: appearance.radialGradient,
        }}
      />

      {/* Outer border & subtle glow wrapper */}
      <div
        className="relative flex h-full w-full flex-col justify-between rounded-2xl border p-3.5 shadow-2xl backdrop-blur-xl transition-all duration-300"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-main)',
          color: 'var(--text-main)',
          boxShadow: `var(--card-shadow), 0 0 20px -4px ${appearance.shadowGlow}`,
        }}
      >
        {/* Top Header Row */}
        <div className="flex items-center justify-between gap-2">
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

          {/* Close button */}
          <button
            type="button"
            onClick={dismiss}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-black/10 dark:hover:bg-white/10"
            style={{ color: 'var(--text-sub)' }}
            title="关闭提醒"
            aria-label="关闭提醒"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Content Body Area */}
        <div className="my-auto flex items-start gap-3 py-1">
          {/* Main icon */}
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${appearance.iconBg}`}
          >
            <Icon className={`h-5 w-5 ${appearance.iconClass}`} />
          </div>

          <div className="min-w-0 flex-1">
            {/* Primary Headline / Task Title */}
            <h1
              className="line-clamp-1 text-sm font-semibold"
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

        {/* Footer Actions Row */}
        <div className="flex items-center justify-between pt-1 text-xs">
          {/* Left: Pause / Countdown status */}
          <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-sub)' }}>
            {isPaused ? (
              <span className="flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                <Pause className="h-3 w-3" />
                <span>悬停已暂停</span>
              </span>
            ) : (
              <span>
                {Math.ceil((progress / 100) * (AUTO_DISMISS_MS / 1000))}s 后自动关闭
              </span>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={dismiss}
              className="ui-cancel-button px-2.5 py-1 text-xs rounded-lg font-medium"
            >
              知道了
            </button>
            <button
              type="button"
              onClick={handleOpenMain}
              className="theme-btn-primary flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold"
            >
              <span>查看任务</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Bottom Countdown Progress Bar (Inset capsule to stay within panel bounds and 4px thick) */}
        <div
          className="absolute bottom-2 left-4 right-4 h-[4px] overflow-hidden rounded-full"
          style={{ backgroundColor: 'var(--border-subtle)' }}
        >
          <div
            className="h-full rounded-full transition-all ease-linear"
            style={{
              width: `${progress}%`,
              background: appearance.progressGradient,
              boxShadow: isPaused ? `0 0 8px ${appearance.borderGlow}` : 'none',
              transitionDuration: `${TICK_INTERVAL_MS}ms`,
            }}
          />
        </div>
      </div>

      {/* Standalone browser mode: Mini theme test dock */}
      {!isTauriEnv() && (
        <div className="mt-2 flex items-center justify-center gap-1 text-[10px]">
          <span className="text-slate-400 mr-1">切换主题测试:</span>
          {allThemes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setThemeId(t.id)}
              className={`px-1.5 py-0.5 rounded border transition-all ${
                currentTheme.id === t.id
                  ? 'border-blue-400 bg-blue-500/20 text-blue-300 font-bold'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
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
