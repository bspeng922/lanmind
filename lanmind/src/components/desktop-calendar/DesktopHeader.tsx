/**
 * DesktopHeader.tsx — Header toolbar for desktop calendar window.
 *
 * CALLING SPEC:
 *   <DesktopHeader
 *     currentDate={currentDate}
 *     viewMode={viewMode}
 *     onViewModeChange={setViewMode}
 *     onPrevMonth={prevMonth}
 *     onNextMonth={nextMonth}
 *     onToday={goToToday}
 *     onTogglePin={handleTogglePin}
 *     isAdjustMode={isAdjustMode}
 *     onToggleOpacityPopover={toggleOpacity}
 *     onRefresh={loadData}
 *     isLight={isLight}
 *     showLunar={showLunar}
 *   />
 */

import React from 'react';
import { ChevronLeft, ChevronRight, Pin, PinOff, Sliders, RefreshCw, Calendar, ListTodo } from 'lucide-react';
import { tr } from '../../i18n';
import { formatHeaderDateWithLunar } from '../../utils/lunar';

export type DesktopCalendarMode = 'month' | 'agenda';

interface DesktopHeaderProps {
  currentDate: Date;
  viewMode: DesktopCalendarMode;
  onViewModeChange: (mode: DesktopCalendarMode) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onTogglePin: () => void;
  isAdjustMode: boolean;
  onToggleOpacityPopover: () => void;
  onRefresh: () => void;
  isLight: boolean;
  showLunar?: boolean;
}

export function DesktopHeader({
  currentDate,
  viewMode,
  onViewModeChange,
  onPrevMonth,
  onNextMonth,
  onToday,
  onTogglePin,
  isAdjustMode,
  onToggleOpacityPopover,
  onRefresh,
  isLight,
  showLunar = true,
}: DesktopHeaderProps) {
  const info = formatHeaderDateWithLunar(currentDate);
  const headerDateStr = showLunar
    ? `${info.solarDateText} ${info.weekdayText} ${info.lunarText}`
    : `${info.solarDateText} ${info.weekdayText}`;

  return (
    <div
      data-tauri-drag-region={isAdjustMode ? 'true' : undefined}
      className={`desktop-calendar-header flex shrink-0 items-center justify-between gap-2 px-3 py-2 select-none border-b ${
        isLight ? 'border-black/10' : 'border-white/10'
      }`}
    >
      {/* Left: Date & Lunar Info */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`text-xs font-bold truncate ${
            isLight ? 'text-slate-800' : 'text-slate-100'
          }`}
          title={headerDateStr}
        >
          {headerDateStr}
        </span>
      </div>

      {/* Center: Mode Switcher (Month vs 3-Day Agenda) */}
      <div className="flex items-center rounded-lg bg-black/15 p-0.5 border border-white/10">
        <button
          type="button"
          onClick={() => onViewModeChange('month')}
          className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${
            viewMode === 'month'
              ? 'bg-accent text-on-accent font-semibold shadow-xs'
              : isLight
              ? 'text-slate-700 hover:text-black'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <Calendar className="h-3 w-3" />
          <span>{tr('calendar:calendarView.monthView', { defaultValue: '月历' })}</span>
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('agenda')}
          className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${
            viewMode === 'agenda'
              ? 'bg-accent text-on-accent font-semibold shadow-xs'
              : isLight
              ? 'text-slate-700 hover:text-black'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <ListTodo className="h-3 w-3" />
          <span>{tr('calendar:calendarView.agendaStream')}</span>
        </button>
      </div>

      {/* Right: Controls & Prev/Next */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToday}
          className={`px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors ${
            isLight ? 'hover:bg-black/10 text-slate-700' : 'hover:bg-white/15 text-slate-300'
          }`}
          title={tr('calendar:calendarView.today')}
        >
          {tr('calendar:calendarView.today')}
        </button>

        <button
          type="button"
          onClick={onPrevMonth}
          className={`p-1 rounded transition-colors ${
            isLight ? 'hover:bg-black/10 text-slate-700' : 'hover:bg-white/15 text-slate-300'
          }`}
          aria-label="Previous"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onNextMonth}
          className={`p-1 rounded transition-colors ${
            isLight ? 'hover:bg-black/10 text-slate-700' : 'hover:bg-white/15 text-slate-300'
          }`}
          aria-label="Next"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        <div className={`h-3 w-px mx-0.5 ${isLight ? 'bg-black/10' : 'bg-white/15'}`} />

        <button
          type="button"
          onClick={onToggleOpacityPopover}
          className={`p-1 rounded transition-colors ${
            isLight ? 'hover:bg-black/10 text-slate-700' : 'hover:bg-white/15 text-slate-300'
          }`}
          title={tr('calendar:desktopCalendarWindow.backgroundOpacity')}
        >
          <Sliders className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={onTogglePin}
          className={`p-1 rounded transition-colors ${
            isAdjustMode
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-xs'
              : isLight
              ? 'hover:bg-black/10 text-accent'
              : 'hover:bg-white/15 text-accent'
          }`}
          title={
            isAdjustMode
              ? tr('calendar:desktopCalendarWindow.dragTheTopToMoveOrEdges')
              : tr('calendar:desktopCalendarWindow.pinnedClickToAdjustDoubleClickA')
          }
          aria-label={isAdjustMode ? 'Lock position' : 'Adjust position and size'}
        >
          {isAdjustMode ? (
            <PinOff className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
          ) : (
            <Pin className="h-3.5 w-3.5 rotate-45 text-accent" />
          )}
        </button>

        <button
          type="button"
          onClick={onRefresh}
          className={`p-1 rounded transition-colors ${
            isLight ? 'hover:bg-black/10 text-slate-700' : 'hover:bg-white/15 text-slate-300'
          }`}
          title={tr('calendar:desktopCalendarWindow.refreshTasks')}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
