/**
 * DesktopCalendarWindow.tsx — Transparent Wallpaper Calendar & Memo Widget.
 *
 * CALLING SPEC:
 *   <DesktopCalendarWindow />
 *
 * FEATURES:
 *   - Blends with Windows wallpaper beneath ordinary application windows.
 *   - Dual View Modes: Full 42-cell Month Matrix & Compact 3-Day Agenda Stream.
 *   - Double-clicking opens quick AI-assisted task note modal.
 *   - Pin / Adjust Mode for dragging window and resizing.
 *   - Background tone, custom hex color & opacity slider (0% - 90%).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Eye, EyeOff, Palette, Sun, Sliders, X } from 'lucide-react';
import { tr, useLocale } from './i18n';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { AppLockGate } from './components/AppLockGate';
import { DesktopCalendarTaskModal } from './components/DesktopCalendarTaskModal';
import { TaskInfoModal } from './components/TaskInfoModal';
import { ApiService, TASKS_CHANGED_EVENT } from './services/api';
import { Project, Task, User, WeekStartDay } from './types';
import {
  getStoredWeekStartDay,
  WEEK_START_CHANGE_EVENT,
  WEEK_START_STORAGE_KEY,
  TAURI_WEEK_START_EVENT,
} from './utils/calendarGrid';
import {
  DESKTOP_CALENDAR_CUSTOM_COLOR_KEY,
  DESKTOP_CALENDAR_DEFAULT_CUSTOM_COLOR,
  DESKTOP_CALENDAR_MAX_OPACITY,
  DESKTOP_CALENDAR_MIN_OPACITY,
  DESKTOP_CALENDAR_SHOW_COMPLETED_KEY,
  DESKTOP_CALENDAR_THEME_TONE_KEY,
  DesktopCalendarTone,
  hexToRgb,
  isLightColor,
  normalizeDesktopCalendarCustomColor,
  normalizeDesktopCalendarOpacity,
  normalizeDesktopCalendarThemeTone,
} from './utils/desktopCalendar';
import { DesktopHeader, DesktopCalendarMode } from './components/desktop-calendar/DesktopHeader';
import { DesktopMonthGrid } from './components/desktop-calendar/DesktopMonthGrid';
import { DesktopAgendaStream } from './components/desktop-calendar/DesktopAgendaStream';

const CALENDAR_PRESET_COLORS = [
  { get name() { return tr('calendar:desktopCalendarWindow.obsidian'); }, hex: '#0f172a' },
  { get name() { return tr('calendar:desktopCalendarWindow.titanium'); }, hex: '#ffffff' },
  { get name() { return tr('calendar:desktopCalendarWindow.oceanBlue'); }, hex: '#2563eb' },
  { get name() { return tr('calendar:desktopCalendarWindow.emeraldGreen'); }, hex: '#059669' },
  { get name() { return tr('calendar:desktopCalendarWindow.auroraPurple'); }, hex: '#7c3aed' },
  { get name() { return tr('calendar:desktopCalendarWindow.warmAmber'); }, hex: '#ea580c' },
  { get name() { return tr('calendar:desktopCalendarWindow.roseRed'); }, hex: '#e11d48' },
];

const DESKTOP_CAL_VIEW_MODE_KEY = 'lanmind_desktop_cal_mode';

function DesktopCalendarContent() {
  const { locale } = useLocale();
  const { currentTheme } = useTheme();

  const [themeTone, setThemeTone] = useState<DesktopCalendarTone>(() => {
    return normalizeDesktopCalendarThemeTone(localStorage.getItem(DESKTOP_CALENDAR_THEME_TONE_KEY));
  });
  const [customColor, setCustomColor] = useState<string>(() => {
    return normalizeDesktopCalendarCustomColor(localStorage.getItem(DESKTOP_CALENDAR_CUSTOM_COLOR_KEY));
  });
  const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>(getStoredWeekStartDay);

  const [viewMode, setViewMode] = useState<DesktopCalendarMode>(() => {
    const saved = localStorage.getItem(DESKTOP_CAL_VIEW_MODE_KEY);
    return saved === 'agenda' ? 'agenda' : 'month';
  });

  const isLight = useMemo(() => {
    if (themeTone === 'custom') {
      return isLightColor(customColor);
    }
    return currentTheme.id === 'light';
  }, [themeTone, customColor, currentTheme.id]);

  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isAdjustMode, setIsAdjustMode] = useState<boolean>(false);
  const [showLunar, setShowLunar] = useState<boolean>(() => {
    return localStorage.getItem('lanmind_show_lunar') !== 'false';
  });
  const [opacity, setOpacity] = useState<number>(() => {
    const saved = localStorage.getItem('lanmind_desktop_cal_opacity');
    return normalizeDesktopCalendarOpacity(saved);
  });
  const [showOpacityPopover, setShowOpacityPopover] = useState(false);
  const [showCompleted, setShowCompleted] = useState<boolean>(() => {
    return localStorage.getItem(DESKTOP_CALENDAR_SHOW_COMPLETED_KEY) !== 'false';
  });
  const [updatingTaskIds, setUpdatingTaskIds] = useState<Set<string>>(() => new Set());
  const [selectedDateForNewTask, setSelectedDateForNewTask] = useState<string | null>(null);
  const [selectedTaskForDetail, setSelectedTaskForDetail] = useState<Task | null>(null);

  const pinTransitionPending = useRef(false);
  const loadRequestId = useRef(0);

  const handleOpenFullForm = useCallback(async (dateStr?: string, title?: string) => {
    setSelectedDateForNewTask(null);
    if (isTauri()) {
      try {
        await emit('task-form://open', { date: dateStr, title });
        await invoke('reveal_main_window');
      } catch (e) {
        console.warn('Failed to reveal main window for task form', e);
      }
    }
  }, []);

  const handleEditTaskInMain = useCallback(async (task: Task) => {
    setSelectedTaskForDetail(null);
    if (isTauri()) {
      try {
        await emit('task-edit://open', { taskId: task.id, task });
        await invoke('reveal_main_window');
      } catch (e) {
        console.warn('Failed to reveal main window for task edit', e);
      }
    }
  }, []);

  const handleViewModeChange = (mode: DesktopCalendarMode) => {
    setViewMode(mode);
    localStorage.setItem(DESKTOP_CAL_VIEW_MODE_KEY, mode);
  };

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    try {
      const bootstrap = await ApiService.getBootstrap();
      if (bootstrap?.currentUser) {
        const [taskList, userList, projectList] = await Promise.all([
          ApiService.getTasks(bootstrap.currentUser.id).catch(() => []),
          ApiService.getUsers().catch(() => []),
          ApiService.getProjects(bootstrap.currentUser.id).catch(() => []),
        ]);
        if (requestId !== loadRequestId.current) return;
        setCurrentUser(bootstrap.currentUser);
        setTasks(taskList);
        if (userList.length > 0) setUsers(userList);
        if (projectList.length > 0) setProjects(projectList);
      }
    } catch (e) {
      if (requestId === loadRequestId.current) {
        console.warn('Desktop calendar sync deferred:', e);
      }
    }
  }, []);

  const prevMonth = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (viewMode === 'agenda') {
        d.setDate(d.getDate() - 3);
      } else {
        d.setMonth(d.getMonth() - 1);
      }
      return d;
    });
  }, [viewMode]);

  const nextMonth = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (viewMode === 'agenda') {
        d.setDate(d.getDate() + 3);
      } else {
        d.setMonth(d.getMonth() + 1);
      }
      return d;
    });
  }, [viewMode]);

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  // Listen to configs and events
  useEffect(() => {
    if (!isTauri()) return;
    ApiService.getDesktopCalendarConfig().then((cfg) => {
      if (cfg) {
        if (typeof cfg.opacity === 'number') {
          const normalized = normalizeDesktopCalendarOpacity(cfg.opacity);
          setOpacity(normalized);
          localStorage.setItem('lanmind_desktop_cal_opacity', String(normalized));
        }
        if (typeof cfg.showCompleted === 'boolean') {
          setShowCompleted(cfg.showCompleted);
          localStorage.setItem(DESKTOP_CALENDAR_SHOW_COMPLETED_KEY, String(cfg.showCompleted));
        }
        if (cfg.themeTone) {
          const tone = normalizeDesktopCalendarThemeTone(cfg.themeTone);
          setThemeTone(tone);
          localStorage.setItem(DESKTOP_CALENDAR_THEME_TONE_KEY, tone);
        }
        if (cfg.customColor) {
          const col = normalizeDesktopCalendarCustomColor(cfg.customColor);
          setCustomColor(col);
          localStorage.setItem(DESKTOP_CALENDAR_CUSTOM_COLOR_KEY, col);
        }
      }
    }).catch(() => { });
  }, []);

  const handleOpacityChange = useCallback((val: number) => {
    const clamped = normalizeDesktopCalendarOpacity(val);
    setOpacity(clamped);
    localStorage.setItem('lanmind_desktop_cal_opacity', String(clamped));
    void ApiService.setDesktopCalendarOpacity(clamped);
  }, []);

  const handleThemeToneChange = useCallback((tone: DesktopCalendarTone) => {
    setThemeTone(tone);
    localStorage.setItem(DESKTOP_CALENDAR_THEME_TONE_KEY, tone);
    void ApiService.setDesktopCalendarThemeTone(tone);
  }, []);

  const handleCustomColorChange = useCallback((color: string) => {
    const normalized = normalizeDesktopCalendarCustomColor(color);
    setCustomColor(normalized);
    localStorage.setItem(DESKTOP_CALENDAR_CUSTOM_COLOR_KEY, normalized);
    void ApiService.setDesktopCalendarCustomColor(normalized);
  }, []);

  const handleTogglePin = useCallback(async () => {
    if (!isTauri() || pinTransitionPending.current) return;
    pinTransitionPending.current = true;
    try {
      await ApiService.setDesktopCalendarAdjustMode(!isAdjustMode);
      setIsAdjustMode(!isAdjustMode);
    } catch (error) {
      console.error('Failed to toggle desktop calendar adjust mode', error);
    } finally {
      pinTransitionPending.current = false;
    }
  }, [isAdjustMode]);

  useEffect(() => {
    void loadData();

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('contextmenu', handleContextMenu, true);

    const handleLunarChange = (e: CustomEvent<boolean>) => setShowLunar(e.detail);
    const handleExtOpacityChange = (e: CustomEvent<number>) => setOpacity(normalizeDesktopCalendarOpacity(e.detail));
    const handleShowCompletedChange = (e: CustomEvent<boolean>) => setShowCompleted(e.detail);
    const handleExtCustomColorChange = (e: CustomEvent<string>) => setCustomColor(normalizeDesktopCalendarCustomColor(e.detail));
    const handleWeekStartChange = (e: CustomEvent<WeekStartDay>) => setWeekStartDay(e.detail);

    window.addEventListener('lanmind-lunar-change', handleLunarChange as EventListener);
    window.addEventListener('lanmind-desktop-cal-opacity-change', handleExtOpacityChange as EventListener);
    window.addEventListener('lanmind-desktop-cal-show-completed-change', handleShowCompletedChange as EventListener);
    window.addEventListener('lanmind-desktop-cal-custom-color-change', handleExtCustomColorChange as EventListener);
    window.addEventListener(WEEK_START_CHANGE_EVENT, handleWeekStartChange as EventListener);

    const subscriptions: (() => void)[] = [];
    if (isTauri()) {
      listen(TASKS_CHANGED_EVENT, () => void loadData()).then((fn) => subscriptions.push(fn)).catch(() => { });
      listen<WeekStartDay>(TAURI_WEEK_START_EVENT, (event) => {
        if (event.payload === 'monday' || event.payload === 'sunday') setWeekStartDay(event.payload);
      }).then((fn) => subscriptions.push(fn)).catch(() => { });
    }

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu, true);
      window.removeEventListener('lanmind-lunar-change', handleLunarChange as EventListener);
      window.removeEventListener('lanmind-desktop-cal-opacity-change', handleExtOpacityChange as EventListener);
      window.removeEventListener('lanmind-desktop-cal-show-completed-change', handleShowCompletedChange as EventListener);
      window.removeEventListener('lanmind-desktop-cal-custom-color-change', handleExtCustomColorChange as EventListener);
      window.removeEventListener(WEEK_START_CHANGE_EVENT, handleWeekStartChange as EventListener);
      subscriptions.forEach((dispose) => dispose());
    };
  }, [loadData]);

  const handleToggleTask = useCallback(async (task: Task) => {
    if (!currentUser || updatingTaskIds.has(task.id)) return;
    setUpdatingTaskIds((prev) => new Set(prev).add(task.id));
    try {
      await ApiService.updateTask(
        task.id,
        { status: task.status === 'completed' ? 'todo' : 'completed' },
        currentUser.id
      );
      await loadData();
    } catch (error) {
      console.error('Failed to toggle task in desktop calendar', error);
      await loadData();
    } finally {
      setUpdatingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }, [currentUser, loadData, updatingTaskIds]);

  const computedBgStyle = useMemo(() => {
    const alpha = Math.max(0, Math.min(100, opacity)) / 100;
    if (themeTone === 'custom') {
      const rgb = hexToRgb(customColor) || { r: 15, g: 23, b: 42 };
      return {
        backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`,
        backdropFilter: 'blur(16px)',
      };
    }
    if (themeTone === 'dark' || !isLight) {
      return {
        backgroundColor: `rgba(15, 23, 42, ${alpha})`,
        backdropFilter: 'blur(16px)',
      };
    }
    return {
      backgroundColor: `rgba(248, 250, 252, ${alpha})`,
      backdropFilter: 'blur(16px)',
    };
  }, [themeTone, customColor, opacity, isLight]);

  return (
    <div
      className={`desktop-calendar-window relative flex h-screen w-screen flex-col overflow-hidden select-none transition-colors ${isAdjustMode ? 'ring-2 ring-amber-400/80 shadow-2xl' : ''
        }`}
      style={computedBgStyle}
    >
      {/* Header */}
      <DesktopHeader
        currentDate={currentDate}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onPrevMonth={prevMonth}
        onNextMonth={nextMonth}
        onToday={goToToday}
        onTogglePin={handleTogglePin}
        isAdjustMode={isAdjustMode}
        onToggleOpacityPopover={() => setShowOpacityPopover((prev) => !prev)}
        onRefresh={loadData}
        isLight={isLight}
        showLunar={showLunar}
      />

      {/* Main Grid: Month or 3-Day Agenda Stream */}
      {viewMode === 'month' ? (
        <DesktopMonthGrid
          currentDate={currentDate}
          tasks={tasks}
          projects={projects}
          weekStartDay={weekStartDay}
          showCompleted={showCompleted}
          isLight={isLight}
          showLunar={showLunar}
          onToggleTask={handleToggleTask}
          onOpenNewTask={(d) => setSelectedDateForNewTask(d)}
          onTaskClick={(t) => setSelectedTaskForDetail(t)}
          updatingTaskIds={updatingTaskIds}
        />
      ) : (
        <DesktopAgendaStream
          currentDate={currentDate}
          tasks={tasks}
          projects={projects}
          showCompleted={showCompleted}
          isLight={isLight}
          showLunar={showLunar}
          onToggleTask={handleToggleTask}
          onOpenNewTask={(d) => setSelectedDateForNewTask(d)}
          onTaskClick={(t) => setSelectedTaskForDetail(t)}
          updatingTaskIds={updatingTaskIds}
        />
      )}

      {/* Opacity & Appearance Popover */}
      {showOpacityPopover && (
        <div
          data-no-drag="true"
          className="absolute right-3 top-12 z-50 w-64 rounded-xl border border-edge bg-surface/95 p-3.5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95"
        >
          <div className="flex items-center justify-between pb-2 border-b border-edge">
            <span className="text-xs font-semibold text-main">
              {tr('calendar:desktopCalendarWindow.backgroundOpacity')}
            </span>
            <button
              type="button"
              onClick={() => setShowOpacityPopover(false)}
              className="rounded p-0.5 text-sub hover:bg-hover hover:text-main"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 space-y-3">
            {/* Opacity Slider */}
            <div>
              <div className="flex items-center justify-between text-xs text-sub mb-1">
                <span>{tr('calendar:desktopCalendarWindow.backgroundOpacity')}</span>
                <span className="font-mono text-xs font-semibold text-accent">{opacity}%</span>
              </div>
              <input
                type="range"
                min={DESKTOP_CALENDAR_MIN_OPACITY}
                max={DESKTOP_CALENDAR_MAX_OPACITY}
                step={1}
                value={opacity}
                onChange={(e) => handleOpacityChange(Number(e.target.value))}
                className="w-full accent-accent h-1.5 rounded-lg cursor-pointer bg-edge"
              />
              <div className="flex items-center justify-between gap-1 text-[10px] text-quiet font-mono mt-1">
                {[0, 30, 60, 100].map((presetVal) => (
                  <button
                    key={presetVal}
                    type="button"
                    onClick={() => handleOpacityChange(presetVal)}
                    className={`px-1.5 py-0.5 rounded transition-colors ${opacity === presetVal
                        ? 'text-accent font-bold bg-accent/10'
                        : 'hover:text-main hover:bg-hover'
                      }`}
                  >
                    {presetVal}%
                  </button>
                ))}
              </div>
            </div>

            {/* Background Tone / Color Selection */}
            <div className="space-y-2">
              <span className="text-xs text-sub block">
                {tr('calendar:desktopCalendarWindow.translucentBackground')}
              </span>
              <div className="grid grid-cols-2 gap-1.5 p-0.5 rounded-lg bg-surface-hover/60 border border-edge">
                <button
                  type="button"
                  onClick={() => handleThemeToneChange('system')}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${themeTone === 'system'
                      ? 'bg-accent text-white shadow-xs font-semibold'
                      : 'text-sub hover:text-main hover:bg-hover'
                    }`}
                  title={tr('calendar:desktopCalendarWindow.useTheApplicationTheme')}
                >
                  <Sun className="h-3 w-3 shrink-0" />
                  <span>{tr('calendar:desktopCalendarWindow.followTheme')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleThemeToneChange('custom')}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${themeTone === 'custom'
                      ? 'bg-accent text-white shadow-xs font-semibold'
                      : 'text-sub hover:text-main hover:bg-hover'
                    }`}
                  title={tr('calendar:desktopCalendarWindow.chooseABackgroundColor')}
                >
                  <Palette className="h-3 w-3 shrink-0" />
                  <span>{tr('calendar:desktopCalendarWindow.customColor')}</span>
                </button>
              </div>

              {/* Custom Color Palette & Presets */}
              {themeTone === 'custom' && (
                <div className="p-2.5 rounded-lg border border-edge bg-surface/50 space-y-2 animate-in fade-in zoom-in-95">
                  <div className="flex items-center justify-between gap-2">
                    <label className="relative flex items-center gap-2 cursor-pointer group flex-1 min-w-0">
                      <span
                        className="w-6 h-6 rounded-md border border-edge shadow-xs shrink-0 transition-transform group-hover:scale-105"
                        style={{ backgroundColor: customColor }}
                      />
                      <span className="text-xs text-sub group-hover:text-main truncate">
                        {tr('calendar:desktopCalendarWindow.chooseFromPalette')}
                      </span>
                      <input
                        type="color"
                        value={customColor}
                        onChange={(e) => handleCustomColorChange(e.target.value)}
                        className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                        title={tr('calendar:desktopCalendarWindow.openColorPicker')}
                      />
                    </label>
                    <span className="font-mono text-xs font-semibold text-accent px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20 shrink-0">
                      {customColor.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-7 gap-1.5 pt-1.5 border-t border-edge">
                    {CALENDAR_PRESET_COLORS.map((preset) => {
                      const isSelected = customColor.toLowerCase() === preset.hex.toLowerCase();
                      const isLightPreset = isLightColor(preset.hex);
                      return (
                        <button
                          key={preset.hex}
                          type="button"
                          onClick={() => handleCustomColorChange(preset.hex)}
                          style={{ backgroundColor: preset.hex }}
                          title={`${preset.name} (${preset.hex})`}
                          className={`h-5 w-full rounded-md border transition-all flex items-center justify-center ${isSelected
                              ? 'ring-2 ring-accent scale-105 border-accent shadow-xs'
                              : 'border-edge hover:scale-105 hover:border-accent/60'
                            }`}
                        >
                          {isSelected && (
                            <span className={`text-[10px] font-bold ${isLightPreset ? 'text-slate-900' : 'text-white'}`}>
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Show completed toggle */}
            <div className="flex items-center justify-between pt-2 border-t border-edge">
              <span className="text-xs text-sub">{tr('calendar:desktopCalendarWindow.showCompletedTasks')}</span>
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(e) => {
                  setShowCompleted(e.target.checked);
                  localStorage.setItem(DESKTOP_CALENDAR_SHOW_COMPLETED_KEY, String(e.target.checked));
                }}
                className="rounded accent-accent size-4 cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* Quick Task Note Modal */}
      <DesktopCalendarTaskModal
        isOpen={!!selectedDateForNewTask}
        dateStr={selectedDateForNewTask || ''}
        currentUser={currentUser}
        projects={projects}
        users={users}
        onClose={() => setSelectedDateForNewTask(null)}
        onTaskCreated={() => void loadData()}
        onOpenFullForm={handleOpenFullForm}
        showLunar={showLunar}
      />

      {/* Task Details Modal in Desktop Calendar */}
      {selectedTaskForDetail && (
        <TaskInfoModal
          task={selectedTaskForDetail}
          currentUserId={currentUser?.id}
          users={users}
          projects={projects}
          tasks={tasks}
          canEdit={true}
          onClose={() => setSelectedTaskForDetail(null)}
          onEdit={handleEditTaskInMain}
          onOpen={(child) => setSelectedTaskForDetail(child)}
        />
      )}
    </div>
  );
}

export default function DesktopCalendarWindow() {
  useLocale();
  return (
    <ThemeProvider>
      <AppLockGate primary={false}>
        <DesktopCalendarContent />
      </AppLockGate>
    </ThemeProvider>
  );
}
