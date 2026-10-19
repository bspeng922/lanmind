/**
 * WorkspaceSettingsPanel — 工作区设置与管理面板。
 *
 * CALLING SPEC:
 *   <WorkspaceSettingsPanel
 *     workspace={workspace}
 *     users={allUsers}
 *     currentUser={currentUser}
 *     onWorkspaceUpdated={(next) => void}
 *     localDirectory={localDirectory}
 *     onLocalDirectoryChange={(dir) => void}
 *   />
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  Copy,
  Globe,
  HardDrive,
  Info,
  Loader2,
  Network,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import { ApiService } from '../../services/api';
import type {
  LocalDirectory,
  LocalOrgMember,
  LocalOrgUnit,
  User,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '../../types';
import { ThemeSelect, ThemeSelectOption } from '../ThemeSelect';
import { WorkspaceTimezoneSelect } from './WorkspaceTimezoneSelect';
import { WorkspaceOrgTree } from './org/WorkspaceOrgTree';
import { WorkspaceOrgMemberList } from './org/WorkspaceOrgMemberList';
import { OrgUnitTreeSelect } from './org/OrgUnitTreeSelect';

interface WorkspaceSettingsPanelProps {
  workspace: Workspace | null;
  users: User[];
  currentUser: User;
  onWorkspaceUpdated?: (next: Workspace) => void;
  localDirectory?: LocalDirectory;
  onLocalDirectoryChange?: (dir: LocalDirectory) => void;
}

const ROLE_LABEL_KEYS: Record<WorkspaceMember['role'], string> = {
  owner: 'settings:workspaceSettings.role.owner',
  admin: 'settings:workspaceSettings.role.admin',
  member: 'settings:workspaceSettings.role.member',
  guest: 'settings:workspaceSettings.role.guest',
};

export const WorkspaceSettingsPanel: React.FC<WorkspaceSettingsPanelProps> = ({
  workspace,
  users,
  currentUser,
  onWorkspaceUpdated,
  localDirectory = { units: [], members: [] },
  onLocalDirectoryChange,
}) => {
  useLocale();
  const [activeTab, setActiveTab] = useState<'general' | 'users'>('general');
  const [name, setName] = useState(workspace?.name ?? '');
  const [timezone, setTimezone] = useState(workspace?.timezone ?? '');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 组织树中当前选中的部门 (null: 根节点全部成员; '__unassigned__': 未分配; 其余为 unitId)
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  // 添加成员弹窗状态
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [selectedAddUserId, setSelectedAddUserId] = useState('');
  const [selectedAddRole, setSelectedAddRole] = useState<WorkspaceRole>('member');
  const [selectedAddUnitId, setSelectedAddUnitId] = useState('');
  const [isAddingMember, setIsAddingMember] = useState(false);

  // 新建部门弹窗状态
  const [createUnitModal, setCreateUnitModal] = useState<{
    isOpen: boolean;
    parentId: string | null;
    unitName: string;
  }>({
    isOpen: false,
    parentId: null,
    unitName: '',
  });

  // 加载工作区成员
  const loadMembers = useCallback(async () => {
    try {
      const list = await ApiService.getWorkspaceMembers(currentUser.id);
      setMembers(list);
    } catch (e) {
      console.warn('Failed to load workspace members:', e);
    }
  }, [currentUser.id]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers, workspace?.id]);

  useEffect(() => {
    setName(workspace?.name ?? '');
    setTimezone(workspace?.timezone ?? '');
  }, [workspace?.id, workspace?.name, workspace?.timezone]);

  /** 权限判断：所有者或管理员可配置 */
  const canManage = useMemo(() => {
    if (!workspace) return false;
    if (workspace.ownerId === currentUser.id) return true;
    return members.some(
      (m) => m.userId === currentUser.id && (m.role === 'owner' || m.role === 'admin')
    );
  }, [workspace, members, currentUser.id]);

  const isDirty =
    Boolean(workspace) &&
    (name.trim() !== workspace!.name || timezone.trim() !== (workspace!.timezone ?? ''));

  const showNotification = (msg: string, isError = false) => {
    if (isError) {
      setErrorMsg(msg);
      window.setTimeout(() => setErrorMsg(''), 4000);
    } else {
      setSuccessMsg(msg);
      window.setTimeout(() => setSuccessMsg(''), 3000);
    }
  };

  // 保存工作区基本设置
  const handleSave = useCallback(async () => {
    if (!workspace || !name.trim() || isSaving) return;
    setIsSaving(true);
    setErrorMsg('');
    try {
      const next = await ApiService.updateWorkspace(
        { name: name.trim(), timezone: timezone.trim() || workspace.timezone },
        currentUser.id
      );
      onWorkspaceUpdated?.(next);
      setSavedAt(true);
      window.setTimeout(() => setSavedAt(false), 2000);
    } catch (error) {
      showNotification(error instanceof Error ? error.message : String(error), true);
    } finally {
      setIsSaving(false);
    }
  }, [workspace, name, timezone, isSaving, currentUser.id, onWorkspaceUpdated]);

  const handleCopySlug = async () => {
    if (!workspace?.slug) return;
    try {
      await navigator.clipboard.writeText(workspace.slug);
      setCopiedSlug(true);
      window.setTimeout(() => setCopiedSlug(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  // 更改成员角色
  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await ApiService.updateWorkspaceMemberRole(userId, newRole, currentUser.id);
      setMembers((prev) =>
        prev.map((m) => (m.userId === userId ? { ...m, role: newRole as WorkspaceRole } : m))
      );
      showNotification(tr('settings:workspaceSettings.roleChangeSuccess'));
    } catch (e) {
      showNotification(e instanceof Error ? e.message : String(e), true);
    }
  };

  // 更改成员所属组织
  const handleMemberOrgChange = async (userId: string, newUnitId: string) => {
    const nextMembers = (localDirectory.members || []).filter((m) => m.userId !== userId);
    if (newUnitId) {
      nextMembers.push({ orgUnitId: newUnitId, userId });
    }
    const nextDir: LocalDirectory = { ...localDirectory, members: nextMembers };
    onLocalDirectoryChange?.(nextDir);
    try {
      await ApiService.saveLocalDirectory(nextDir);
      showNotification(tr('settings:workspaceSettings.orgAssignmentUpdated'));
    } catch (e) {
      showNotification(e instanceof Error ? e.message : String(e), true);
    }
  };

  // 移除成员
  const handleRemoveMember = async (userId: string, memberName: string) => {
    if (!window.confirm(`${tr('settings:workspaceSettings.removeMemberConfirm')} (${memberName})`)) {
      return;
    }
    try {
      await ApiService.removeWorkspaceMember(userId, currentUser.id);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      // 同时清理组织内该用户映射
      const nextMembers = (localDirectory.members || []).filter((m) => m.userId !== userId);
      const nextDir: LocalDirectory = { ...localDirectory, members: nextMembers };
      onLocalDirectoryChange?.(nextDir);
      void ApiService.saveLocalDirectory(nextDir);
      showNotification(`${tr('settings:workspaceSettings.removeMember')} ${memberName}`);
    } catch (e) {
      showNotification(e instanceof Error ? e.message : String(e), true);
    }
  };

  // 组织树：新建部门
  const handleCreateUnit = (parentId: string | null) => {
    const defaultName = parentId
      ? `子部门 ${(localDirectory.units || []).length + 1}`
      : `部门 ${(localDirectory.units || []).length + 1}`;
    setCreateUnitModal({
      isOpen: true,
      parentId,
      unitName: defaultName,
    });
  };

  const handleConfirmCreateUnit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const unitName = createUnitModal.unitName.trim();
    if (!unitName) return;

    const parentId = createUnitModal.parentId;
    const newUnit: LocalOrgUnit = {
      id: `local-org-${crypto.randomUUID()}`,
      name: unitName,
      parentId,
      sortOrder: (localDirectory.units || []).length,
    };

    const nextUnits = [...(localDirectory.units || []), newUnit];
    const nextDir: LocalDirectory = { ...localDirectory, units: nextUnits };
    onLocalDirectoryChange?.(nextDir);
    setSelectedUnitId(newUnit.id);
    setCreateUnitModal({ isOpen: false, parentId: null, unitName: '' });

    try {
      await ApiService.saveLocalDirectory(nextDir);
      showNotification(`已创建部门: ${newUnit.name}`);
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), true);
    }
  };

  // 组织树：重命名部门
  const handleRenameUnit = async (unitId: string, newName: string) => {
    const nextUnits = (localDirectory.units || []).map((u) =>
      u.id === unitId ? { ...u, name: newName } : u
    );
    const nextDir: LocalDirectory = { ...localDirectory, units: nextUnits };
    onLocalDirectoryChange?.(nextDir);
    try {
      await ApiService.saveLocalDirectory(nextDir);
      showNotification(`部门已更新为: ${newName}`);
    } catch (e) {
      showNotification(e instanceof Error ? e.message : String(e), true);
    }
  };

  // 组织树：删除部门
  const handleDeleteUnit = async (unitId: string) => {
    const targetUnit = (localDirectory.units || []).find((u) => u.id === unitId);
    if (!targetUnit) return;
    if (!window.confirm(tr('settings:workspaceSettings.deleteUnitConfirm'))) {
      return;
    }

    // 级联处理：将其子部门提升到上级
    const replacementParentId = targetUnit.parentId || null;
    const nextUnits = (localDirectory.units || [])
      .map((u) =>
        u.id === targetUnit.id
          ? null
          : u.parentId === targetUnit.id
          ? { ...u, parentId: replacementParentId }
          : u
      )
      .filter((u): u is LocalOrgUnit => u !== null);

    // 清理该部门下的人员映射（自动转为未分配）
    const nextMembers = (localDirectory.members || []).filter((m) => m.orgUnitId !== unitId);

    const nextDir: LocalDirectory = { units: nextUnits, members: nextMembers };
    onLocalDirectoryChange?.(nextDir);
    if (selectedUnitId === unitId) setSelectedUnitId(null);

    try {
      await ApiService.saveLocalDirectory(nextDir);
      showNotification(`已删除部门: ${targetUnit.name}`);
    } catch (e) {
      showNotification(e instanceof Error ? e.message : String(e), true);
    }
  };

  // 添加成员进入工作区
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAddUserId || isAddingMember) return;
    setIsAddingMember(true);
    try {
      await ApiService.addWorkspaceMember(selectedAddUserId, selectedAddRole, currentUser.id);

      // 若指定了所属部门
      if (selectedAddUnitId) {
        const nextMembers = (localDirectory.members || []).filter((m) => m.userId !== selectedAddUserId);
        nextMembers.push({ orgUnitId: selectedAddUnitId, userId: selectedAddUserId });
        const nextDir: LocalDirectory = { ...localDirectory, members: nextMembers };
        onLocalDirectoryChange?.(nextDir);
        await ApiService.saveLocalDirectory(nextDir);
      }

      setShowAddMemberModal(false);
      setSelectedAddUserId('');
      setSelectedAddUnitId('');
      setSelectedAddRole('member');
      void loadMembers();
      showNotification(tr('settings:workspaceSettings.addMember'));
    } catch (e) {
      showNotification(e instanceof Error ? e.message : String(e), true);
    } finally {
      setIsAddingMember(false);
    }
  };

  // 候选未加入工作区的用户
  const candidateUsers = useMemo(() => {
    return users.filter((u) => !members.some((m) => m.userId === u.id));
  }, [users, members]);

  const candidateUserOptions: ThemeSelectOption[] = useMemo(
    () =>
      candidateUsers.map((u) => ({
        value: u.id,
        label: `${u.nickname || u.username} (${u.deviceId || u.ip || '局域网节点'})`,
        tone: 'blue' as const,
      })),
    [candidateUsers]
  );

  const roleSelectOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: 'admin', label: tr(ROLE_LABEL_KEYS.admin) },
      { value: 'member', label: tr(ROLE_LABEL_KEYS.member) },
      { value: 'guest', label: tr(ROLE_LABEL_KEYS.guest) },
    ],
    []
  );


  if (!workspace) {
    return <p className="text-xs text-quiet">{tr('settings:workspaceSettings.title')}</p>;
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      {/* 消息通知 */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-success/10 border border-success/30 px-3.5 py-2 text-xs text-success animate-in fade-in">
          <Check className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-danger/10 border border-danger/30 px-3.5 py-2 text-xs text-danger animate-in fade-in">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Tabs 导航头 */}
      <div className="flex border-b border-edge gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
            activeTab === 'general'
              ? 'border-accent text-accent'
              : 'border-transparent text-sub hover:text-main'
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>{tr('settings:workspaceSettings.tabGeneral')}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
            activeTab === 'users'
              ? 'border-accent text-accent'
              : 'border-transparent text-sub hover:text-main'
          }`}
        >
          <Users className="h-4 w-4" />
          <span>{tr('settings:workspaceSettings.tabUsersOrg')}</span>
          <span className="rounded-full bg-canvas px-1.5 py-0.2 text-[10px] text-quiet font-mono border border-edge">
            {members.length}
          </span>
        </button>
      </div>

      {/* TAB 1: 常规设置 (网格双卡片布局，彻底优化留白) */}
      {activeTab === 'general' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 卡片 1: 工作区基本属性 */}
            <div className="flex flex-col justify-between rounded-2xl border border-edge bg-surface p-4 shadow-2xs space-y-4">
              <div>
                <div className="flex items-center gap-2 pb-2 border-b border-edge/60 mb-3">
                  <Globe className="h-4 w-4 text-accent" />
                  <h4 className="text-xs font-bold text-main">基本属性</h4>
                </div>

                <div className="space-y-3.5">
                  {/* 工作区名称 */}
                  <div>
                    <label htmlFor="workspace-name" className="mb-1 block text-xs font-semibold text-sub">
                      {tr('settings:workspaceSettings.name')}
                    </label>
                    <input
                      id="workspace-name"
                      type="text"
                      value={name}
                      disabled={!canManage}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="输入工作区名称"
                      className="h-9 w-full rounded-xl border border-edge bg-canvas px-3.5 py-1.5 text-xs text-main focus:border-accent focus:outline-none disabled:opacity-60 transition-colors"
                    />
                  </div>

                  {/* 唯一标识 Slug */}
                  <div>
                    <label htmlFor="workspace-slug" className="mb-1 block text-xs font-semibold text-sub">
                      {tr('settings:workspaceSettings.slug')}
                    </label>
                    <div className="relative flex items-center">
                      <input
                        id="workspace-slug"
                        type="text"
                        value={workspace.slug}
                        readOnly
                        className="h-9 w-full rounded-xl border border-edge bg-canvas/60 pl-3.5 pr-9 font-mono text-xs text-quiet focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCopySlug()}
                        className="absolute right-2.5 text-quiet hover:text-main"
                        title="复制标识"
                      >
                        {copiedSlug ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-quiet">{tr('settings:workspaceSettings.slugHint')}</p>
                  </div>
                </div>
              </div>

              {/* 保存操作区 */}
              {canManage && (
                <div className="flex items-center gap-3 pt-3 border-t border-edge/60">
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={!isDirty || isSaving}
                    className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50 shadow-soft"
                  >
                    {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {isSaving ? tr('settings:workspaceSettings.saving') : tr('settings:workspaceSettings.save')}
                  </button>
                  {savedAt && (
                    <span className="flex items-center gap-1 text-xs text-success animate-in fade-in">
                      <Check className="h-3.5 w-3.5" /> {tr('settings:workspaceSettings.updated')}
                    </span>
                  )}
                  {isDirty && !savedAt && (
                    <span className="text-[11px] text-warning">有尚未保存的更改</span>
                  )}
                </div>
              )}
            </div>

            {/* 卡片 2: 时区与运行环境配置 */}
            <div className="flex flex-col justify-between rounded-2xl border border-edge bg-surface p-4 shadow-2xs space-y-4">
              <div>
                <div className="flex items-center gap-2 pb-2 border-b border-edge/60 mb-3">
                  <Network className="h-4 w-4 text-feature" />
                  <h4 className="text-xs font-bold text-main">区域时区与网络环境</h4>
                </div>

                <div className="space-y-3.5">
                  {/* 时区下拉选择器 (带实时时间与搜索) */}
                  <div>
                    <label htmlFor="workspace-timezone-trigger" className="mb-1 block text-xs font-semibold text-sub">
                      {tr('settings:workspaceSettings.timezone')}
                    </label>
                    <WorkspaceTimezoneSelect
                      value={timezone}
                      disabled={!canManage}
                      onChange={(newTz) => setTimezone(newTz)}
                    />
                  </div>

                  {/* 局域网与本地持久化提示 */}
                  <div className="rounded-xl border border-edge/80 bg-canvas/40 p-3 space-y-2 text-[11px] text-sub">
                    <div className="flex items-center gap-2 font-semibold text-main">
                      <HardDrive className="h-3.5 w-3.5 text-accent" />
                      <span>Local-first 本地数据与同步</span>
                    </div>
                    <p className="leading-relaxed text-quiet">
                      {tr('settings:workspaceSettings.localFirstNote')}
                    </p>
                    <div className="flex items-center justify-between pt-1 border-t border-edge/60 text-[10px] text-quiet font-mono">
                      <span>本节点标识: {currentUser.deviceId || currentUser.ip || '本机'}</span>
                      <span className="text-success flex items-center gap-1">
                        <Check className="h-2.5 w-2.5" /> 正常通信
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 工作区资源概览卡片 */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-edge/60 text-center">
                <div className="rounded-xl bg-card p-2 border border-edge/50">
                  <div className="text-xs font-mono font-bold text-main">{members.length}</div>
                  <div className="text-[10px] text-quiet">工作区成员</div>
                </div>
                <div className="rounded-xl bg-card p-2 border border-edge/50">
                  <div className="text-xs font-mono font-bold text-main">
                    {(localDirectory.units || []).length}
                  </div>
                  <div className="text-[10px] text-quiet">组织部门</div>
                </div>
                <div className="rounded-xl bg-card p-2 border border-edge/50">
                  <div className="text-xs font-mono font-bold text-accent">
                    {members.filter((m) => m.role === 'admin' || m.role === 'owner').length}
                  </div>
                  <div className="text-[10px] text-quiet">管理员/所有者</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: 用户与组织架构 (一体化左树右人工作台) */}
      {activeTab === 'users' && (
        <div className="flex h-[490px] rounded-2xl border border-edge bg-surface overflow-hidden shadow-2xs animate-in fade-in duration-150">
          {/* 左侧组织架构树 (占 240px) */}
          <div className="w-60 md:w-64 shrink-0 border-r border-edge bg-canvas/30 p-3 flex flex-col">
            <WorkspaceOrgTree
              units={localDirectory.units || []}
              members={localDirectory.members || []}
              totalMembersCount={members.length}
              selectedUnitId={selectedUnitId}
              onSelectUnit={(unitId) => setSelectedUnitId(unitId)}
              canManage={canManage}
              onCreateUnit={(parentId) => void handleCreateUnit(parentId)}
              onRenameUnit={(unitId, newName) => void handleRenameUnit(unitId, newName)}
              onDeleteUnit={(unitId) => void handleDeleteUnit(unitId)}
            />
          </div>

          {/* 右侧部门成员管理列表 (占剩余空间) */}
          <div className="flex-1 min-w-0 p-3.5 flex flex-col bg-surface">
            <WorkspaceOrgMemberList
              members={members}
              users={users}
              currentUser={currentUser}
              selectedUnitId={selectedUnitId}
              units={localDirectory.units || []}
              orgMembers={localDirectory.members || []}
              canManage={canManage}
              onRoleChange={(userId, role) => void handleRoleChange(userId, role)}
              onOrgChange={(userId, unitId) => void handleMemberOrgChange(userId, unitId)}
              onRemoveMember={(userId, name) => void handleRemoveMember(userId, name)}
              onOpenAddMember={() => {
                // 如果当前正好选中了某个部门，默认预选该部门
                setSelectedAddUnitId(selectedUnitId && selectedUnitId !== '__unassigned__' ? selectedUnitId : '');
                setShowAddMemberModal(true);
              }}
            />
          </div>
        </div>
      )}

      {/* 添加成员浮层弹窗 */}
      {showAddMemberModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-overlay/50 p-4 backdrop-blur-2xs animate-in fade-in">
          <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-5 shadow-popover space-y-4">
            <div className="flex items-center justify-between border-b border-edge pb-2.5">
              <h4 className="text-sm font-bold text-main flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-accent" />
                <span>{tr('settings:workspaceSettings.addMember')}</span>
              </h4>
              <button
                type="button"
                onClick={() => setShowAddMemberModal(false)}
                className="text-quiet hover:text-main"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddMember} className="space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-sub">
                  {tr('settings:workspaceSettings.selectUserToAdd')}
                </label>
                {candidateUserOptions.length === 0 ? (
                  <p className="text-xs text-quiet py-2">局域网内暂无未加入工作区的节点用户</p>
                ) : (
                  <ThemeSelect
                    portal
                    value={selectedAddUserId}
                    options={candidateUserOptions}
                    onChange={(val) => setSelectedAddUserId(val)}
                    ariaLabel="选择用户"
                  />
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-sub">分配所属部门</label>
                <OrgUnitTreeSelect
                  portal
                  value={selectedAddUnitId}
                  units={localDirectory.units || []}
                  onChange={(val) => setSelectedAddUnitId(val)}
                  ariaLabel="所属部门"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-sub">
                  {tr('settings:workspaceSettings.initialRole')}
                </label>
                <ThemeSelect
                  portal
                  value={selectedAddRole}
                  options={roleSelectOptions}
                  onChange={(val) => setSelectedAddRole(val as WorkspaceRole)}
                  ariaLabel="初始角色"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-edge">
                <button
                  type="button"
                  onClick={() => setShowAddMemberModal(false)}
                  className="rounded-xl border border-edge px-3.5 py-1.5 text-xs text-sub hover:bg-hover"
                >
                  {tr('settings:workspaceSettings.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!selectedAddUserId || isAddingMember}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-1.5 text-xs font-semibold text-on-accent hover:opacity-90 disabled:opacity-50"
                >
                  {isAddingMember && <Loader2 className="h-3 w-3 animate-spin" />}
                  <span>{tr('settings:workspaceSettings.confirmAdd')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* 新建部门模态框 */}
      {createUnitModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-edge bg-surface p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-edge pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-feature/10 text-feature flex items-center justify-center border border-feature/20">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-main">
                    {createUnitModal.parentId ? '新建子部门' : '新建部门'}
                  </h3>
                  <p className="text-[11px] text-sub">
                    {createUnitModal.parentId
                      ? `将在「${(localDirectory.units || []).find((u) => u.id === createUnitModal.parentId)?.name || '上级部门'}」下创建子部门`
                      : '创建新的组织部门，可在部门内分配团队成员'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateUnitModal({ isOpen: false, parentId: null, unitName: '' })}
                className="text-quiet hover:text-main p-1 rounded-lg hover:bg-hover transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmCreateUnit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-sub">
                  部门名称
                </label>
                <input
                  type="text"
                  autoFocus
                  value={createUnitModal.unitName}
                  onChange={(e) =>
                    setCreateUnitModal((prev) => ({ ...prev, unitName: e.target.value }))
                  }
                  placeholder="例如: 研发部、产品设计组"
                  className="w-full rounded-xl border border-edge bg-canvas px-3 py-2 text-xs text-main placeholder:text-muted focus:border-accent focus:outline-hidden"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-edge">
                <button
                  type="button"
                  onClick={() => setCreateUnitModal({ isOpen: false, parentId: null, unitName: '' })}
                  className="rounded-xl border border-edge px-3.5 py-1.5 text-xs text-sub hover:bg-hover transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!createUnitModal.unitName.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-1.5 text-xs font-semibold text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  <span>创建部门</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
