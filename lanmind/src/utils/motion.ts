/** Resolve at the time of scrolling so system preference changes take effect immediately. */
export function preferredScrollBehavior(smooth = true): ScrollBehavior {
  return smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto';
}
