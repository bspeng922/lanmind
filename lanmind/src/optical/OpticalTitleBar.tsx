import React, { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  QrCode,
  Upload,
  ScanLine,
  Minus,
  Square,
  Copy,
  X,
} from 'lucide-react';
import { isMacOS, getPlatform } from '../utils/platform';
import {
  blurWindowControlFocus,
  scheduleWindowControlFocusReset,
} from '../utils/windowControlFocus';

export interface OpticalTitleBarProps {
  tab: 'send' | 'receive';
  onTabChange: (tab: 'send' | 'receive') => void;
  receiverOnly?: boolean;
}

export const OpticalTitleBar: React.FC<OpticalTitleBarProps> = ({
  tab,
  onTabChange,
  receiverOnly = false,
}) => {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isMac, setIsMac] = useState(isMacOS());

  useEffect(() => {
    getPlatform().then(() => setIsMac(isMacOS())).catch(() => {});
  }, []);

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
      cancelFocusReset?.();
      unlisten?.();
      unlistenFocus?.();
    };
  }, []);

  const runWindowCommand = async (command: 'minimize' | 'maximize' | 'close') => {
    blurWindowControlFocus();
    if (isTauri()) {
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
    } else {
      if (command === 'close') {
        window.close();
      }
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
      className="h-14 shrink-0 bg-surface border-b border-edge text-main pl-4 flex items-center justify-between shadow-panel z-30 select-none"
    >
      {/* Left: App Title & Logo */}
      <div data-tauri-drag-region className="flex items-center space-x-3">
        {isMac && isTauri() && (
          <div className="flex items-center space-x-2 mr-1 group" data-no-drag>
            <button
              type="button"
              onClick={() => runWindowCommand('close')}
              className="w-3 h-3 rounded-full bg-[#ff5f56] hover:brightness-90 flex items-center justify-center text-[#4c0000] transition-transform active:scale-95 cursor-pointer"
              title="关闭窗口"
              aria-label="关闭窗口"
            >
              <X className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <button
              type="button"
              onClick={() => runWindowCommand('minimize')}
              className="w-3 h-3 rounded-full bg-[#ffbd2e] hover:brightness-90 flex items-center justify-center text-[#5c3c00] transition-transform active:scale-95 cursor-pointer"
              title="最小化"
              aria-label="最小化窗口"
            >
              <Minus className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <button
              type="button"
              onClick={() => runWindowCommand('maximize')}
              className="w-3 h-3 rounded-full bg-[#27c93f] hover:brightness-90 flex items-center justify-center text-[#003e00] transition-transform active:scale-95 cursor-pointer"
              title={isWindowMaximized ? '还原' : '最大化'}
              aria-label="最大化窗口"
            >
              <Square className="w-1.5 h-1.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </div>
        )}

        <div data-tauri-drag-region className="flex items-center space-x-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-transform hover:scale-105"
            style={{
              background: 'var(--accent-gradient)',
              boxShadow: '0 4px 14px var(--accent-glow)',
            }}
          >
            <QrCode className="w-4 h-4 text-main" />
          </div>
          <div data-tauri-drag-region>
            <h1 data-tauri-drag-region className="text-sm font-bold tracking-wide text-main flex items-center gap-2">
              光学文件传输
            </h1>
            <div data-tauri-drag-region className="flex items-center space-x-2 text-[10px] text-sub">
              <span data-tauri-drag-region>基于屏幕与摄像头的离线数据通道 · LMFT</span>
            </div>
          </div>
        </div>
      </div>

      {/* Middle: Mode Switch Tabs (Send / Receive) */}
      {!receiverOnly && (
        <div data-no-drag className="flex items-center bg-card/80 p-0.5 rounded-lg border border-subtle/80 shadow-inner">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'send'}
            onClick={() => onTabChange('send')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              tab === 'send'
                ? 'bg-accent text-on-accent shadow-sm'
                : 'text-sub hover:text-main hover:bg-hover/60'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>发送文件</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'receive'}
            onClick={() => onTabChange('receive')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              tab === 'receive'
                ? 'bg-accent text-on-accent shadow-sm'
                : 'text-sub hover:text-main hover:bg-hover/60'
            }`}
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span>接收扫描</span>
          </button>
        </div>
      )}

      {/* Right: Window Control Buttons */}
      <div data-no-drag className={`flex h-full items-center ${isMac && isTauri() ? 'pr-4' : 'pr-0'}`}>

        {/* Windows / Linux standard window controls or Web Close button */}
        {!isMac && isTauri() ? (
          <div className="ml-1 flex h-full items-stretch border-l border-edge/80">
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
              onClick={(e) => {
                e.currentTarget.blur();
                runWindowCommand('close');
              }}
              onMouseLeave={(e) => {
                e.currentTarget.blur();
              }}
              className="window-control-button window-control-button-close flex h-full w-11 items-center justify-center"
              title="关闭"
              aria-label="关闭窗口"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          /* Explicit Top-right Close Button for Mac or Web */
          <button
            type="button"
            onClick={() => runWindowCommand('close')}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-subtle/80 bg-card/80 text-sub transition-colors hover:bg-danger hover:text-on-solid hover:border-danger"
            title="关闭窗口"
            aria-label="关闭窗口"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
};
