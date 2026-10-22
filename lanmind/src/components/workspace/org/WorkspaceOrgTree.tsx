/**
 * WorkspaceOrgTree — 工作区左侧组织架构树组件。
 *
 * CALLING SPEC:
 *   <WorkspaceOrgTree
 *     units={units}
 *     members={orgMembers}
 *     totalMembersCount={number}
 *     selectedUnitId={string | null}
 *     onSelectUnit={(unitId: string | null) => void}
 *     canManage={boolean}
 *     onCreateUnit={(parentId: string | null) => void}
 *     onRenameUnit={(unitId: string, newName: string) => void}
 *     onDeleteUnit={(unitId: string) => void}
 *   />
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Edit2,
  FolderPlus,
  FolderTree,
  MoreVertical,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { tr, useLocale } from '../../../i18n';
import type { LocalOrgMember, LocalOrgUnit } from '../../../types';

export const UNASSIGNED_UNIT_ID = '__unassigned__';

interface WorkspaceOrgTreeProps {
  units: LocalOrgUnit[];
  members: LocalOrgMember[];
  totalMembersCount: number;
  selectedUnitId: string | null;
  onSelectUnit: (unitId: string | null) => void;
  canManage: boolean;
  onCreateUnit: (parentId: string | null) => void;
  onRenameUnit: (unitId: string, newName: string) => void;
  onDeleteUnit: (unitId: string) => void;
}

export const WorkspaceOrgTree: React.FC<WorkspaceOrgTreeProps> = ({
  units = [],
  members = [],
  totalMembersCount,
  selectedUnitId,
  onSelectUnit,
  canManage,
  onCreateUnit,
  onRenameUnit,
  onDeleteUnit,
}) => {
  useLocale();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [activeMenuUnitId, setActiveMenuUnitId] = useState<string | null>(null);

  // 点击外部空白区域或按 Escape 键自动关闭部门操作菜单
  useEffect(() => {
    if (!activeMenuUnitId) return;
    const handleOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const isInsideMenu = target.closest(`[data-unit-menu="${activeMenuUnitId}"]`);
      const isMenuButton = target.closest(`[data-unit-menu-btn="${activeMenuUnitId}"]`);
      if (!isInsideMenu && !isMenuButton) {
        setActiveMenuUnitId(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setActiveMenuUnitId(null);
      }
    };
    document.addEventListener('pointerdown', handleOutside, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [activeMenuUnitId]);

  // 计算每个部门节点以及其所有子部门的人员数
  const unitMemberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    units.forEach((u) => {
      const assigned = members.filter((m) => m.orgUnitId === u.id).length;
      counts.set(u.id, assigned);
    });
    return counts;
  }, [units, members]);

  // 未分配组织的人数
  const unassignedCount = useMemo(() => {
    const assignedUserIds = new Set(members.map((m) => m.userId));
    return Math.max(0, totalMembersCount - assignedUserIds.size);
  }, [totalMembersCount, members]);

  // 构建父子层级映射
  const childrenMap = useMemo(() => {
    const map = new Map<string | null, LocalOrgUnit[]>();
    units.forEach((unit) => {
      const pId = unit.parentId && units.some((u) => u.id === unit.parentId) ? unit.parentId : null;
      const list = map.get(pId) || [];
      list.push(unit);
      map.set(pId, list);
    });
    // 排序
    map.forEach((list) => {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    });
    return map;
  }, [units]);

  // 找出所有拥有子部门的部门 ID
  const parentUnitIds = useMemo(() => {
    const ids = new Set<string>();
    units.forEach((u) => {
      if (u.parentId && units.some((p) => p.id === u.parentId)) {
        ids.add(u.parentId);
      }
    });
    return ids;
  }, [units]);

  const isAllCollapsed =
    parentUnitIds.size > 0 &&
    Array.from(parentUnitIds).every((id) => collapsedIds.has(id));

  const handleToggleExpandAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAllCollapsed) {
      setCollapsedIds(new Set());
    } else {
      setCollapsedIds(new Set(parentUnitIds));
    }
  };

  const toggleCollapse = (unitId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  const handleStartRename = (unit: LocalOrgUnit, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveMenuUnitId(null);
    setEditingUnitId(unit.id);
    setEditingName(unit.name);
  };

  const handleSaveRename = (unitId: string) => {
    if (editingName.trim()) {
      onRenameUnit(unitId, editingName.trim());
    }
    setEditingUnitId(null);
  };

  // 递归渲染部门树节点
  const renderTreeNodes = (parentId: string | null = null, depth = 0) => {
    const children = childrenMap.get(parentId) || [];
    if (children.length === 0) return null;

    return (
      <div className="space-y-0.5">
        {children.map((unit) => {
          const isSelected = selectedUnitId === unit.id;
          const subChildren = childrenMap.get(unit.id) || [];
          const hasChildren = subChildren.length > 0;
          const isCollapsed = collapsedIds.has(unit.id);
          const memberCount = unitMemberCounts.get(unit.id) || 0;
          const isEditing = editingUnitId === unit.id;

          return (
            <div key={unit.id} className="select-none">
              <div
                onClick={() => onSelectUnit(unit.id)}
                style={{ paddingLeft: `${depth * 14 + 10}px` }}
                className={`group flex items-center justify-between rounded-xl py-1.5 pr-2 text-xs transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-accent/12 text-accent font-semibold'
                    : 'text-main hover:bg-hover'
                }`}
              >
                <div className="flex min-w-0 items-center gap-1.5 flex-1 pr-1">
                  {/* 折叠/展开箭头 */}
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => toggleCollapse(unit.id, e)}
                      className="p-0.5 text-quiet hover:text-main rounded transition-transform"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    <span className="w-4.5" />
                  )}

                  <Building2
                    className={`h-3.5 w-3.5 shrink-0 ${
                      isSelected ? 'text-accent' : 'text-sub'
                    }`}
                  />

                  {isEditing ? (
                    <input
                      type="text"
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => handleSaveRename(unit.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(unit.id);
                        if (e.key === 'Escape') setEditingUnitId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-6 w-full rounded border border-accent bg-canvas px-1.5 text-xs text-main focus:outline-none"
                    />
                  ) : (
                    <span className="truncate">{unit.name}</span>
                  )}
                </div>

                {/* 人数 & 管理操作 */}
                <div className="flex items-center gap-1 shrink-0">
                  <span className="rounded-full bg-card px-1.5 py-0.2 text-[10px] text-quiet font-mono border border-edge/60">
                    {memberCount}
                  </span>

                  {canManage && (
                    <div className="relative opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        data-unit-menu-btn={unit.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuUnitId((prev) => (prev === unit.id ? null : unit.id));
                        }}
                        className="rounded p-1 text-quiet hover:bg-hover hover:text-main"
                        title="部门操作"
                      >
                        <MoreVertical className="h-3 w-3" />
                      </button>

                      {/* 菜单浮层 */}
                      {activeMenuUnitId === unit.id && (
                        <div
                          data-unit-menu={unit.id}
                          role="menu"
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-6 z-30 w-28 rounded-xl border border-edge bg-surface p-1 shadow-popover animate-in fade-in"
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuUnitId(null);
                              onCreateUnit(unit.id);
                            }}
                            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[11px] text-sub hover:bg-hover hover:text-main"
                          >
                            <Plus className="h-3 w-3" />
                            <span>{tr('settings:workspaceSettings.newSubUnit')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleStartRename(unit, e)}
                            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[11px] text-sub hover:bg-hover hover:text-main"
                          >
                            <Edit2 className="h-3 w-3" />
                            <span>{tr('settings:workspaceSettings.renameUnit')}</span>
                          </button>
                          <div className="my-0.5 border-t border-edge" />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuUnitId(null);
                              onDeleteUnit(unit.id);
                            }}
                            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[11px] text-danger hover:bg-danger/10"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>{tr('settings:workspaceSettings.deleteUnit')}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 递归渲染子部门 */}
              {!isCollapsed && renderTreeNodes(unit.id, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* 头部标题与新建/折叠按钮 */}
      <div className="flex items-center justify-between border-b border-edge pb-2 mb-2 px-1">
        <div className="flex items-center gap-1.5 text-xs font-bold text-main">
          <FolderTree className="h-4 w-4 text-accent" />
          <span>{tr('settings:workspaceSettings.orgStructure')}</span>
        </div>

        <div className="flex items-center gap-1">
          {parentUnitIds.size > 0 && (
            <button
              type="button"
              onClick={handleToggleExpandAll}
              className="flex h-6.5 w-6.5 items-center justify-center rounded-lg text-quiet hover:bg-hover hover:text-main transition-colors"
              title={isAllCollapsed ? tr('settings:workspaceSettings.expandAll') : tr('settings:workspaceSettings.collapseAll')}
              aria-label={isAllCollapsed ? tr('settings:workspaceSettings.expandAll') : tr('settings:workspaceSettings.collapseAll')}
            >
              {isAllCollapsed ? (
                <ChevronsUpDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronsDownUp className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => onCreateUnit(null)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors"
              title={tr('settings:workspaceSettings.newRootUnit')}
            >
              <Plus className="h-3 w-3" />
              <span>{tr('settings:workspaceSettings.newDepartment')}</span>
            </button>
          )}
        </div>
      </div>

      {/* 组织列表区 */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-1 scrollbar-thin">
        {/* 1. 根节点：全部成员 */}
        <button
          type="button"
          onClick={() => onSelectUnit(null)}
          className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
            selectedUnitId === null
              ? 'bg-accent/15 text-accent font-semibold'
              : 'text-main hover:bg-hover'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            <Users className={`h-3.5 w-3.5 ${selectedUnitId === null ? 'text-accent' : 'text-sub'}`} />
            <span className="truncate">{tr('settings:workspaceSettings.rootOrg')}</span>
          </div>
          <span className="rounded-full bg-card px-1.5 py-0.2 text-[10px] text-quiet font-mono border border-edge/60">
            {totalMembersCount}
          </span>
        </button>

        {/* 2. 特殊节点：未分配部门 */}
        <button
          type="button"
          onClick={() => onSelectUnit(UNASSIGNED_UNIT_ID)}
          className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
            selectedUnitId === UNASSIGNED_UNIT_ID
              ? 'bg-accent/15 text-accent font-semibold'
              : 'text-main hover:bg-hover'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            <Building2 className={`h-3.5 w-3.5 ${selectedUnitId === UNASSIGNED_UNIT_ID ? 'text-accent' : 'text-quiet'}`} />
            <span className="truncate">{tr('settings:workspaceSettings.unassignedOrg')}</span>
          </div>
          <span className="rounded-full bg-card px-1.5 py-0.2 text-[10px] text-quiet font-mono border border-edge/60">
            {unassignedCount}
          </span>
        </button>

        <div className="my-1.5 border-t border-edge/60" />

        {/* 3. 组织树多级列表 */}
        {units.length === 0 ? (
          <div className="py-8 text-center text-xs text-quiet">
            <p>{tr('settings:workspaceSettings.noOrgUnitsYet')}</p>
            {canManage && (
              <button
                type="button"
                onClick={() => onCreateUnit(null)}
                className="mt-2 text-xs text-accent hover:underline"
              >
                {tr('settings:workspaceSettings.createOrgPrompt')}
              </button>
            )}
          </div>
        ) : (
          renderTreeNodes(null, 0)
        )}
      </div>
    </div>
  );
};
