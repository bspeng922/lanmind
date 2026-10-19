/**
 * WorkspaceOrgMemberList — 工作区右侧部门成员列表与配置面板。
 *
 * CALLING SPEC:
 *   <WorkspaceOrgMemberList
 *     members={workspaceMembers}
 *     users={allUsers}
 *     currentUser={currentUser}
 *     selectedUnitId={selectedUnitId}
 *     units={units}
 *     orgMembers={orgMembers}
 *     canManage={boolean}
 *     onRoleChange={(userId, role) => void}
 *     onOrgChange={(userId, unitId) => void}
 *     onRemoveMember={(userId, name) => void}
 *     onOpenAddMember={() => void}
 *   />
 */

import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { tr, useLocale } from '../../../i18n';
import type {
  LocalOrgMember,
  LocalOrgUnit,
  User,
  WorkspaceMember,
  WorkspaceRole,
} from '../../../types';
import { MemberAvatar } from '../../workitem/MemberAvatar';
import { ThemeSelect, ThemeSelectOption } from '../../ThemeSelect';
import { UNASSIGNED_UNIT_ID } from './WorkspaceOrgTree';
import { OrgUnitTreeSelect } from './OrgUnitTreeSelect';

interface WorkspaceOrgMemberListProps {
  members: WorkspaceMember[];
  users: User[];
  currentUser: User;
  selectedUnitId: string | null;
  units: LocalOrgUnit[];
  orgMembers: LocalOrgMember[];
  canManage: boolean;
  onRoleChange: (userId: string, newRole: string) => void;
  onOrgChange: (userId: string, newUnitId: string) => void;
  onRemoveMember: (userId: string, name: string) => void;
  onOpenAddMember: () => void;
}

const ROLE_LABEL_KEYS: Record<WorkspaceRole, string> = {
  owner: 'settings:workspaceSettings.role.owner',
  admin: 'settings:workspaceSettings.role.admin',
  member: 'settings:workspaceSettings.role.member',
  guest: 'settings:workspaceSettings.role.guest',
};

