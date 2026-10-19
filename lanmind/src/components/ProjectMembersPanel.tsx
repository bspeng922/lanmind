/**
 * ProjectMembersPanel — 协作项目成员与权限管理面板（左右分栏布局）。
 *
 * CALLING SPEC:
 *   <ProjectMembersPanel
 *     project={project}
 *     users={users}
 *     currentUser={currentUser}
 *     localDirectory={localDirectory}
 *     isProjectAdmin={boolean}
 *     members={string[]}
 *     admins={string[]}
 *     defaultAssignee={string}
 *     guestAccess={boolean}
 *     onMembersChange={(newMembers: string[]) => void}
 *     onAdminsChange={(newAdmins: string[]) => void}
 *     onDefaultAssigneeChange={(val: string) => void}
 *     onGuestAccessChange={(val: boolean) => void}
 *   />
 */

import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderTree,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { tr, useLocale } from '../i18n';
import type { LocalDirectory, LocalOrgUnit, Project, User } from '../types';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';

export const UNASSIGNED_UNIT_ID = '__unassigned__';

interface ProjectMembersPanelProps {
  project: Project;
  users: User[];
  currentUser: User;
  localDirectory?: LocalDirectory;
  isProjectAdmin: boolean;
  members: string[];
  admins: string[];
  defaultAssignee: string;
  guestAccess: boolean;
  onMembersChange: (newMembers: string[]) => void;
  onAdminsChange: (newAdmins: string[]) => void;
  onDefaultAssigneeChange: (val: string) => void;
  onGuestAccessChange: (val: boolean) => void;
}

