import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Flag } from 'lucide-react';
import { tr } from '../i18n';

export interface ThemeSelectOption {
  value: string;
  label: string;
  tone?: 'rose' | 'amber' | 'blue' | 'slate' | 'emerald';
  indicator?: 'flag';
}

interface ThemeSelectBaseProps {
  ariaLabel: string;
  options: ThemeSelectOption[];
  width?: number | string;
  disabled?: boolean;
  portal?: boolean;
  popoverOwnerId?: string;
  menuClassName?: string;
  searchable?: boolean;
}
export type ThemeSelectProps = ThemeSelectBaseProps & (
  { multiple?: false; value: string; onChange: (value: string) => void }
  | { multiple: true; value: string[]; onChange: (value: string[]) => void }
);

export const ThemeSelect: React.FC<ThemeSelectProps> = (props) => {
  const {
    ariaLabel,
    value,
    options,
    width = '100%',
    disabled = false,
    portal = false,
    popoverOwnerId,
    menuClassName = '',
    searchable = false,
    multiple = false,
  } = props;
  const [search, setSearch] = useState('');
  const visibleOptions = options.filter((option) => !search || option.value === 'ALL' || option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selectedValues = Array.isArray(value) ? value : [value];
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
  const selectedOptions = options.filter((option) => selectedValues.includes(option.value));
  const selectedOption = selectedOptions[0] || options[0] || { value: '', label: tr('tasks:taskLayoutPanel.all') };
  const selectionSummary = selectedOptions.slice(0, 2).map((option) => option.label).join('、')
    + (selectedOptions.length > 2 ? tr('tasks:taskLayoutPanel.moreSelected', { count: selectedOptions.length - 2 }) : '');
  const selectedLabel = multiple ? selectionSummary || tr('tasks:taskLayoutPanel.all') : selectedOption.label;

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
      const wantedHeight = Math.min(280, menuRef.current?.scrollHeight || 280);
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
    const observer = new ResizeObserver(position);
    if (menuRef.current) observer.observe(menuRef.current);
    if (buttonRef.current) observer.observe(buttonRef.current);
    const scroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) position(); };
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', position);
    return () => {
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', position);
      observer.disconnect();
    };
  }, [isOpen, portal, options.map((option) => option.label).join('\u0000')]);

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
    setActiveIndex(Math.max(0, options.findIndex((option) => selectedValues.includes(option.value))));
    setIsOpen(true);
    setSearch('');
  };

  const selectOption = (option: ThemeSelectOption) => {
    if (props.multiple) {
      props.onChange(option.value === 'ALL' ? [] : props.value.includes(option.value) ? props.value.filter((item) => item !== option.value) : [...props.value, option.value]);
    } else {
      props.onChange(option.value);
      setIsOpen(false);
    }
    buttonRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (isOpen && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, visibleOptions.length - 1));
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (visibleOptions.length) setActiveIndex((current) => (current + direction + visibleOptions.length) % visibleOptions.length);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen && visibleOptions[activeIndex]) selectOption(visibleOptions[activeIndex]);
      else openMenu();
      return;
    }
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      buttonRef.current?.focus();
    }
  };

  const menu = isOpen ? (
        <div ref={menuRef} id={listboxId} role="listbox" aria-label={ariaLabel} aria-multiselectable={multiple || undefined} className={`filter-select-menu ${menuClassName}`} data-portal={portal || undefined} data-popover-owner={popoverOwnerId}
          data-theme={portal ? menuTheme : undefined} style={portal ? { position: 'fixed', ...menuPosition, minWidth: 0, zIndex: 99999 } : undefined}>
          {searchable && <input aria-label={tr('tasks:taskLayoutPanel.searchOptions')} placeholder={tr('tasks:taskLayoutPanel.searchOptions')} value={search} onChange={(event) => { setSearch(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => {
            if (!event.nativeEvent.isComposing && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) handleKeyDown(event);
          }} className="filter-select-search" />}
          {visibleOptions.map((option, index) => {
            const isSelected = multiple && option.value === 'ALL' ? selectedValues.length === 0 : selectedValues.includes(option.value);
            return (
              <button
                ref={index === activeIndex ? activeOptionRef : undefined}
                id={`${listboxId}-${index}`}
                key={option.value}
                type="button"
                role="option"
                title={option.label}
                aria-selected={isSelected}
                className="filter-select-option"
                data-active={index === activeIndex}
                data-selected={isSelected}
                onFocus={() => setActiveIndex(index)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
                onKeyDown={handleKeyDown}
              >
                <span className="filter-select-option-label">
                  {option.indicator === 'flag'
                    ? <Flag className="filter-select-flag" data-tone={option.tone} aria-hidden="true" />
                    : <span className="filter-select-dot" data-tone={option.tone || 'theme'} aria-hidden="true" />}
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
        title={multiple ? selectedOptions.map((option) => option.label).join('、') || selectedLabel : selectedLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen ? `${listboxId}-${activeIndex}` : undefined}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="filter-select-value">
          {selectedOption.indicator === 'flag'
            ? <Flag className="filter-select-flag" data-tone={selectedOption.tone} aria-hidden="true" />
            : <span className="filter-select-dot" data-tone={selectedOption.tone || 'theme'} aria-hidden="true" />}
          <span>{selectedLabel}</span>
        </span>
        <ChevronDown className="filter-select-chevron" data-open={isOpen} aria-hidden="true" />
      </button>

      {portal && menu ? createPortal(menu, document.body) : menu}
    </div>
  );
};