export const WorkspaceOrgMemberList: React.FC<WorkspaceOrgMemberListProps> = ({
  members,
  users,
  currentUser,
  selectedUnitId,
  units,
  orgMembers,
  canManage,
  onRoleChange,
  onOrgChange,
  onRemoveMember,
  onOpenAddMember,
}) => {
  useLocale();
  const [search, setSearch] = useState('');

  // 当前选中的部门对象
  const currentUnit = useMemo(() => {
    if (!selectedUnitId || selectedUnitId === UNASSIGNED_UNIT_ID) return null;
    return units.find((u) => u.id === selectedUnitId) || null;
  }, [units, selectedUnitId]);

  // 获取当前组织节点的标题
  const currentUnitTitle = useMemo(() => {
    if (selectedUnitId === null) return tr('settings:workspaceSettings.rootOrg');
    if (selectedUnitId === UNASSIGNED_UNIT_ID) return tr('settings:workspaceSettings.unassignedOrg');
    return currentUnit ? currentUnit.name : '部门成员';
  }, [selectedUnitId, currentUnit]);

  // 根据当前选中的组织过滤成员
  const filteredByOrg = useMemo(() => {
    if (selectedUnitId === null) {
      // 根节点：所有工作区成员
      return members;
    }
    if (selectedUnitId === UNASSIGNED_UNIT_ID) {
      // 未分配部门：在 orgMembers 中没有记录或 unitId 无效
      const assignedUserIds = new Set(
        orgMembers
          .filter((m) => units.some((u) => u.id === m.orgUnitId))
          .map((m) => m.userId)
      );
      return members.filter((m) => !assignedUserIds.has(m.userId));
    }
    // 指定部门：直接属于该部门的成员
    const unitUserIds = new Set(
      orgMembers.filter((m) => m.orgUnitId === selectedUnitId).map((m) => m.userId)
    );
    return members.filter((m) => unitUserIds.has(m.userId));
  }, [members, selectedUnitId, orgMembers, units]);

  // 根据搜索关键字过滤
  const visibleMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredByOrg;
    return filteredByOrg.filter((m) => {
      const u = users.find((user) => user.id === m.userId);
      const name = (u?.nickname || '').toLowerCase();
      const uname = (u?.username || '').toLowerCase();
      const ip = (u?.ip || '').toLowerCase();
      return name.includes(q) || uname.includes(q) || ip.includes(q) || m.userId.toLowerCase().includes(q);
    });
  }, [filteredByOrg, search, users]);

  // 角色下拉选项
  const roleOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: 'admin', label: tr(ROLE_LABEL_KEYS.admin), tone: 'amber' },
      { value: 'member', label: tr(ROLE_LABEL_KEYS.member), tone: 'blue' },
      { value: 'guest', label: tr(ROLE_LABEL_KEYS.guest), tone: 'slate' },
    ],
    []
  );


  return (
    <div className="flex h-full flex-col">
      {/* 头部：部门名称、搜索框与添加成员按钮 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-edge pb-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-main truncate">{currentUnitTitle}</h3>
            <span className="rounded-full bg-card px-2 py-0.5 text-xs text-sub font-mono border border-edge">
              {filteredByOrg.length}
            </span>
          </div>
          <p className="text-[11px] text-quiet truncate mt-0.5">
            {selectedUnitId === null
              ? '当前显示工作区所有成员，可在下方管理角色与部门分配'
              : selectedUnitId === UNASSIGNED_UNIT_ID
              ? '尚未分配至任何具体部门的成员'
              : `所属组织: ${currentUnit?.name || '当前部门'}`}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-quiet" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr('settings:workspaceSettings.searchMembersPlaceholder')}
              className="h-8 w-44 sm:w-56 rounded-xl border border-edge bg-canvas pl-8 pr-7 text-xs text-main placeholder:text-quiet focus:border-accent focus:outline-none transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-quiet hover:text-main"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* 添加成员按钮 */}
          {canManage && (
            <button
              type="button"
              onClick={onOpenAddMember}
              className="flex h-8 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-semibold text-on-accent hover:opacity-90 transition-opacity shadow-soft shrink-0"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>{tr('settings:workspaceSettings.addMember')}</span>
            </button>
          )}
        </div>
      </div>

      {/* 只读提示（针对非管理员成员） */}
      {!canManage && (
        <div className="mb-3 rounded-xl border border-edge bg-canvas/60 px-3 py-1.5 text-[11px] text-quiet">
          {tr('settings:workspaceSettings.readOnlyNotice')}
        </div>
      )}

      {/* 成员列表区 */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
        {visibleMembers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-quiet">
            <Users className="h-8 w-8 text-quiet/50 mb-2" />
            <p>{search ? '未找到匹配的成员' : '当前部门暂无成员'}</p>
            {canManage && !search && selectedUnitId && selectedUnitId !== UNASSIGNED_UNIT_ID && (
              <p className="mt-1 text-[11px] text-sub">可将其他部门成员调动至此，或点击右上角添加新成员。</p>
            )}
          </div>
        ) : (
          visibleMembers.map((member) => {
            const user = users.find((item) => item.id === member.userId);
            const displayName = user?.nickname || user?.username || member.userId;
            const isOwner = member.role === 'owner';
            const isSelf = member.userId === currentUser.id;

            // 查找成员当前所属组织
            const orgMember = orgMembers.find((m) => m.userId === member.userId);
            const currentUnitId =
              orgMember && units.some((u) => u.id === orgMember.orgUnitId)
                ? orgMember.orgUnitId
                : '';
            const unitObj = units.find((u) => u.id === currentUnitId);

            return (
              <div
                key={member.userId}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-edge bg-surface p-3 shadow-2xs hover:border-subtle transition-colors"
              >
                {/* 成员基本信息 */}
                <div className="flex min-w-0 items-center gap-3">
                  <MemberAvatar user={user} name={displayName} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-bold text-main">{displayName}</span>
                      {isSelf && (
                        <span className="rounded bg-accent/15 px-1.5 py-0.2 text-[10px] font-semibold text-accent">
                          您
                        </span>
                      )}
                      {isOwner && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.2 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                          {tr(ROLE_LABEL_KEYS.owner)}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-quiet truncate flex items-center gap-2">
                      <span>{user?.username || member.userId}</span>
                      {user?.ip && (
                        <span className="font-mono text-[10px]">({user.ip})</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 部门分配与角色配置 */}
                <div className="flex flex-wrap items-center gap-2.5 self-end sm:self-auto shrink-0">
                  {/* 所属部门 */}
                  <div className="w-48">
                    {canManage ? (
                      <OrgUnitTreeSelect
                        portal
                        value={currentUnitId}
                        units={units}
                        onChange={(val) => void onOrgChange(member.userId, val)}
                        ariaLabel={`${displayName} 所属组织`}
                      />
                    ) : (
                      <span className="inline-block rounded-xl border border-edge bg-canvas/60 px-2.5 py-1 text-xs text-sub truncate w-full">
                        {unitObj ? `🏢 ${unitObj.name}` : tr('settings:workspaceSettings.unassignedOrg')}
                      </span>
                    )}
                  </div>

                  {/* 成员角色 */}
                  <div className="w-26">
                    {isOwner ? (
                      <ThemeSelect
                        portal
                        disabled
                        value="owner"
                        options={[{ value: 'owner', label: tr(ROLE_LABEL_KEYS.owner), tone: 'amber' }]}
                        onChange={() => {}}
                        ariaLabel={`${displayName} 角色`}
                      />
                    ) : canManage ? (
                      <ThemeSelect
                        portal
                        value={member.role}
                        options={roleOptions}
                        onChange={(val) => void onRoleChange(member.userId, val)}
                        ariaLabel={`${displayName} 角色`}
                      />
                    ) : (
                      <ThemeSelect
                        portal
                        disabled
                        value={member.role}
                        options={[{ value: member.role, label: tr(ROLE_LABEL_KEYS[member.role] || member.role), tone: 'slate' }]}
                        onChange={() => {}}
                        ariaLabel={`${displayName} 角色`}
                      />
                    )}
                  </div>

                  {/* 移除成员操作 */}
                  {canManage && (
                    <div className="w-7 flex items-center justify-center shrink-0">
                      {isOwner || isSelf ? (
                        <button
                          type="button"
                          disabled
                          className="rounded-lg p-1.5 text-quiet/25 cursor-not-allowed opacity-30 w-7 h-7 flex items-center justify-center transition-colors"
                          title={isOwner ? "工作区所有者不可移除" : "本机登录用户不可移除"}
                          aria-label="不可移除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onRemoveMember(member.userId, displayName)}
                          className="rounded-lg p-1.5 text-quiet hover:bg-danger/10 hover:text-danger w-7 h-7 flex items-center justify-center transition-colors"
                          title={tr('settings:workspaceSettings.removeMember')}
                          aria-label={`${tr('settings:workspaceSettings.removeMember')} ${displayName}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
