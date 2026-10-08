import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

async function revealMainWindow() {
  try { await invoke('main_window_ready'); }
  catch (error) {
    console.error('Failed to show the startup window', error);
    await getCurrentWindow().show().catch((showError) => console.error('Failed to reveal the main window', showError));
  }
}

// Show the branded cover as soon as it is painted. Keep it over initialization
// and the lock shield until the final view is ready, including on fast launches.
export function createAppStartup({ desktop = isTauri(), reveal = revealMainWindow }: { desktop?: boolean; reveal?: () => Promise<void> } = {}) {
  let starting: Promise<number> | undefined;
  let finishing: Promise<void> | undefined;
  const start = () => starting ??= (async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (desktop) await reveal();
    return performance.now();
  })();
  const finish = () => finishing ??= (async () => {
    const shownAt = await start();
    const remaining = Math.max(0, 650 - (performance.now() - shownAt));
    if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
    document.getElementById('app-splash')?.remove();
  })();
  return { start, finish };
}
