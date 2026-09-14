import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isGroupCreatorOrAdmin,
  groupAdminIds,
  canUserCreateChatGroup,
  canManageGroupMembers,
  canManageGroupAnnouncements,
} from './groupPermissions';
import { LanChatGroup, Project } from '../types';

const mockGroup: LanChatGroup = {
  id: 'group-test-1',
  name: '测试群组',
  description: '权限测试群',
  avatar: '👥',
  memberIds: ['user-creator', 'user-admin', 'user-member'],
  adminIds: ['user-admin'],
  createdBy: 'user-creator',
  createdAt: '2026-09-14T10:00:00.000Z',
};

const mockProject: Project = {
  id: 'proj-1',
  name: '测试项目',
  description: '权限测试项目',
  color: '#2563eb',
  createdBy: 'proj-creator',
  admins: ['proj-admin'],
  members: ['proj-member'],
  createdAt: '2026-09-14T10:00:00.000Z',
  updatedAt: '2026-09-14T10:00:00.000Z',
};

test('isGroupCreatorOrAdmin correctly identifies creators and admins', () => {
  assert.equal(isGroupCreatorOrAdmin(mockGroup, 'user-creator'), true);
  assert.equal(isGroupCreatorOrAdmin(mockGroup, 'user-admin'), true);
  assert.equal(isGroupCreatorOrAdmin(mockGroup, 'user-member'), false);
  assert.equal(isGroupCreatorOrAdmin(mockGroup, 'stranger'), false);
});

test('groupAdminIds always includes creator and deduplicates', () => {
  const admins = groupAdminIds(mockGroup);
  assert.ok(admins.includes('user-creator'));
  assert.ok(admins.includes('user-admin'));

  const groupWithoutAdmins: LanChatGroup = {
    ...mockGroup,
    adminIds: undefined,
  };
  assert.deepEqual(groupAdminIds(groupWithoutAdmins), ['user-creator']);

  const groupWithCreatorInAdmins: LanChatGroup = {
    ...mockGroup,
    adminIds: ['user-creator', 'user-admin'],
  };
  const deduplicated = groupAdminIds(groupWithCreatorInAdmins);
  assert.equal(deduplicated.filter((id) => id === 'user-creator').length, 1);
});

test('canUserCreateChatGroup allows system admins, group creators/admins, and project creators/admins', () => {
  // System admin
  assert.equal(
    canUserCreateChatGroup({
      currentUserRole: 'admin',
      currentUserId: 'ordinary-user',
      groups: [],
      projects: [],
    }),
    true,
  );

  // Group creator
  assert.equal(
    canUserCreateChatGroup({
      currentUserRole: 'user',
      currentUserId: 'user-creator',
      groups: [mockGroup],
      projects: [],
    }),
    true,
  );

  // Group admin
  assert.equal(
    canUserCreateChatGroup({
      currentUserRole: 'user',
      currentUserId: 'user-admin',
      groups: [mockGroup],
      projects: [],
    }),
    true,
  );

  // Project creator
  assert.equal(
    canUserCreateChatGroup({
      currentUserRole: 'user',
      currentUserId: 'proj-creator',
      groups: [],
      projects: [mockProject],
    }),
    true,
  );

  // Project admin
  assert.equal(
    canUserCreateChatGroup({
      currentUserRole: 'user',
      currentUserId: 'proj-admin',
      groups: [],
      projects: [mockProject],
    }),
    true,
  );

  // Ordinary member (not creator, not admin in any group or project) -> CANNOT create group
  assert.equal(
    canUserCreateChatGroup({
      currentUserRole: 'user',
      currentUserId: 'user-member',
      groups: [mockGroup],
      projects: [mockProject],
    }),
    false,
  );

  // Stranger -> CANNOT create group
  assert.equal(
    canUserCreateChatGroup({
      currentUserRole: 'user',
      currentUserId: 'stranger',
      groups: [mockGroup],
      projects: [mockProject],
    }),
    false,
  );
});

test('canManageGroupMembers restricts editing to group creator and admin when not read-only', () => {
  assert.equal(
    canManageGroupMembers({
      group: mockGroup,
      userId: 'user-creator',
    }),
    true,
  );

  assert.equal(
    canManageGroupMembers({
      group: mockGroup,
      userId: 'user-admin',
    }),
    true,
  );

  assert.equal(
    canManageGroupMembers({
      group: mockGroup,
      userId: 'user-member',
    }),
    false,
  );

  // Read-only project group blocks even creator/admin
  assert.equal(
    canManageGroupMembers({
      group: mockGroup,
      userId: 'user-creator',
      isProjectReadOnly: true,
    }),
    false,
  );
});

test('groupPermissions gracefully handles undefined, null, and malformed inputs', () => {
  assert.equal(isGroupCreatorOrAdmin(null, 'user-1'), false);
  assert.equal(isGroupCreatorOrAdmin(undefined, 'user-1'), false);
  assert.deepEqual(groupAdminIds(null), []);
  assert.deepEqual(groupAdminIds(undefined), []);
  assert.equal(
    canUserCreateChatGroup({
      currentUserRole: 'user',
      currentUserId: 'user-1',
      groups: undefined,
      projects: undefined,
    }),
    false,
  );
  assert.equal(
    canManageGroupMembers({
      group: null,
      userId: 'user-1',
    }),
    false,
  );
  assert.equal(
    canManageGroupAnnouncements({
      group: null,
      userId: 'user-1',
    }),
    false,
  );
});

test('canManageGroupAnnouncements allows creators and admins, rejects regular members and read-only projects', () => {
  assert.equal(
    canManageGroupAnnouncements({
      group: mockGroup,
      userId: 'user-creator',
    }),
    true,
  );
  assert.equal(
    canManageGroupAnnouncements({
      group: mockGroup,
      userId: 'user-admin',
    }),
    true,
  );
  assert.equal(
    canManageGroupAnnouncements({
      group: mockGroup,
      userId: 'user-member',
    }),
    false,
  );
  assert.equal(
    canManageGroupAnnouncements({
      group: mockGroup,
      userId: 'stranger',
    }),
    false,
  );
  assert.equal(
    canManageGroupAnnouncements({
      group: mockGroup,
      userId: 'user-creator',
      isProjectReadOnly: true,
    }),
    false,
  );
  assert.equal(
    canManageGroupAnnouncements({
      group: null,
      userId: 'user-creator',
    }),
    false,
  );
});

