/** Let input and rendering run between slices of expensive, asynchronous work. */
export function yieldToMainThread(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}
