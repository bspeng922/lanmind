import React, { useState, useEffect, useRef } from 'react';
import { Download, LockKeyhole, MoreHorizontal, RotateCw, Settings, Trash2, Upload } from 'lucide-react';
import { tr } from '../../../src/i18n';
import { Button } from './ui';

export interface VaultHeaderActionsProps {
  onOpenGenerator: () => void;
  onOpenImport: () => void;
  onOpenExport: () => void;
  onOpenSettings: () => void;
  onOpenDestroy: () => void;
  onLock: () => void;
}

export function VaultHeaderActions({
  onOpenGenerator,
  onOpenImport,
  onOpenExport,
  onOpenSettings,
  onOpenDestroy,
  onLock,
}: VaultHeaderActionsProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handleOutside = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setMoreOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreOpen]);

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {/* 密码生成器（仅图标，使用 RotateCw 重新生成/循环图标） */}
      <Button
        onClick={onOpenGenerator}
        title={tr('vault:generate')}
        aria-label={tr('vault:generate')}
        className="p-2 h-8 w-8 rounded-lg"
      >
        <RotateCw className="h-4 w-4 text-accent" />
      </Button>

      {/* 锁定密码库（仅图标） */}
      <Button
        onClick={onLock}
        title={tr('vault:lock')}
        aria-label={tr('vault:lock')}
        className="p-2 h-8 w-8 rounded-lg"
      >
        <LockKeyhole className="h-4 w-4 text-sub hover:text-main" />
      </Button>

      {/* 更多菜单组（导入、导出、密码库设置、删除本机密码库）放到最右侧 */}
      <div ref={menuRef} className="relative">
        <Button
          onClick={() => setMoreOpen((prev) => !prev)}
          title={tr('vault:more')}
          aria-label={tr('vault:more')}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          className="p-2 h-8 w-8 rounded-lg"
        >
          <MoreHorizontal className="h-4 w-4 text-sub" />
        </Button>

        {moreOpen && (
          <div
            role="menu"
            aria-label={tr('vault:more')}
            className="absolute right-0 top-full mt-1.5 z-50 w-48 rounded-xl border border-edge bg-surface/95 backdrop-blur-md p-1.5 shadow-popover select-none animate-in fade-in zoom-in-95 duration-100"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                onOpenImport();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-main hover:bg-hover transition-colors"
            >
              <Download className="h-3.5 w-3.5 text-sub" />
              <span>{tr('vault:import')}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                onOpenExport();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-main hover:bg-hover transition-colors"
            >
              <Upload className="h-3.5 w-3.5 text-sub" />
              <span>{tr('vault:export')}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                onOpenSettings();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-main hover:bg-hover transition-colors"
            >
              <Settings className="h-3.5 w-3.5 text-sub" />
              <span>{tr('vault:settings')}</span>
            </button>

            <div className="my-1 border-t border-edge" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                onOpenDestroy();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-rose-500 hover:bg-rose-500/10 transition-colors font-medium"
            >
              <Trash2 className="h-3.5 w-3.5 text-rose-500" />
              <span>{tr('vault:destroyVault')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

