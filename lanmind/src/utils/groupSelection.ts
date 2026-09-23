/**
 * Group Selection Utility — Pure functions for batch selection and inversion of group members.
 *
 * CALLING SPEC:
 *   // Select all members of a group:
 *   const nextSelected = selectAllGroupMembers(currentSelected, groupMemberIds);
 *
 *   // Invert selection of a group's members (protecting specified IDs like creator):
 *   const nextSelected = invertGroupSelection(currentSelected, groupMemberIds, disabledUserIds);
 */

/**
 * Merges all members of a group into the selected ID list.
 *
 * TOOL CONTRACT:
 *   Input:  currentSelected (string[]), groupMemberIds (string[])
 *   Output: new string[] containing all previous selections plus all groupMemberIds (deduplicated)
 *   Deterministic, no side-effects.
 */
export function selectAllGroupMembers(
  currentSelected: string[],
  groupMemberIds: string[],
): string[] {
  const set = new Set(currentSelected);
  for (const id of groupMemberIds) {
    set.add(id);
  }
  return Array.from(set);
}

/**
 * Inverts the selection status of members within a specific group.
 * Members in group that were previously selected are unselected (unless in disabledUserIds).
 * Members in group that were previously unselected are selected.
 * User IDs not in groupMemberIds are left untouched.
 *
 * TOOL CONTRACT:
 *   Input:  currentSelected (string[]), groupMemberIds (string[]), disabledUserIds (string[], optional)
 *   Output: new string[] with inverted group selection
 *   Deterministic, no side-effects.
 */
export function invertGroupSelection(
  currentSelected: string[],
  groupMemberIds: string[],
  disabledUserIds: string[] = [],
): string[] {
  const currentSet = new Set(currentSelected);
  const disabledSet = new Set(disabledUserIds);

  for (const id of groupMemberIds) {
    if (disabledSet.has(id)) {
      // Protected users retain their selected status
      currentSet.add(id);
      continue;
    }
    if (currentSet.has(id)) {
      currentSet.delete(id);
    } else {
      currentSet.add(id);
    }
  }

  return Array.from(currentSet);
}

export interface GroupTreeNode {
  id: string;
  parentId?: string | null;
  memberUserIds: string[];
}

/**
 * Traverses a group tree branch and collects all member user IDs
 * from the root group and all its descendant child groups.
 *
 * TOOL CONTRACT:
 *   Input:  rootGroupId (string), groups (GroupTreeNode[])
 *   Output: new string[] of deduplicated user IDs in this branch
 *   Deterministic, no side-effects.
 */
export function collectBranchMemberUserIds(
  rootGroupId: string,
  groups: GroupTreeNode[],
): string[] {
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const childrenMap = new Map<string, GroupTreeNode[]>();

  for (const g of groups) {
    if (g.parentId && groupsById.has(g.parentId)) {
      const list = childrenMap.get(g.parentId) || [];
      list.push(g);
      childrenMap.set(g.parentId, list);
    }
  }

  const result = new Set<string>();
  const traverse = (id: string) => {
    const node = groupsById.get(id);
    if (node) {
      for (const uid of node.memberUserIds) {
        result.add(uid);
      }
    }
    const children = childrenMap.get(id) || [];
    for (const child of children) {
      traverse(child.id);
    }
  };

  traverse(rootGroupId);
  return Array.from(result);
}

