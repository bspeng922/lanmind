import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SOUND_ENABLED,
  DEFAULT_SOUND_TONE,
  NOTIFICATION_SOUND_ENABLED_KEY,
  NOTIFICATION_SOUND_TONE_KEY,
  NOTIFICATION_SOUND_TONES,
  getNotificationSoundSettings,
  isNotificationSoundTone,
  setNotificationSoundSettings,
} from './notificationSound';

test('validates recognized notification sound tones correctly', () => {
  assert.equal(isNotificationSoundTone('chime'), true);
  assert.equal(isNotificationSoundTone('gentle'), true);
  assert.equal(isNotificationSoundTone('classic'), true);
  assert.equal(isNotificationSoundTone('cyber'), true);

  assert.equal(isNotificationSoundTone('invalid-tone'), false);
  assert.equal(isNotificationSoundTone(''), false);
  assert.equal(isNotificationSoundTone(null), false);
  assert.equal(isNotificationSoundTone(undefined), false);
  assert.equal(isNotificationSoundTone(123), false);
});

test('defines all 4 tone options with non-empty descriptions', () => {
  assert.equal(NOTIFICATION_SOUND_TONES.length, 4);
  const ids = NOTIFICATION_SOUND_TONES.map((item) => item.id);
  assert.deepEqual(ids, ['chime', 'gentle', 'classic', 'cyber']);
  for (const option of NOTIFICATION_SOUND_TONES) {
    assert.ok(option.name.length > 0);
    assert.ok(option.description.length > 0);
  }
});

test('persists and retrieves sound settings with mock localStorage', () => {
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
  };

  try {
    // 1. Initial state defaults
    const initial = getNotificationSoundSettings();
    assert.equal(initial.enabled, DEFAULT_SOUND_ENABLED);
    assert.equal(initial.tone, DEFAULT_SOUND_TONE);

    // 2. Set tone to 'gentle'
    setNotificationSoundSettings({ tone: 'gentle' });
    assert.equal(store.get(NOTIFICATION_SOUND_TONE_KEY), 'gentle');
    assert.equal(getNotificationSoundSettings().tone, 'gentle');

    // 3. Disable sound
    setNotificationSoundSettings({ enabled: false });
    assert.equal(store.get(NOTIFICATION_SOUND_ENABLED_KEY), 'false');
    assert.equal(getNotificationSoundSettings().enabled, false);

    // 4. Invalid tone falls back to default
    store.set(NOTIFICATION_SOUND_TONE_KEY, 'corrupted_tone');
    assert.equal(getNotificationSoundSettings().tone, DEFAULT_SOUND_TONE);
  } finally {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  }
});
