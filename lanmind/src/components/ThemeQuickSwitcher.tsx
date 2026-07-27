/**
 * ThemeQuickSwitcher — Fast Header Theme Selection Popover
 *
 * CALLING SPEC:
 *   <ThemeQuickSwitcher onOpenFullCustomizer={() => ...} />
 *
 *   Provides immediate one-click theme switching directly from the app header
 *   without navigating away or opening heavy full-screen dialogs.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { Palette, Check, ChevronDown, Monitor, Sparkles } from 'lucide-react';
import { ThemePreference } from '../types';

interface ThemeQuickSwitcherProps {
  onOpenFullCustomizer?: () => void;
}

export const ThemeQuickSwitcher: React.FC<ThemeQuickSwitcherProps> = ({
  onOpenFullCustomizer,
}) => {
  const { currentTheme, themePreference, setThemeId, allThemes } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handlePointerDown);
    }
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isOpen]);

  const handleSelect = (id: ThemePreference) => {
    setThemeId(id);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={containerRef} data-no-drag>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex h-8 w-10 items-center justify-center gap-1 rounded-lg border border-slate-700/80 bg-slate-800/80 text-slate-200 transition-all hover:border-slate-600 hover:bg-slate-700/90 active:scale-95"
        title={`切换主题：${currentTheme.name}${themePreference === 'system' ? '（跟随系统）' : ''}`}
        aria-label={`切换主题，当前为${currentTheme.name}${themePreference === 'system' ? '，跟随系统' : ''}`}
        aria-expanded={isOpen}
      >
        <span
          className="h-3 w-3 rounded-full shadow-sm ring-1 ring-white/20 transition-transform group-hover:scale-110"
          style={{ background: currentTheme.previewColor }}
        />
        <ChevronDown
          className={`h-3 w-3 text-slate-400 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-white' : ''
          }`}
        />
      </button>

      {/* Floating Theme Menu */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 origin-top-right rounded-xl border border-slate-700/80 bg-slate-900 p-2 shadow-2xl backdrop-blur-md z-50 animate-in fade-in zoom-in-95 duration-120">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-800/80 mb-1">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
              <Palette className="h-3.5 w-3.5 text-blue-400" />
              <span>选择界面主题</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">即时生效</span>
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => handleSelect('system')}
              className={`flex w-full items-center justify-between rounded-lg p-2 text-left transition-all ${
                themePreference === 'system'
                  ? 'bg-slate-800/90 text-white ring-1 ring-blue-500/50 shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-slate-400">
                  <Monitor className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold">跟随系统</div>
                  <div className="truncate text-[10px] text-slate-400">
                    浅色使用钛白明亮，深色使用深蓝星空
                  </div>
                </div>
              </div>
              {themePreference === 'system' && (
                <span className="ml-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm">
                  <Check className="h-2.5 w-2.5" />
                </span>
              )}
            </button>

            {allThemes.map((theme) => {
              const isSelected = themePreference === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => handleSelect(theme.id)}
                  className={`flex w-full items-center justify-between rounded-lg p-2 text-left transition-all ${
                    isSelected
                      ? 'bg-slate-800/90 text-white ring-1 ring-blue-500/50 shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="h-4 w-4 shrink-0 rounded-full shadow-sm ring-1 ring-white/20"
                      style={{ background: theme.previewColor }}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{theme.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">{theme.description}</div>
                    </div>
                  </div>

                  {isSelected && (
                    <span className="ml-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {onOpenFullCustomizer && (
            <div className="mt-1.5 border-t border-slate-800/80 pt-1.5 px-1">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenFullCustomizer();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-blue-400 transition-colors"
              >
                <Sparkles className="h-3 w-3" />
                <span>更多主题与系统配置...</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
