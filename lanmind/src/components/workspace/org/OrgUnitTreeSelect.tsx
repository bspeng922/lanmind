/**
 * OrgUnitTreeSelect — 工作区组织架构树形选择器组件。
 *
 * CALLING SPEC:
 *   <OrgUnitTreeSelect
 *     value={string}
 *     units={LocalOrgUnit[]}
 *     onChange={(unitId: string) => void}
 *     disabled={boolean}
 *     ariaLabel={string}
 *     placeholder={string}
 *     portal={boolean}
 *     allowUnassigned={boolean}
 *   />
 */

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Search,
  X,
} from 'lucide-react';
import type { LocalOrgUnit } from '../../../types';
import { tr, useLocale } from '../../../i18n';

export interface OrgUnitTreeSelectProps {
  value: string;
  units: LocalOrgUnit[];
  onChange: (unitId: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  portal?: boolean;
  allowUnassigned?: boolean;
  unassignedLabel?: string;
  width?: number | string;
  className?: string;
}

export const OrgUnitTreeSelect: React.FC<OrgUnitTreeSelectProps> = ({
  value,
  units = [],
  onChange,
  disabled = false,
  ariaLabel,
  placeholder,
  portal = true,
  allowUnassigned = true,
  unassignedLabel,
  width = '100%',
  className = '',
}) => {
  useLocale();
  const effectiveAriaLabel = ariaLabel || tr('settings:orgUnitSelect.selectDepartment');
  const effectivePlaceholder = placeholder || tr('settings:orgUnitSelect.unassignedDepartment');
  const effectiveUnassignedLabel = unassignedLabel || tr('settings:orgUnitSelect.unassignedDepartment');
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [menuPosition, setMenuPosition] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: 'top' | 'bottom';
  } | null>(null);
  const [menuTheme, setMenuTheme] = useState<string | undefined>();
  const listboxId = useId();

  // 1. 父子层级映射
  const { childrenMap, parentUnitIds, unitMap, unitPathMap } = useMemo(() => {
    const map = new Map<string | null, LocalOrgUnit[]>();
    const uMap = new Map<string, LocalOrgUnit>();
    units.forEach((u) => {
      uMap.set(u.id, u);
      const pId = u.parentId && units.some((parent) => parent.id === u.parentId) ? u.parentId : null;
      const list = map.get(pId) || [];
      list.push(u);
      map.set(pId, list);
    });

    map.forEach((list) => {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    });

    const parentIds = new Set<string>();
    units.forEach((u) => {
      if (u.parentId && units.some((p) => p.id === u.parentId)) {
        parentIds.add(u.parentId);
      }
    });

    // 计算每个部门的全路径面包屑，例如 "研发部 / 123"
    const pathMap = new Map<string, string>();
    const getPath = (unit: LocalOrgUnit): string => {
      if (pathMap.has(unit.id)) return pathMap.get(unit.id)!;
      if (!unit.parentId || !uMap.has(unit.parentId)) {
        pathMap.set(unit.id, unit.name);
        return unit.name;
      }
      const parentUnit = uMap.get(unit.parentId)!;
      const fullPath = `${getPath(parentUnit)} / ${unit.name}`;
      pathMap.set(unit.id, fullPath);
      return fullPath;
    };
    units.forEach((u) => getPath(u));

    return { childrenMap: map, parentUnitIds: parentIds, unitMap: uMap, unitPathMap: pathMap };
  }, [units]);

  // 当前选中节点的展示文本
  const selectedUnit = value ? unitMap.get(value) : null;
  const selectedPath = value ? unitPathMap.get(value) || selectedUnit?.name || effectivePlaceholder : effectiveUnassignedLabel;

  const closeMenu = () => {
    setIsOpen(false);
    setMenuPosition(null);
  };

  const calcPosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;

    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const estimatedHeight = Math.min(320, 45 + (allowUnassigned ? 32 : 0) + units.length * 32 + 12);
    const openAbove = below < estimatedHeight && above > below;
    const maxHeight = Math.max(80, Math.min(320, openAbove ? above : below));
    const menuWidth = Math.min(Math.max(rect.width, 240), window.innerWidth - 20);
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

