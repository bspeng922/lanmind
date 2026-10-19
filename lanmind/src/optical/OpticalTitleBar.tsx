import { tr, useLocale } from "../i18n";
import React from 'react';
import { Upload, ScanLine } from 'lucide-react';

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

  return (
    <header
      data-tauri-drag-region
      className="optical-titlebar min-h-12 shrink-0 bg-surface border-b border-edge text-main px-4 py-2 flex items-center justify-center shadow-panel z-30 select-none"
    >
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
          <span>{tr("optical:opticalTitleBar.sendFiles")}</span>
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
          <span>{tr("optical:opticalTitleBar.receive")}</span>
        </button>
      </div>
    </header>
  );
};
