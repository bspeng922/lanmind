/**
 * notificationAppearance.ts — Pure aesthetic and parsing helpers for desktop notifications.
 *
 * CALLING SPEC:
 *   getNotificationAppearance(kind: NotificationKind): NotificationAppearance
 *   parseNotificationContent(notification: DesktopNotification): { headline, dueMeta, detail }
 *   SNOOZE_OPTIONS: readonly SnoozeOption[]
 *   DEMO_NOTIFICATIONS: DesktopNotification[]
 */

import { AlarmClock, Bell, CheckCircle2, MessageSquare } from 'lucide-react';
import { tr } from '../i18n';
import type { ThemeId, ThemePreference } from '../types';

export type NotificationKind = 'assignment' | 'message' | 'reminder';

export interface DesktopNotification {
  feature?: 'chat';
  workspaceId?: string;
  workspaceRevision?: number;
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  themeId?: ThemeId;
  themePreference?: ThemePreference;
}

export interface NotificationAppearance {
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

export function getNotificationAppearance(kind: NotificationKind): NotificationAppearance {
  switch (kind) {
    case 'reminder':
      return {
        Icon: AlarmClock,
        badgeLabel: tr('common:notificationWindow.taskReminder'),
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
        badgeLabel: tr('common:notificationWindow.taskAssignment'),
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
        badgeLabel: tr('common:notificationWindow.newMessage'),
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
        badgeLabel: tr('common:notificationWindow.notification'),
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
        dueMeta: lines[1].replace(/^(?:到期时间|Due)[：:]\s*/i, ''),
        detail: lines.slice(2).join(' ') || null,
      };
    }
    if (lines.length === 1) {
      if (/^(?:到期时间|Due)[：:]/i.test(lines[0])) {
        return { headline: title, dueMeta: lines[0].replace(/^(?:到期时间|Due)[：:]\s*/i, ''), detail: null };
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

export interface SnoozeOption {
  label: string;
  minutes: number;
}

export const SNOOZE_OPTIONS: readonly SnoozeOption[] = [
  { get label() { return tr('common:notificationWindow.in5Minutes'); }, minutes: 5 },
  { get label() { return tr('common:notificationWindow.in10Minutes'); }, minutes: 10 },
  { get label() { return tr('common:notificationWindow.in15Minutes'); }, minutes: 15 },
] as const;

export const DEMO_NOTIFICATIONS: DesktopNotification[] = [
  {
    id: 'demo-reminder-1',
    kind: 'reminder',
    get title() { return tr('common:notificationWindow.taskDueReminder'); },
    get body() { return tr('common:notificationWindow.finishArchitectureDesignAndReviewDueToday'); },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'demo-assignment-2',
    kind: 'assignment',
    get title() { return tr('common:notificationWindow.liAssignedANewTask'); },
    get body() { return tr('common:notificationWindow.fixAndVerifyReconnectionAfterALan'); },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'demo-message-3',
    kind: 'message',
    get title() { return tr('common:notificationWindow.newMessageFromWang'); },
    get body() { return tr('common:notificationWindow.areTheMilestonePresentationMaterialsReadyFor'); },
    createdAt: new Date().toISOString(),
  },
];

