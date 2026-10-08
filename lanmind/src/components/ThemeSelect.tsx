import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface ThemeSelectOption {
  value: string;
  label: string;
  tone?: 'rose' | 'amber' | 'blue' | 'slate' | 'emerald';
}

export interface ThemeSelectProps {
  ariaLabel: string;
  value: string;
  options: ThemeSelectOption[];
  onChange: (value: string) => void;
  width?: number | string;
  disabled?: boolean;
  portal?: boolean;
  popoverOwnerId?: string;
  menuClassName?: string;
}

export const ThemeSelect: React.FC<ThemeSelectProps> = ({
  ariaLabel,
  value,
  options,
  onChange,
  width = '100%',
  disabled = false,
  portal = false,
  popoverOwnerId,
  menuClassName = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex((option) => option.value === value)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 });
  const [menuTheme, setMenuTheme] = useState<string | undefined>();
  const listboxId = useId();
  const selectedOption = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !portal) return;
    const position = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const wantedHeight = Math.min(280, options.length * 30 + 10);
      const openAbove = below < wantedHeight && above > below;
      const maxHeight = Math.max(40, Math.min(wantedHeight, openAbove ? above : below));
      const menuWidth = Math.min(Math.max(rect.width, 160), window.innerWidth - 20);
      setMenuPosition({
        top: Math.max(10, openAbove ? rect.top - maxHeight - 6 : rect.bottom + 6),
        left: Math.max(10, Math.min(rect.left, window.innerWidth - menuWidth - 10)),
        width: menuWidth,
        maxHeight,
      });
      setMenuTheme(rootRef.current?.closest<HTMLElement>('[data-theme]')?.dataset.theme);
    };
    position();
    const scroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) position(); };
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', position);
    return () => {
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', position);
    };
  }, [isOpen, portal, options.length]);

  useEffect(() => {
    if (!isOpen) return;
    const menu = menuRef.current;
    const option = activeOptionRef.current;
    if (!menu || !option) return;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
    }
  }, [activeIndex, isOpen]);

  const openMenu = () => {
    if (disabled) return;
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    setIsOpen(true);
  };

  const selectOption = (option: ThemeSelectOption) => {
    onChange(option.value);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + direction + options.length) % options.length);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen) selectOption(options[activeIndex]);
      else openMenu();
      return;
    }
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
    }
  };

  const menu = isOpen ? (
        <div ref={menuRef} id={listboxId} role="listbox" aria-label={ariaLabel} className={`filter-select-menu ${menuClassName}`} data-portal={portal || undefined} data-popover-owner={popoverOwnerId}
          data-theme={portal ? menuTheme : undefined} style={portal ? { position: 'fixed', ...menuPosition, minWidth: 0, zIndex: 99999 } : undefined}>
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <button
                ref={index === activeIndex ? activeOptionRef : undefined}
                id={`${listboxId}-${index}`}
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className="filter-select-option"
                data-active={index === activeIndex}
                data-selected={isSelected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
              >
                <span className="filter-select-option-label">
                  <span className="filter-select-dot" data-tone={option.tone || 'theme'} />
                  <span>{option.label}</span>
                </span>
                <Check className="filter-select-check" aria-hidden="true" />
              </button>
            );
          })}
        </div>
  ) : null;

  return (
    <div ref={rootRef} className="filter-select" data-open={isOpen} style={{ width }}>
      <button
        ref={buttonRef}
        type="button"
        className="filter-select-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen ? `${listboxId}-${activeIndex}` : undefined}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="filter-select-value">
          <span className="filter-select-dot" data-tone={selectedOption.tone || 'theme'} />
          <span>{selectedOption.label}</span>
        </span>
        <ChevronDown className="filter-select-chevron" data-open={isOpen} aria-hidden="true" />
      </button>

      {portal && menu ? createPortal(menu, document.body) : menu}
    </div>
  );
};
