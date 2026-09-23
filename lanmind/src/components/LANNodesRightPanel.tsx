import React, { useState, useMemo } from 'react';
import { LocalDirectory, LocalOrgUnit, User } from '../types';
import { LocalDirectoryModal } from './LocalDirectoryModal';
import {
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
  ChevronRight,
  UserCheck,
  Shield,
  Edit3,
  HardDrive,
  Users,
  Activity,
  MessageSquare,
  Send,
  Network,
  FolderTree,
} from 'lucide-react';

interface LANNodesRightPanelProps {
  isExpanded: boolean;
  onToggleExpand: () => void;
  users: User[];
  currentUser: User;
  unreadMessagesByUser?: Record<string, number>;
  unreadMessageTotal?: number;
  onOpenProfileModal: () => void;
  onOpenLanChat?: (targetUser?: User) => void;
  localDirectory: LocalDirectory;
  onLocalDirectoryChange: (directory: LocalDirectory) => void;
}

export const LANNodesRightPanel: React.FC<LANNodesRightPanelProps> = ({
  isExpanded,
  onToggleExpand,
  users,
  currentUser,
  unreadMessagesByUser = {},
  unreadMessageTotal = 0,
  onOpenProfileModal,
  onOpenLanChat,
  localDirectory,
  onLocalDirectoryChange,
}) => {
  const [isDirectoryOpen, setIsDirectoryOpen] = useState(false);
  const [collapsedUnitIds, setCollapsedUnitIds] = useState<Set<string>>(new Set());
  const otherUsers = users.filter((u) => u.id !== currentUser.id);
  const onlineCount = users.filter((u) => u.isOnline).length;

  const toggleUnitCollapse = (unitId: string) => {
    setCollapsedUnitIds((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) {
        next.delete(unitId);
      } else {
        next.add(unitId);
      }
      return next;
    });
  };

  const unitsById = useMemo(
    () => new Map(localDirectory.units.map((u) => [u.id, u])),
    [localDirectory.units],
  );


  const childrenMap = useMemo(() => {
    if (localDirectory.units.length === 0) return new Map<string | null, LocalOrgUnit[]>();
    const map = new Map<string | null, LocalOrgUnit[]>();
    localDirectory.units.forEach((unit) => {
      const parentId = unit.parentId && unitsById.has(unit.parentId) ? unit.parentId : null;
      map.set(parentId, [...(map.get(parentId) || []), unit]);
    });
    map.forEach((list) => list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
    return map;
  }, [localDirectory.units, unitsById]);

  const rootUnits = useMemo(() => childrenMap.get(null) || [], [childrenMap]);

  const unitUsersMap = useMemo(() => {
    const map = new Map<string, User[]>();
    localDirectory.units.forEach((unit) => {
      const userIds = new Set(
        localDirectory.members.filter((m) => m.orgUnitId === unit.id).map((m) => m.userId),
      );
      const matched = otherUsers.filter((u) => userIds.has(u.id));
      map.set(unit.id, matched);
    });
    return map;
  }, [localDirectory.units, localDirectory.members, otherUsers]);

  const unitSubtreeUsersMap = useMemo(() => {
    const map = new Map<string, User[]>();
    const computeForUnit = (unitId: string): User[] => {
      if (map.has(unitId)) return map.get(unitId)!;
      const userMap = new Map<string, User>();
      const direct = unitUsersMap.get(unitId) || [];
      direct.forEach((u) => userMap.set(u.id, u));
      const children = childrenMap.get(unitId) || [];
      children.forEach((c) => {
        const childUsers = computeForUnit(c.id);
        childUsers.forEach((u) => userMap.set(u.id, u));
      });
      const result = Array.from(userMap.values());
      map.set(unitId, result);
      return result;
    };
    localDirectory.units.forEach((u) => computeForUnit(u.id));
    return map;
  }, [localDirectory.units, unitUsersMap, childrenMap]);

  const unassignedUsers = useMemo(() => {
    const assignedIds = new Set(localDirectory.members.map((m) => m.userId));
    return otherUsers.filter((u) => !assignedIds.has(u.id));
  }, [localDirectory.members, otherUsers]);

  const renderUserCard = (u: User) => {
    const isUserImg = u.avatar && (u.avatar.startsWith('data:image') || u.avatar.startsWith('http'));
    const unreadCount = unreadMessagesByUser[u.id] || 0;
    return (
      <div
        key={u.id}
        className="p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all bg-canvas/60 border-edge/80 hover:bg-hover/60 group"
      >
        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-card border border-subtle/80 flex items-center justify-center text-sm overflow-hidden">
              {isUserImg ? (
                <img src={u.avatar} alt={u.nickname} className="w-full h-full object-cover" />
              ) : (
                u.avatar || u.nickname.charAt(0)
              )}
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-edge ${
                u.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-muted'
              }`}
            />
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-on-solid ring-2 ring-edge">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="font-semibold text-main flex items-center gap-1">
              <span className="truncate">{u.nickname}</span>
            </div>
            <div className="text-[10px] font-mono text-sub truncate">{u.ip}</div>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0 ml-1">
          <button
            onClick={() => onOpenLanChat?.(u)}
            className="p-1.5 bg-card/80 hover:bg-blue-600 text-sub hover:text-on-solid rounded-lg transition-colors border border-subtle/80 hover:border-blue-500"
            title={`与 ${u.nickname} 发起 P2P 对话`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const renderUnitNode = (unit: LocalOrgUnit, depth: number): React.ReactNode => {
    const orgUsers = unitUsersMap.get(unit.id) || [];
    const subtreeUsers = unitSubtreeUsersMap.get(unit.id) || orgUsers;
    const childUnits = childrenMap.get(unit.id) || [];
    const hasChildren = childUnits.length > 0;
    const isCollapsed = collapsedUnitIds.has(unit.id);
    const subtreeOnlineCount = subtreeUsers.filter((u) => u.isOnline).length;
    const hasContent = orgUsers.length > 0 || hasChildren;

    return (
      <div key={unit.id} className="space-y-1">
        <button
          type="button"
          onClick={() => toggleUnitCollapse(unit.id)}
          className="flex w-full items-center justify-between px-2 py-1.5 rounded-lg text-xs font-semibold text-sub hover:text-main hover:bg-hover/80 transition-colors group select-none"
          title={`点击${isCollapsed ? '展开' : '收起'} ${unit.name}`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5 text-quiet group-hover:text-main shrink-0 transition-transform" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-quiet group-hover:text-main shrink-0 transition-transform" />
            )}
            <FolderTree className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="truncate">{unit.name}</span>
          </div>
          <span className="text-[10px] font-mono text-quiet bg-canvas px-1.5 py-0.5 rounded border border-edge shrink-0 ml-1">
            {subtreeOnlineCount}/{subtreeUsers.length}
          </span>
        </button>

        {!isCollapsed && (
          <div className="pl-2.5 ml-2 border-l border-edge/70 space-y-1.5">
            {orgUsers.length > 0 && (
              <div className="space-y-1">
                {orgUsers.map((u) => renderUserCard(u))}
              </div>
            )}

            {hasChildren && (
              <div className="space-y-1.5">
                {childUnits.map((child) => renderUnitNode(child, depth + 1))}
              </div>
            )}

            {!hasContent && (
              <div className="text-[10px] text-quiet py-1 px-2 italic">该组织暂无节点</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const isSelfImg = currentUser.avatar && (currentUser.avatar.startsWith('data:image') || currentUser.avatar.startsWith('http'));

  return (
    <>
      {!isExpanded ? (
        <aside className="z-20 flex w-14 flex-shrink-0 select-none flex-col items-center gap-3 border-l border-edge bg-surface py-3 shadow-soft transition-all duration-300">
          {/* Expand Toggle Button */}
          <button
            onClick={onToggleExpand}
            className="group relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main"
            title="展开局域网在线节点列表"
          >
            <PanelRightOpen className="h-4 w-4" />
            <span className="absolute right-12 top-1 bg-card text-main text-[10px] px-2 py-1 rounded whitespace-nowrap hidden group-hover:block border border-subtle shadow-panel">
              展开节点列表
            </span>
          </button>

          <div className="h-px w-8 flex-shrink-0 bg-card" />

          {/* LAN Chat Quick Launcher */}
          <button
            onClick={() => onOpenLanChat?.()}
            className="group relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sub transition-all hover:bg-hover hover:text-main"
            title="发起局域网即时沟通"
          >
            <MessageSquare className="w-4 h-4" />
            {unreadMessageTotal > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-on-solid ring-2 ring-edge">
                {unreadMessageTotal > 99 ? '99+' : unreadMessageTotal}
              </span>
            )}
            <span className="absolute right-12 top-1 bg-card text-main text-[10px] px-2 py-1 rounded whitespace-nowrap hidden group-hover:block border border-subtle shadow-panel">
              局域网即时聊天
            </span>
          </button>

          <button
            onClick={() => setIsDirectoryOpen(true)}
            className="group relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sub transition-all hover:bg-hover hover:text-main"
            title="管理本地组织目录"
          >
            <FolderTree className="h-4 w-4" />
            <span className="absolute right-12 top-1 hidden whitespace-nowrap rounded border border-subtle bg-card px-2 py-1 text-[10px] text-main shadow-panel group-hover:block">本地组织目录</span>
          </button>

          {/* Stacked User Avatars */}
          <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-1 pt-1">
            {otherUsers.map((u) => {
              const isImg = u.avatar && (u.avatar.startsWith('data:image') || u.avatar.startsWith('http'));
              const unreadCount = unreadMessagesByUser[u.id] || 0;
              return (
                <button
                  key={u.id}
                  onClick={() => onOpenLanChat?.(u)}
                  className="relative h-8 w-8 flex-shrink-0 transition-transform hover:scale-105"
                  title={`点击与 ${u.nickname} 开启 P2P 聊天 (${u.isOnline ? '在线' : '离线'})`}
                >
                  <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-subtle bg-card text-sm">
                    {isImg ? (
                      <img src={u.avatar} alt={u.nickname} className="h-full w-full object-cover" />
                    ) : (
                      <span>{u.avatar || u.nickname.charAt(0)}</span>
                    )}
                  </span>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-edge ${
                      u.isOnline ? 'bg-emerald-400' : 'bg-muted'
                    }`}
                  />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-on-solid ring-2 ring-edge">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>
      ) : (
        <aside className="w-64 bg-surface border-l border-edge text-sub flex flex-col h-full select-none shadow-soft transition-all duration-300 z-20">
          {/* Panel Header */}
          <div className="px-2.5 py-2.5 border-b border-edge flex items-center justify-between bg-surface/90 gap-1.5 select-none">
            <div className="flex items-center gap-1.5 min-w-0 shrink">
              <Network className="w-4 h-4 text-success shrink-0" />
              <h2 className="text-xs font-bold text-main shrink-0 whitespace-nowrap">
                局域网节点
              </h2>
              <span
                className="text-[10px] bg-emerald-500/10 text-success px-1.5 py-0.5 rounded font-mono border border-emerald-500/20 whitespace-nowrap shrink-0 flex items-center gap-1 leading-none"
                title={`${onlineCount} 台在线 / 共 ${users.length} 个节点`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>{onlineCount}/{users.length}</span>
              </span>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => onOpenLanChat?.()}
                className="relative p-1.5 hover:bg-hover text-sub hover:text-main rounded-lg transition-colors"
                title="打开局域网即时聊天频道"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                {unreadMessageTotal > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-on-solid ring-2 ring-edge">
                    {unreadMessageTotal > 99 ? '99+' : unreadMessageTotal}
                  </span>
                )}
              </button>
              <button
                onClick={() => setIsDirectoryOpen(true)}
                className="p-1.5 hover:bg-hover text-sub hover:text-main rounded-lg transition-colors"
                title="管理本地组织目录"
                aria-label="管理本地组织目录"
              >
                <FolderTree className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onToggleExpand}
                className="p-1.5 hover:bg-hover text-sub hover:text-main rounded-lg transition-colors"
                title="收起右侧节点列表"
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

      {/* Self Profile Card */}
      <div className="p-3 border-b border-edge bg-canvas/60 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-sub font-semibold">
          <span>本机节点</span>
        </div>

        <div
          onClick={onOpenProfileModal}
          className="flex items-center space-x-2.5 bg-surface/90 p-2.5 rounded-xl border border-edge/80 hover:border-blue-500/50 cursor-pointer transition-all group"
          title="点击修改个人头像与名称"
        >
          <div className="w-9 h-9 rounded-xl bg-card border border-subtle/80 flex items-center justify-center text-base flex-shrink-0 shadow-soft overflow-hidden group-hover:scale-105 transition-transform">
            {isSelfImg ? (
              <img src={currentUser.avatar} alt={currentUser.nickname} className="w-full h-full object-cover" />
            ) : (
              currentUser.avatar || '👤'
            )}
          </div>
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-bold text-main truncate flex items-center gap-1 group-hover:text-info transition-colors">
              <span className="truncate">{currentUser.nickname}</span>
              <span className="text-[9px] bg-blue-500/20 text-info px-1 rounded font-mono flex-shrink-0">
                本机
              </span>
            </div>
            <div className="text-[10px] text-sub font-mono truncate">{currentUser.ip}</div>
          </div>
        </div>
      </div>

      {/* All LAN Nodes List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div className="text-[11px] font-bold text-quiet uppercase tracking-wider mb-1 flex items-center justify-between">
          <span>局域网其他节点 ({otherUsers.length})</span>
        </div>

        <div className="space-y-1.5">
          {otherUsers.length === 0 ? (
            <div className="text-center py-8 text-quiet text-xs bg-canvas/40 rounded-xl border border-edge/60">
              <p>暂无其他局域网节点</p>
              <p className="text-[10px] text-quiet mt-1">开启 P2P 发现后将自动感应同局域网成员</p>
            </div>
          ) : localDirectory.units.length > 0 ? (
            <div className="space-y-2">
              {rootUnits.map((unit) => renderUnitNode(unit, 0))}

              {unassignedUsers.length > 0 && (
                <div key="unassigned" className="space-y-1 pt-1 border-t border-edge/60">
                  <button
                    type="button"
                    onClick={() => toggleUnitCollapse('unassigned')}
                    className="flex w-full items-center justify-between px-2 py-1.5 rounded-lg text-xs font-semibold text-sub hover:text-main hover:bg-hover/80 transition-colors group select-none"
                    title={`点击${collapsedUnitIds.has('unassigned') ? '展开' : '收起'} 未分组节点`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {collapsedUnitIds.has('unassigned') ? (
                        <ChevronRight className="w-3.5 h-3.5 text-quiet group-hover:text-main shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-quiet group-hover:text-main shrink-0" />
                      )}
                      <Users className="w-3.5 h-3.5 text-quiet shrink-0" />
                      <span className="truncate">未分组节点</span>
                    </div>
                    <span className="text-[10px] font-mono text-quiet bg-canvas px-1.5 py-0.5 rounded border border-edge shrink-0 ml-1">
                      {unassignedUsers.filter((u) => u.isOnline).length}/{unassignedUsers.length}
                    </span>
                  </button>

                  {!collapsedUnitIds.has('unassigned') && (
                    <div className="space-y-1 pl-2">
                      {unassignedUsers.map((u) => renderUserCard(u))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            otherUsers.map((u) => renderUserCard(u))
          )}
        </div>
      </div>
    </aside>
    )}
    <LocalDirectoryModal
      isOpen={isDirectoryOpen}
      onClose={() => setIsDirectoryOpen(false)}
      users={users}
      directory={localDirectory}
      onSaved={onLocalDirectoryChange}
    />
    </>
  );
};
