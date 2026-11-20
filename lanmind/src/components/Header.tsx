import { tr, useLocale } from "../i18n";
import React, { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Wifi,
  AlertTriangle,
  Search,
  Plus,
  Minus,
  Square,
  Copy,
  X,
  Pin,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { LanMindLogo } from './LanMindLogo';
import { WorkspaceSwitcher } from './workspace/WorkspaceSwitcher';
import type { Workspace, WorkspaceMember } from '../types';
import { ApiService } from '../services/api';
import { isMacOS, getPlatform } from '../utils/platform';
import {
  blurWindowControlFocus,
  scheduleWindowControlFocusReset,
} from '../utils/windowControlFocus';

interface HeaderProps {
  onOpenQuickAdd: () => void;
  onOpenCommandPalette?: () => void;
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
  onOpenCommandPalette,
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
      className="app-header h-12 shrink-0 bg-surface text-main pl-3.5 flex items-center justify-between gap-2 z-40 select-none"
    >
      {/* Left: App Title & Dynamic Themed Logo (with macOS window controls) */}
      <div data-tauri-drag-region className="app-header-start flex flex-wrap items-center gap-2.5">
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
        <div data-tauri-drag-region className="app-header-brand flex items-center gap-2.5">
          <LanMindLogo size="sm" className="pointer-events-none gap-2" />
          <div data-tauri-drag-region className="flex flex-col">
            <h1 data-tauri-drag-region className="text-[13px] font-semibold tracking-tight text-main leading-none">
              {tr("common:header.lanmind")}
            </h1>
            <div data-tauri-drag-region className="app-header-subtitle mt-0.5 text-[11px] leading-none text-quiet">
              <span data-tauri-drag-region>{tr("common:header.lanTaskManagement")}</span>
            </div>
          </div>
        </div>
        {/* Back and Forward navigation buttons */}
        <div data-no-drag className="flex items-center gap-0.5 pl-0.5">
          <button
            type="button"
            onClick={onNavigateBack}
            disabled={!canNavigateBack}
            className="flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-main disabled:opacity-25 disabled:pointer-events-none transition-colors"
            title={tr("common:header.back")}
            aria-label={tr("common:header.back")}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onNavigateForward}
            disabled={!canNavigateForward}
            className="flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-main disabled:opacity-25 disabled:pointer-events-none transition-colors"
            title={tr("common:header.forward")}
            aria-label={tr("common:header.forward")}
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

      {/* Middle Drag Region + Command Palette Trigger */}
      <div data-tauri-drag-region className="flex flex-1 items-center justify-center px-2 min-w-0">
        {onOpenCommandPalette && (
          <button
            type="button"
            data-no-drag
            onClick={onOpenCommandPalette}
            className="hidden md:inline-flex h-8 w-full max-w-[260px] items-center justify-between gap-2 rounded-lg border border-edge bg-card/80 px-2.5 text-xs text-quiet hover:border-edge-strong hover:bg-card hover:text-sub transition-colors"
            title={tr("common:commandPalette.title")}
            aria-label={tr("common:commandPalette.title")}
          >
            <span className="flex items-center gap-2 truncate">
              <Search className="h-3.5 w-3.5 shrink-0 text-quiet" />
              <span className="truncate">{tr("common:header.openCommandPalette")}</span>
            </span>
            <kbd className="shrink-0 rounded border border-subtle bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-sub">
              {isMac ? '⌘K' : 'Ctrl K'}
            </kbd>
          </button>
        )}
      </div>

      {/* Right: Quick Action Controls & Panel Toggle */}
      <div data-no-drag className={`app-header-actions flex items-center gap-1 ${isMac ? 'pr-3' : 'pr-1'}`}>
        {/* Primary Action Button */}
        <button
          type="button"
          onClick={onOpenQuickAdd}
          className="theme-btn-primary inline-flex h-7 w-7 items-center justify-center rounded-md p-0 text-xs transition-all"
          title={tr("common:header.quickAddTask")}
          aria-label={tr("common:header.quickAddTask")}
        >
          <Plus className="h-4 w-4" />
        </button>

        {/* Risk Scanner Alert */}
        <button
          type="button"
          onClick={onOpenRiskScanner}
          className={`relative flex h-8 w-8 items-center justify-center rounded-md text-xs transition-colors ${
            riskCount > 0
              ? 'bg-warning/10 text-warning hover:bg-warning/20'
              : 'text-sub hover:bg-hover hover:text-main'
          }`}
          title={tr("common:header.aiRiskAnalysis")}
          aria-label={tr("common:header.aiRiskAnalysis")}
        >
          <AlertTriangle className="w-4 h-4" />
          {riskCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-warning-solid text-on-warning font-bold tabular-nums text-[10px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center motion-safe:animate-pulse">
              {riskCount}
            </span>
          )}
        </button>

        {/* P2P LAN Status Monitor */}
        <button
          type="button"
          onClick={onOpenSyncMonitor}
          className="flex h-8 w-8 items-center justify-center rounded-md text-sub transition-colors hover:bg-hover hover:text-main"
          title={tr("common:header.lanSyncMonitorV", { value0: syncVersion })}
          aria-label={tr("common:header.openSyncMonitorVersion", { value0: syncVersion })}
        >
          <Wifi className="h-4 w-4 text-success" />
        </button>

        {/* Pin to Desktop Button */}
        {isTauri() && (
          <button
            type="button"
            onClick={handleToggleDesktopCalendar}
            className={`flex h-8 w-8 items-center justify-center rounded-md text-xs transition-colors ${
              isDesktopPinned
                ? 'bg-accent/15 text-accent-text hover:bg-accent/25'
                : 'text-sub hover:bg-hover hover:text-main'
            }`}
            title={isDesktopPinned ? tr("common:header.desktopCalendarIsOnClickToHide") : tr("common:header.pinCalendarToDesktopBelowOtherApplications")}
            aria-label={tr("common:header.pinToDesktop")}
          >
            <Pin className={`w-4 h-4 ${isDesktopPinned ? 'text-accent-text rotate-45' : ''}`} />
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
