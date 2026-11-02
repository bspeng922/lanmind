import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { tr } from '../i18n';

export function PluginDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const id = useId(); const root = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const elements = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])].filter(el => el.getClientRects().length);
      if (!elements.length) { event.preventDefault(); root.current?.focus(); return; }
      const first = elements[0], last = elements.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-5" onMouseDown={event => { if (event.target === event.currentTarget) close.current(); }}>
      <div ref={root} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-edge bg-surface text-main shadow-xl outline-none">
        <div className="flex items-center justify-between gap-4 border-b border-edge px-6 py-4">
          <h2 id={id} className="text-base font-semibold">{title}</h2>
          <button type="button" aria-label={tr('settings:pluginCenter.close')} onClick={onClose} className="rounded-md p-1 text-sub hover:bg-hover"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-5 overflow-y-auto p-6">{children}</div>
      </div>
    </div>, document.body,
  );
}