export const ProjectMembersPanel: React.FC<ProjectMembersPanelProps> = ({
  project,
  users = [],
  currentUser,
  localDirectory = { units: [], members: [] },
  isProjectAdmin,
  members = [],
  admins = [],
  defaultAssignee,
  guestAccess,
  onMembersChange,
  onAdminsChange,
  onDefaultAssigneeChange,
  onGuestAccessChange,
}) => {
  useLocale();

  // Left panel state
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [leftSearch, setLeftSearch] = useState('');

  // Right panel state
  const [rightSearch, setRightSearch] = useState('');

  const safeUnits = localDirectory.units || [];
  const safeOrgMembers = localDirectory.members || [];

  // 1. 父子部门层级映射
  const childrenMap = useMemo(() => {
    const map = new Map<string | null, LocalOrgUnit[]>();
    safeUnits.forEach((unit) => {
      const pId = unit.parentId && safeUnits.some((u) => u.id === unit.parentId) ? unit.parentId : null;
      const list = map.get(pId) || [];
      list.push(unit);
      map.set(pId, list);
    });
    map.forEach((list) => {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    });
    return map;
  }, [safeUnits]);

  // 2. 部门直属成员映射 (unitId -> User[])
  const directUnitUsersMap = useMemo(() => {
    const userMap = new Map(users.map((u) => [u.id, u]));
    const map = new Map<string, User[]>();
    safeUnits.forEach((u) => map.set(u.id, []));
    safeOrgMembers.forEach((m) => {
      const u = userMap.get(m.userId);
      if (u) {
        const list = map.get(m.orgUnitId);
        if (list && !list.some((existing) => existing.id === u.id)) {
          list.push(u);
        }
      }
    });
    return map;
  }, [safeUnits, safeOrgMembers, users]);

  // 3. 未分配部门的用户
  const unassignedUsers = useMemo(() => {
    const assignedIds = new Set(safeOrgMembers.map((m) => m.userId));
    return users.filter((u) => !assignedIds.has(u.id));
  }, [users, safeOrgMembers]);

  // 4. 每个部门分支的全部成员 (递归：直属成员 + 所有子孙部门成员)
  const branchUsersMap = useMemo(() => {
    const map = new Map<string, User[]>();

    const getBranchUsers = (unitId: string): User[] => {
      if (map.has(unitId)) return map.get(unitId)!;
      const direct = directUnitUsersMap.get(unitId) || [];
      const children = childrenMap.get(unitId) || [];
      const allUsers = [...direct];
      children.forEach((child) => {
        const childUsers = getBranchUsers(child.id);
        childUsers.forEach((cu) => {
          if (!allUsers.some((u) => u.id === cu.id)) {
            allUsers.push(cu);
          }
        });
      });
      map.set(unitId, allUsers);
      return allUsers;
    };

    safeUnits.forEach((u) => getBranchUsers(u.id));
    return map;
  }, [safeUnits, directUnitUsersMap, childrenMap]);

  // 5. 用户与部门归属映射 (userId -> unitName)
  const userUnitNameMap = useMemo(() => {
    const unitMap = new Map(safeUnits.map((u) => [u.id, u.name]));
    const map = new Map<string, string>();
    safeOrgMembers.forEach((m) => {
      const uName = unitMap.get(m.orgUnitId);
      if (uName) map.set(m.userId, uName);
    });
    return map;
  }, [safeUnits, safeOrgMembers]);

  // 6. 可展开的部门与未分配节点集合
  const allExpandableUnitIds = useMemo(() => {
    const ids = new Set<string>();
    safeUnits.forEach((u) => {
      const subChildren = childrenMap.get(u.id) || [];
      const direct = directUnitUsersMap.get(u.id) || [];
      if (subChildren.length > 0 || direct.length > 0) {
        ids.add(u.id);
      }
    });
    if (unassignedUsers.length > 0) {
      ids.add(UNASSIGNED_UNIT_ID);
    }
    return ids;
  }, [safeUnits, childrenMap, directUnitUsersMap, unassignedUsers.length]);

  const isAllCollapsed =
    allExpandableUnitIds.size > 0 &&
    Array.from(allExpandableUnitIds).every((id) => collapsedIds.has(id));

  const handleToggleExpandAll = () => {
    setCollapsedIds(isAllCollapsed ? new Set() : new Set(allExpandableUnitIds));
  };

  const toggleCollapse = (unitId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  // 7. 添加单个用户到项目
  const handleAddMember = (userId: string) => {
    if (!members.includes(userId)) {
      onMembersChange([...members, userId]);
    }
  };

  // 8. 批量添加某个部门的所有成员到项目
  const handleAddAllUnitMembers = (unitUsers: User[]) => {
    const unaddedIds = unitUsers.map((u) => u.id).filter((id) => !members.includes(id));
    if (unaddedIds.length > 0) {
      onMembersChange([...members, ...unaddedIds]);
    }
  };

  // 9. 从项目移除用户
  const handleRemoveMember = (userId: string) => {
    if (userId === project.createdBy) return; // 创建者不可移除
    onMembersChange(members.filter((id) => id !== userId));
    onAdminsChange(admins.filter((id) => id !== userId));
    if (defaultAssignee === userId) {
      onDefaultAssigneeChange('');
    }
  };

  // 9. 更改项目角色
  const handleRoleChange = (userId: string, role: 'Admin' | 'Member' | 'Viewer') => {
    if (role === 'Admin') {
      if (!admins.includes(userId)) {
        onAdminsChange([...admins, userId]);
      }
    } else {
      onAdminsChange(admins.filter((id) => id !== userId));
    }
  };

  // 10. 右侧已加入项目的用户列表
  const joinedUsers = useMemo(() => {
    const map = new Map(users.map((u) => [u.id, u]));
    return members
      .map((id) => map.get(id))
      .filter((u): u is User => u !== undefined);
  }, [members, users]);

  // 11. 过滤右侧列表
  const filteredJoinedUsers = useMemo(() => {
    if (!rightSearch.trim()) return joinedUsers;
    const q = rightSearch.trim().toLowerCase();
    return joinedUsers.filter(
      (u) =>
        (u.nickname && u.nickname.toLowerCase().includes(q)) ||
        (u.username && u.username.toLowerCase().includes(q))
    );
  }, [joinedUsers, rightSearch]);

  const defaultAssigneeOptions: ThemeSelectOption[] = useMemo(() => {
    const list: ThemeSelectOption[] = [{ value: '', label: '未指定' }];
    joinedUsers.forEach((u) => {
      list.push({
        value: u.id,
        label: `${u.nickname || u.username} (${u.id === currentUser.id ? '您' : u.username})`,
      });
    });
    return list;
  }, [joinedUsers, currentUser.id]);

  const roleSelectOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: 'Admin', label: tr('projects:projectModal.roleAdmin'), tone: 'amber' },
      { value: 'Member', label: tr('projects:projectModal.roleMember'), tone: 'blue' },
      { value: 'Viewer', label: tr('projects:projectModal.roleViewer'), tone: 'slate' },
    ],
    []
  );

  // 11. 搜索匹配逻辑：根据部门名或候选人昵称/用户名匹配
  const searchLower = leftSearch.trim().toLowerCase();

  const userMatchesQuery = (u: User, q: string) => {
    return (u.nickname && u.nickname.toLowerCase().includes(q)) || (u.username && u.username.toLowerCase().includes(q));
  };

  const matchingUnitIds = useMemo(() => {
    if (!searchLower) return null;
    const matched = new Set<string>();

    safeUnits.forEach((u) => {
      const branchUsers = branchUsersMap.get(u.id) || [];
      const hasMatchingUser = branchUsers.some((user) => userMatchesQuery(user, searchLower));
      const nameMatches = u.name.toLowerCase().includes(searchLower);
      if (nameMatches || hasMatchingUser) {
        matched.add(u.id);
        let curr = u.parentId;
        while (curr) {
          matched.add(curr);
          const parentUnit = safeUnits.find((p) => p.id === curr);
          curr = parentUnit ? parentUnit.parentId : null;
        }
      }
    });

    return matched;
  }, [searchLower, safeUnits, branchUsersMap]);

  const displayUnassignedUsers = useMemo(() => {
    if (!searchLower) return unassignedUsers;
    if ('未分配部门'.toLowerCase().includes(searchLower)) return unassignedUsers;
    return unassignedUsers.filter((u) => userMatchesQuery(u, searchLower));
  }, [searchLower, unassignedUsers]);

  const hasAnyMatches = useMemo(() => {
    if (!searchLower) return true;
    if (safeUnits.length === 0) {
      return users.some((u) => userMatchesQuery(u, searchLower));
    }
    return (matchingUnitIds !== null && matchingUnitIds.size > 0) || displayUnassignedUsers.length > 0;
  }, [searchLower, safeUnits.length, users, matchingUnitIds, displayUnassignedUsers.length]);

  // 渲染人员条目
  const renderUserRow = (user: User, depth = 0) => {
    const isJoined = members.includes(user.id);
    const isSelf = user.id === currentUser.id;

    return (
      <div
        key={user.id}
        style={{ paddingLeft: `${depth * 14 + 14}px` }}
        className={`group/user flex items-center justify-between rounded-xl py-1 pr-2 text-xs transition-colors ${
          isJoined ? 'bg-canvas/20 text-quiet' : 'hover:bg-hover text-main'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent font-bold text-[11px] uppercase">
            {(user.nickname || user.username).slice(0, 1)}
            <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface ${user.isOnline ? 'bg-success' : 'bg-muted'}`} />
          </div>
          <div className="flex min-w-0 items-center gap-1.5 truncate">
            <span className={`truncate text-xs ${isJoined ? 'text-quiet font-normal' : 'text-main font-medium'}`}>{user.nickname || user.username}</span>
            {isSelf && <span className="rounded bg-accent/10 px-1 py-0.2 text-[9px] text-accent font-medium shrink-0">您</span>}
            <span className="truncate text-[10px] text-quiet">@{user.username}</span>
          </div>
        </div>

        <div className="shrink-0 pl-1.5">
          {isJoined ? (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success border border-success/20">
              <Check className="w-2.5 h-2.5" />
              <span>已加入</span>
            </span>
          ) : isProjectAdmin ? (
            <button
              type="button"
              onClick={() => handleAddMember(user.id)}
              className="flex items-center gap-0.5 rounded-md bg-accent px-2 py-0.5 text-[10px] font-semibold text-on-accent hover:bg-accent/90 transition-colors shadow-2xs"
              title="添加到项目"
            >
              <Plus className="w-3 h-3" />
              <span>添加</span>
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  // 渲染组织架构树节点（递归包含子部门与直属人员）
  const renderTreeNodes = (parentId: string | null = null, depth = 0) => {
    const children = childrenMap.get(parentId) || [];
    if (children.length === 0) return null;

    const visibleChildren = matchingUnitIds !== null
      ? children.filter((u) => matchingUnitIds.has(u.id))
      : children;

    if (visibleChildren.length === 0) return null;

    return (
      <div className="space-y-0.5">
        {visibleChildren.map((unit) => {
          const subChildren = childrenMap.get(unit.id) || [];
          const directUsers = directUnitUsersMap.get(unit.id) || [];
          const branchUsers = branchUsersMap.get(unit.id) || [];
          const hasChildren = subChildren.length > 0 || directUsers.length > 0;
          const isCollapsed = searchLower ? false : collapsedIds.has(unit.id);
          const unaddedBranchUsers = branchUsers.filter((u) => !members.includes(u.id));

          // 搜索时，若部门名匹配则展示所有直属成员，否则只展示匹配的直属成员
          const displayDirectUsers = searchLower
            ? (unit.name.toLowerCase().includes(searchLower) ? directUsers : directUsers.filter((u) => userMatchesQuery(u, searchLower)))
            : directUsers;

          return (
            <div key={unit.id} className="select-none">
              <div
                onClick={() => hasChildren && toggleCollapse(unit.id)}
                style={{ paddingLeft: `${depth * 14 + 8}px` }}
                className={`group flex items-center justify-between rounded-xl py-1.5 pr-2.5 text-xs transition-colors cursor-pointer hover:bg-hover ${
                  !isCollapsed ? 'text-main font-semibold' : 'text-main'
                }`}
              >
                <div className="flex min-w-0 items-center gap-1.5 truncate">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(unit.id);
                      }}
                      className="p-0.5 text-quiet hover:text-main rounded transition-colors"
                    >
                      {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-sub group-hover:text-accent transition-colors" />
                  <span className="truncate">{unit.name}</span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {isProjectAdmin && unaddedBranchUsers.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddAllUnitMembers(branchUsers);
                      }}
                      className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 text-[10px] font-semibold text-accent hover:bg-accent/15 px-1.5 py-0.5 rounded transition-all"
                      title={`添加 ${unit.name} 全部人员 (${unaddedBranchUsers.length} 人)`}
                    >
                      <UserPlus className="w-3 h-3" />
                      <span>添加全组</span>
                    </button>
                  )}
                  <span className="rounded-full bg-card px-1.5 py-0.2 text-[10px] text-quiet font-mono border border-edge/60">
                    {branchUsers.length}
                  </span>
                </div>
              </div>

              {!isCollapsed && (
                <div className="space-y-0.5">
                  {subChildren.length > 0 && renderTreeNodes(unit.id, depth + 1)}
                  {displayDirectUsers.map((u) => renderUserRow(u, depth + 1))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // 渲染未分配部门节点
  const renderUnassignedNode = () => {
    if (displayUnassignedUsers.length === 0 && searchLower) return null;
    if (unassignedUsers.length === 0) return null;

    const isCollapsed = searchLower ? false : collapsedIds.has(UNASSIGNED_UNIT_ID);
    const unaddedCount = unassignedUsers.filter((u) => !members.includes(u.id)).length;

    return (
      <div className="select-none">
        <div
          onClick={() => toggleCollapse(UNASSIGNED_UNIT_ID)}
          style={{ paddingLeft: '8px' }}
          className={`group flex items-center justify-between rounded-xl py-1.5 pr-2.5 text-xs transition-colors cursor-pointer hover:bg-hover ${
            !isCollapsed ? 'text-main font-semibold' : 'text-main'
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5 truncate">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse(UNASSIGNED_UNIT_ID);
              }}
              className="p-0.5 text-quiet hover:text-main rounded transition-colors"
            >
              {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            <Building2 className="h-3.5 w-3.5 shrink-0 text-quiet group-hover:text-accent transition-colors" />
            <span className="truncate">未分配部门</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isProjectAdmin && unaddedCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddAllUnitMembers(unassignedUsers);
                }}
                className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 text-[10px] font-semibold text-accent hover:bg-accent/15 px-1.5 py-0.5 rounded transition-all"
                title={`添加未分配部门全部人员 (${unaddedCount} 人)`}
              >
                <UserPlus className="w-3 h-3" />
                <span>添加本组</span>
              </button>
            )}
            <span className="rounded-full bg-card px-1.5 py-0.2 text-[10px] text-quiet font-mono border border-edge/60">
              {unassignedUsers.length}
            </span>
          </div>
        </div>

        {!isCollapsed && (
          <div className="space-y-0.5">
            {displayUnassignedUsers.map((u) => renderUserRow(u, 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-[480px] w-full overflow-hidden rounded-2xl border border-edge bg-surface shadow-soft">
      {/* ===================== 左侧分栏：组织架构与待选人员 ===================== */}
      <div className="flex w-72 shrink-0 flex-col border-r border-edge bg-canvas/30 overflow-hidden">
        {/* 1. 顶部候选人与部门搜索框 */}
        <div className="border-b border-edge p-2.5 bg-surface/50">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-quiet" />
            <input
              type="text"
              value={leftSearch}
              onChange={(e) => setLeftSearch(e.target.value)}
              placeholder="搜索部门或候选人员..."
              className="w-full bg-canvas border border-edge rounded-lg pl-8 pr-7 py-1.5 text-xs text-main placeholder:text-quiet focus:outline-none focus:border-accent"
            />
            {leftSearch && (
              <button type="button" onClick={() => setLeftSearch('')} className="absolute right-2 top-2 text-quiet hover:text-main">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 2. 组织架构标题与一键展开收起 */}
        <div className="flex items-center justify-between border-b border-edge px-3.5 py-2 bg-canvas/40">
          <div className="flex items-center gap-1.5 text-xs font-bold text-main">
            <FolderTree className="h-4 w-4 text-accent" />
            <span>组织架构</span>
            <span className="text-[10px] text-quiet font-normal">({users.length}人)</span>
          </div>
          {allExpandableUnitIds.size > 0 && (
            <button
              type="button"
              onClick={handleToggleExpandAll}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-quiet hover:bg-hover hover:text-main transition-colors"
              title={isAllCollapsed ? '一键全部展开' : '一键全部折叠'}
              aria-label={isAllCollapsed ? '一键全部展开' : '一键全部折叠'}
            >
              {isAllCollapsed ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <ChevronsDownUp className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        {/* 3. 组织树与候选人员（无缝融合） */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 scrollbar-thin">
          {safeUnits.length === 0 ? (
            <div className="space-y-0.5">
              {(searchLower ? users.filter((u) => userMatchesQuery(u, searchLower)) : users).map((u) => renderUserRow(u, 0))}
            </div>
          ) : hasAnyMatches ? (
            <>
              {renderTreeNodes(null, 0)}
              {renderUnassignedNode()}
            </>
          ) : (
            <div className="py-8 text-center text-xs text-quiet">未找到匹配的部门或候选人员</div>
          )}
        </div>
      </div>

      {/* ===================== 右侧分栏：已加入项目成员与角色配置 ===================== */}
      <div className="flex flex-1 min-w-0 flex-col overflow-hidden bg-surface">
        {/* 顶部配置面板：默认负责人 & 访客权限 */}
        <div className="border-b border-edge bg-canvas/30 p-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-edge bg-surface/80 p-3">
              <div className="font-semibold text-main text-xs mb-0.5">{tr('projects:projectModal.defaultAssigneeTitle')}</div>
              <div className="text-[11px] text-quiet mb-2">{tr('projects:projectModal.defaultAssigneeHint')}</div>
              <ThemeSelect
                portal
                disabled={!isProjectAdmin}
                value={defaultAssignee}
                options={defaultAssigneeOptions}
                onChange={(val) => onDefaultAssigneeChange(val)}
                ariaLabel={tr('projects:projectModal.defaultAssigneeTitle')}
              />
            </div>

            <div className="rounded-xl border border-edge bg-surface/80 p-3 flex items-center justify-between">
              <div>
                <div className="font-semibold text-main text-xs mb-0.5">{tr('projects:projectModal.guestAccessTitle')}</div>
                <div className="text-[11px] text-quiet max-w-xs">
                  {tr('projects:projectModal.guestAccessHint')}
                </div>
              </div>
              <input
                type="checkbox"
                disabled={!isProjectAdmin}
                checked={guestAccess}
                onChange={(e) => onGuestAccessChange(e.target.checked)}
                className="h-4 w-4 rounded border-edge text-accent focus:ring-accent cursor-pointer disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {/* 成员列表顶部工具条 */}
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-main">已加入项目成员</h3>
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-mono font-bold text-accent">
              {joinedUsers.length}
            </span>
          </div>

          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-quiet" />
            <input
              type="text"
              value={rightSearch}
              onChange={(e) => setRightSearch(e.target.value)}
              placeholder="搜索已加入项目成员..."
              className="w-full bg-canvas border border-edge rounded-xl pl-8 pr-3 py-1.5 text-xs text-main focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* 成员表格 */}
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
          <div className="rounded-xl border border-edge overflow-hidden bg-canvas/30">
            <table className="w-full table-fixed text-left text-xs">
              <colgroup>
                <col className="w-[40%]" />
                <col className="w-[26%]" />
                <col className="w-[22%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead className="border-b border-edge bg-canvas/60 text-quiet font-semibold">
                <tr>
                  <th className="py-2.5 px-3 truncate">成员</th>
                  <th className="py-2.5 px-2.5 truncate">所属部门</th>
                  <th className="py-2.5 px-2.5 truncate">项目角色</th>
                  <th className="py-2.5 px-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {filteredJoinedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-quiet">
                      暂无项目成员，请从左侧组织架构中选择人员添加
                    </td>
                  </tr>
                ) : (
                  filteredJoinedUsers.map((u) => {
                    const isCreator = u.id === project.createdBy;
                    const isAdmin = admins.includes(u.id);
                    const roleValue: 'Admin' | 'Member' | 'Viewer' = isAdmin ? 'Admin' : 'Member';
                    const roleLabel = isAdmin
                      ? tr('projects:projectModal.roleAdmin')
                      : tr('projects:projectModal.roleMember');
                    const deptName = userUnitNameMap.get(u.id) || '未分配';

                    return (
                      <tr key={u.id} className="hover:bg-hover/40 transition-colors">
                        <td className="py-2 px-3 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            {/* 头像与在线状态指示点 */}
                            <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent font-bold text-xs uppercase">
                              {(u.nickname || u.username).slice(0, 1)}
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-surface ${
                                  u.isOnline ? 'bg-success' : 'bg-muted'
                                }`}
                                title={u.isOnline ? '在线' : '离线'}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-bold text-main truncate text-xs" title={u.nickname || u.username}>
                                  {u.nickname || u.username}
                                </span>
                                {u.id === currentUser.id && (
                                  <span className="rounded bg-accent/15 px-1 py-0.2 text-[9px] font-semibold text-accent shrink-0">
                                    您
                                  </span>
                                )}
                                {isCreator && (
                                  <span className="rounded bg-amber-500/15 px-1 py-0.2 text-[9px] font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                                    {tr('projects:projectModal.roleCreator')}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-quiet truncate flex items-center gap-1 font-mono">
                                <span className="truncate">{u.username}</span>
                                {u.ip && (
                                  <span className="text-[9px] text-quiet/70 shrink-0">({u.ip})</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-2.5 min-w-0">
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-0.5 border border-edge/60 max-w-full shadow-2xs" title={deptName}>
                            <Building2 className="w-3.5 h-3.5 text-quiet shrink-0" />
                            <span className="truncate text-[11px] text-sub">{deptName}</span>
                          </span>
                        </td>
                        <td className="py-2 px-2.5 min-w-0">
                          {isCreator ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-info/10 px-2 py-1 text-[11px] font-semibold text-info border border-info/20 truncate" title={tr('projects:projectModal.roleCreator')}>
                              <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> {tr('projects:projectModal.roleCreator')}
                            </span>
                          ) : isProjectAdmin ? (
                            <div className="w-full">
                              <ThemeSelect
                                portal
                                value={roleValue}
                                options={roleSelectOptions}
                                onChange={(val) => handleRoleChange(u.id, val as any)}
                                ariaLabel={tr('projects:projectModal.roleMember')}
                              />
                            </div>
                          ) : (
                            <span className="text-sub font-semibold truncate text-[11px]">{roleLabel}</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {isCreator ? (
                            <button
                              type="button"
                              disabled
                              className="text-quiet opacity-40 p-1 cursor-not-allowed"
                              title="项目创建者不可移除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : isProjectAdmin ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(u.id)}
                              className="text-danger hover:text-danger/80 transition-colors p-1 rounded hover:bg-danger/10"
                              title="从项目中移除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
