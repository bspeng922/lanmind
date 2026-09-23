/**
 * GroupedMemberSelector — Collapsible tree/group member selection component.
 *
 * CALLING SPEC:
 *   <GroupedMemberSelector
 *     groups={[{ id: string, name: string, parentId?: string | null, memberUserIds: string[], icon?: ReactNode }]}
 *     users={allUsers}
 *     selectedUserIds={selectedIds}
 *     disabledUserIds={[creatorId]} // Protected from unselection / invert removal
 *     onToggleUser={(userId) => handleToggle(userId)}
 *     onUpdateSelection={(newIds) => setMemberIds(newIds)}
 *     searchQuery={filterQuery}
 *     emptyText="暂无组织或群组"
 *     maxHeightClass="max-h-56"
 *     readOnly={false}
 *     currentUserId={currentUser.id}
 *     creatorId={projectOrGroupCreatorId}
 *     adminIds={adminIds}
 *   />
 */

import React, { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, CheckSquare, RefreshCw, FolderTree, Crown, Shield } from 'lucide-react';
import { User } from '../types';
import { ThemeCheckbox } from './ThemeCheckbox';
import { selectAllGroupMembers, invertGroupSelection, collectBranchMemberUserIds } from '../utils/groupSelection';

export interface SelectableGroup {
  id: string;
  name: string;
  subtitle?: string;
  icon?: React.ReactNode;
  memberUserIds: string[];
  tag?: string;
  parentId?: string | null;
}

export interface GroupedMemberSelectorProps {
  groups: SelectableGroup[];
  users: User[];
  selectedUserIds: string[];
  disabledUserIds?: string[];
  onToggleUser: (userId: string) => void;
  onUpdateSelection: (newSelectedIds: string[]) => void;
  searchQuery?: string;
  emptyText?: string;
  maxHeightClass?: string;
  readOnly?: boolean;
  currentUserId?: string;
  creatorId?: string;
  adminIds?: string[];
}

