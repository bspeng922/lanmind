/**
 * WorkspaceTimezoneSelect — 工作区时区下拉选择器组件。
 *
 * CALLING SPEC:
 *   <WorkspaceTimezoneSelect
 *     value={timezone}
 *     disabled={!canManage}
 *     onChange={(newTimezone) => setTimezone(newTimezone)}
 *   />
 */

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Clock, Laptop, Search, X } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import {
  getCurrentTimeInZone,
  getDeviceTimezone,
  getTimezoneOptions,
  TimezoneOption,
} from '../../utils/timeFormat';

export interface WorkspaceTimezoneSelectProps {
  value: string;
  disabled?: boolean;
  onChange: (tz: string) => void;
  className?: string;
  id?: string;
  showTimePreview?: boolean;
}

export const WorkspaceTimezoneSelect: React.FC<WorkspaceTimezoneSelectProps> = ({
  value,
  disabled = false,
  onChange,
  className = '',
  id,
  showTimePreview = true,
}) => {
  const { locale } = useLocale();
  const isZh = (locale || '').toLowerCase().startsWith('zh');
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [menuPosition, setMenuPosition] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: 'top' | 'bottom';
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // 当前设备本地时区
  const deviceTimezone = useMemo(() => getDeviceTimezone(), []);

  // 国际化完整时区列表
  const timezoneOptions = useMemo(() => getTimezoneOptions(locale), [locale]);

  // 当前选中时区的对应项
  const selectedOption = useMemo(() => {
    const found = timezoneOptions.find((item) => item.value === value);
    if (found) return found;
    if (value) {
      return {
        value,
        label: `${value}`,
        city: value,
        offset: '',
        region: tr('settings:workspaceSettings.customTimezone') || (isZh ? '自定义' : 'Custom'),
      };
    }
    return (
      timezoneOptions[0] || {
        value: 'Asia/Shanghai',
        label: isZh ? '北京 / 上海时间 (UTC+08:00)' : 'Beijing / Shanghai (UTC+08:00)',
        city: isZh ? '北京/上海 (中国)' : 'Beijing / Shanghai (China)',
        offset: 'UTC+08:00',
        region: isZh ? '常用' : 'Common',
      }
    );
  }, [value, timezoneOptions, isZh]);

  // 过滤后的时区列表
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return timezoneOptions;
    return timezoneOptions.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.value.toLowerCase().includes(query) ||
        item.city.toLowerCase().includes(query) ||
        item.offset.toLowerCase().includes(query)
    );
  }, [search, timezoneOptions]);

  const closeMenu = () => {
    setIsOpen(false);
    setMenuPosition(null);
  };

  // 关闭下拉菜单点击外部或按 Escape
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        !triggerRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // 打开时自动聚焦搜索框
  useEffect(() => {
    if (isOpen) {
      window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const calcPosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const estimatedHeight = Math.min(340, 50 + filteredOptions.length * 36 + 12);
    const openAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(100, Math.min(340, openAbove ? spaceAbove : spaceBelow));

    const targetWidth = Math.max(rect.width, 320);
    const menuWidth = Math.min(targetWidth, window.innerWidth - 20);
    const left = Math.max(10, Math.min(rect.left, window.innerWidth - menuWidth - 10));

    if (openAbove) {
      return {
        bottom: Math.max(10, window.innerHeight - rect.top + 6),
        top: undefined,
        left,
        width: menuWidth,
        maxHeight,
        placement: 'top' as const,
      };
    }

    return {
      top: Math.max(10, rect.bottom + 6),
      bottom: undefined,
      left,
      width: menuWidth,
      maxHeight,
      placement: 'bottom' as const,
    };
  };

  // 计算下拉浮层位置 (Portal 渲染到 document.body 确保不被 overflow 裁剪)
  useLayoutEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      const pos = calcPosition();
      if (!pos) return;
      setMenuPosition(pos);
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  const handleSelect = (tzValue: string) => {
    onChange(tzValue);
    closeMenu();
    triggerRef.current?.focus();
  };

  const handleToggle = () => {
    if (disabled) return;
    if (isOpen) {
      closeMenu();
    } else {
      const pos = calcPosition();
      if (pos) setMenuPosition(pos);
      setSearch('');
      setIsOpen(true);
    }
  };

  return (
    <div className={`relative w-full ${className}`}>
      {/* 触发器按钮：样式与输入框一致，实现标准 Combobox 模式 */}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        id={id || "workspace-timezone-trigger"}
        aria-label={tr('settings:workspaceSettings.timezone')}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={handleToggle}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-edge bg-canvas px-3.5 py-1.5 text-xs text-main transition-colors hover:border-subtle focus:border-accent focus:outline-none disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed text-left"
      >
        <span className="flex items-center gap-2 truncate">
          <Clock className="h-3.5 w-3.5 text-sub shrink-0" />
          <span className="truncate font-medium">{selectedOption.label}</span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-sub shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-accent' : ''
          }`}
        />
      </button>

      {/* 时区实时时间提示 */}
      {showTimePreview && (
        <div className="mt-1 flex items-center justify-between text-[11px] text-quiet">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {tr('settings:workspaceSettings.timezoneCurrentTime')}:
            <span className="font-mono text-sub ml-1">{getCurrentTimeInZone(value || 'Asia/Shanghai')}</span>
          </span>
          {!disabled && deviceTimezone && value !== deviceTimezone && (
            <button
              type="button"
              onClick={() => onChange(deviceTimezone)}
              className="text-[10px] text-accent hover:underline flex items-center gap-1"
            >
              <Laptop className="h-2.5 w-2.5" />
              {tr('settings:workspaceSettings.useSystemTimezone')}
            </button>
          )}
        </div>
      )}

      {/* 下拉面板（Portal 挂载到 body，防截断并最高层级显示） */}
      {isOpen && menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            style={{
              position: 'fixed',
              ...(menuPosition.bottom !== undefined
                ? { bottom: `${menuPosition.bottom}px`, top: 'auto' }
                : { top: `${menuPosition.top}px`, bottom: 'auto' }),
              left: `${menuPosition.left}px`,
              width: `${menuPosition.width}px`,
              maxHeight: `${menuPosition.maxHeight}px`,
              zIndex: 99999,
              transition: 'none',
            }}
            className={`flex flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-popover ${menuPosition.placement === 'top' ? 'origin-bottom-left' : 'origin-top-left'}`}
          >
            {/* 搜索框 */}
            <div className="flex items-center gap-2 border-b border-edge p-2 bg-card/50">
              <Search className="h-3.5 w-3.5 text-sub shrink-0 ml-1" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tr('settings:workspaceSettings.timezoneSearchPlaceholder')}
                className="w-full bg-transparent text-xs text-main placeholder:text-quiet focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="rounded p-0.5 text-quiet hover:text-main"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* 本地快捷选项 */}
            {deviceTimezone && (
              <div className="border-b border-edge/60 p-1.5 bg-canvas/30">
                <button
                  type="button"
                  onClick={() => handleSelect(deviceTimezone)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-sub hover:bg-hover hover:text-main transition-colors"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <Laptop className="h-3.5 w-3.5 text-accent" />
                    <span>{tr('settings:workspaceSettings.useSystemTimezone')}</span>
                  </span>
                  <span className="font-mono text-[10px] text-quiet">{deviceTimezone}</span>
                </button>
              </div>
            )}

            {/* 时区列表 */}
            <div className="flex-1 overflow-y-auto p-1 scrollbar-thin">
              {filteredOptions.length === 0 ? (
                <div className="py-6 text-center text-xs text-quiet">
                  {tr('settings:workspaceSettings.noMatchingTimezones') || (isZh ? '未匹配到时区' : 'No matching time zones')}
                </div>
              ) : (
                filteredOptions.map((item) => {
                  const isSelected = item.value === value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(item.value)}
                      className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-accent/10 text-accent font-semibold'
                          : 'text-main hover:bg-hover'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="truncate font-medium">{item.label}</div>
                        <div className="truncate text-[10px] font-mono text-quiet">{item.value}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-[10px] text-sub">{item.offset}</span>
                        {isSelected && <Check className="h-3.5 w-3.5 text-accent" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
