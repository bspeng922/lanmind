/** Serialize refreshes and retain one trailing refresh for events received in flight. */
export function coalesceRefresh(work: () => Promise<void>): () => Promise<void> {
    let running: Promise<void> | null = null;
    let pending = false;
    return () => {
        pending = true;
        if (!running)
            running = (async () => {
                do {
                    pending = false;
                    await work();
                } while (pending);
            })().finally(() => { running = null; });
        return running;
    };
}
/** Hidden webviews catch up when visible instead of polling unchanged UI state. */
export function visiblePolling(refresh: () => Promise<unknown>, interval: number): () => void {
    let stopped = false;
    let timer: number | undefined;
    const refreshOnce = coalesceRefresh(async () => {
        if (!stopped && document.visibilityState !== 'hidden')
            await refresh();
    });
    const tick = () => { void refreshOnce().catch(() => { }); };
    const pause = () => {
        if (timer !== undefined) window.clearInterval(timer);
        timer = undefined;
    };
    const start = () => {
        if (!stopped && timer === undefined && document.visibilityState !== 'hidden')
            timer = window.setInterval(tick, interval);
    };
    const visible = () => {
        if (document.visibilityState === 'hidden') pause();
        else { start(); tick(); }
    };
    start();
    document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; pause(); document.removeEventListener('visibilitychange', visible); };
}
