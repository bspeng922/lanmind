/**
 * DesktopCalendarWindow — Transparent Desktop Calendar & Memo
 *
 * CALLING SPEC:
 *   <DesktopCalendarWindow />
 *
 * FEATURES:
 *   - Blends with Windows wallpaper beneath ordinary application windows.
 *   - Displays complete header: Year/Month/Day, Weekday, Lunar text.
 *   - Shows week numbers, Monday-to-Sunday headers, and 42-day calendar matrix.
 *   - Displays Solar Terms (24节气), Chinese Festivals, and Lunar day labels.
 *   - Double-clicking any cell opens an instant inline memo card to record tasks.
 *   - Fixed mode: locked in place; double-click a date to create a memo.
 *   - Adjust mode (via Pin button or double-clicking header): freely draggable and resizable via 8 handles.
 *   - Real-time adjustable background opacity slider (0% - 90%) with quick presets.
 *   - Restores bounds and opacity automatically on startup and system reboots.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  X,
  Check,
  Calendar as CalendarIcon,
  Sparkles,
  Pin,
  Sliders,
  Sun,
  Eye,
  EyeOff,
  Palette,
} from 'lucide-react';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { DesktopCalendarTaskModal } from './components/DesktopCalendarTaskModal';
import { ThemeCheckbox } from './components/ThemeCheckbox';
import { ApiService } from './services/api';
import { Project, Task, User, WeekStartDay } from './types';
import { formatHeaderDateWithLunar, getLunarDateInfo } from './utils/lunar';
import { expandTaskOccurrences, TaskOccurrence } from './utils/recurrence';
import {
  generateCalendarGrid,
  getStoredWeekStartDay,
  getWeekdayHeaders,
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
  sortDesktopCalendarOccurrences,
} from './utils/desktopCalendar';

const CALENDAR_PRESET_COLORS = [
  { name: '曜石黑', hex: '#0f172a' },
  { name: '深空蓝', hex: '#1e293b' },
  { name: '玄夜青', hex: '#042f2e' },
  { name: '暮夜紫', hex: '#1e1b4b' },
  { name: '晨雾灰', hex: '#334155' },
  { name: '钛晶白', hex: '#f8fafc' },
];

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function DesktopCalendarContent() {
  const { currentTheme } = useTheme();
  const [themeTone, setThemeTone] = useState<DesktopCalendarTone>(() => {
    return normalizeDesktopCalendarThemeTone(localStorage.getItem(DESKTOP_CALENDAR_THEME_TONE_KEY));
  });
  const [customColor, setCustomColor] = useState<string>(() => {
    return normalizeDesktopCalendarCustomColor(localStorage.getItem(DESKTOP_CALENDAR_CUSTOM_COLOR_KEY));
  });
  const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>(getStoredWeekStartDay);

  const isLight = useMemo(() => {
    if (themeTone === 'custom') {
      return isLightColor(customColor);
    }
    return currentTheme.id === 'titanium-light';
  }, [themeTone, customColor, currentTheme.id]);


  const [currentDate, setCurrentDate] = useState(new Date());
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
  const pinTransitionPending = useRef(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const loadData = useCallback(async () => {
    try {
      const bootstrap = await ApiService.getBootstrap();
      if (bootstrap?.currentUser) {
        setCurrentUser(bootstrap.currentUser);
        const [taskList, userList, projectList] = await Promise.all([
          ApiService.getTasks(bootstrap.currentUser.id).catch(() => []),
          ApiService.getUsers().catch(() => []),
          ApiService.getProjects(bootstrap.currentUser.id).catch(() => []),
        ]);
        setTasks(taskList);
        if (userList.length > 0) setUsers(userList);
        if (projectList.length > 0) setProjects(projectList);
      }
    } catch (e) {
      console.warn('Desktop calendar sync deferred:', e);
    }
  }, []);

  const prevMonth = useCallback(() => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }, []);

  const nextMonth = useCallback(() => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }, []);

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  // Window bounds are restored and saved by the native window lifecycle.
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
    }).catch(() => {});
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

    // Disable browser context menu on right click everywhere on desktop calendar window
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('contextmenu', handleContextMenu, true);

    const handleLunarChange = (e: CustomEvent<boolean>) => {
      setShowLunar(e.detail);
    };
    const handleExtOpacityChange = (e: CustomEvent<number>) => {
      if (typeof e.detail === 'number') {
        setOpacity(normalizeDesktopCalendarOpacity(e.detail));
      }
    };
    const handleShowCompletedChange = (e: CustomEvent<boolean>) => {
      if (typeof e.detail === 'boolean') setShowCompleted(e.detail);
    };
    const handleExtCustomColorChange = (e: CustomEvent<string>) => {
      if (typeof e.detail === 'string') {
        setCustomColor(normalizeDesktopCalendarCustomColor(e.detail));
      }
    };
    window.addEventListener('lanmind-lunar-change', handleLunarChange as EventListener);
    window.addEventListener('lanmind-desktop-cal-opacity-change', handleExtOpacityChange as EventListener);
    window.addEventListener('lanmind-desktop-cal-show-completed-change', handleShowCompletedChange as EventListener);
    window.addEventListener('lanmind-desktop-cal-custom-color-change', handleExtCustomColorChange as EventListener);

    const handleWeekStartChange = (e: CustomEvent<WeekStartDay>) => {
      if (e.detail === 'monday' || e.detail === 'sunday') {
        setWeekStartDay(e.detail);
      }
    };
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === WEEK_START_STORAGE_KEY) {
        setWeekStartDay(getStoredWeekStartDay());
      }
    };
    window.addEventListener(WEEK_START_CHANGE_EVENT, handleWeekStartChange as EventListener);
    window.addEventListener('storage', handleStorageChange);

    let disposed = false;
    const subscriptions: Array<() => void> = [];
    const keepSubscription = (dispose: () => void) => {
      if (disposed) dispose();
      else subscriptions.push(dispose);
    };

    if (isTauri()) {
      void listen('sync://operation', () => void loadData()).then(keepSubscription);
      void listen<boolean>('desktop-calendar://adjust-mode-changed', (event) => {
        setIsAdjustMode(Boolean(event.payload));
      }).then(keepSubscription);
      void listen<boolean>('desktop-calendar://state-changed', () => {
        setShowOpacityPopover(false);
        setSelectedDateForNewTask(null);
      }).then(keepSubscription);
      void listen<number>('desktop-calendar://opacity-changed', (event) => {
        if (typeof event.payload === 'number') {
          const value = normalizeDesktopCalendarOpacity(event.payload);
          setOpacity(value);
          localStorage.setItem('lanmind_desktop_cal_opacity', String(value));
        }
      }).then(keepSubscription);
      void listen<boolean>('desktop-calendar://show-completed-changed', (event) => {
        if (typeof event.payload === 'boolean') {
          setShowCompleted(event.payload);
          localStorage.setItem(DESKTOP_CALENDAR_SHOW_COMPLETED_KEY, String(event.payload));
        }
      }).then(keepSubscription);
      void listen<string>('desktop-calendar://theme-tone-changed', (event) => {
        const tone = normalizeDesktopCalendarThemeTone(event.payload);
        setThemeTone(tone);
        localStorage.setItem(DESKTOP_CALENDAR_THEME_TONE_KEY, tone);
      }).then(keepSubscription);
      void listen<string>('desktop-calendar://custom-color-changed', (event) => {
        const col = normalizeDesktopCalendarCustomColor(event.payload);
        setCustomColor(col);
        localStorage.setItem(DESKTOP_CALENDAR_CUSTOM_COLOR_KEY, col);
      }).then(keepSubscription);
      void listen<WeekStartDay>(TAURI_WEEK_START_EVENT, (event) => {
        if (event.payload === 'monday' || event.payload === 'sunday') {
          setWeekStartDay(event.payload);
        }
      }).then(keepSubscription);
    }

    return () => {
      disposed = true;
      window.removeEventListener('contextmenu', handleContextMenu, true);
      window.removeEventListener('lanmind-lunar-change', handleLunarChange as EventListener);
      window.removeEventListener('lanmind-desktop-cal-opacity-change', handleExtOpacityChange as EventListener);
      window.removeEventListener('lanmind-desktop-cal-show-completed-change', handleShowCompletedChange as EventListener);
      window.removeEventListener('lanmind-desktop-cal-custom-color-change', handleExtCustomColorChange as EventListener);
      window.removeEventListener(WEEK_START_CHANGE_EVENT, handleWeekStartChange as EventListener);
      window.removeEventListener('storage', handleStorageChange);

      subscriptions.forEach((dispose) => dispose());
    };
  }, [loadData]);

  const handleToggleShowCompleted = useCallback(() => {
    const next = !showCompleted;
    setShowCompleted(next);
    localStorage.setItem(DESKTOP_CALENDAR_SHOW_COMPLETED_KEY, String(next));
    window.dispatchEvent(new CustomEvent('lanmind-desktop-cal-show-completed-change', { detail: next }));
    void ApiService.setDesktopCalendarShowCompleted(next);
  }, [showCompleted]);

  const handleClose = async () => {
    if (isTauri()) {
      await ApiService.hideDesktopCalendar();
    }
  };

  const handleToggleTask = useCallback(async (task: Task) => {
    if (!currentUser || updatingTaskIds.has(task.id)) return;
    setUpdatingTaskIds((previous) => new Set(previous).add(task.id));
    try {
      await ApiService.updateTask(
        task.id,
        { status: task.status === 'completed' ? 'todo' : 'completed' },
        currentUser.id,
      );
      await loadData();
    } catch (error) {
      console.error('Failed to toggle desktop calendar task', error);
      await loadData();
    } finally {
      setUpdatingTaskIds((previous) => {
        const next = new Set(previous);
        next.delete(task.id);
        return next;
      });
    }
  }, [currentUser, loadData, updatingTaskIds]);

  // Let Windows run the drag loop on the window thread. No global mouse hook
  // or move-event feedback through the WebView.
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    if (!isTauri() || !isAdjustMode || e.button !== 0 || e.detail > 1) return;
    e.preventDefault();
    void getCurrentWindow().startDragging().catch((error) => {
      console.error('Failed to drag desktop calendar', error);
    });
  };

  const handleHeaderDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    void handleTogglePin();
  };

  // 8-Direction native resize during Adjust Mode
  const handleResizeMouseDown = (direction: string, e: React.MouseEvent) => {
    if (!isAdjustMode || !isTauri()) return;
    e.preventDefault();
    e.stopPropagation();
    const directions: Record<string, Parameters<ReturnType<typeof getCurrentWindow>['startResizeDragging']>[0]> = {
      n: 'North', s: 'South', e: 'East', w: 'West',
      nw: 'NorthWest', ne: 'NorthEast', sw: 'SouthWest', se: 'SouthEast',
    };
    const resizeDirection = directions[direction];
    if (resizeDirection) void getCurrentWindow().startResizeDragging(resizeDirection);
  };

  const gridCells = useMemo(
    () => generateCalendarGrid(year, month, weekStartDay),
    [year, month, weekStartDay]
  );

  const todayFormatted = formatDateKey(new Date());
  const monthStart = formatDateKey(new Date(year, month, 1));
  const monthEnd = formatDateKey(new Date(year, month + 1, 0));

  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, TaskOccurrence[]>();
    tasks.forEach((task) => {
      expandTaskOccurrences(task, monthStart, monthEnd).forEach((occ) => {
        const key = occ.dueDate.slice(0, 10);
        const existing = grouped.get(key) || [];
        existing.push(occ);
        grouped.set(key, existing);
      });
    });
    grouped.forEach((occurrences, key) => {
      grouped.set(key, sortDesktopCalendarOccurrences(occurrences, showCompleted));
    });
    return grouped;
  }, [tasks, monthStart, monthEnd, showCompleted]);

  const handleCellDoubleClick = (dateStr: string) => {
    setSelectedDateForNewTask(dateStr);
  };

  const handleOpenFullTaskForm = useCallback((targetDate?: string) => {
    const date = targetDate || selectedDateForNewTask || formatDateKey(new Date());
    setSelectedDateForNewTask(null);
    if (isTauri()) {
      void invoke('open_task_form', { date }).catch((error) => {
        console.error('Failed to open full task form', error);
      });
    }
  }, [selectedDateForNewTask]);

  const handleOpenTaskList = useCallback((date: string) => {
    if (!isTauri()) return;
    void invoke('open_task_list', { date }).catch((error) => {
      console.error('Failed to open task list', error);
    });
  }, []);

  const handleTaskCreated = useCallback((newTask: Task) => {
    setTasks((prev) => [...prev, newTask]);
  }, []);

  const headerInfo = useMemo(() => {
    return formatHeaderDateWithLunar(currentDate);
  }, [currentDate]);

  // One tinted surface blends with the real wallpaper in both modes.
  const containerBgStyle = useMemo(() => {
    const alpha = opacity / 100;
    if (themeTone === 'custom') {
      const { r, g, b } = hexToRgb(customColor);
      return {
        background: `rgba(${r}, ${g}, ${b}, ${alpha})`,
      };
    }
    return {
      background: `rgb(var(--calendar-tint) / ${alpha})`,
    };
  }, [opacity, themeTone, customColor, isLight]);


  return (
    <div
      data-theme={isLight ? 'titanium-light' : 'navy-slate'}
      style={containerBgStyle}
      className={`desktop-cal-container relative flex h-screen w-screen flex-col overflow-hidden rounded-2xl select-none ${
        isAdjustMode ? 'desktop-cal-adjust-mode' : ''
      }${opacity === 0 ? ' desktop-cal-transparent' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={() => setShowOpacityPopover(false)}
    >
      {/* 8 Resize Handles during Adjust Mode */}
      {isAdjustMode && (
        <>
          <div className="desktop-cal-resize-handle handle-n" onMouseDown={(e) => handleResizeMouseDown('n', e)} />
          <div className="desktop-cal-resize-handle handle-s" onMouseDown={(e) => handleResizeMouseDown('s', e)} />
          <div className="desktop-cal-resize-handle handle-w" onMouseDown={(e) => handleResizeMouseDown('w', e)} />
          <div className="desktop-cal-resize-handle handle-e" onMouseDown={(e) => handleResizeMouseDown('e', e)} />
          <div className="desktop-cal-resize-handle handle-nw" onMouseDown={(e) => handleResizeMouseDown('nw', e)} />
          <div className="desktop-cal-resize-handle handle-ne" onMouseDown={(e) => handleResizeMouseDown('ne', e)} />
          <div className="desktop-cal-resize-handle handle-sw" onMouseDown={(e) => handleResizeMouseDown('sw', e)} />
          <div className="desktop-cal-resize-handle handle-se" onMouseDown={(e) => handleResizeMouseDown('se', e)} />
        </>
      )}

      {/* Top Header Bar */}
      <div
        onMouseDown={handleHeaderMouseDown}
        onDoubleClick={handleHeaderDoubleClick}
        className={`desktop-cal-header flex h-12 shrink-0 items-center justify-between border-b px-4 transition-colors select-none ${
          isLight ? 'border-subtle/30' : 'border-white/10'
        } ${
          isAdjustMode
            ? 'bg-amber-500/15 cursor-move'
            : 'hover:bg-white/5 cursor-default'
        }`}
        title={isAdjustMode ? '按住可拖动移动位置；双击锁定' : '已锁定在桌面；双击进入调整模式，双击日期格可新建备忘'}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <CalendarIcon className="h-4 w-4 shrink-0 text-info" />
          <span className="text-sm font-bold tracking-wide truncate text-main">
            {headerInfo.fullTitle}
          </span>
          {isAdjustMode ? (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/25 px-2.5 py-0.5 text-[11px] font-medium text-warning animate-pulse shrink-0">
              <Sparkles className="h-3 w-3 text-warning" />
              <span>调整模式 · 拖动顶部移动，拖动边缘缩放，点击 📌 锁定</span>
            </div>
          ) : (
            <span className={`text-xs font-normal hidden lg:inline truncate ${isLight ? 'text-quiet' : 'text-sub/80'}`}>
              (双击日期格记录备忘 · 点击 📌 解锁拖动)
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0" data-no-drag onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={goToToday}
            className={`rounded-md border px-2 py-0.5 text-xs font-semibold transition ${
              isLight
                ? 'border-subtle bg-white/70 text-sub hover:bg-white'
                : 'border-white/15 bg-white/10 text-main hover:bg-white/20'
            }`}
            title="回到今天"
          >
            今天
          </button>
          <button
            type="button"
            onClick={prevMonth}
            className={`flex h-7 w-7 items-center justify-center rounded-md border transition ${
              isLight
                ? 'border-subtle bg-white/70 text-sub hover:bg-white'
                : 'border-white/10 bg-white/5 text-sub hover:bg-white/15'
            }`}
            title="上一月"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextMonth}
            className={`flex h-7 w-7 items-center justify-center rounded-md border transition ${
              isLight
                ? 'border-subtle bg-white/70 text-sub hover:bg-white'
                : 'border-white/10 bg-white/5 text-sub hover:bg-white/15'
            }`}
            title="下一月"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void loadData()}
            className={`flex h-7 w-7 items-center justify-center rounded-md border transition ${
              isLight
                ? 'border-subtle bg-white/70 text-sub hover:bg-white'
                : 'border-white/10 bg-white/5 text-sub hover:bg-white/15'
            }`}
            title="同步任务刷新"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>

          {/* Opacity Adjustment Button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowOpacityPopover((prev) => !prev)}
              className={`flex h-7 items-center gap-1 rounded-md border px-1.5 text-[11px] font-mono transition ${
                showOpacityPopover
                  ? 'border-blue-500 bg-blue-600/30 text-info'
                  : isLight
                  ? 'border-subtle bg-white/70 text-sub hover:bg-white'
                  : 'border-white/10 bg-white/5 text-sub hover:bg-white/15'
              }`}
              title={`调节背景透明度 (当前 ${opacity}%)`}
            >
              <Sliders className="h-3 w-3" />
              <span>{opacity}%</span>
            </button>

            {/* Opacity Dropdown Popover */}
            {showOpacityPopover && (
              <div
                className={`desktop-cal-popover absolute right-0 top-9 z-50 w-64 rounded-xl border p-3 shadow-popover backdrop-blur-md animate-in fade-in zoom-in-95 ${
                  isLight
                    ? 'border-subtle bg-white/95 text-main'
                    : 'border-white/20 bg-surface/98 text-main'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between text-xs font-semibold mb-2 text-main">
                  <span className="flex items-center gap-1.5">
                    <Sun className="h-3.5 w-3.5 text-warning" />
                    <span>背景透明度</span>
                  </span>
                  <span className="font-mono text-info font-bold">{opacity}%</span>
                </div>

                <input
                  type="range"
                  min={DESKTOP_CALENDAR_MIN_OPACITY}
                  max={DESKTOP_CALENDAR_MAX_OPACITY}
                  step="1"
                  value={opacity}
                  onChange={(e) => handleOpacityChange(Number(e.target.value))}
                  className="w-full h-1.5 bg-hover rounded-lg appearance-none cursor-pointer accent-blue-500"
                />

                <div className="mt-2.5 grid grid-cols-3 gap-1">
                  {[0, 10, 25, 50, 75, 90].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => handleOpacityChange(val)}
                      className={`px-2 py-0.5 text-[10px] font-medium rounded transition border ${
                        opacity === val
                          ? 'desktop-cal-btn-active bg-blue-600 text-on-solid font-bold shadow'
                          : isLight
                          ? 'desktop-cal-btn-inactive bg-surface text-sub hover:bg-hover border-subtle/80'
                          : 'desktop-cal-btn-inactive bg-white/10 text-sub hover:bg-white/20 border-white/10'
                      }`}
                    >
                      {val}%
                    </button>
                  ))}
                </div>

                {/* 半透明底色配置 (仅支持：跟随主题 / 自定义颜色) */}
                <div className="mt-3 pt-2.5 border-t border-white/10">
                  <div className="text-[11px] font-semibold mb-1.5 flex items-center justify-between text-sub">
                    <span>半透明底色</span>
                    <span className="text-[10px] text-info font-normal flex items-center gap-1">
                      {themeTone === 'custom' ? (
                        <>
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full border border-white/30"
                            style={{ backgroundColor: customColor }}
                          />
                          <span>自选色 ({customColor.toUpperCase()})</span>
                        </>
                      ) : (
                        '跟随主题'
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleThemeToneChange('system')}
                      className={`px-2 py-1 text-[11px] font-medium rounded transition flex items-center justify-center gap-1.5 border ${
                        themeTone === 'system'
                          ? 'desktop-cal-btn-active bg-blue-600 text-on-solid font-bold shadow'
                          : isLight
                          ? 'desktop-cal-btn-inactive bg-surface text-sub hover:bg-hover border-subtle/80'
                          : 'desktop-cal-btn-inactive bg-white/10 text-sub hover:bg-white/20 border-white/10'
                      }`}
                      title="跟随应用与系统全局主题配色"
                    >
                      <Sun className="h-3 w-3 shrink-0" />
                      <span>跟随主题</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleThemeToneChange('custom')}
                      className={`px-2 py-1 text-[11px] font-medium rounded transition flex items-center justify-center gap-1.5 border ${
                        themeTone === 'custom'
                          ? 'desktop-cal-btn-active bg-blue-600 text-on-solid font-bold shadow'
                          : isLight
                          ? 'desktop-cal-btn-inactive bg-surface text-sub hover:bg-hover border-subtle/80'
                          : 'desktop-cal-btn-inactive bg-white/10 text-sub hover:bg-white/20 border-white/10'
                      }`}
                      title="自选底色与色盘自定义"
                    >
                      <Palette className="h-3 w-3 shrink-0" />
                      <span>自定义颜色</span>
                    </button>
                  </div>

                  {/* 自选颜色面板：原生色盘 + 常用精选预设 */}
                  {themeTone === 'custom' && (
                    <div className="mt-2 p-2 rounded-lg border border-white/10 bg-black/20 flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="relative flex items-center gap-2 cursor-pointer group flex-1">
                          <span
                            className="w-6 h-6 rounded-md border border-white/30 shadow-soft shrink-0 transition-transform group-hover:scale-105"
                            style={{ backgroundColor: customColor }}
                          />
                          <span className="text-[11px] font-medium text-main">
                            点击色盘挑选
                          </span>
                          <input
                            type="color"
                            value={customColor}
                            onChange={(e) => handleCustomColorChange(e.target.value)}
                            className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                            title="打开颜色选择器"
                          />
                        </label>
                        <span className="font-mono text-[11px] text-info font-bold px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">
                          {customColor.toUpperCase()}
                        </span>
                      </div>

                      {/* 预设推荐常用色 */}
                      <div className="grid grid-cols-6 gap-1 pt-1.5 border-t border-white/10">
                        {CALENDAR_PRESET_COLORS.map((preset) => {
                          const isSelected = customColor.toLowerCase() === preset.hex.toLowerCase();
                          return (
                            <button
                              key={preset.hex}
                              type="button"
                              onClick={() => handleCustomColorChange(preset.hex)}
                              title={`${preset.name} (${preset.hex})`}
                              className={`h-5 w-full rounded border transition-all flex items-center justify-center ${
                                isSelected
                                  ? 'border-blue-400 ring-2 ring-blue-500/80 scale-105 z-10'
                                  : 'border-white/20 hover:border-white/50 hover:scale-105'
                              }`}
                              style={{ backgroundColor: preset.hex }}
                            >
                              {isSelected && (
                                <span className={`text-[9px] font-bold ${preset.hex === '#f8fafc' ? 'text-main' : 'text-main'}`}>
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


                <button
                  type="button"
                  role="switch"
                  aria-checked={showCompleted}
                  onClick={handleToggleShowCompleted}
                  className={`mt-3 flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-left text-[11px] font-medium transition ${
                    isLight
                      ? 'border-edge bg-surface text-sub hover:bg-hover'
                      : 'border-white/10 bg-white/5 text-sub hover:bg-white/10'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {showCompleted ? <Eye className="h-3.5 w-3.5 text-info" /> : <EyeOff className="h-3.5 w-3.5 text-quiet" />}
                    <span>显示已完成任务</span>
                  </span>
                  <span className={`ui-switch !h-5 !w-9 ${showCompleted ? '!bg-blue-600 !border-blue-500' : ''}`} data-state={showCompleted ? 'checked' : 'unchecked'}>
                    <span className="ui-switch-thumb !h-3.5 !w-3.5 !top-[2px] !left-[2px]" />
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Pin/Adjust Mode Button */}
          <button
            type="button"
            onClick={() => void handleTogglePin()}
            className={`flex h-7 w-7 items-center justify-center rounded-md border transition ${
              isAdjustMode
                ? 'border-amber-400/60 bg-amber-500/25 text-warning ring-2 ring-amber-400/40 shadow-soft'
                : isLight
                ? 'border-subtle bg-white/70 text-info hover:bg-white'
                : 'border-white/10 bg-white/5 text-info hover:bg-white/15'
            }`}
            title={
              isAdjustMode
                ? '调整中：按住顶部拖动移动，拖动边缘缩放大小；调整完成后点击此按钮固定锁定'
                : '已固定锁定：点击可解锁调整位置与大小；双击日期可记录备忘'
            }
          >
            <Pin
              className={`h-3.5 w-3.5 transition-transform ${
                isAdjustMode ? 'text-warning rotate-0' : 'text-info rotate-45'
              }`}
            />
          </button>

          {/* Close Button */}
          <button
            type="button"
            onClick={handleClose}
            className={`flex h-7 w-7 items-center justify-center rounded-md border transition ${
              isLight
                ? 'border-subtle bg-white/70 text-sub hover:bg-rose-500/30 hover:text-main'
                : 'border-white/10 bg-white/5 text-sub hover:bg-rose-500/30 hover:text-main'
            }`}
            title="关闭桌面日历（退出钉在桌面）"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Weekday Bar */}
      <div className={`desktop-cal-weekday-bar grid grid-cols-[38px_repeat(7,minmax(0,1fr))] border-b text-center text-xs font-semibold ${
        isLight
          ? 'border-subtle/30 bg-white/5 text-sub'
          : 'border-white/10 bg-white/5 text-sub'
      }`}>
        <div className={`py-2 text-[11px] border-r ${
          isLight ? 'text-sub border-subtle/30' : 'text-quiet border-white/10'
        }`}>周</div>
        {getWeekdayHeaders(weekStartDay, 'full').map((weekday, idx) => {
          const isWeekend = weekStartDay === 'sunday' ? (idx === 0 || idx === 6) : idx >= 5;
          return (
            <div
              key={weekday}
              className={`py-2 ${isWeekend ? 'text-warning/90' : 'text-sub'}`}
            >
              {weekday}
            </div>
          );
        })}
      </div>

      {/* Month Days Matrix */}
      <div className="desktop-cal-grid grid min-h-0 flex-1 grid-cols-[38px_repeat(7,minmax(0,1fr))] grid-rows-6 p-px">
        {/* 6 Rows of 7 days */}
        {Array.from({ length: 6 }).map((_, rowIndex) => {
          const rowStart = rowIndex * 7;
          const rowCells = gridCells.slice(rowStart, rowStart + 7);
          const midWeekDate = weekStartDay === 'sunday' ? rowCells[4].dateObj : rowCells[3].dateObj;
          const weekNum = getWeekNumber(midWeekDate);

          return (
            <React.Fragment key={`row-${rowIndex}`}>
              {/* Left Week Number */}
              <div className={`desktop-cal-week-number flex items-center justify-center border-r text-[11px] font-mono font-medium ${
                isLight
                  ? 'border-subtle/30 bg-black/5 text-quiet'
                  : 'border-white/10 bg-black/20 text-sub'
              }`}>
                {weekNum}
              </div>

              {/* 7 Day Cells */}
              {rowCells.map((cell) => {
                const isToday = cell.dateStr === todayFormatted;
                const cellTasks = tasksByDate.get(cell.dateStr) || [];
                const lunar = showLunar ? getLunarDateInfo(cell.dateStr) : null;

                return (
                  <div
                    key={cell.dateStr}
                    data-cell-date={cell.dateStr}
                    onDoubleClick={() => handleCellDoubleClick(cell.dateStr)}
                    className={`desktop-cal-cell group relative flex flex-col justify-between overflow-hidden p-1.5 transition-colors ${
                      isToday
                        ? 'ring-2 ring-blue-500/80 bg-info/10'
                        : isLight
                        ? 'hover:bg-black/[0.04]'
                        : 'hover:bg-white/[0.08]'
                    }`}
                  >
                    {/* Date Number & Lunar Badge Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span
                          className={`text-sm leading-none font-bold ${
                            isToday
                              ? 'rounded-full bg-blue-500 px-1.5 py-0.5 text-on-solid shadow-soft'
                              : cell.isCurrentMonth
                              ? 'text-main'
                              : (isLight ? 'opacity-55 text-quiet' : 'opacity-55 text-sub')
                          }`}
                        >
                          {cell.dayNum}
                        </span>
                        {showLunar && lunar && (
                          <span
                            className={`text-[10px] leading-none max-w-[70px] sm:max-w-[85px] truncate cursor-help ${
                              lunar.isFestival
                                ? 'text-warning font-semibold'
                                : lunar.isSolarTerm
                                ? 'text-success font-semibold'
                                : isLight ? 'text-quiet' : 'text-sub/90'
                            }`}
                            title={
                              lunar.festival
                                ? `${lunar.festival}（${lunar.fullText}）`
                                : lunar.solarTerm
                                ? `${lunar.solarTerm}（${lunar.fullText}）`
                                : lunar.fullText
                            }
                          >
                            {lunar.label}
                          </span>
                        )}
                      </div>

                      {/* Quick Add Button on Hover */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCellDoubleClick(cell.dateStr);
                        }}
                        className={`opacity-0 group-hover:opacity-100 h-4 w-4 rounded flex items-center justify-center transition-all ${
                          isLight
                            ? 'bg-surface/15 text-main hover:bg-blue-600 hover:text-on-solid'
                            : 'bg-white/25 text-on-solid hover:bg-blue-600'
                        }`}
                        title="双击或点击在此日期新建备忘"
                      >
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                    </div>

                    {/* Task Memos in Day Cell */}
                    <div className="mt-1 flex-1 space-y-1 overflow-y-auto overflow-x-hidden pr-0.5">
                      {cellTasks.slice(0, 3).map((occ) => {
                        const t = occ.task;
                        const isDone = t.status === 'completed';
                        const isUpdating = updatingTaskIds.has(t.id);
                        return (
                          <div
                            key={`${t.id}-${occ.dueDate}`}
                            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-snug border transition-all ${
                              isDone
                                ? isLight
                                  ? 'border-edge bg-surface/85 text-sub line-through opacity-75'
                                  : 'border-subtle/60 bg-surface/80 text-sub line-through opacity-75'
                                : t.priority === 'P1'
                                ? isLight
                                  ? 'border-rose-400/80 bg-rose-50/95 text-danger font-semibold'
                                  : 'border-rose-500/70 bg-danger/10 text-danger font-semibold'
                                : t.priority === 'P2'
                                ? isLight
                                  ? 'border-amber-400/80 bg-amber-50/95 text-warning font-semibold'
                                  : 'border-amber-500/70 bg-warning/10 text-warning font-semibold'
                                : isLight
                                  ? 'border-subtle/90 bg-white/95 text-main font-medium'
                                  : 'border-subtle/80 bg-surface/90 text-main font-medium'
                            }`}
                            title={t.title}
                          >
                            <ThemeCheckbox
                              checked={isDone}
                              disabled={isUpdating}
                              onChange={() => void handleToggleTask(t)}
                              onClick={(event) => event.stopPropagation()}
                              size="sm"
                              ariaLabel={`${isDone ? '撤销完成' : '完成'}任务：${t.title}`}
                            />
                            <span className="flex-1 truncate select-none">
                              {t.title}
                            </span>
                          </div>
                        );
                      })}
                      {cellTasks.length > 3 && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenTaskList(cell.dateStr);
                          }}
                          className={`flex w-full items-center justify-center rounded border px-1 py-0.5 text-[9px] font-medium transition ${
                            isLight
                              ? 'border-blue-300 bg-blue-50/90 text-info hover:bg-blue-100 hover:text-info'
                              : 'border-blue-500/40 bg-info/10 text-info hover:bg-info/10 hover:text-main'
                          }`}
                          title="查看当天全部任务"
                        >
                          +{cellTasks.length - 3} 项任务，查看全部
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>

      {/* AI-Assisted Quick Task Creation Modal */}
      <DesktopCalendarTaskModal
        isOpen={!!selectedDateForNewTask}
        dateStr={selectedDateForNewTask || ''}
        currentUser={currentUser}
        projects={projects}
        users={users}
        onClose={() => setSelectedDateForNewTask(null)}
        onTaskCreated={handleTaskCreated}
        onOpenFullForm={handleOpenFullTaskForm}
        showLunar={showLunar}
      />
    </div>
  );
}

export default function DesktopCalendarWindow() {
  return (
    <ThemeProvider>
      <DesktopCalendarContent />
    </ThemeProvider>
  );
}