export const GroupedMemberSelector: React.FC<GroupedMemberSelectorProps> = ({
  groups,
  users,
  selectedUserIds,
  disabledUserIds = [],
  onToggleUser,
  onUpdateSelection,
  searchQuery = '',
  emptyText = '暂无匹配的组织或群组',
  maxHeightClass = 'max-h-56',
  readOnly = false,
  currentUserId,
  creatorId,
  adminIds = [],
}) => {
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());

  const toggleGroupExpand = useCallback((groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const selectedSet = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);
  const disabledSet = useMemo(() => new Set(disabledUserIds), [disabledUserIds]);

  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const childrenMap = useMemo(() => {
    const map = new Map<string | null, SelectableGroup[]>();
    groups.forEach((g) => {
      const pId = g.parentId && groupsById.has(g.parentId) ? g.parentId : null;
      map.set(pId, [...(map.get(pId) || []), g]);
    });
    return map;
  }, [groups, groupsById]);

  const rootGroups = useMemo(() => childrenMap.get(null) || [], [childrenMap]);

  const getBranchUserIds = useCallback(
    (groupId: string): string[] => collectBranchMemberUserIds(groupId, groups),
    [groups],
  );

  // Compute set of visible group IDs (matches query directly or has a descendant matching query)
  const visibleGroupIds = useMemo(() => {
    if (!normalizedQuery) {
      return new Set(groups.map((g) => g.id));
    }
    const visible = new Set<string>();
    groups.forEach((g) => {
      const isNameMatching = g.name.toLowerCase().includes(normalizedQuery);
      const groupUsers = g.memberUserIds
        .map((id) => userMap.get(id))
        .filter((u): u is User => !!u);
      const isMemberMatching = groupUsers.some((u) =>
        [u.nickname, u.username, u.id, u.ip, u.deviceId].some(
          (val) => val && val.toLowerCase().includes(normalizedQuery),
        ),
      );
      if (isNameMatching || isMemberMatching) {
        visible.add(g.id);
        // Include all ancestors so tree path remains intact
        let curParentId = g.parentId;
        const seen = new Set<string>();
        while (curParentId && groupsById.has(curParentId) && !seen.has(curParentId)) {
          seen.add(curParentId);
          visible.add(curParentId);
          curParentId = groupsById.get(curParentId)?.parentId;
        }
      }
    });
    return visible;
  }, [groups, groupsById, userMap, normalizedQuery]);

  const visibleRootGroups = useMemo(
    () => rootGroups.filter((g) => visibleGroupIds.has(g.id)),
    [rootGroups, visibleGroupIds],
  );

  const renderGroupNode = (group: SelectableGroup, depth: number): React.ReactNode => {
    const isExpanded = normalizedQuery ? true : !collapsedGroupIds.has(group.id);
    const childGroups = (childrenMap.get(group.id) || []).filter((cg) => visibleGroupIds.has(cg.id));
    const hasChildren = childGroups.length > 0;

    // Direct members of this group
    const directUsers = group.memberUserIds
      .map((id) => userMap.get(id))
      .filter((u): u is User => !!u);

    const matchingDirectUsers = normalizedQuery
      ? (group.name.toLowerCase().includes(normalizedQuery)
          ? directUsers
          : directUsers.filter((u) =>
              [u.nickname, u.username, u.id, u.ip, u.deviceId].some(
                (val) => val && val.toLowerCase().includes(normalizedQuery),
              ),
            ))
      : directUsers;

    // Branch users for select all / invert and count badge
    const branchUserIds = getBranchUserIds(group.id);
    const availableBranchUserIds = branchUserIds.filter((id) => userMap.has(id));
    const selectedCount = availableBranchUserIds.filter((id) => selectedSet.has(id)).length;
    const totalCount = availableBranchUserIds.length;
    const allSelected = totalCount > 0 && selectedCount === totalCount;
    const partiallySelected = selectedCount > 0 && !allSelected;

    const handleSelectAll = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly || totalCount === 0) return;
      const next = selectAllGroupMembers(selectedUserIds, availableBranchUserIds);
      onUpdateSelection(next);
    };

    const handleInvert = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly || totalCount === 0) return;
      const next = invertGroupSelection(selectedUserIds, availableBranchUserIds, disabledUserIds);
      onUpdateSelection(next);
    };

    return (
      <div
        key={group.id}
        className={`rounded-lg border transition-colors overflow-hidden ${
          depth === 0 ? 'border-edge bg-surface/70' : 'border-edge/70 bg-surface/50'
        }`}
      >
        {/* Group Header */}
        <div
          onClick={() => toggleGroupExpand(group.id)}
          className="flex items-center justify-between p-2 cursor-pointer select-none bg-canvas/40 hover:bg-hover/60 transition-colors text-xs"
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
            <span className="text-sub shrink-0">
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-accent transition-transform" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-quiet transition-transform" />
              )}
            </span>
            <span className="shrink-0">{group.icon || <FolderTree className="w-3.5 h-3.5 text-accent" />}</span>
            <span className="font-semibold text-main truncate">{group.name}</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full border shrink-0 ${
                allSelected
                  ? 'bg-blue-500/15 text-feature border-blue-500/30'
                  : partiallySelected
                    ? 'bg-amber-500/15 text-warning border-amber-500/30'
                    : 'bg-card text-quiet border-edge'
              }`}
            >
              {selectedCount}/{totalCount}人
            </span>
          </div>

          {/* Group Action Buttons: 全选 & 反选 */}
          {!readOnly && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleSelectAll}
                disabled={totalCount === 0}
                className="px-2 py-0.5 text-[10px] font-medium rounded border border-edge bg-card text-sub hover:border-accent hover:text-accent disabled:opacity-40 transition-colors flex items-center gap-1"
                title="全选该组织及其子组织所有人员"
              >
                <CheckSquare className="w-2.5 h-2.5" />
                <span>全选</span>
              </button>
              <button
                type="button"
                onClick={handleInvert}
                disabled={totalCount === 0}
                className="px-2 py-0.5 text-[10px] font-medium rounded border border-edge bg-card text-sub hover:border-accent hover:text-accent disabled:opacity-40 transition-colors flex items-center gap-1"
                title="反选该组织及其子组织人员"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                <span>反选</span>
              </button>
            </div>
          )}
        </div>

        {/* Expanded Content: Direct Members + Child Groups */}
        {isExpanded && (
          <div className="border-t border-edge/60 bg-canvas/30 p-1.5 space-y-1.5">
            {/* Direct Members */}
            {matchingDirectUsers.length > 0 && (
              <div className="space-y-1">
                {matchingDirectUsers.map((u) => {
                  const isChecked = selectedSet.has(u.id);
                  const isDisabled = disabledSet.has(u.id);
                  const isCreator = creatorId === u.id;
                  const isAdmin = !isCreator && adminIds.includes(u.id);
                  const isSelf = currentUserId === u.id;

                  const handleRowClick = () => {
                    if (readOnly || isDisabled) return;
                    onToggleUser(u.id);
                  };

                  return (
                    <div
                      key={u.id}
                      onClick={handleRowClick}
                      className={`flex items-center justify-between p-1.5 rounded-md text-xs transition-colors ${
                        readOnly || isDisabled ? 'cursor-default opacity-85' : 'cursor-pointer hover:bg-hover'
                      } ${isChecked ? 'bg-accent/5' : 'bg-canvas/40'}`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <ThemeCheckbox
                          checked={isChecked}
                          onChange={() => {
                            if (!readOnly && !isDisabled) onToggleUser(u.id);
                          }}
                          disabled={readOnly || isDisabled}
                          size="sm"
                          ariaLabel={`选择成员：${u.nickname}`}
                        />
                        <div className="min-w-0 flex-1 flex items-center gap-1.5">
                          <span className="font-medium text-main truncate">{u.nickname || u.username}</span>
                          {isSelf && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-blue-500/15 text-feature shrink-0 font-medium">
                              我
                            </span>
                          )}
                          {isCreator && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/15 text-warning shrink-0 flex items-center gap-0.5 font-medium">
                              <Crown className="w-2.5 h-2.5" />
                              创建者
                            </span>
                          )}
                          {isAdmin && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-500/15 text-indigo-400 shrink-0 flex items-center gap-0.5 font-medium">
                              <Shield className="w-2.5 h-2.5" />
                              管理员
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-[10px] text-quiet font-mono ml-2 shrink-0">
                        {u.ip || u.id}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Child Groups: indented with tree guideline */}
            {hasChildren && (
              <div className="pl-2.5 ml-1.5 border-l-2 border-accent/20 space-y-1.5 pt-0.5">
                {childGroups.map((child) => renderGroupNode(child, depth + 1))}
              </div>
            )}

            {/* Empty state when neither direct members nor sub-groups match */}
            {matchingDirectUsers.length === 0 && !hasChildren && (
              <div className="py-2 text-center text-[10px] text-quiet">
                {totalCount === 0 ? '该组织暂无关联的局域网人员' : '无匹配成员'}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (visibleRootGroups.length === 0) {
    return (
      <div className={`rounded-xl border border-edge bg-canvas/60 p-6 text-center text-xs text-quiet ${maxHeightClass}`}>
        {emptyText}
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 overflow-y-auto pr-1 ${maxHeightClass}`}>
      {visibleRootGroups.map((group) => renderGroupNode(group, 0))}
    </div>
  );
};