  // 弹窗定位与滚动监听
  useLayoutEffect(() => {
    if (!isOpen || !portal) return;

    const updatePosition = () => {
      const pos = calcPosition();
      if (!pos) return;
      setMenuPosition(pos);

      const theme = rootRef.current?.closest<HTMLElement>('[data-theme]')?.dataset.theme;
      setMenuTheme(theme);
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, portal, units.length]);

  const handleToggle = () => {
    if (disabled) return;
    if (isOpen) {
      closeMenu();
    } else {
      if (portal) {
        const pos = calcPosition();
        if (pos) {
          setMenuPosition(pos);
        }
        const theme = rootRef.current?.closest<HTMLElement>('[data-theme]')?.dataset.theme;
        setMenuTheme(theme);
      }
      setIsOpen(true);
    }
  };

  // 打开时自动聚焦搜索框
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      window.setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        closeMenu();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  const toggleCollapse = (unitId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  const handleSelect = (unitId: string) => {
    onChange(unitId);
    closeMenu();
    triggerRef.current?.focus();
  };

  // 递归渲染树节点
  const renderTreeNodes = (parentId: string | null, depth: number): React.ReactNode => {
    const childList = childrenMap.get(parentId) || [];
    if (childList.length === 0) return null;

    const query = search.trim().toLowerCase();

    return childList.map((unit) => {
      const hasChildren = parentUnitIds.has(unit.id);
      const isCollapsed = collapsedIds.has(unit.id);
      const isSelected = value === unit.id;
      const path = unitPathMap.get(unit.id) || unit.name;

      // 搜索过滤匹配检查
      const matchesSelf = !query || unit.name.toLowerCase().includes(query) || path.toLowerCase().includes(query);
      // 检查子树是否有匹配
      const checkDescendantsMatch = (id: string): boolean => {
        const sub = childrenMap.get(id) || [];
        return sub.some(
          (c) =>
            c.name.toLowerCase().includes(query) ||
            checkDescendantsMatch(c.id)
        );
      };
      const matchesSubtree = query ? checkDescendantsMatch(unit.id) : true;

      if (query && !matchesSelf && !matchesSubtree) {
        return null;
      }

      return (
        <div key={unit.id} className="space-y-0.5">
          <div
            className={`group flex items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors cursor-pointer select-none ${
              isSelected
                ? 'bg-accent/15 text-accent font-semibold'
                : 'text-main hover:bg-hover'
            }`}
            style={{ paddingLeft: `${Math.max(8, depth * 16 + 8)}px` }}
            onClick={() => handleSelect(unit.id)}
            role="option"
            aria-selected={isSelected}
            title={path}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={(e) => toggleCollapse(unit.id, e)}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-quiet hover:bg-hover hover:text-main"
                  title={isCollapsed ? '展开' : '折叠'}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
              ) : (
                <span className="w-4 shrink-0 text-quiet/40 font-mono text-[10px] text-center">
                  {depth > 0 ? '└' : '•'}
                </span>
              )}

              {hasChildren ? (
                isCollapsed ? (
                  <Folder className="h-3.5 w-3.5 text-accent shrink-0" />
                ) : (
                  <FolderOpen className="h-3.5 w-3.5 text-accent shrink-0" />
                )
              ) : (
                <Building2 className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-accent' : 'text-sub'}`} />
              )}

              <span className="truncate">{unit.name}</span>
            </div>

            {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-accent ml-2" />}
          </div>

          {/* 子节点递归 */}
          {hasChildren && (!isCollapsed || Boolean(query)) && (
            <div className="space-y-0.5">{renderTreeNodes(unit.id, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  const menu = isOpen ? (
    <div
      ref={menuRef}
      id={listboxId}
      role="listbox"
      aria-label={ariaLabel}
      data-theme={portal ? menuTheme : undefined}
      style={
        portal
          ? (menuPosition ? {
              position: 'fixed',
              ...(menuPosition.bottom !== undefined
                ? { bottom: `${menuPosition.bottom}px`, top: 'auto' }
                : { top: `${menuPosition.top}px`, bottom: 'auto' }),
              left: `${menuPosition.left}px`,
              width: `${menuPosition.width}px`,
              maxHeight: `${menuPosition.maxHeight}px`,
              zIndex: 99999,
              transition: 'none',
            } : undefined)
          : undefined
      }
      className={`flex flex-col overflow-hidden rounded-xl border border-edge bg-surface/98 backdrop-blur-md shadow-popover ${menuPosition?.placement === 'top' ? 'origin-bottom-left' : 'origin-top-left'}`}
    >
      {/* 顶部搜索框 */}
      <div className="border-b border-edge p-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-quiet" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr('settings:orgUnitSelect.searchPlaceholder')}
            className="w-full rounded-lg border border-edge bg-canvas/80 pl-8 pr-7 py-1 text-xs text-main placeholder:text-quiet focus:border-accent focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-2 text-quiet hover:text-main"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 滚动树内容 */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 scrollbar-thin">
        {/* 未分配部门选项 */}
        {allowUnassigned && (
          <div
            className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors cursor-pointer select-none ${
              !value
                ? 'bg-accent/15 text-accent font-semibold'
                : 'text-main hover:bg-hover'
            }`}
            onClick={() => handleSelect('')}
            role="option"
            aria-selected={!value}
          >
            <div className="flex items-center gap-2 truncate">
              <span className="w-4 shrink-0 text-center text-quiet text-xs">○</span>
              <Building2 className={`h-3.5 w-3.5 shrink-0 ${!value ? 'text-accent' : 'text-quiet'}`} />
              <span className="truncate">{effectiveUnassignedLabel}</span>
            </div>
            {!value && <Check className="h-3.5 w-3.5 shrink-0 text-accent ml-2" />}
          </div>
        )}

        {/* 组织架构树 */}
        {units.length > 0 ? (
          <div className="pt-0.5">{renderTreeNodes(null, 0)}</div>
        ) : (
          <div className="py-4 text-center text-xs text-quiet">{tr('settings:orgUnitSelect.noDepartments')}</div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={`relative ${className}`} style={{ width }}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        aria-label={effectiveAriaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={selectedPath}
        className={`flex h-8 w-full items-center justify-between rounded-xl border border-edge bg-canvas px-2.5 py-1 text-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
          isOpen ? 'border-accent ring-1 ring-accent/30' : 'hover:border-subtle'
        }`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Building2 className={`h-3.5 w-3.5 shrink-0 ${value ? 'text-accent' : 'text-quiet'}`} />
          <span className={`truncate ${value ? 'text-main font-medium' : 'text-quiet'}`}>
            {selectedPath}
          </span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-quiet transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-accent' : ''
          }`}
        />
      </button>

      {portal ? (isOpen && menuPosition && menu ? createPortal(menu, document.body) : null) : menu}
    </div>
  );
};
