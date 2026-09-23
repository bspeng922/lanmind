import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  FolderTree,
  Loader2,
  Plus,
  Save,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { LocalDirectory, LocalOrgMember, LocalOrgUnit, User } from '../types';
import { ApiService } from '../services/api';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';

interface LocalDirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  directory: LocalDirectory;
  onSaved: (directory: LocalDirectory) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  unitId?: string;
}

export const LocalDirectoryModal: React.FC<LocalDirectoryModalProps> = ({
  isOpen,
  onClose,
  users,
  directory,
  onSaved,
}) => {
  const [units, setUnits] = useState<LocalOrgUnit[]>([]);
  const [members, setMembers] = useState<LocalOrgMember[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [collapsedUnitIds, setCollapsedUnitIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setUnits(directory.units.map((unit) => ({ ...unit })));
      setMembers(directory.members.map((member) => ({ ...member })));
      setSelectedUnitId(directory.units[0]?.id || null);
      setSearchQuery('');
      setMemberSearchQuery('');
      setErrorMessage(null);
      setContextMenu(null);
    }
    wasOpenRef.current = isOpen;
  }, [directory, isOpen]);

  // Close context menu on outside click or escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleClose);
    window.addEventListener('contextmenu', handleClose);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('contextmenu', handleClose);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const unitsById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);

  const childrenMap = useMemo(() => {
    const compare = (left: LocalOrgUnit, right: LocalOrgUnit) =>
      left.sortOrder - right.sortOrder || left.name.localeCompare(right.name);
    const map = new Map<string | null, LocalOrgUnit[]>();
    units.forEach((unit) => {
      const parentId = unit.parentId && unitsById.has(unit.parentId) ? unit.parentId : null;
      map.set(parentId, [...(map.get(parentId) || []), unit]);
    });
    map.forEach((items) => items.sort(compare));
    return map;
  }, [units, unitsById]);

  const visibleUnits = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const ordered: { unit: LocalOrgUnit; depth: number }[] = [];
    const append = (parentId: string | null, depth: number, isHiddenByParent: boolean) => {
      (childrenMap.get(parentId) || []).forEach((unit) => {
        const isCollapsed = collapsedUnitIds.has(unit.id);
        const matches = !query || unit.name.toLocaleLowerCase().includes(query);
        if (!isHiddenByParent || query) {
          if (matches || query) {
            ordered.push({ unit, depth });
          }
        }
        append(unit.id, depth + 1, isHiddenByParent || isCollapsed);
      });
    };
    append(null, 0, false);
    return ordered;
  }, [searchQuery, childrenMap, collapsedUnitIds]);

  const selectedUnit = selectedUnitId ? unitsById.get(selectedUnitId) : undefined;

  // Hierarchical parent options formatted with tree indentation
  const parentUnitOptions: ThemeSelectOption[] = useMemo(() => {
    const defaultOpt: ThemeSelectOption = { value: '', label: '作为顶级组织（无上级）', tone: 'slate' };
    if (!selectedUnit) return [defaultOpt];

    // Collect invalid IDs (selectedUnit itself and all descendants to prevent cycles)
    const invalidIds = new Set<string>([selectedUnit.id]);
    let changed = true;
    while (changed) {
      changed = false;
      units.forEach((u) => {
        if (u.parentId && invalidIds.has(u.parentId) && !invalidIds.has(u.id)) {
          invalidIds.add(u.id);
          changed = true;
        }
      });
    }

    const treeOptions: ThemeSelectOption[] = [];
    const traverse = (parentId: string | null, depth: number) => {
      const list = childrenMap.get(parentId) || [];
      list.forEach((u) => {
        if (!invalidIds.has(u.id)) {
          const indent = depth === 0 ? '' : '　'.repeat(depth) + '└─ ';
          treeOptions.push({
            value: u.id,
            label: `${indent}${u.name}`,
            tone: depth === 0 ? 'blue' : 'slate',
          });
          traverse(u.id, depth + 1);
        }
      });
    };
    traverse(null, 0);

    return [defaultOpt, ...treeOptions];
  }, [selectedUnit, units, childrenMap]);

  const selectedMemberIds = useMemo(
    () => new Set(members.filter((member) => member.orgUnitId === selectedUnitId).map((member) => member.userId)),
    [members, selectedUnitId],
  );

  const unitSubtreeMemberCounts = useMemo(() => {
    const map = new Map<string, number>();
    const computeForUnit = (unitId: string): Set<string> => {
      const userIds = new Set<string>();
      members.filter((m) => m.orgUnitId === unitId).forEach((m) => userIds.add(m.userId));
      const children = childrenMap.get(unitId) || [];
      children.forEach((c) => {
        const childUserIds = computeForUnit(c.id);
        childUserIds.forEach((uid) => userIds.add(uid));
      });
      map.set(unitId, userIds.size);
      return userIds;
    };
    units.forEach((u) => computeForUnit(u.id));
    return map;
  }, [units, members, childrenMap]);

  const visibleUsers = useMemo(() => {
    const query = memberSearchQuery.trim().toLocaleLowerCase();
    return users
      .filter((user) => !query || [user.nickname, user.username, user.deviceId, user.ip].some((value) => value.toLocaleLowerCase().includes(query)))
      .sort((left, right) => Number(right.isOnline) - Number(left.isOnline) || left.nickname.localeCompare(right.nickname));
  }, [memberSearchQuery, users]);

  if (!isOpen) return null;

  const addUnit = (parentId: string | null = null) => {
    const parent = parentId ? unitsById.get(parentId) : null;
    const next: LocalOrgUnit = {
      id: `local-org-${crypto.randomUUID()}`,
      name: parent ? `${parent.name}子部门` : '新组织',
      parentId,
      sortOrder: units.length,
    };
    setUnits((previous) => [...previous, next]);
    setSelectedUnitId(next.id);
    if (parentId) {
      setCollapsedUnitIds((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(parentId);
        return nextSet;
      });
    }
    setErrorMessage(null);
  };

  const updateSelectedUnit = (updates: Partial<LocalOrgUnit>) => {
    if (!selectedUnitId) return;
    setUnits((previous) => previous.map((unit) => unit.id === selectedUnitId ? { ...unit, ...updates } : unit));
  };

  const removeUnitById = (targetUnitId: string) => {
    const target = unitsById.get(targetUnitId);
    if (!target) return;
    const replacementParentId = target.parentId || null;
    setUnits((previous) =>
      previous
        .map((unit) =>
          unit.id === target.id
            ? unit
            : unit.parentId === target.id
              ? { ...unit, parentId: replacementParentId }
              : unit,
        )
        .filter((unit) => unit.id !== target.id),
    );
    setMembers((previous) => previous.filter((member) => member.orgUnitId !== target.id));
    if (selectedUnitId === target.id) {
      const nextUnit = units.find((unit) => unit.id !== target.id);
      setSelectedUnitId(nextUnit?.id || null);
    }
  };

  const removeSelectedUnit = () => {
    if (selectedUnitId) removeUnitById(selectedUnitId);
  };

  const toggleMember = (userId: string) => {
    if (!selectedUnitId) return;
    setMembers((previous) => {
      const exists = previous.some((member) => member.orgUnitId === selectedUnitId && member.userId === userId);
      return exists
        ? previous.filter((member) => !(member.orgUnitId === selectedUnitId && member.userId === userId))
        : [...previous, { orgUnitId: selectedUnitId, userId }];
    });
  };

  const handleSave = async () => {
    if (units.some((unit) => !unit.name.trim())) {
      setErrorMessage('组织名称不能为空');
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const saved = await ApiService.saveLocalDirectory({
        units: units.map((unit) => ({ ...unit, name: unit.name.trim() })),
        members,
      });
      onSaved(saved);
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存本地组织失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay/80 p-4 backdrop-blur-sm">
      <div className="flex h-[min(680px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-subtle bg-surface shadow-popover">
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl border border-accent/30 bg-accent/15 p-2 text-accent"><FolderTree className="h-4 w-4" /></div>
            <div>
              <h2 className="text-sm font-bold text-main">本地组织目录</h2>
              <p className="mt-0.5 text-[11px] text-sub">仅保存在本机，用于快速筛选和添加群成员（支持右键管理组织树）</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-sub hover:bg-hover hover:text-main" aria-label="关闭本地组织目录"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Left Tree Sidebar */}
          <section className="flex max-h-56 w-full flex-shrink-0 flex-col border-b border-edge bg-canvas/50 p-3 sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r">
            <div className="mb-2 flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="搜索组织"
                  className="w-full rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs text-main outline-none placeholder-quiet focus:border-accent"
                />
              </div>
              <button
                type="button"
                onClick={() => addUnit(null)}
                className="rounded-lg border border-accent/30 bg-accent/15 p-1.5 text-accent hover:bg-accent hover:text-on-accent transition-colors"
                title="新建顶级组织 (亦可右键空白处)"
                aria-label="新建顶级组织"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div
              className="min-h-0 flex-1 space-y-1 overflow-y-auto"
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              {visibleUnits.length === 0 ? (
                <div className="rounded-lg border border-dashed border-edge px-3 py-8 text-center text-[11px] text-quiet">
                  还没有本地组织，点击上方「+」或右键新建
                </div>
              ) : (
                visibleUnits.map(({ unit, depth }) => {
                  const active = unit.id === selectedUnitId;
                  const memberCount = unitSubtreeMemberCounts.get(unit.id) ?? members.filter((member) => member.orgUnitId === unit.id).length;
                  const hasChildren = (childrenMap.get(unit.id) || []).length > 0;
                  const isCollapsed = collapsedUnitIds.has(unit.id);
                  return (
                    <div
                      key={unit.id}
                      onClick={() => setSelectedUnitId(unit.id)}
                      onDoubleClick={() => {
                        if (hasChildren) {
                          setCollapsedUnitIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(unit.id)) next.delete(unit.id);
                            else next.add(unit.id);
                            return next;
                          });
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedUnitId(unit.id);
                        setContextMenu({ x: e.clientX, y: e.clientY, unitId: unit.id });
                      }}
                      className={`group relative flex w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors cursor-pointer select-none ${
                        active
                          ? 'border-accent/40 bg-accent/15 text-accent shadow-sm'
                          : 'border-transparent text-sub hover:border-edge hover:bg-hover'
                      }`}
                      style={{ paddingLeft: `${8 + depth * 14}px` }}
                      title="单击查看详情，双击展开/收起，右键弹出菜单"
                    >
                      {/* Tree branch line for nested nodes */}
                      {depth > 0 && (
                        <span
                          className="absolute top-0 bottom-0 border-l border-edge/60"
                          style={{ left: `${depth * 14 - 2}px` }}
                        />
                      )}

                      {/* Expand / Collapse Chevron */}
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCollapsedUnitIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(unit.id)) next.delete(unit.id);
                              else next.add(unit.id);
                              return next;
                            });
                          }}
                          className="w-4 h-4 -ml-0.5 flex items-center justify-center rounded hover:bg-hover/80 text-sub hover:text-main shrink-0 transition-colors"
                          title={isCollapsed ? '展开子组织' : '收起子组织'}
                          aria-label={isCollapsed ? '展开子组织' : '收起子组织'}
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
                          )}
                        </button>
                      ) : (
                        <span className="w-4 h-4 -ml-0.5 shrink-0" />
                      )}

                      <FolderTree className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-accent' : 'text-accent/70 group-hover:text-accent'}`} />
                      <span className="min-w-0 flex-1 truncate font-medium text-main">{unit.name || '未命名组织'}</span>

                      {/* Quick add child button on hover */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          addUnit(unit.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent/20 hover:text-accent text-quiet transition-all shrink-0"
                        title="添加子组织"
                        aria-label="添加子组织"
                      >
                        <Plus className="h-3 w-3" />
                      </button>

                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-canvas/80 border border-edge/60 text-quiet shrink-0">
                        {memberCount}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Right Edit Form */}
          <section className="min-w-0 flex-1 overflow-y-auto p-5">
            {!selectedUnit ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-xs text-quiet">
                <FolderTree className="h-10 w-10 text-quiet/40" />
                <p>选择左侧组织进行查看，或新建一个本地组织</p>
                <button
                  type="button"
                  onClick={() => addUnit(null)}
                  className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent hover:text-on-accent transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  新建组织
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-semibold text-main">组织名称</label>
                    <input
                      value={selectedUnit.name}
                      onChange={(event) => updateSelectedUnit({ name: event.target.value })}
                      placeholder="例如：研发部、云平台组"
                      className="w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-main outline-none placeholder-quiet focus:border-accent"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={removeSelectedUnit}
                    className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-500 hover:bg-rose-500 hover:text-on-solid transition-colors"
                    title="删除组织"
                    aria-label="删除组织"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-main">上级组织</label>
                  <ThemeSelect
                    ariaLabel="选择上级组织"
                    value={selectedUnit.parentId || ''}
                    options={parentUnitOptions}
                    onChange={(val) => updateSelectedUnit({ parentId: val || null })}
                    width="100%"
                  />
                </div>
                <div className="border-t border-edge pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <h3 className="flex items-center gap-1.5 text-xs font-bold text-main">
                        <Users className="h-3.5 w-3.5 text-success" />
                        组织直属成员
                      </h3>
                      <p className="mt-0.5 text-[10px] text-quiet">同一个人可以加入多个本地组织</p>
                    </div>
                    <span className="text-[10px] text-accent">已选 {selectedMemberIds.size} 人</span>
                  </div>
                  <input
                    value={memberSearchQuery}
                    onChange={(event) => setMemberSearchQuery(event.target.value)}
                    placeholder="搜索成员"
                    className="mb-2 w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-main outline-none placeholder-quiet focus:border-accent"
                  />
                  <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-edge bg-canvas/50 p-2">
                    {visibleUsers.map((user) => {
                      const checked = selectedMemberIds.has(user.id);
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => toggleMember(user.id)}
                          className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left text-xs transition-colors ${
                            checked ? 'border-accent/30 bg-accent/10' : 'border-transparent hover:border-edge hover:bg-hover'
                          }`}
                        >
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded border ${
                              checked ? 'border-accent bg-accent text-on-accent' : 'border-subtle bg-surface'
                            }`}
                          >
                            {checked && <Check className="h-3 w-3" />}
                          </span>
                          <span className={`h-2 w-2 rounded-full ${user.isOnline ? 'bg-emerald-400' : 'bg-muted'}`} />
                          <span className="min-w-0 flex-1 truncate font-medium text-main">{user.nickname}</span>
                          <span className="max-w-32 truncate font-mono text-[10px] text-quiet">{user.ip}</span>
                        </button>
                      );
                    })}
                    {visibleUsers.length === 0 && (
                      <div className="py-6 text-center text-[11px] text-quiet">没有匹配的局域网成员</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {errorMessage && (
          <div className="border-t border-rose-500/20 bg-rose-500/10 px-5 py-2 text-xs text-danger">{errorMessage}</div>
        )}
        <div className="flex items-center justify-between border-t border-edge px-5 py-3">
          <span className="text-[10px] text-quiet">仅保存在本机，不会同步给局域网中的其他用户</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="ui-cancel-button rounded-lg px-3 py-1.5 text-xs">
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="theme-btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存目录
            </button>
          </div>
        </div>
      </div>

      {/* Right-click Context Menu */}
      {contextMenu && (
        <div
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 170),
            top: Math.min(contextMenu.y, window.innerHeight - 180),
          }}
          className="fixed z-[100] w-40 rounded-xl border border-edge bg-surface/95 backdrop-blur-md p-1.5 shadow-popover text-xs space-y-0.5 select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.unitId ? (
            <>
              <div className="px-2 py-1 text-[10px] font-semibold text-quiet truncate border-b border-edge/60 mb-1">
                {unitsById.get(contextMenu.unitId)?.name || '组织操作'}
              </div>
              <button
                type="button"
                onClick={() => {
                  addUnit(contextMenu.unitId);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-main hover:bg-hover hover:text-accent transition-colors text-left"
              >
                <FolderPlus className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>新建子组织</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const curr = unitsById.get(contextMenu.unitId!);
                  addUnit(curr?.parentId || null);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-main hover:bg-hover hover:text-accent transition-colors text-left"
              >
                <Plus className="w-3.5 h-3.5 text-sub shrink-0" />
                <span>新建同级组织</span>
              </button>
              <div className="my-1 border-t border-edge/60" />
              <button
                type="button"
                onClick={() => {
                  removeUnitById(contextMenu.unitId!);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-rose-500 hover:bg-rose-500/10 transition-colors text-left"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>删除该组织</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                addUnit(null);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-main hover:bg-hover hover:text-accent transition-colors text-left"
            >
              <Plus className="w-3.5 h-3.5 text-accent shrink-0" />
              <span>新建顶级组织</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
