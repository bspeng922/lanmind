import React, { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Wifi,
  AlertTriangle,
  Search,
  Zap,
  Settings,
  Minus,
  Square,
  Copy,
  X,
  Pin,
} from 'lucide-react';
import { ThemeQuickSwitcher } from './ThemeQuickSwitcher';
import { ApiService } from '../services/api';

interface HeaderProps {
  onOpenQuickAdd: () => void;
  onOpenLLMConfig: () => void;
  onOpenRiskScanner: () => void;
  onOpenSyncMonitor: () => void;
  onOpenProfileModal: () => void;
  onOpenThemeModal: () => void;
  onOpenShortcutModal?: () => void;
  onOpenSettingsModal?: (tab?: 'basic' | 'theme' | 'shortcuts') => void;
  riskCount: number;
  syncVersion: number;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenQuickAdd,
  onOpenLLMConfig,
  onOpenRiskScanner,
  onOpenSyncMonitor,
  onOpenProfileModal,
  onOpenThemeModal,
  onOpenShortcutModal,
  onOpenSettingsModal,
  riskCount,
  syncVersion,
  searchQuery,
  setSearchQuery,
}) => {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isDesktopPinned, setIsDesktopPinned] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    ApiService.isDesktopCalendarVisible().then(setIsDesktopPinned).catch(() => {});
    const unlistenPromise = listen<boolean>('desktop-calendar://state-changed', (event) => {
      setIsDesktopPinned(Boolean(event.payload));
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const handleToggleDesktopCalendar = async () => {
    if (!isTauri()) return;
    try {
      const active = await ApiService.toggleDesktopCalendar();
      setIsDesktopPinned(active);
    } catch (e) {
      console.error('Failed to toggle desktop calendar', e);
    }
  };

  useEffect(() => {
    if (!isTauri()) return;

    const appWindow = getCurrentWindow();
    let active = true;
    let unlisten: (() => void) | undefined;

    const syncMaximizedState = () => {
      appWindow
        .isMaximized()
        .then((maximized) => {
          if (active) setIsWindowMaximized(maximized);
        })
        .catch((error) => console.error('Failed to read maximized state', error));
    };

    syncMaximizedState();
    appWindow
      .onResized(syncMaximizedState)
      .then((nextUnlisten) => {
        if (active) unlisten = nextUnlisten;
        else nextUnlisten();
      })
      .catch((error) => console.error('Failed to listen for window resize', error));

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const runWindowCommand = async (command: 'minimize' | 'maximize' | 'close') => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    try {
      if (command === 'minimize') {
        await appWindow.minimize();
      } else if (command === 'maximize') {
        await appWindow.toggleMaximize();
        setIsWindowMaximized(await appWindow.isMaximized());
      } else {
        await appWindow.close();
      }
    } catch (error) {
      console.error(`Window ${command} failed`, error);
    }
  };

  const handleTitleBarDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, input, [data-no-drag]')) return;
    runWindowCommand('maximize');
  };

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={handleTitleBarDoubleClick}
      className="h-14 shrink-0 bg-slate-900 border-b border-slate-800 text-slate-100 pl-4 flex items-center justify-between shadow-md z-30 select-none"
    >
      {/* Left: App Title & Dynamic Themed Logo */}
      <div data-tauri-drag-region className="flex items-center space-x-3">
        <div data-tauri-drag-region className="flex items-center space-x-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-transform hover:scale-105"
            style={{
              background: 'var(--accent-gradient)',
              boxShadow: '0 4px 14px var(--accent-glow)',
            }}
          >
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div data-tauri-drag-region>
            <h1 data-tauri-drag-region className="text-sm font-bold tracking-wide text-slate-100 flex items-center gap-2">
              智域协同
            </h1>
            <div data-tauri-drag-region className="flex items-center space-x-2 text-[10px] text-slate-400">
              <span data-tauri-drag-region>局域网 AI 协同任务管理</span>
            </div>
          </div>
        </div>
      </div>

      {/* Middle: Enhanced Global Search */}
      <div data-no-drag className="hidden md:flex items-center flex-1 max-w-sm mx-4">
        <div className="relative w-full group">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 transition-colors group-focus-within:text-blue-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索任务、标签或责任人..."
            className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl pl-9 pr-14 py-1.5 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all shadow-inner"
          />
          <div className="absolute right-2.5 top-2 flex items-center gap-1">
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-0.5 text-slate-400 hover:text-white rounded transition-colors"
                title="清空搜索"
              >
                <X className="w-3 h-3" />
              </button>
            ) : (
              <kbd className="hidden lg:inline text-[9px] font-mono bg-slate-700/60 px-1.5 py-0.5 rounded border border-slate-600/60 text-slate-400">
                Ctrl K
              </kbd>
            )}
          </div>
        </div>
      </div>

      {/* Right: Quick Action Controls & Panel Toggle */}
      <div data-no-drag className="flex h-full items-center space-x-2 pr-1">
        {/* Primary Action Button (Theme Gradient) */}
        <button
          onClick={onOpenQuickAdd}
          className="theme-btn-primary h-8 px-3 text-xs"
          title="快捷创建任务"
          aria-label="快捷创建任务"
        >
          <Zap className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">新建</span>
        </button>

        {/* Quick Theme Switcher */}
        <ThemeQuickSwitcher
          onOpenFullCustomizer={() =>
            onOpenSettingsModal ? onOpenSettingsModal('theme') : onOpenThemeModal()
          }
        />

        {/* Risk Scanner Alert */}
        <button
          onClick={onOpenRiskScanner}
          className={`relative p-2 rounded-lg border text-xs flex items-center space-x-1 transition-all ${
            riskCount > 0
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
              : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-700'
          }`}
          title="AI 任务风险诊断"
        >
          <AlertTriangle className="w-4 h-4" />
          {riskCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-amber-500 text-slate-950 font-bold text-[10px] w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
              {riskCount}
            </span>
          )}
        </button>

        {/* P2P LAN Status Monitor */}
        <button
          onClick={onOpenSyncMonitor}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-800/80 text-slate-200 transition-colors hover:bg-slate-700"
          title={`局域网 P2P 增量同步监控 · v${syncVersion}`}
          aria-label={`打开同步监控，当前版本 ${syncVersion}`}
        >
          <Wifi className="h-4 w-4 text-emerald-400" />
        </button>

        {/* Pin to Desktop Button */}
        {isTauri() && (
          <button
            onClick={handleToggleDesktopCalendar}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs transition-colors ${
              isDesktopPinned
                ? 'bg-blue-600/20 text-blue-400 border-blue-500/50 hover:bg-blue-600/30'
                : 'border-slate-700/80 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
            title={isDesktopPinned ? '桌面日历已开启（点击隐藏）' : '钉到桌面（透明日历，保持在其他应用下方）'}
            aria-label="钉到桌面"
          >
            <Pin className={`w-4 h-4 ${isDesktopPinned ? 'text-blue-400 rotate-45' : 'text-slate-300'}`} />
          </button>
        )}

        {/* Unified System Settings Button */}
        <button
          onClick={() => (onOpenSettingsModal ? onOpenSettingsModal('basic') : onOpenThemeModal())}
          className="group flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-800/80 text-slate-200 transition-colors hover:bg-slate-700"
          title="系统设置"
          aria-label="打开系统设置"
        >
          <Settings className="w-4 h-4 text-slate-300 group-hover:rotate-45 transition-transform" />
        </button>

        {/* Window Control Buttons */}
        <div className="ml-1 flex h-full items-stretch border-l border-slate-800/80">
          <button
            type="button"
            onClick={() => runWindowCommand('minimize')}
            className="window-control-button flex h-full w-11 items-center justify-center"
            title="最小化"
            aria-label="最小化窗口"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => runWindowCommand('maximize')}
            className="window-control-button flex h-full w-11 items-center justify-center"
            title={isWindowMaximized ? '还原' : '最大化'}
            aria-label={isWindowMaximized ? '还原窗口' : '最大化窗口'}
          >
            {isWindowMaximized ? (
              <Copy className="h-3.5 w-3.5" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => runWindowCommand('close')}
            className="window-control-button window-control-button-close flex h-full w-11 items-center justify-center"
            title="关闭到系统托盘"
            aria-label="关闭到系统托盘"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
