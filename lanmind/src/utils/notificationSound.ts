/**
 * notificationSound.ts — Web Audio synthesized notification sound utility.
 *
 * CALLING SPEC:
 *   import {
 *     NOTIFICATION_SOUND_TONES,
 *     getNotificationSoundSettings,
 *     setNotificationSoundSettings,
 *     playNotificationSound,
 *     previewNotificationSound,
 *     type NotificationSoundTone,
 *   } from './utils/notificationSound';
 *
 *   const { enabled, tone } = getNotificationSoundSettings();
 *   setNotificationSoundSettings({ enabled: true, tone: 'gentle' });
 *   playNotificationSound(); // Plays configured tone if enabled
 *   previewNotificationSound('classic'); // Auditions tone unconditionally
 *
 * TOOL CONTRACT:
 *   - Input: Sound tone identifier ('chime' | 'gentle' | 'classic' | 'cyber')
 *   - Output: Audio playback via Web Audio API (or silent fallback if unavailable)
 *   - Side effects: Reads/writes localStorage keys
 *   - Deterministic: Same tone reproduces identical acoustic waveforms without external assets
 */

export type NotificationSoundTone = 'chime' | 'gentle' | 'classic' | 'cyber';

export interface NotificationSoundOption {
  id: NotificationSoundTone;
  name: string;
  description: string;
}

export const NOTIFICATION_SOUND_TONES: readonly NotificationSoundOption[] = [
  {
    id: 'chime',
    name: '清脆双音（默认）',
    description: '轻盈通透的二度双音，适合敏捷任务提醒',
  },
  {
    id: 'gentle',
    name: '轻柔提示',
    description: '温和木琴三和弦，柔和不刺耳',
  },
  {
    id: 'classic',
    name: '经典钟声',
    description: '醇厚清朗的前奏钟音，庄重清晰',
  },
  {
    id: 'cyber',
    name: '灵动科技',
    description: '未来感微频跃升音，富有数字活力',
  },
] as const;

export const NOTIFICATION_SOUND_ENABLED_KEY = 'lanmind_notification_sound_enabled';
export const NOTIFICATION_SOUND_TONE_KEY = 'lanmind_notification_sound_tone';

export const DEFAULT_SOUND_ENABLED = true;
export const DEFAULT_SOUND_TONE: NotificationSoundTone = 'chime';

const VALID_TONES = new Set<string>(NOTIFICATION_SOUND_TONES.map((item) => item.id));

/**
 * Pure function: Validate if a string is a recognized sound tone.
 */
export function isNotificationSoundTone(value: unknown): value is NotificationSoundTone {
  return typeof value === 'string' && VALID_TONES.has(value);
}

/**
 * Get notification sound configuration from localStorage.
 */
export function getNotificationSoundSettings(): {
  enabled: boolean;
  tone: NotificationSoundTone;
} {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { enabled: DEFAULT_SOUND_ENABLED, tone: DEFAULT_SOUND_TONE };
  }

  const rawEnabled = window.localStorage.getItem(NOTIFICATION_SOUND_ENABLED_KEY);
  const enabled = rawEnabled === null ? DEFAULT_SOUND_ENABLED : rawEnabled === 'true';

  const rawTone = window.localStorage.getItem(NOTIFICATION_SOUND_TONE_KEY);
  const tone = isNotificationSoundTone(rawTone) ? rawTone : DEFAULT_SOUND_TONE;

  return { enabled, tone };
}

/**
 * Persist notification sound configuration to localStorage.
 */
export function setNotificationSoundSettings(settings: {
  enabled?: boolean;
  tone?: NotificationSoundTone;
}): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  if (settings.enabled !== undefined) {
    window.localStorage.setItem(NOTIFICATION_SOUND_ENABLED_KEY, String(settings.enabled));
  }
  if (settings.tone !== undefined && isNotificationSoundTone(settings.tone)) {
    window.localStorage.setItem(NOTIFICATION_SOUND_TONE_KEY, settings.tone);
  }
}

/**
 * Synthesize and play an audio tone using the standard Web Audio API.
 */
function synthesizeTone(tone: NotificationSoundTone, volume = 0.15): void {
  if (typeof window === 'undefined') return;

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const context = new AudioCtx();
    const now = context.currentTime;

    const playVoice = (
      freq: number,
      start: number,
      duration: number,
      peakGain: number,
      type: OscillatorType = 'sine',
    ) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(start);
      osc.stop(start + duration);
    };

    switch (tone) {
      case 'chime':
        // Harmonic bell chime: E5 (659Hz) -> A5 (880Hz)
        playVoice(659.25, now, 0.35, volume * 0.85);
        playVoice(880.0, now + 0.09, 0.45, volume);
        setTimeout(() => void context.close().catch(() => {}), 700);
        break;

      case 'gentle':
        // Soft acoustic triad: C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz)
        playVoice(523.25, now, 0.28, volume * 0.7);
        playVoice(659.25, now + 0.08, 0.32, volume * 0.8);
        playVoice(783.99, now + 0.16, 0.48, volume * 0.9);
        setTimeout(() => void context.close().catch(() => {}), 800);
        break;

      case 'classic':
        // Deep classic resonant bell: G4 (392Hz) -> C5 (523Hz) with octave warmth
        playVoice(392.0, now, 0.42, volume * 0.9);
        playVoice(784.0, now, 0.3, volume * 0.25, 'triangle');
        playVoice(523.25, now + 0.14, 0.58, volume);
        playVoice(1046.5, now + 0.14, 0.38, volume * 0.3, 'triangle');
        setTimeout(() => void context.close().catch(() => {}), 900);
        break;

      case 'cyber': {
        // Modern sweep and digital spark
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1400, now + 0.08);
        osc.frequency.exponentialRampToValueAtTime(1050, now + 0.22);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(volume * 0.9, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

        osc.connect(gain);
        gain.connect(context.destination);
        osc.start(now);
        osc.stop(now + 0.35);

        // Subtle harmonic overtone
        playVoice(1760, now + 0.06, 0.2, volume * 0.3, 'sine');
        setTimeout(() => void context.close().catch(() => {}), 600);
        break;
      }
    }
  } catch (error) {
    console.warn('Failed to synthesize notification sound', error);
  }
}

/**
 * Preview / audition a specific tone regardless of the global sound switch.
 */
export function previewNotificationSound(tone: NotificationSoundTone): void {
  synthesizeTone(tone, 0.16);
}

/**
 * Play notification sound according to persisted user preferences.
 * If user has disabled sounds, this is a no-op.
 */
export function playNotificationSound(explicitTone?: NotificationSoundTone): void {
  const { enabled, tone } = getNotificationSoundSettings();
  if (!enabled) return;
  synthesizeTone(explicitTone || tone, 0.15);
}
