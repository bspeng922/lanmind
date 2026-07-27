import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface ThemeSelectOption {
  value: string;
  label: string;
  tone?: 'rose' | 'amber' | 'blue' | 'slate' | 'emerald';
}

interface ThemeSelectProps {
  ariaLabel: string;
  value: string;
  options: ThemeSelectOption[];
  onChange: (value: string) => void;
  width?: number | string;
  disabled?: boolean;
}

export const ThemeSelect: React.FC<ThemeSelectProps> = ({
  ariaLabel,
  value,
  options,
  onChange,
  width = '100%',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex((option) => option.value === value)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedOption = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) activeOptionRef.current?.scrollIntoView({ block: 'nearest' });
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
      setIsOpen(false);
    }
  };

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

      {isOpen && (
        <div id={listboxId} role="listbox" aria-label={ariaLabel} className="filter-select-menu">
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
      )}
    </div>
  );
};
