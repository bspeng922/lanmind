import { useEffect, useRef } from 'react';

export type StartupLockView = 'unlocked' | 'locked' | 'error';

// Initial lock and identity reads run independently. Only dismiss the startup
// cover over a painted final view; a real error must allow a visible retry.
export function AppStartupReady({ lockView, sessionReady, onReady }: { lockView: StartupLockView | null; sessionReady: boolean; onReady?: () => void }) {
  const revealed = useRef(false);
  const ready = lockView === 'locked' || lockView === 'error' || (lockView === 'unlocked' && sessionReady);
  useEffect(() => {
    if (!ready || !onReady || revealed.current) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => { revealed.current = true; onReady(); });
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [ready, onReady]);
  return null;
}
