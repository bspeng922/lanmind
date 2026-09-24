const isWindowControl = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement && element.closest('.window-control-button') !== null;

export const blurWindowControlFocus = (): void => {
  const activeElement = document.activeElement;
  if (isWindowControl(activeElement)) {
    activeElement.blur();
  }
};

/**
 * Native window activation and DOM focus do not always happen in the same
 * event loop turn. Clear immediately and once after the next paint so a
 * hidden window cannot restore a title-bar button as focused.
 */
export const scheduleWindowControlFocusReset = (): (() => void) => {
  blurWindowControlFocus();

  const frameId = window.requestAnimationFrame(blurWindowControlFocus);
  const timeoutId = window.setTimeout(blurWindowControlFocus, 0);

  return () => {
    window.cancelAnimationFrame(frameId);
    window.clearTimeout(timeoutId);
  };
};
