/**
 * notificationSettings.ts — System notification auto-dismiss and countdown duration configuration.
 *
 * CALLING SPEC:
 *   import {
 *     getNotificationSettings,
 *     setNotificationSettings,
 *     clampNotificationDuration,
 *     DEFAULT_NOTIFICATION_AUTO_DISMISS,
 *     DEFAULT_NOTIFICATION_DURATION_SECONDS,
 *     MIN_NOTIFICATION_DURATION_SECONDS,
 *     MAX_NOTIFICATION_DURATION_SECONDS,
 *     type NotificationSettings,
 *   } from './utils/notificationSettings';
 *
 *   const { autoDismiss, durationSeconds } = getNotificationSettings();
 *   setNotificationSettings({ autoDismiss: false, durationSeconds: 15 });
 *
 * TOOL CONTRACT:
 *   - Input: Partial<NotificationSettings>
 *   - Output: NotificationSettings with valid bounds
 *   - Side effects: Reads/writes localStorage keys, emits cross-window events
 *   - Deterministic: Clamping produces identical numbers for given inputs
 */

import { emit } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';

export interface NotificationSettings {
  autoDismiss: boolean;
  durationSeconds: number;
}

export const NOTIFICATION_AUTO_DISMISS_KEY = 'lanmind_notification_auto_dismiss';
export const NOTIFICATION_DURATION_SECONDS_KEY = 'lanmind_notification_duration_seconds';

export const DEFAULT_NOTIFICATION_AUTO_DISMISS = true;
export const DEFAULT_NOTIFICATION_DURATION_SECONDS = 10;
export const MIN_NOTIFICATION_DURATION_SECONDS = 3;
export const MAX_NOTIFICATION_DURATION_SECONDS = 30;

export const NOTIFICATION_SETTINGS_CHANGED_EVENT = 'notification://settings-changed';

/**
 * Pure function: Clamps a duration in seconds between 3 and 30, fallback to default 10.
 */
export function clampNotificationDuration(seconds: unknown): number {
  if (typeof seconds !== 'number' || Number.isNaN(seconds) || !Number.isFinite(seconds)) {
    return DEFAULT_NOTIFICATION_DURATION_SECONDS;
  }
  const rounded = Math.round(seconds);
  return Math.max(
    MIN_NOTIFICATION_DURATION_SECONDS,
    Math.min(MAX_NOTIFICATION_DURATION_SECONDS, rounded),
  );
}

/**
 * Read notification settings from localStorage.
 */
export function getNotificationSettings(): NotificationSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {
      autoDismiss: DEFAULT_NOTIFICATION_AUTO_DISMISS,
      durationSeconds: DEFAULT_NOTIFICATION_DURATION_SECONDS,
    };
  }

  const rawAutoDismiss = window.localStorage.getItem(NOTIFICATION_AUTO_DISMISS_KEY);
  const autoDismiss =
    rawAutoDismiss === null ? DEFAULT_NOTIFICATION_AUTO_DISMISS : rawAutoDismiss === 'true';

  const rawSeconds = window.localStorage.getItem(NOTIFICATION_DURATION_SECONDS_KEY);
  const durationSeconds =
    rawSeconds === null
      ? DEFAULT_NOTIFICATION_DURATION_SECONDS
      : clampNotificationDuration(Number(rawSeconds));

  return { autoDismiss, durationSeconds };
}

/**
 * Persist notification settings to localStorage and notify all windows.
 */
export function setNotificationSettings(settings: Partial<NotificationSettings>): NotificationSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {
      autoDismiss: settings.autoDismiss ?? DEFAULT_NOTIFICATION_AUTO_DISMISS,
      durationSeconds: clampNotificationDuration(settings.durationSeconds),
    };
  }

  const current = getNotificationSettings();
  const nextAutoDismiss =
    settings.autoDismiss !== undefined ? settings.autoDismiss : current.autoDismiss;
  const nextDurationSeconds =
    settings.durationSeconds !== undefined
      ? clampNotificationDuration(settings.durationSeconds)
      : current.durationSeconds;

  window.localStorage.setItem(NOTIFICATION_AUTO_DISMISS_KEY, String(nextAutoDismiss));
  window.localStorage.setItem(NOTIFICATION_DURATION_SECONDS_KEY, String(nextDurationSeconds));

  const updated: NotificationSettings = {
    autoDismiss: nextAutoDismiss,
    durationSeconds: nextDurationSeconds,
  };

  // Dispatch local window event
  window.dispatchEvent(
    new CustomEvent('lanmind-notification-settings-change', { detail: updated }),
  );

  // Broadcast to other Tauri windows
  if (isTauri()) {
    emit(NOTIFICATION_SETTINGS_CHANGED_EVENT, updated).catch((err) => {
      console.warn('Failed to broadcast notification settings change event:', err);
    });
  }

  return updated;
}
