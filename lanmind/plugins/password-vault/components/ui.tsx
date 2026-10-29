import React, { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { tr } from '../../../src/i18n';
import { ThemeSelect } from '../../../src/components/ThemeSelect';
import { folderPath, type VaultFolder } from '../client';

export const inputClass = 'w-full rounded-xl border border-edge bg-canvas px-3.5 py-2 text-xs text-main placeholder:text-quiet outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all';
export const textareaClass = 'w-full rounded-xl border border-edge bg-canvas px-3.5 py-2.5 text-xs text-main placeholder:text-quiet outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all custom-scrollbar';

const sharedButtonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer';
export const buttonClass = `${sharedButtonClass} border border-edge bg-surface text-main hover:bg-hover hover:border-edge-focus shadow-soft`;
export const primaryClass = `${sharedButtonClass} theme-btn-primary font-bold shadow-soft`;
export const dangerButtonClass = `${sharedButtonClass} border border-rose-500/30 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 shadow-soft`;

export function Button({
  children,
  primary = false,
  danger = false,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) {
  const chosenClass = danger ? dangerButtonClass : primary ? primaryClass : buttonClass;
  return (
    <button type="button" {...props} className={`${chosenClass} ${className}`}>
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  key?: string | number;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-sub">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Check({
  label,
  checked,
  onChange,
  description,
}: {
  key?: string | number;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}) {
  return (
    <label className="flex items-start gap-2.5 text-xs font-medium text-main cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded accent-accent mt-0.5 cursor-pointer"
      />
      <div className="flex flex-col min-w-0">
        <span>{label}</span>
        {description && <span className="text-[11px] text-sub mt-0.5 font-normal">{description}</span>}
      </div>
    </label>
  );
}

export function FolderSelect({
  folders,
  value,
  onChange,
  exclude,
  emptyLabel,
  ariaLabel,
  portal = true,
}: {
  folders: VaultFolder[];
  value: string | null;
  onChange: (value: string | null) => void;
  exclude?: Set<string>;
  emptyLabel?: string;
  ariaLabel?: string;
  portal?: boolean;
}) {
  const options = useMemo(() => [
    { value: '', label: emptyLabel || tr('vault:unfiled') },
    ...folders
      .filter((f) => !exclude?.has(f.id))
      .sort((a, b) => folderPath(folders, a.id).localeCompare(folderPath(folders, b.id)))
      .map((f) => ({
        value: f.id,
        label: folderPath(folders, f.id),
      })),
  ], [folders, exclude, emptyLabel]);

  return (
    <ThemeSelect
      portal={portal}
      ariaLabel={ariaLabel || tr('vault:folder')}
      value={value || ''}
      options={options}
      onChange={(next) => onChange(next ? next : null)}
    />
  );
}

export function Modal({
  title,
  description,
  icon,
  children,
  footer,
  footerLeft,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  footerLeft?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (root.current?.querySelector('[role="dialog"]:not([aria-label="' + title + '"])')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const items = [
          ...(root.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]'
          ) || []),
        ];
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      previous?.focus();
    };
  }, [title]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-md p-3 sm:p-5 overflow-hidden animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={root}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-subtle bg-surface text-main shadow-popover outline-none animate-in zoom-in-95 duration-150 ${
          wide ? 'max-w-2xl sm:max-w-3xl' : 'max-w-xl'
        }`}
      >
        {/* Pinned Header */}
        <div className="flex-shrink-0 flex items-center justify-between border-b border-edge px-5 py-3.5 bg-canvas/40">
          <div className="flex items-center space-x-2.5 min-w-0">
            {icon ? (
              <div className="p-2 bg-accent/15 text-accent rounded-xl border border-accent/20 shrink-0">
                {icon}
              </div>
            ) : null}
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-main truncate">{title}</h3>
              {description ? (
                <p className="text-[11px] text-sub truncate mt-0.5">{description}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            aria-label={tr('vault:close')}
            className="p-1.5 text-sub hover:text-main rounded-lg hover:bg-hover transition-colors shrink-0 ml-2"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar">
          {children}
        </div>

        {/* Pinned Footer */}
        {(footer || footerLeft) ? (
          <div className="flex-shrink-0 flex items-center justify-between gap-2 px-5 py-3.5 border-t border-edge bg-canvas/40">
            <div className="flex items-center gap-2">
              {footerLeft}
            </div>
            <div className="flex items-center justify-end gap-2 ml-auto">
              {footer}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
