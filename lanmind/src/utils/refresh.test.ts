import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coalesceRefresh, visiblePolling } from './refresh';
test('refresh bursts serialize, retain changes arriving in flight, and recover after errors', async () => {
    let calls = 0;
    let active = 0;
    let maximum = 0;
    let release: (() => void) | undefined;
    const refresh = coalesceRefresh(async () => { calls++; maximum = Math.max(maximum, ++active); if (calls === 1)
        await new Promise<void>(resolve => { release = resolve; }); active--; });
    const first = refresh();
    const second = refresh();
    refresh();
    release!();
    await Promise.all([first, second]);
    assert.equal(calls, 2);
    assert.equal(maximum, 1);
    let fail = true;
    const retry = coalesceRefresh(async () => { if (fail)
        throw new Error('failed'); });
    await assert.rejects(retry());
    fail = false;
    await retry();
});
test('polling pauses while hidden, catches up on visibility, and cancels queued work on cleanup', async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const documentMock = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
    let tick: () => void = () => { };
    let cleared = false;
    let starts = 0;
    let calls = 0;
    let release: () => void = () => { };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
            setInterval: (callback: () => void) => { starts++; tick = callback; return starts; },
            clearInterval: () => { cleared = true; },
        } });
    let stop = () => { };
    try {
        stop = visiblePolling(async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); }, 5000);
        tick();
        await new Promise(setImmediate);
        assert.equal(calls, 0);
        assert.equal(starts, 0, 'hidden windows do not schedule interval wake-ups');
        documentMock.visibilityState = 'visible';
        documentMock.dispatchEvent(new Event('visibilitychange'));
        assert.equal(calls, 1);
        assert.equal(starts, 1);
        documentMock.visibilityState = 'hidden';
        documentMock.dispatchEvent(new Event('visibilitychange'));
        assert.equal(cleared, true, 'hiding cancels the existing interval');
        documentMock.visibilityState = 'visible';
        documentMock.dispatchEvent(new Event('visibilitychange'));
        assert.equal(starts, 2, 'resuming starts only one new interval');
        documentMock.dispatchEvent(new Event('visibilitychange'));
        assert.equal(starts, 2);
        tick();
        tick();
        assert.equal(calls, 1);
        stop();
        release();
        await new Promise(setImmediate);
        documentMock.dispatchEvent(new Event('visibilitychange'));
        tick();
        await new Promise(setImmediate);
        assert.equal(calls, 1);
        assert.equal(cleared, true);
    }
    finally {
        stop();
        if (previousWindow)
            Object.defineProperty(globalThis, 'window', previousWindow);
        else
            Reflect.deleteProperty(globalThis, 'window');
        if (previousDocument)
            Object.defineProperty(globalThis, 'document', previousDocument);
        else
            Reflect.deleteProperty(globalThis, 'document');
    }
});
