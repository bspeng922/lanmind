/**
 * groupPermissions.ts — Pure functions for group chat and member permission verification.
 *
 * CALLING SPEC:
 *   isGroupCreatorOrAdmin(group, userId) -> boolean
 *   groupAdminIds(group) -> string[]
 *   canUserCreateChatGroup({ currentUserRole, currentUserId, groups, projects }) -> boolean
 *   canManageGroupMembers({ group, userId, isProjectReadOnly }) -> boolean
 *   canManageGroupAnnouncements({ group, userId, isProjectReadOnly }) -> boolean
 */

import { LanChatGroup, Project, Role } from '../types';

/**
 * Checks if a user is the creator or an admin of the specified chat group.
 */
export const isGroupCreatorOrAdmin = (group: LanChatGroup | null | undefined, userId: string): boolean => {
  if (!group || !userId) return false;
  if (group.createdBy === userId) return true;
  if (Array.isArray(group.adminIds) && group.adminIds.includes(userId)) return true;
  return false;
};

/**
 * Returns all admin IDs for a group, guaranteeing that the creator is included.
 */
export const groupAdminIds = (group: LanChatGroup | null | undefined): string[] => {
  if (!group) return [];
  const admins = new Set(Array.isArray(group.adminIds) ? group.adminIds : []);
  if (group.createdBy) {
    admins.add(group.createdBy);
  }
  return Array.from(admins);
};

/**
 * Checks if a user is eligible to create group chats:
 * - System admin (role === 'admin'), OR
 * - Creator or admin of an existing group, OR
 * - Creator or admin of an existing project
 */
export const canUserCreateChatGroup = ({
  currentUserRole,
  currentUserId,
  groups = [],
  projects = [],
}: {
  currentUserRole?: Role;
  currentUserId: string;
  groups?: LanChatGroup[];
  projects?: Project[];
}): boolean => {
  if (currentUserRole === 'admin') return true;
  if (Array.isArray(groups) && groups.some((g) => isGroupCreatorOrAdmin(g, currentUserId))) return true;
  if (
    Array.isArray(projects) &&
    projects.some(
      (p) =>
        p &&
        (p.createdBy === currentUserId ||
          (Array.isArray(p.admins) && p.admins.includes(currentUserId))),
    )
  ) {
    return true;
  }
  return false;
};

/**
 * Checks if a user can manage members of a group:
 * Must be creator or admin of the group, and not in read-only state.
 */
export const canManageGroupMembers = ({
  group,
  userId,
  isProjectReadOnly = false,
}: {
  group: LanChatGroup | null | undefined;
  userId: string;
  isProjectReadOnly?: boolean;
}): boolean => {
  if (isProjectReadOnly || !group) return false;
  return isGroupCreatorOrAdmin(group, userId);
};

/**
 * Checks if a user can publish, pin/unpin, and delete announcements in a group:
 * Must be creator or admin of the group, and not in read-only state.
 */
export const canManageGroupAnnouncements = ({
  group,
  userId,
  isProjectReadOnly = false,
}: {
  group: LanChatGroup | null | undefined;
  userId: string;
  isProjectReadOnly?: boolean;
}): boolean => {
  if (isProjectReadOnly || !group) return false;
  return isGroupCreatorOrAdmin(group, userId);
};

