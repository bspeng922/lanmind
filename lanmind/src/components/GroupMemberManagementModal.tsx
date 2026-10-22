/**
 * GroupMemberManagementModal — 局域网聊天群组成员管理弹窗（左右分栏布局与项目维度关联）。
 *
 * CALLING SPEC:
 *   <GroupMemberManagementModal
 *     isOpen={boolean}
 *     onClose={() => void}
 *     group={LanChatGroup}
 *     currentUser={User}
 *     users={User[]}
 *     projects={Project[]}
 *     localDirectory={LocalDirectory}
 *     canManage={boolean}
 *     onGroupUpdated={(updatedGroup: LanChatGroup) => void}
 *   />
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Crown,
  FolderKanban,
  FolderTree,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { tr, useLocale } from '../i18n';
import type { LanChatGroup, LocalDirectory, LocalOrgUnit, Project, User } from '../types';
import { ApiService } from '../services/api';
import { isTauri } from '@tauri-apps/api/core';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { isGroupCreatorOrAdmin, groupAdminIds } from '../utils/groupPermissions';

export const UNASSIGNED_UNIT_ID = '__unassigned__';

export interface GroupMemberManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: LanChatGroup;
  currentUser: User;
  users: User[];
  projects?: Project[];
  localDirectory?: LocalDirectory;
  canManage: boolean;
  onGroupUpdated: (updatedGroup: LanChatGroup) => void;
}

export const GroupMemberManagementModal: React.FC<GroupMemberManagementModalProps> = ({
  isOpen,
  onClose,
  group,
  currentUser,
  users = [],
  projects = [],
  localDirectory = { units: [], members: [] },
  canManage,
  onGroupUpdated,
}) => {
  useLocale();

  const [managedMemberIds, setManagedMemberIds] = useState<string[]>(group.memberIds || []);
  const [managedAdminIds, setManagedAdminIds] = useState<string[]>(group.adminIds || []);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(group.projectId || '');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [leftSearch, setLeftSearch] = useState('');
  const [rightSearch, setRightSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [projectSyncNotice, setProjectSyncNotice] = useState<string | null>(null);

  // 同步外部群组状态
  useEffect(() => {
    if (isOpen) {
      setManagedMemberIds(group.memberIds || []);
      setManagedAdminIds(group.adminIds || []);
      setSelectedProjectId(group.projectId || '');
      setLeftSearch('');
      setRightSearch('');
      setErrorMessage(null);
      setProjectSyncNotice(null);
    }
  }, [isOpen, group.id, group.memberIds, group.adminIds, group.projectId]);

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

  // 5. 用户与部门名称映射 (userId -> unitName) 用于右侧成员表格展示
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

  const isAllCollapsed = allExpandableUnitIds.size > 0 && Array.from(allExpandableUnitIds).every((id) => collapsedIds.has(id));

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

  // 7. 可选项目列表
  const projectOptions: ThemeSelectOption[] = useMemo(() => [
    { value: '', label: tr('chat:groupMemberModal.noLinkedProject'), tone: 'slate' },
    ...projects.map((p) => ({ value: p.id, label: `📁 ${p.name}`, tone: 'blue' as const })),
  ], [projects]);

  const linkedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return projects.find((p) => p.id === selectedProjectId) || null;
  }, [projects, selectedProjectId]);

  const linkedProjectMemberIds = useMemo(() => {
    if (!linkedProject) return null;
    return new Set([
      linkedProject.createdBy,
      ...(Array.isArray(linkedProject.admins) ? linkedProject.admins : []),
      ...(Array.isArray(linkedProject.members) ? linkedProject.members : []),
    ]);
  }, [linkedProject]);

  // 角色管理权限：群主和群管理员可以设置其他成员的角色
  const isCurrentUserCreator = group.createdBy === currentUser.id;
  const isCurrentUserAdmin = Array.isArray(managedAdminIds) && managedAdminIds.includes(currentUser.id);
  const canManageRoles = canManage && (isCurrentUserCreator || isCurrentUserAdmin);

  const groupRoleOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: 'admin', label: tr('chat:groupMemberModal.admin'), tone: 'blue' },
      { value: 'member', label: tr('chat:groupMemberModal.member'), tone: 'slate' },
    ],
    []
  );

  const handleRoleChange = (userId: string, newRole: 'admin' | 'member') => {
    if (userId === group.createdBy) return; // 群主不可被修改
    if (newRole === 'admin') {
      setManagedAdminIds((prev) => Array.from(new Set([...prev, userId])));
    } else {
      setManagedAdminIds((prev) => prev.filter((id) => id !== userId));
    }
  };

  // 8. 关联项目发生变化时：以项目为维度管理，自动加入该项目中的所有用户！
  const handleProjectSelect = (newProjectId: string) => {
    setSelectedProjectId(newProjectId);
    if (!newProjectId) {
      setProjectSyncNotice(null);
      return;
    }
    const prj = projects.find((p) => p.id === newProjectId);
    if (!prj) return;
    const prjMemberIds = new Set([
      prj.createdBy,
      ...(Array.isArray(prj.admins) ? prj.admins : []),
      ...(Array.isArray(prj.members) ? prj.members : []),
    ]);
    setManagedMemberIds((prev) => Array.from(new Set([...prev, ...prjMemberIds, group.createdBy])));
    setProjectSyncNotice(tr('chat:groupMemberModal.projectLinkedNotice', { name: prj.name, count: prjMemberIds.size }));
  };

  const handleSyncProjectMembers = () => {
    if (!linkedProject) return;
    const prjMemberIds = new Set([
      linkedProject.createdBy,
      ...(Array.isArray(linkedProject.admins) ? linkedProject.admins : []),
      ...(Array.isArray(linkedProject.members) ? linkedProject.members : []),
    ]);
    setManagedMemberIds((prev) => Array.from(new Set([...prev, ...prjMemberIds, group.createdBy])));
    setProjectSyncNotice(tr('chat:groupMemberModal.projectResyncedNotice', { name: linkedProject.name }));
  };

  const handleAddMember = (userId: string) => {
    if (linkedProject && linkedProjectMemberIds && !linkedProjectMemberIds.has(userId) && userId !== group.createdBy) {
      setErrorMessage(tr('chat:groupMemberModal.projectRestrictedNotice', { name: linkedProject.name }));
      return;
    }
    setErrorMessage(null);
    if (!managedMemberIds.includes(userId)) setManagedMemberIds((prev) => [...prev, userId]);
  };

  const handleAddAllUnitMembers = (unitUsers: User[]) => {
    const validUsers = linkedProject && linkedProjectMemberIds
      ? unitUsers.filter((u) => linkedProjectMemberIds.has(u.id) || u.id === group.createdBy)
      : unitUsers;
    const unaddedIds = validUsers.map((u) => u.id).filter((id) => !managedMemberIds.includes(id));
    if (unaddedIds.length > 0) {
      setManagedMemberIds((prev) => [...prev, ...unaddedIds]);
      setErrorMessage(null);
    }
    if (linkedProject && linkedProjectMemberIds && validUsers.length < unitUsers.length) {
      setProjectSyncNotice(tr('chat:groupMemberModal.departmentPartialAddedNotice', { name: linkedProject.name, count: unaddedIds.length }));
    }
  };

  const handleRemoveMember = (userId: string) => {
    if (userId === group.createdBy) return; // 群主不可被移除
    setManagedMemberIds((prev) => prev.filter((id) => id !== userId));
    setManagedAdminIds((prev) => prev.filter((id) => id !== userId));
  };

  const joinedUsers = useMemo(() => {
    const map = new Map(users.map((u) => [u.id, u]));
    return managedMemberIds.map((id) => map.get(id)).filter((u): u is User => u !== undefined);
  }, [managedMemberIds, users]);

  const filteredJoinedUsers = useMemo(() => {
    if (!rightSearch.trim()) return joinedUsers;
    const q = rightSearch.trim().toLowerCase();
    return joinedUsers.filter((u) => (u.nickname && u.nickname.toLowerCase().includes(q)) || (u.username && u.username.toLowerCase().includes(q)));
  }, [joinedUsers, rightSearch]);

  // 9. 搜索匹配逻辑：根据部门名或候选人昵称/用户名匹配
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

  const handleSave = async () => {
    if (!canManage) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      // 1. 如果关联了项目，校验是否有非项目成员混入
      if (linkedProject && linkedProjectMemberIds) {
        const invalidUserIds = managedMemberIds.filter(
          (id) => !linkedProjectMemberIds.has(id) && id !== group.createdBy
        );
        if (invalidUserIds.length > 0) {
          const invalidNames = invalidUserIds
            .map((id) => users.find((u) => u.id === id)?.nickname || id)
            .join('、');
          setErrorMessage(
            `关联项目群组只能添加项目成员。以下人员非「${linkedProject.name}」成员：${invalidNames}。请先将其移除或解除项目关联。`
          );
          setIsSaving(false);
          return;
        }
      }

      const finalAdminIds = Array.from(
        new Set([
          ...managedAdminIds.filter((id) => managedMemberIds.includes(id)),
          group.createdBy,
        ])
      );
      const finalMemberIds = Array.from(
        new Set([...managedMemberIds, ...finalAdminIds, group.createdBy])
      );
      let updated: LanChatGroup = {
        ...group,
        memberIds: finalMemberIds,
        adminIds: finalAdminIds,
        projectId: selectedProjectId || undefined,
      };

      if (isTauri()) {
        try {
          // 关联项目若改变，先更新 profile 以更新 project_id 边界
          if (selectedProjectId !== (group.projectId || '')) {
            updated = await ApiService.updateChatGroupProfile(
              group.id,
              group.name,
              group.description,
              group.avatar,
              selectedProjectId || undefined,
              currentUser.id
            );
          }
          // 再同步更新成员与管理员角色
          updated = await ApiService.updateChatGroupMembers(
            group.id,
            finalMemberIds,
            finalAdminIds,
            currentUser.id
          );
        } catch (apiError: any) {
          const errText = apiError instanceof Error ? apiError.message : String(apiError);
          // 若为尚未持久化的虚拟项目群组（群组不存在），先执行落库创建
          if (errText.includes('群组不存在') || errText.includes('not found')) {
            const newGroupToSave: LanChatGroup = {
              ...group,
              projectId: selectedProjectId || undefined,
              memberIds: finalMemberIds,
              adminIds: finalAdminIds,
              createdBy: group.createdBy || currentUser.id,
            };
            updated = await ApiService.saveChatGroup(newGroupToSave);
          } else {
            throw apiError;
          }
        }
      }
      onGroupUpdated(updated);
      onClose();
    } catch (e: any) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  // 渲染人员条目
  const renderUserRow = (user: User, depth = 0) => {
    const isJoined = managedMemberIds.includes(user.id);
    const isSelf = user.id === currentUser.id;
    const isProjectMember = !linkedProject || !linkedProjectMemberIds || linkedProjectMemberIds.has(user.id) || user.id === group.createdBy;

    return (
      <div
        key={user.id}
        style={{ paddingLeft: `${depth * 14 + 14}px` }}
        className={`group/user flex items-center justify-between rounded-xl py-1 pr-2 text-xs transition-colors ${
          isJoined ? 'bg-canvas/20 text-quiet' : !isProjectMember ? 'opacity-60 text-quiet' : 'hover:bg-hover text-main'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent font-bold text-[11px] uppercase">
            {(user.nickname || user.username).slice(0, 1)}
            <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface ${user.isOnline ? 'bg-success' : 'bg-muted'}`} />
          </div>
          <div className="flex min-w-0 items-center gap-1.5 truncate">
            <span className={`truncate text-xs ${isJoined ? 'text-quiet font-normal' : 'text-main font-medium'}`}>{user.nickname || user.username}</span>
            {isSelf && <span className="rounded bg-accent/10 px-1 py-0.2 text-[9px] text-accent font-medium shrink-0">{tr('chat:groupMemberModal.you')}</span>}
            <span className="truncate text-[10px] text-quiet">@{user.username}</span>
            {!isProjectMember && (
              <span className="rounded bg-card border border-edge/60 px-1 py-0.2 text-[9px] text-quiet shrink-0" title={tr('chat:groupMemberModal.notProjectMember', { name: linkedProject?.name || '' })}>
                {tr('chat:groupMemberModal.nonProjectMember')}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 pl-1.5">
          {isJoined ? (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success border border-success/20">
              <Check className="w-2.5 h-2.5" />
              <span>{tr('chat:groupMemberModal.alreadyInGroup')}</span>
            </span>
          ) : !isProjectMember ? (
            <span className="text-[10px] text-quiet px-1" title={tr('chat:groupMemberModal.onlyProjectMembersAllowed')}>
              {tr('chat:groupMemberModal.cannotAdd')}
            </span>
          ) : canManage ? (
            <button
              type="button"
              onClick={() => handleAddMember(user.id)}
              className="flex items-center gap-0.5 rounded-md bg-accent px-2 py-0.5 text-[10px] font-semibold text-on-accent hover:bg-accent/90 transition-colors shadow-2xs"
              title={tr('chat:groupMemberModal.addToGroup')}
            >
              <Plus className="w-3 h-3" />
              <span>{tr('chat:groupMemberModal.add')}</span>
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
          const unaddedBranchUsers = branchUsers.filter((u) => !managedMemberIds.includes(u.id));

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
                  {canManage && unaddedBranchUsers.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddAllUnitMembers(branchUsers);
                      }}
                      className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 text-[10px] font-semibold text-accent hover:bg-accent/15 px-1.5 py-0.5 rounded transition-all"
                      title={tr('chat:groupMemberModal.addAllUnitTooltip', { name: unit.name, count: unaddedBranchUsers.length })}
                    >
                      <UserPlus className="w-3 h-3" />
                      <span>{tr('chat:groupMemberModal.addAllUnit')}</span>
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
    const unaddedCount = unassignedUsers.filter((u) => !managedMemberIds.includes(u.id)).length;

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
            <span className="truncate">{tr('chat:groupMemberModal.unassignedDept')}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {canManage && unaddedCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddAllUnitMembers(unassignedUsers);
                }}
                className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 text-[10px] font-semibold text-accent hover:bg-accent/15 px-1.5 py-0.5 rounded transition-all"
                title={tr('chat:groupMemberModal.addUnassignedUnitTooltip', { count: unaddedCount })}
              >
                <UserPlus className="w-3 h-3" />
                <span>{tr('chat:groupMemberModal.addThisGroup')}</span>
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onClose(); }}
    >
      <div className="relative flex h-[82vh] w-[1080px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-strong animate-in zoom-in-95 duration-200">
        {/* 顶部标题与关联项目栏 */}
        <div className="flex items-center justify-between border-b border-edge bg-canvas/40 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/20 text-accent font-bold text-base">
              {group.avatar || '👥'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-main text-sm">{group.name}</span>
                <span className="text-xs text-quiet font-normal">{tr('chat:groupMemberModal.memberManagement')}</span>
                {group.createdBy === currentUser.id ? (
                  <span className="flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning font-semibold">
                    <Crown className="h-3 w-3" /> {tr('chat:groupMemberModal.owner')}
                  </span>
                ) : isGroupCreatorOrAdmin(group, currentUser.id) ? (
                  <span className="flex items-center gap-1 rounded bg-info/15 px-1.5 py-0.5 text-[10px] text-info font-semibold">
                    <Shield className="h-3 w-3" /> {tr('chat:groupMemberModal.admin')}
                  </span>
                ) : null}
              </div>
              <div className="text-[11px] text-quiet">{tr('chat:groupMemberModal.subtitle')}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {canManage && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-sub shrink-0 flex items-center gap-1">
                  <FolderKanban className="w-3.5 h-3.5 text-accent" />
                  <span>{tr('chat:groupMemberModal.linkedProject')}</span>
                </span>
                <div className="w-48">
                  <ThemeSelect portal value={selectedProjectId} options={projectOptions} onChange={(val) => handleProjectSelect(val)} ariaLabel={tr('chat:groupMemberModal.linkedProject')} />
                </div>
                {linkedProject && (
                  <button
                    type="button"
                    onClick={handleSyncProjectMembers}
                    className="flex h-7 items-center gap-1 rounded-lg border border-edge bg-surface px-2 text-[11px] font-semibold text-sub hover:bg-hover hover:text-main transition-colors"
                    title={tr('chat:groupMemberModal.syncProjectMembersTooltip')}
                  >
                    <RefreshCw className="w-3 h-3 text-accent" />
                    <span>{tr('chat:groupMemberModal.syncProjectMembers')}</span>
                  </button>
                )}
              </div>
            )}
            <button type="button" onClick={onClose} disabled={isSaving} className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main" title={tr('chat:groupMemberModal.close')}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 同步或错误通知栏 */}
        {projectSyncNotice && (
          <div className="flex items-center justify-between border-b border-accent/20 bg-accent/10 px-5 py-2 text-xs font-semibold text-accent">
            <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /><span>{projectSyncNotice}</span></span>
            <button type="button" onClick={() => setProjectSyncNotice(null)} className="text-accent/70 hover:text-accent"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}
        {errorMessage && (
          <div className="flex items-center justify-between border-b border-danger/20 bg-danger/10 px-5 py-2 text-xs font-semibold text-danger">
            <span>{errorMessage}</span>
            <button type="button" onClick={() => setErrorMessage(null)} className="text-danger/70 hover:text-danger"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {/* 主体：左右分栏布局 */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* 左侧：组织架构与候选人员 */}
          <div className="flex w-80 shrink-0 flex-col border-r border-edge bg-canvas/30 overflow-hidden">
            {/* 1. 顶部候选人与部门搜索框 */}
            <div className="border-b border-edge p-2.5 bg-surface/50">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-quiet" />
                <input
                  type="text"
                  value={leftSearch}
                  onChange={(e) => setLeftSearch(e.target.value)}
                  placeholder={tr('chat:groupMemberModal.searchCandidatePlaceholder')}
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
                <span>{tr('chat:groupMemberModal.orgTree')}</span>
                <span className="text-[10px] text-quiet font-normal">({users.length})</span>
              </div>
              {allExpandableUnitIds.size > 0 && (
                <button
                  type="button"
                  onClick={handleToggleExpandAll}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-quiet hover:bg-hover hover:text-main transition-colors"
                  title={isAllCollapsed ? tr('chat:groupMemberModal.expandAll') : tr('chat:groupMemberModal.collapseAll')}
                  aria-label={isAllCollapsed ? tr('chat:groupMemberModal.expandAll') : tr('chat:groupMemberModal.collapseAll')}
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
                <div className="py-8 text-center text-xs text-quiet">{tr('chat:groupMemberModal.noMatchingCandidates')}</div>
              )}
            </div>
          </div>

          {/* 右侧：当前群组成员管理 */}
          <div className="flex flex-1 min-w-0 flex-col overflow-hidden bg-surface">
            <div className="flex items-center justify-between border-b border-edge px-5 py-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-main">{tr('chat:groupMemberModal.currentGroupMembers')}</h3>
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-mono font-bold text-accent">
                  {tr('chat:groupMemberModal.memberCountPill', { count: joinedUsers.length })}
                </span>
                {linkedProject && (
                  <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-500 border border-blue-500/20">
                    <FolderKanban className="w-3 h-3" />
                    <span>{tr('chat:groupMemberModal.linkedProjectBadge', { value0: linkedProject.name })}</span>
                  </span>
                )}
              </div>

              <div className="relative w-56">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-quiet" />
                <input
                  type="text"
                  value={rightSearch}
                  onChange={(e) => setRightSearch(e.target.value)}
                  placeholder={tr('chat:groupMemberModal.searchMembersPlaceholder')}
                  className="w-full bg-canvas border border-edge rounded-xl pl-8 pr-3 py-1.5 text-xs text-main focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              <div className="rounded-xl border border-edge overflow-x-auto bg-canvas/30 scrollbar-thin">
                <table className="w-full min-w-[500px] text-left text-xs">
                  <thead className="border-b border-edge bg-canvas/60 text-quiet font-semibold">
                    <tr>
                      <th className="py-2.5 px-4 whitespace-nowrap min-w-[170px]">{tr('chat:groupMemberModal.colMember')}</th>
                      <th className="py-2.5 px-4 whitespace-nowrap min-w-[120px]">{tr('chat:groupMemberModal.colDepartment')}</th>
                      <th className="py-2.5 px-4 whitespace-nowrap w-36">{tr('chat:groupMemberModal.colRole')}</th>
                      <th className="py-2.5 px-4 whitespace-nowrap text-right w-14 pr-4">{tr('chat:groupMemberModal.colAction')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge">
                    {filteredJoinedUsers.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-quiet">{tr('chat:groupMemberModal.noMatchingMembers')}</td>
                      </tr>
                    ) : (
                      filteredJoinedUsers.map((u) => {
                        const isCreator = u.id === group.createdBy;
                        const isAdmin = !isCreator && (managedAdminIds || []).includes(u.id);
                        const deptName = userUnitNameMap.get(u.id) || tr('chat:groupMemberModal.unassigned');

                        return (
                          <tr key={u.id} className="hover:bg-hover/40 transition-colors">
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent font-bold text-xs uppercase">
                                  {(u.nickname || u.username).slice(0, 1)}
                                  <span
                                    className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-surface ${
                                      u.isOnline ? 'bg-success' : 'bg-muted'
                                    }`}
                                    title={u.isOnline ? tr('chat:groupMemberModal.online') : tr('chat:groupMemberModal.offline')}
                                  />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-main truncate max-w-[140px] text-xs">
                                      {u.nickname || u.username}
                                    </span>
                                    {u.id === currentUser.id && (
                                      <span className="rounded bg-accent/15 px-1.5 py-0.2 text-[10px] font-semibold text-accent shrink-0">
                                        {tr('chat:groupMemberModal.you')}
                                      </span>
                                    )}
                                    {isCreator && (
                                      <span className="rounded bg-amber-500/15 px-1.5 py-0.2 text-[10px] font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                                        {tr('chat:groupMemberModal.owner')}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-quiet truncate flex items-center gap-1.5 font-mono">
                                    <span>{u.username}</span>
                                    {u.ip && (
                                      <span className="text-[10px] text-quiet/80">({u.ip})</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-sub text-[11px] whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-0.5 border border-edge/60 whitespace-nowrap shadow-2xs" title={deptName}>
                                <Building2 className="w-3.5 h-3.5 text-quiet shrink-0" />
                                <span className="whitespace-nowrap">{deptName}</span>
                              </span>
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              {isCreator ? (
                                <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20 whitespace-nowrap">
                                  <Crown className="w-3.5 h-3.5 shrink-0" /> {tr('chat:groupMemberModal.owner')}
                                </span>
                              ) : canManageRoles ? (
                                <div className="w-28">
                                  <ThemeSelect
                                    portal
                                    value={isAdmin ? 'admin' : 'member'}
                                    options={groupRoleOptions}
                                    onChange={(val) => handleRoleChange(u.id, val as 'admin' | 'member')}
                                    ariaLabel={tr('chat:groupMemberModal.colRole')}
                                  />
                                </div>
                              ) : isAdmin ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-info/15 px-2 py-0.5 text-[11px] font-semibold text-info border border-info/20 whitespace-nowrap">
                                  <Shield className="w-3.5 h-3.5 shrink-0" /> {tr('chat:groupMemberModal.admin')}
                                </span>
                              ) : (
                                <span className="text-sub font-semibold whitespace-nowrap text-xs">{tr('chat:groupMemberModal.member')}</span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right whitespace-nowrap pr-4">
                              {isCreator ? (
                                <button type="button" disabled className="text-quiet opacity-40 p-1 cursor-not-allowed" title={tr('chat:groupMemberModal.ownerCannotBeRemoved')}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              ) : canManage ? (
                                <button type="button" onClick={() => handleRemoveMember(u.id)} className="text-danger hover:text-danger/80 transition-colors p-1 rounded hover:bg-danger/10" title={tr('chat:groupMemberModal.removeMember')}>
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

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between border-t border-edge bg-canvas/40 px-6 py-3">
          <div className="text-xs text-quiet">
            {canManage ? tr('chat:groupMemberModal.footerManageHint') : tr('chat:groupMemberModal.footerReadOnlyHint')}
          </div>

          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onClose} disabled={isSaving} className="rounded-xl border border-edge bg-surface px-4 py-2 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-50">
              {tr('chat:groupMemberModal.cancel')}
            </button>
            {canManage && (
              <button type="button" onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent/90 disabled:opacity-50 shadow-soft">
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{tr('chat:groupMemberModal.saveChanges')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
