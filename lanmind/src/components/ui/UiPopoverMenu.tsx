import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type PopoverAlign = 'left' | 'right';
export type PopoverSide = 'bottom' | 'top';

export interface PopoverPosition {
  top: number;
  left: number;
  origin: 'origin-top-left' | 'origin-top-right' | 'origin-bottom-left' | 'origin-bottom-right';
  minWidth?: number;
}

export interface UsePortalPopoverOptions {
  align?: PopoverAlign;
  side?: PopoverSide;
  offset?: number;
  estimatedWidth?: number;
  estimatedHeight?: number;
  matchTriggerWidth?: boolean;
}

/**
 * Strictly implements LanMind's Portal Popover positioning contract:
 * - menuPos initializes to null (never { top: 0, left: 0 })
 * - Computes trigger rect synchronously BEFORE opening
 * - Resets menuPos to null on close
 * - Clamps cleanly inside viewport edges
 */
export function usePortalPopover({
  align = 'right',
  side = 'bottom',
  offset = 6,
  estimatedWidth = 200,
  estimatedHeight = 220,
  matchTriggerWidth = false,
}: UsePortalPopoverOptions = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const computePos = useCallback(
    (anchorEl: Element | null): PopoverPosition | null => {
      if (!anchorEl) return null;
      const rect = anchorEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = matchTriggerWidth ? Math.max(rect.width, estimatedWidth) : estimatedWidth;
      const pad = 8;

      const spaceBelow = vh - rect.bottom - offset - pad;
      const spaceAbove = rect.top - offset - pad;
      const actualSide: PopoverSide =
        side === 'bottom'
          ? spaceBelow < estimatedHeight && spaceAbove > spaceBelow
            ? 'top'
            : 'bottom'
          : spaceAbove < estimatedHeight && spaceBelow > spaceAbove
          ? 'bottom'
          : 'top';

      let left = align === 'right' ? rect.right - width : rect.left;
      left = Math.max(pad, Math.min(left, vw - width - pad));

      const top =
        actualSide === 'bottom'
          ? Math.min(rect.bottom + offset, vh - pad)
          : Math.max(pad, rect.top - offset);

      const origin: PopoverPosition['origin'] =
        actualSide === 'bottom'
          ? align === 'right'
            ? 'origin-top-right'
            : 'origin-top-left'
          : align === 'right'
          ? 'origin-bottom-right'
          : 'origin-bottom-left';

      return {
        top,
        left,
        origin,
        minWidth: matchTriggerWidth ? rect.width : undefined,
      };
    },
    [align, estimatedHeight, estimatedWidth, matchTriggerWidth, offset, side],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setMenuPos(null);
  }, []);

  const openFrom = useCallback(
    (el?: Element | null) => {
      const target = el ?? triggerRef.current;
      const next = computePos(target);
      if (!next) return;
      setMenuPos(next);
      setIsOpen(true);
    },
    [computePos],
  );

  const toggle = useCallback(
    (el?: Element | null) => {
      if (isOpen) {
        close();
      } else {
        openFrom(el);
      }
    },
    [close, isOpen, openFrom],
  );

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    };
    const onViewportChange = () => close();

    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [close, isOpen]);

  return { isOpen, menuPos, triggerRef, menuRef, openFrom, close, toggle };
}

export interface UiPopoverPortalProps {
  isOpen: boolean;
  menuPos: PopoverPosition | null;
  menuRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
  role?: 'menu' | 'dialog' | 'listbox';
  ariaLabel?: string;
  children: React.ReactNode;
}

export const UiPopoverPortal: React.FC<UiPopoverPortalProps> = ({
  isOpen,
  menuPos,
  menuRef,
  className = '',
  role = 'menu',
  ariaLabel,
  children,
}) => {
  if (!isOpen || !menuPos || typeof document === 'undefined') return null;
  const activeTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const isBottomOrigin = menuPos.origin.startsWith('origin-bottom');

  return createPortal(
    <div
      ref={menuRef}
      role={role}
      aria-label={ariaLabel}
      data-theme={activeTheme}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={`fixed z-[120] rounded-xl border border-edge bg-elevated p-1.5 text-main shadow-popover ${menuPos.origin} ${className}`}
      style={{
        top: menuPos.top,
        left: menuPos.left,
        minWidth: menuPos.minWidth,
        transform: isBottomOrigin ? 'translateY(-100%)' : undefined,
        transition: 'none',
      }}
    >
      {children}
    </div>,
    document.body,
  );
};
