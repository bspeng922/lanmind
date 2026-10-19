import { tr, useLocale } from "../i18n";
import React, { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Wifi,
  AlertTriangle,
  Search,
  Zap,
  Minus,
  Square,
  Copy,
  X,
  Pin,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { WorkspaceSwitcher } from './workspace/WorkspaceSwitcher';
import type { Workspace, WorkspaceMember } from '../types';
import { ApiService } from '../services/api';
import { isMacOS, getPlatform } from '../utils/platform';
import { useAppIcon } from '../utils/appIcon';
import {
  blurWindowControlFocus,
  scheduleWindowControlFocusReset,
} from '../utils/windowControlFocus';

interface HeaderProps {
  onOpenQuickAdd: () => void;
  onOpenLLMConfig: () => void;
  onOpenRiskScanner: () => void;
  onOpenSyncMonitor: () => void;
  onOpenProfileModal: () => void;
  onOpenThemeModal: () => void;
  onOpenShortcutModal?: () => void;
  onOpenSettingsModal?: (tab?: 'basic' | 'theme' | 'shortcuts') => void;
  onOpenOpticalTransfer?: () => void;
  riskCount: number;
  syncVersion: number;
  searchQuery?: string;
  setSearchQuery?: (q: string) => void;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  /** 当前工作区。为空时切换器只显示占位名称。 */
  workspace?: Workspace | null;
  workspaceMembers?: WorkspaceMember[];
  currentUserId?: string;
  onOpenWorkspaceSettings?: () => void;
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
  onOpenOpticalTransfer,
  riskCount,
  syncVersion,
  searchQuery,
  setSearchQuery,
  canNavigateBack = false,
  canNavigateForward = false,
  onNavigateBack,
  onNavigateForward,
  workspace = null,
  workspaceMembers = [],
  currentUserId,
  onOpenWorkspaceSettings,
}) => {
  useLocale();
  const { iconConfig } = useAppIcon();
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isDesktopPinned, setIsDesktopPinned] = useState(false);
  const [isMac, setIsMac] = useState(isMacOS());

  useEffect(() => {
    getPlatform().then(() => setIsMac(isMacOS())).catch(() => {});
  }, []);

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

    let cancelFocusReset: (() => void) | undefined;
    const clearWindowControlFocus = () => {
      cancelFocusReset?.();
      cancelFocusReset = scheduleWindowControlFocusReset();
    };

    window.addEventListener('focus', clearWindowControlFocus);

    // When the window is re-shown from the system tray, `visibilitychange`
    // fires at the moment the page becomes paintable. This is the most
    // reliable hook for clearing focus that WebView2 silently restores after
    // the native activation sequence has finished.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') clearWindowControlFocus();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    let unlistenFocus: (() => void) | undefined;
    appWindow
      .onFocusChanged(({ payload: focused }) => {
        if (focused) clearWindowControlFocus();
      })
      .then((nextUnlisten) => {
        if (active) unlistenFocus = nextUnlisten;
        else nextUnlisten();
      })
      .catch(() => {});

    return () => {
      active = false;
      window.removeEventListener('focus', clearWindowControlFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cancelFocusReset?.();
      unlisten?.();
      unlistenFocus?.();
    };
  }, []);

  const runWindowCommand = async (command: 'minimize' | 'maximize' | 'close') => {
    blurWindowControlFocus();
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

  // Closing to the tray keeps this WebView alive. Prevent the
  // clicked title-bar control from becoming the focus restored by WebView2.
  const preventWindowControlMouseFocus = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  const handleTitleBarDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, input, [data-no-drag]')) return;
    runWindowCommand('maximize');
  };

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={handleTitleBarDoubleClick}
      className="h-14 shrink-0 bg-surface border-b border-edge text-main pl-4 flex items-center justify-between shadow-panel z-40 select-none"
    >
      {/* Left: App Title & Dynamic Themed Logo (with macOS window controls) */}
      <div data-tauri-drag-region className="flex items-center space-x-3">
        {isMac && isTauri() && (
          <div className="flex items-center space-x-2 mr-1 group" data-no-drag>
            <button
              type="button"
              onClick={() => runWindowCommand('close')}
              className="w-3 h-3 rounded-full bg-[#ff5f56] hover:brightness-90 flex items-center justify-center text-[#4c0000] transition-transform active:scale-95 cursor-pointer"
              title={tr("common:header.close")}
              aria-label={tr("common:header.closeWindow")}
            >
              <X className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <button
              type="button"
              onClick={() => runWindowCommand('minimize')}
              className="w-3 h-3 rounded-full bg-[#ffbd2e] hover:brightness-90 flex items-center justify-center text-[#5c3c00] transition-transform active:scale-95 cursor-pointer"
              title={tr("common:header.minimize")}
              aria-label={tr("common:header.minimizeWindow")}
            >
              <Minus className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <button
              type="button"
              onClick={() => runWindowCommand('maximize')}
              className="w-3 h-3 rounded-full bg-[#27c93f] hover:brightness-90 flex items-center justify-center text-[#003e00] transition-transform active:scale-95 cursor-pointer"
              title={isWindowMaximized ? tr("common:header.restore") : tr("common:header.maximize")}
              aria-label={tr("common:header.maximizeWindow")}
            >
              <Square className="w-1.5 h-1.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </div>
        )}
        <div data-tauri-drag-region className="flex items-center space-x-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-transform hover:scale-105"
            style={{
              background: iconConfig.gradient,
              boxShadow: `0 4px 14px ${iconConfig.glow}`,
            }}
          >
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div data-tauri-drag-region>
            <h1 data-tauri-drag-region className="text-sm font-bold tracking-wide text-main flex items-center gap-2">
              {tr("common:header.lanmind")}</h1>
            <div data-tauri-drag-region className="flex items-center space-x-2 text-[10px] text-sub">
              <span data-tauri-drag-region>{tr("common:header.lanTaskManagement")}</span>
            </div>
          </div>
        </div>
        {/* Back and Forward navigation buttons */}
        <div data-no-drag className="flex items-center space-x-0.5 pl-0.5">
          <button
            type="button"
            onClick={onNavigateBack}
            disabled={!canNavigateBack}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main disabled:opacity-25 disabled:pointer-events-none transition-colors"
            title="后退"
            aria-label="后退"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onNavigateForward}
            disabled={!canNavigateForward}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main disabled:opacity-25 disabled:pointer-events-none transition-colors"
            title="前进"
            aria-label="前进"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {onOpenWorkspaceSettings && (
          <WorkspaceSwitcher
            workspace={workspace}
            members={workspaceMembers}
            currentUserId={currentUserId}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          />
        )}
      </div>

      {/* Middle Drag Region */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Right: Quick Action Controls & Panel Toggle */}
      <div data-no-drag className={`flex h-full items-center space-x-2 ${isMac ? 'pr-3' : 'pr-1'}`}>
        {/* Primary Action Button (Theme Gradient) */}
        <button
          onClick={onOpenQuickAdd}
          className="theme-btn-primary h-8 w-8 p-0 text-xs"
          title={tr("common:header.quickAddTask")}
          aria-label={tr("common:header.quickAddTask")}
        >
          <Zap className="h-3.5 w-3.5" />
        </button>


        {/* Risk Scanner Alert */}
        <button
          onClick={onOpenRiskScanner}
          className={`relative p-2 rounded-lg border text-xs flex items-center space-x-1 transition-all ${
            riskCount > 0
              ? 'bg-amber-500/10 border-amber-500/30 text-warning hover:bg-amber-500/20'
              : 'bg-card/80 border-subtle/80 text-sub hover:bg-hover'
          }`}
          title={tr("common:header.aiRiskAnalysis")}
        >
          <AlertTriangle className="w-4 h-4" />
          {riskCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-amber-500 text-main font-bold text-[10px] w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
              {riskCount}
            </span>
          )}
        </button>

        {/* P2P LAN Status Monitor */}
        <button
          onClick={onOpenSyncMonitor}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-subtle/80 bg-card/80 text-main transition-colors hover:bg-hover"
          title={tr("common:header.lanSyncMonitorV", { value0: syncVersion })}
          aria-label={tr("common:header.openSyncMonitorVersion", { value0: syncVersion })}
        >
          <Wifi className="h-4 w-4 text-success" />
        </button>

        {/* Pin to Desktop Button */}
        {isTauri() && (
          <button
            onClick={handleToggleDesktopCalendar}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs transition-colors ${
              isDesktopPinned
                ? 'bg-blue-600/20 text-info border-blue-500/50 hover:bg-blue-600/30'
                : 'border-subtle/80 bg-card/80 text-sub hover:bg-hover'
            }`}
            title={isDesktopPinned ? tr("common:header.desktopCalendarIsOnClickToHide") : tr("common:header.pinCalendarToDesktopBelowOtherApplications")}
            aria-label={tr("common:header.pinToDesktop")}
          >
            <Pin className={`w-4 h-4 ${isDesktopPinned ? 'text-info rotate-45' : 'text-sub'}`} />
          </button>
        )}


        {/* Window Control Buttons (Windows/Linux) */}
        {!isMac && isTauri() && (
          <div className="ml-1 flex h-full items-stretch border-l border-edge/80">
            <button
              type="button"
              onMouseDown={preventWindowControlMouseFocus}
              onClick={() => runWindowCommand('minimize')}
              className="window-control-button flex h-full w-11 items-center justify-center"
              title={tr("common:header.minimize")}
              aria-label={tr("common:header.minimizeWindow")}
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onMouseDown={preventWindowControlMouseFocus}
              onClick={() => runWindowCommand('maximize')}
              className="window-control-button flex h-full w-11 items-center justify-center"
              title={isWindowMaximized ? tr("common:header.restore") : tr("common:header.maximize")}
              aria-label={isWindowMaximized ? tr("common:header.restoreWindow") : tr("common:header.maximizeWindow")}
            >
              {isWindowMaximized ? (
                <Copy className="h-3.5 w-3.5" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onMouseDown={preventWindowControlMouseFocus}
              onClick={() => runWindowCommand('close')}
              className="window-control-button window-control-button-close flex h-full w-11 items-center justify-center"
              title={tr("common:header.close")}
              aria-label={tr("common:header.closeWindow")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
