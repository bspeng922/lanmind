const isWindowControl = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement && element.closest('.window-control-button') !== null;

export const blurWindowControlFocus = (): void => {
  const activeElement = document.activeElement;
  if (isWindowControl(activeElement)) {
    activeElement.blur();
  }
};

/**
 * Clear stale :focus AND :hover states from window-control-buttons after the
 * native window is shown from the system tray.
 *
 * CALLING SPEC:
 *   const cancel = scheduleWindowControlFocusReset();
 *   // later, to tear down all listeners/timers:
 *   cancel();
 *
 * FOCUS — WebView2 can asynchronously restore the previously focused element
 * after the native activation sequence. Staggered timeouts + a
 * visibilitychange listener cover the full range of restoration delays.
 *
 * HOVER — When a window is hidden while the cursor hovers a button, WebView2
 * freezes the CSS :hover pseudo-class. There is no JS API to clear :hover.
 * Instead, the class `window-controls-hover-suppressed` is added to
 * `<html>`, overriding hover styles to match the default appearance.  The
 * class is removed on the first `pointermove`, at which point the browser
 * has recalculated hover targets from the real cursor position.
 */
export const scheduleWindowControlFocusReset = (): (() => void) => {
  blurWindowControlFocus();

  // --- Suppress stale :hover highlights ---
  document.documentElement.classList.add('window-controls-hover-suppressed');
  const onPointerMove = () => {
    document.documentElement.classList.remove('window-controls-hover-suppressed');
  };
  window.addEventListener('pointermove', onPointerMove, { once: true });

  // --- Clear stale :focus ---
  const frameId = window.requestAnimationFrame(blurWindowControlFocus);
  const timeoutId = window.setTimeout(blurWindowControlFocus, 0);
  const earlyTimeoutId = window.setTimeout(blurWindowControlFocus, 50);
  const delayedTimeoutId = window.setTimeout(blurWindowControlFocus, 300);

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      blurWindowControlFocus();
      window.setTimeout(blurWindowControlFocus, 50);
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.cancelAnimationFrame(frameId);
    window.clearTimeout(timeoutId);
    window.clearTimeout(earlyTimeoutId);
    window.clearTimeout(delayedTimeoutId);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.documentElement.classList.remove('window-controls-hover-suppressed');
    window.removeEventListener('pointermove', onPointerMove);
  };
};

