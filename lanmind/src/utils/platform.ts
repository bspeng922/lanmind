/**
 * Platform detection and OS-specific formatting utilities.
 *
 * CALLING SPEC:
 *   import { getPlatform, isMacOS, isWindows, isLinux, formatShortcutKey } from './platform';
 *
 *   const os = await getPlatform(); // 'windows' | 'macos' | 'linux' | string
 *   const mac = isMacOS();           // boolean (sync check based on UA or cached backend)
 *   const win = isWindows();         // boolean
 *   const lnx = isLinux();           // boolean
 *   const key = formatShortcutKey('Ctrl+Shift+F'); // '⌘+Shift+F' on mac, 'Ctrl+Shift+F' on win
 */

import { isTauri, invoke } from '@tauri-apps/api/core';

let cachedPlatform: string | null = null;

function detectPlatformFromNavigator(): string {
  if (typeof navigator === 'undefined') return 'windows';
  const ua = navigator.userAgent.toLowerCase();
  const plat = (navigator.platform || '').toLowerCase();
  if (plat.includes('mac') || ua.includes('macintosh') || ua.includes('mac os')) {
    return 'macos';
  }
  if (plat.includes('linux') || ua.includes('linux')) {
    return 'linux';
  }
  return 'windows';
}

export async function getPlatform(): Promise<string> {
  if (cachedPlatform) {
    return cachedPlatform;
  }
  if (isTauri()) {
    try {
      const p = await invoke<string>('get_platform');
      cachedPlatform = p.toLowerCase();
      return cachedPlatform;
    } catch {
      // Fallback to browser navigator
    }
  }
  cachedPlatform = detectPlatformFromNavigator();
  return cachedPlatform;
}

export function isMacOS(): boolean {
  if (cachedPlatform) {
    return cachedPlatform === 'macos' || cachedPlatform === 'darwin';
  }
  return detectPlatformFromNavigator() === 'macos';
}

export function isWindows(): boolean {
  if (cachedPlatform) {
    return cachedPlatform === 'windows';
  }
  return detectPlatformFromNavigator() === 'windows';
}

export function isLinux(): boolean {
  if (cachedPlatform) {
    return cachedPlatform === 'linux';
  }
  return detectPlatformFromNavigator() === 'linux';
}

/**
 * Formats keyboard shortcut strings for the user's OS.
 * Converts 'Ctrl' or 'CommandOrControl' to '⌘' on macOS.
 */
export function formatShortcutKey(shortcut: string, isMac: boolean = isMacOS()): string {
  if (!shortcut) return '';
  if (isMac) {
    return shortcut
      .replace(/\b(CommandOrControl|Ctrl|Control)\b/gi, '⌘')
      .replace(/\bAlt\b/gi, '⌥')
      .replace(/\bShift\b/gi, '⇧');
  }
  return shortcut.replace(/\bCommandOrControl\b/gi, 'Ctrl');
}
