import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampNotificationDuration,
  DEFAULT_NOTIFICATION_AUTO_DISMISS,
  DEFAULT_NOTIFICATION_DURATION_SECONDS,
  MIN_NOTIFICATION_DURATION_SECONDS,
  MAX_NOTIFICATION_DURATION_SECONDS,
  NOTIFICATION_AUTO_DISMISS_KEY,
  NOTIFICATION_DURATION_SECONDS_KEY,
  getNotificationSettings,
  setNotificationSettings,
} from './notificationSettings';

test('clampNotificationDuration enforces 3 to 30 second bounds with fallback to 10', () => {
  // Normal values within bounds
  assert.equal(clampNotificationDuration(3), 3);
  assert.equal(clampNotificationDuration(10), 10);
  assert.equal(clampNotificationDuration(15), 15);
  assert.equal(clampNotificationDuration(30), 30);

  // Fractional values round properly
  assert.equal(clampNotificationDuration(9.6), 10);
  assert.equal(clampNotificationDuration(3.2), 3);

  // Below lower bound
  assert.equal(clampNotificationDuration(2), MIN_NOTIFICATION_DURATION_SECONDS);
  assert.equal(clampNotificationDuration(0), MIN_NOTIFICATION_DURATION_SECONDS);
  assert.equal(clampNotificationDuration(-10), MIN_NOTIFICATION_DURATION_SECONDS);

  // Above upper bound
  assert.equal(clampNotificationDuration(31), MAX_NOTIFICATION_DURATION_SECONDS);
  assert.equal(clampNotificationDuration(100), MAX_NOTIFICATION_DURATION_SECONDS);

  // Invalid types fallback to default 10
  assert.equal(clampNotificationDuration(null), DEFAULT_NOTIFICATION_DURATION_SECONDS);
  assert.equal(clampNotificationDuration(undefined), DEFAULT_NOTIFICATION_DURATION_SECONDS);
  assert.equal(clampNotificationDuration(NaN), DEFAULT_NOTIFICATION_DURATION_SECONDS);
  assert.equal(clampNotificationDuration(Infinity), DEFAULT_NOTIFICATION_DURATION_SECONDS);
  assert.equal(clampNotificationDuration('15'), DEFAULT_NOTIFICATION_DURATION_SECONDS);
});

test('persists and retrieves notification settings with mock localStorage', () => {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };

  const originalWindow = globalThis.window;
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: mockStorage,
    dispatchEvent: () => true,
  };

  try {
    // 1. Initial defaults
    const initial = getNotificationSettings();
    assert.equal(initial.autoDismiss, DEFAULT_NOTIFICATION_AUTO_DISMISS);
    assert.equal(initial.durationSeconds, DEFAULT_NOTIFICATION_DURATION_SECONDS);

    // 2. Change duration to 15 seconds
    setNotificationSettings({ durationSeconds: 15 });
    assert.equal(store.get(NOTIFICATION_DURATION_SECONDS_KEY), '15');
    assert.equal(getNotificationSettings().durationSeconds, 15);
    assert.equal(getNotificationSettings().autoDismiss, true);

    // 3. Disable auto-dismiss (manual close mode)
    setNotificationSettings({ autoDismiss: false });
    assert.equal(store.get(NOTIFICATION_AUTO_DISMISS_KEY), 'false');
    assert.equal(getNotificationSettings().autoDismiss, false);
    assert.equal(getNotificationSettings().durationSeconds, 15);

    // 4. Clamping on setNotificationSettings
    setNotificationSettings({ durationSeconds: 50 });
    assert.equal(getNotificationSettings().durationSeconds, 30);

    setNotificationSettings({ durationSeconds: 1 });
    assert.equal(getNotificationSettings().durationSeconds, 3);

    // 5. Enable auto-dismiss again
    setNotificationSettings({ autoDismiss: true, durationSeconds: 10 });
    assert.equal(getNotificationSettings().autoDismiss, true);
    assert.equal(getNotificationSettings().durationSeconds, 10);
  } finally {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  }
});
