import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { APP_TOAST_EVENT, type AppToastDetail } from '../utils/toast';

export const AppToastHost: React.FC = () => {
  const [toast, setToast] = useState<AppToastDetail | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent<AppToastDetail>).detail;
      if (!detail?.message) return;
      if (timer !== undefined) window.clearTimeout(timer);
      setToast(detail);
      timer = window.setTimeout(() => {
        setToast((current) => (current?.id === detail.id ? null : current));
      }, Math.max(800, detail.durationMs || 2200));
    };
    window.addEventListener(APP_TOAST_EVENT, handleToast);
    return () => {
      window.removeEventListener(APP_TOAST_EVENT, handleToast);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  if (!toast || typeof document === 'undefined') return null;

  const Icon =
    toast.tone === 'error'
      ? AlertCircle
      : toast.tone === 'info'
        ? Info
        : CheckCircle2;

  const iconClass =
    toast.tone === 'error'
      ? 'text-danger'
      : toast.tone === 'info'
        ? 'text-accent-text'
        : 'text-success';

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[160] -translate-x-1/2 px-4"
    >
      <div
        key={toast.id}
        className="flex items-center gap-2 rounded-xl border border-edge bg-elevated px-3.5 py-2 text-xs font-medium text-main shadow-popover animate-in fade-in slide-in-from-bottom-2 duration-150"
      >
        <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} aria-hidden="true" />
        <span className="whitespace-nowrap">{toast.message}</span>
      </div>
    </div>,
    document.body,
  );
};
