import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

export interface AppContextMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
}

interface AppContextMenuProps {
  x: number;
  y: number;
  items: AppContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 160;
const MENU_PADDING = 6;
const MENU_ITEM_HEIGHT = 36;
const VIEWPORT_MARGIN = 8;

export const AppContextMenu: React.FC<AppContextMenuProps> = ({
  x,
  y,
  items,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const position = useMemo(() => {
    const menuHeight = items.length * MENU_ITEM_HEIGHT + MENU_PADDING * 2;
    return {
      left: Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - menuHeight - VIEWPORT_MARGIN)),
    };
  }, [items.length, x, y]);

  useEffect(() => {
    const closeFromOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const close = () => onClose();

    window.addEventListener('pointerdown', closeFromOutside);
    window.addEventListener('keydown', closeFromKeyboard);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();

    return () => {
      window.removeEventListener('pointerdown', closeFromOutside);
      window.removeEventListener('keydown', closeFromKeyboard);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="应用菜单"
      className="app-context-menu fixed z-[200] p-1.5"
      style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className="app-context-menu-item flex h-9 w-full items-center gap-2 px-2.5 text-left text-xs font-medium"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
};
