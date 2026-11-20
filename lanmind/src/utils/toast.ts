export type ToastTone = 'success' | 'info' | 'error';

export interface AppToastDetail {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
}

export const APP_TOAST_EVENT = 'lanmind:toast';

let nextToastId = 1;

export function showToast(
  message: string,
  tone: ToastTone = 'success',
  durationMs = 2200,
): void {
  if (typeof window === 'undefined' || !message.trim()) return;
  const detail: AppToastDetail = {
    id: nextToastId++,
    message,
    tone,
    durationMs,
  };
  window.dispatchEvent(new CustomEvent<AppToastDetail>(APP_TOAST_EVENT, { detail }));
}
