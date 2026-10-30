/**
 * CalendarHeader.tsx — Navigation toolbar and view switcher for calendar.
 *
 * CALLING SPEC:
 *   <CalendarHeader
 *     currentDate={currentDate}
 *     viewMode={viewMode}
 *     onViewModeChange={setViewMode}
 *     onPrev={handlePrev}
 *     onNext={handleNext}
 *     onToday={handleToday}
 *     weekStartDay={weekStartDay}
 *   />
 */

import React from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Grid } from 'lucide-react';
import { tr } from '../../i18n';
import { WeekStartDay } from '../../types';
import { formatYMD, getIsoWeekNumber, getWeekDays } from '../../utils/calendarGrid';

export type CalendarViewMode = 'day' | 'week' | 'month';

interface CalendarHeaderProps {
  currentDate: Date;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  weekStartDay: WeekStartDay;
  compact?: boolean;
  unscheduledCount?: number;
  showUndated?: boolean;
  onToggleShowUndated?: () => void;
  filterSlot?: React.ReactNode;
}

export function CalendarHeader({
  currentDate,
  viewMode,
  onViewModeChange,
  onPrev,
  onNext,
  onToday,
  weekStartDay,
  compact = false,
  unscheduledCount = 0,
  showUndated = false,
  onToggleShowUndated,
  filterSlot,
}: CalendarHeaderProps) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  // Title formatting depending on current view mode
  const getHeaderTitle = () => {
    if (viewMode === 'month') {
      return tr('calendar:calendarView.calendar', { value0: year, value1: month });
    }
    if (viewMode === 'day') {
      const monthStr = String(month).padStart(2, '0');
      const dayStr = String(currentDate.getDate()).padStart(2, '0');
      const weekdayStr = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(currentDate);
      return `${year}年${monthStr}月${dayStr}日 ${weekdayStr}`;
    }
    // Week mode
    const days = getWeekDays(currentDate, weekStartDay);
    const first = days[0];
    const last = days[6];
    const isoWeek = getIsoWeekNumber(currentDate);
    const firstM = first.getMonth() + 1;
    const firstD = first.getDate();
    const lastM = last.getMonth() + 1;
    const lastD = last.getDate();
    return `${year}年 第${isoWeek}周 · ${firstM}月${firstD}日 - ${lastM}月${lastD}日`;
  };

  return (
    <div
      className={`calendar-navigation shrink-0 bg-surface border-b border-edge flex flex-wrap items-center justify-between gap-2.5 ${
        compact ? 'px-3 py-2' : 'px-4 py-3'
      }`}
    >
      {/* Left: Icon, Title & View Switcher */}
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <CalendarIcon className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} shrink-0 text-info`} />
          <h2 className={`${compact ? 'text-sm' : 'text-base'} font-bold text-main whitespace-nowrap`}>
            {getHeaderTitle()}
          </h2>
        </div>

        {/* View Switcher Segmented Control */}
        <div className="flex items-center rounded-lg border border-subtle bg-canvas p-0.5">
          <button
            type="button"
            onClick={() => onViewModeChange('day')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
              viewMode === 'day'
                ? 'bg-surface text-main shadow-sm font-semibold'
                : 'text-sub hover:text-main'
            }`}
          >
            <span>{tr('calendar:calendarView.dayView', { defaultValue: '日' })}</span>
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('week')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
              viewMode === 'week'
                ? 'bg-surface text-main shadow-sm font-semibold'
                : 'text-sub hover:text-main'
            }`}
          >
            <span>{tr('calendar:calendarView.weekView', { defaultValue: '周' })}</span>
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('month')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
              viewMode === 'month'
                ? 'bg-surface text-main shadow-sm font-semibold'
                : 'text-sub hover:text-main'
            }`}
          >
            <span>{tr('calendar:calendarView.monthView', { defaultValue: '月' })}</span>
          </button>
        </div>

        {unscheduledCount > 0 && onToggleShowUndated && (
          <button
            type="button"
            aria-expanded={showUndated}
            onClick={onToggleShowUndated}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
              showUndated
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-subtle bg-card text-sub hover:bg-hover hover:text-main'
            }`}
          >
            {tr('tasks:taskLayoutPanel.noDueDate', { count: unscheduledCount })}
          </button>
        )}
      </div>

      {/* Right: Actions, Today & Prev/Next */}
      <div className="flex items-center gap-2">
        {filterSlot}

        <button
          type="button"
          onClick={onToday}
          className="rounded-lg border border-subtle bg-card px-2.5 py-1 text-xs font-medium text-main hover:bg-hover transition-colors shadow-sm"
          title={tr('calendar:calendarView.today')}
        >
          {tr('calendar:calendarView.today')}
        </button>

        <div className="flex items-center space-x-0.5 rounded-lg border border-subtle bg-card p-0.5">
          <button
            type="button"
            onClick={onPrev}
            className="rounded p-1 text-sub hover:bg-hover hover:text-main transition-colors"
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            className="rounded p-1 text-sub hover:bg-hover hover:text-main transition-colors"
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

