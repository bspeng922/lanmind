import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { WeekStartDay } from '../types';
import {
  generateCalendarGrid,
  getStoredWeekStartDay,
  getWeekdayHeaders,
  WEEK_START_CHANGE_EVENT,
} from '../utils/calendarGrid';

export interface ThemeDatePickerProps {
  ariaLabel?: string;
  value: string;
  onChange: (dateStr: string) => void;
  placeholder?: string;
  disabled?: boolean;
  width?: number | string;
  weekStartDay?: WeekStartDay;
}

function formatYMD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseYMD(dateStr: string): { year: number; month: number; day: number } | null {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  return { year, month, day };
}

export const ThemeDatePicker: React.FC<ThemeDatePickerProps> = ({
  ariaLabel = '选择日期',
  value,
  onChange,
  placeholder = '选择日期',
  disabled = false,
  width = '100%',
  weekStartDay: propWeekStartDay,
}) => {
  const [internalWeekStartDay, setInternalWeekStartDay] = useState<WeekStartDay>(getStoredWeekStartDay);
  const effectiveWeekStartDay = propWeekStartDay || internalWeekStartDay;

  useEffect(() => {
    const handleWeekStartChange = (e: CustomEvent<WeekStartDay>) => {
      if (e.detail === 'monday' || e.detail === 'sunday') {
        setInternalWeekStartDay(e.detail);
      }
    };
    window.addEventListener(WEEK_START_CHANGE_EVENT, handleWeekStartChange as EventListener);
    return () => {
      window.removeEventListener(WEEK_START_CHANGE_EVENT, handleWeekStartChange as EventListener);
    };
  }, []);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const popupId = useId();

  const [menuPos, setMenuPos] = useState<{ top: number; left: number; placement: 'bottom' | 'top' }>({
    top: 0,
    left: 0,
    placement: 'bottom',
  });

  const parsedValue = parseYMD(value);
  const today = new Date();
  const todayStr = formatYMD(today);

  // Month and year currently being viewed in calendar
  const [viewYear, setViewYear] = useState(() => parsedValue?.year ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => parsedValue?.month ?? today.getMonth());

  // Keep view aligned when value changes externally while closed
  useEffect(() => {
    if (!isOpen && parsedValue) {
      setViewYear(parsedValue.year);
      setViewMonth(parsedValue.month);
    }
  }, [value, isOpen]);

  // Compute fixed position for portal dropdown
  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = 276;
    const menuHeight = menuRef.current?.offsetHeight || 345;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Prefer opening downwards unless there's not enough room below and more room above
    const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;

    let top = openUp ? rect.top - menuHeight - 6 : rect.bottom + 6;
    let left = rect.left;

    // Keep within window horizontal boundaries
    if (left + menuWidth > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - menuWidth - 10);
    }
    if (left < 10) {
      left = 10;
    }

    if (top < 8) {
      top = 8;
    }

    setMenuPos({
      top,
      left,
      placement: openUp ? 'top' : 'bottom',
    });
  }, []);

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition();
    }
  }, [isOpen, updatePosition]);

  // Handle outside clicks, keyboard navigation, and repositioning on scroll/resize
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleScrollOrResize = () => {
      updatePosition();
    };

    const handleKeyDownWindow = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('keydown', handleKeyDownWindow);
    document.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('keydown', handleKeyDownWindow);
      document.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, updatePosition]);

  const handleOpen = () => {
    if (disabled) return;
    if (!propWeekStartDay) {
      setInternalWeekStartDay(getStoredWeekStartDay());
    }
    if (parsedValue) {
      setViewYear(parsedValue.year);
      setViewMonth(parsedValue.month);
    } else {
      setViewYear(today.getFullYear());
      setViewMonth(today.getMonth());
    }
    updatePosition();
    setIsOpen(true);
  };

  const handleSelectDate = (dateStr: string) => {
    onChange(dateStr);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus();
    }
  };

  // Build 42-cell calendar grid (6 weeks)
  const calendarDays = useMemo(() => {
    const cells = generateCalendarGrid(viewYear, viewMonth, effectiveWeekStartDay);
    return cells.map((cell) => ({
      ...cell,
      isToday: cell.dateStr === todayStr,
      isSelected: cell.dateStr === value,
    }));
  }, [viewYear, viewMonth, effectiveWeekStartDay, todayStr, value]);

  return (
    <div
      ref={rootRef}
      className="filter-select theme-date-picker"
      data-open={isOpen}
      style={{ width }}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={buttonRef}
        type="button"
        className="filter-select-trigger theme-date-picker-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popupId : undefined}
        onClick={() => (isOpen ? setIsOpen(false) : handleOpen())}
      >
        <span className="filter-select-value">
          <CalendarIcon className="theme-date-picker-icon" aria-hidden="true" />
          <span className={value ? 'theme-date-picker-value' : 'theme-date-picker-placeholder'}>
            {value || placeholder}
          </span>
        </span>

        <span className="theme-date-picker-actions">
          {value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={handleClear}
              className="theme-date-picker-clear"
              title="清除日期"
              aria-label="清除日期"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="filter-select-chevron" data-open={isOpen} aria-hidden="true" />
        </span>
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            id={popupId}
            role="dialog"
            aria-label={ariaLabel}
            data-placement={menuPos.placement}
            className="filter-select-menu theme-date-picker-menu"
            style={{
              position: 'fixed',
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
              zIndex: 99999,
            }}
          >
          {/* Header Bar: Month Navigator */}
          <div className="theme-date-picker-header">
            <button
              type="button"
              className="theme-date-picker-nav-btn"
              onClick={handlePrevMonth}
              title="上一月"
              aria-label="上一月"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="theme-date-picker-title">
              {viewYear}年 {viewMonth + 1}月
            </span>
            <button
              type="button"
              className="theme-date-picker-nav-btn"
              onClick={handleNextMonth}
              title="下一月"
              aria-label="下一月"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Quick Preset Buttons */}
          <div className="theme-date-picker-presets">
            <button
              type="button"
              className="theme-date-picker-preset-btn"
              onClick={() => handleSelectDate(todayStr)}
            >
              今天
            </button>
            <button
              type="button"
              className="theme-date-picker-preset-btn"
              onClick={() => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                handleSelectDate(formatYMD(tomorrow));
              }}
            >
              明天
            </button>
            <button
              type="button"
              className="theme-date-picker-preset-btn"
              onClick={() => {
                const nextWeek = new Date();
                nextWeek.setDate(nextWeek.getDate() + 7);
                handleSelectDate(formatYMD(nextWeek));
              }}
            >
              下周
            </button>
          </div>

          {/* Weekday Header */}
          <div className="theme-date-picker-weekdays">
            {getWeekdayHeaders(effectiveWeekStartDay, 'short').map((wd, idx) => (
              <span key={`${wd}-${idx}`} className="theme-date-picker-weekday">
                {wd}
              </span>
            ))}
          </div>

          {/* Days Grid */}
          <div className="theme-date-picker-grid">
            {calendarDays.map((cell) => (
              <button
                key={cell.dateStr}
                type="button"
                className="theme-date-picker-day"
                data-current-month={cell.isCurrentMonth}
                data-today={cell.isToday}
                data-selected={cell.isSelected}
                onClick={() => handleSelectDate(cell.dateStr)}
              >
                <span>{cell.dayNum}</span>
              </button>
            ))}
          </div>

          {/* Footer actions */}
          <div className="theme-date-picker-footer">
            <button
              type="button"
              className="theme-date-picker-footer-btn text-danger hover:text-danger"
              onClick={() => {
                onChange('');
                setIsOpen(false);
              }}
            >
              清除
            </button>
            <button
              type="button"
              className="theme-date-picker-footer-btn theme-text-accent"
              onClick={() => handleSelectDate(todayStr)}
            >
              设为今天
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
