import { tr, useLocale } from "../i18n";
import React from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Upload, ScanLine, Minus, Square, X } from 'lucide-react';

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
  useLocale();

  if (receiverOnly) return null;

  const isStandaloneDesktopWindow =
    isTauri() && typeof window !== 'undefined' && window.location.pathname.includes('optical');

  const runWindowAction = async (action: 'minimize' | 'maximize' | 'close') => {
    try {
      const win = getCurrentWindow();
      if (action === 'minimize') await win.minimize();
      else if (action === 'maximize') await win.toggleMaximize();
      else await win.close();
    } catch {
      // Ignore outside Tauri window context
    }
  };

  return (
    <header
      data-tauri-drag-region
      className="optical-titlebar relative min-h-12 shrink-0 bg-surface border-b border-edge text-main px-4 py-1.5 flex items-center justify-center z-30 select-none"
    >
      <div data-no-drag className="flex items-center bg-muted p-0.5 rounded-lg border border-subtle">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'send'}
          onClick={() => onTabChange('send')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            tab === 'send'
              ? 'bg-card text-main shadow-soft'
              : 'text-sub hover:text-main'
          }`}
        >
          <Upload className="w-3.5 h-3.5" />
          <span>{tr("optical:opticalTitleBar.sendFiles")}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'receive'}
          onClick={() => onTabChange('receive')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            tab === 'receive'
              ? 'bg-card text-main shadow-soft'
              : 'text-sub hover:text-main'
          }`}
        >
          <ScanLine className="w-3.5 h-3.5" />
          <span>{tr("optical:opticalTitleBar.receive")}</span>
        </button>
      </div>

      {isStandaloneDesktopWindow && (
        <div data-no-drag className="absolute right-0 top-0 bottom-0 flex items-stretch border-l border-edge/80">
          <button
            type="button"
            onClick={() => void runWindowAction('minimize')}
            className="window-control-button flex h-full w-10 items-center justify-center"
            title={tr("common:header.minimize")}
            aria-label={tr("common:header.minimizeWindow")}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void runWindowAction('maximize')}
            className="window-control-button flex h-full w-10 items-center justify-center"
            title={tr("common:header.maximize")}
            aria-label={tr("common:header.maximizeWindow")}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void runWindowAction('close')}
            className="window-control-button window-control-button-close flex h-full w-10 items-center justify-center"
            title={tr("common:header.close")}
            aria-label={tr("common:header.closeWindow")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </header>
  );
};
