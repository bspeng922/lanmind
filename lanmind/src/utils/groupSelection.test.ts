import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAllGroupMembers, invertGroupSelection, collectBranchMemberUserIds } from './groupSelection';

test('selectAllGroupMembers adds all group members to empty selection', () => {
  const current: string[] = [];
  const group = ['u1', 'u2', 'u3'];
  const result = selectAllGroupMembers(current, group);
  assert.deepEqual(result.sort(), ['u1', 'u2', 'u3']);
});

test('selectAllGroupMembers deduplicates existing selections', () => {
  const current = ['u1', 'u99'];
  const group = ['u1', 'u2'];
  const result = selectAllGroupMembers(current, group);
  assert.deepEqual(result.sort(), ['u1', 'u2', 'u99']);
});

test('selectAllGroupMembers handles empty group gracefully', () => {
  const current = ['u1'];
  const group: string[] = [];
  const result = selectAllGroupMembers(current, group);
  assert.deepEqual(result, ['u1']);
});

test('invertGroupSelection inverts all unselected to selected', () => {
  const current = ['u99']; // Outside group
  const group = ['u1', 'u2'];
  const result = invertGroupSelection(current, group);
  assert.deepEqual(result.sort(), ['u1', 'u2', 'u99']);
});

test('invertGroupSelection inverts all selected to unselected', () => {
  const current = ['u1', 'u2', 'u99'];
  const group = ['u1', 'u2'];
  const result = invertGroupSelection(current, group);
  assert.deepEqual(result, ['u99']);
});

test('invertGroupSelection inverts partial selections correctly', () => {
  const current = ['u1', 'u99'];
  const group = ['u1', 'u2', 'u3'];
  // u1 was selected -> becomes unselected
  // u2, u3 were not selected -> become selected
  // u99 is outside group -> remains selected
  const result = invertGroupSelection(current, group);
  assert.deepEqual(result.sort(), ['u2', 'u3', 'u99']);
});

test('invertGroupSelection protects disabled user IDs from unselection', () => {
  const current = ['creator-1', 'u1'];
  const group = ['creator-1', 'u1', 'u2'];
  const disabled = ['creator-1'];
  // creator-1 is protected -> stays selected
  // u1 was selected -> becomes unselected
  // u2 was unselected -> becomes selected
  const result = invertGroupSelection(current, group, disabled);
  assert.deepEqual(result.sort(), ['creator-1', 'u2']);
});

test('invertGroupSelection ensures protected user is selected even if not previously selected', () => {
  const current = ['u1'];
  const group = ['creator-1', 'u1'];
  const disabled = ['creator-1'];
  // creator-1 was not selected, but is in group & disabled -> must be preserved as selected
  // u1 was selected -> becomes unselected
  const result = invertGroupSelection(current, group, disabled);
  assert.deepEqual(result.sort(), ['creator-1']);
});

test('collectBranchMemberUserIds gathers direct members and all nested descendants', () => {
  const tree = [
    { id: 'dept-rd', parentId: null, memberUserIds: ['u-rd-leader'] },
    { id: 'group-cloud', parentId: 'dept-rd', memberUserIds: ['u-cloud-1', 'u-cloud-2'] },
    { id: 'team-k8s', parentId: 'group-cloud', memberUserIds: ['u-k8s-1'] },
    { id: 'dept-qa', parentId: null, memberUserIds: ['u-qa-1'] },
  ];

  // RD department collects direct + cloud + k8s
  const rdMembers = collectBranchMemberUserIds('dept-rd', tree);
  assert.deepEqual(rdMembers.sort(), ['u-cloud-1', 'u-cloud-2', 'u-k8s-1', 'u-rd-leader']);

  // Cloud group collects cloud + k8s
  const cloudMembers = collectBranchMemberUserIds('group-cloud', tree);
  assert.deepEqual(cloudMembers.sort(), ['u-cloud-1', 'u-cloud-2', 'u-k8s-1']);

  // Leaf node collects only its own
  const k8sMembers = collectBranchMemberUserIds('team-k8s', tree);
  assert.deepEqual(k8sMembers, ['u-k8s-1']);

  // QA collects only QA
  const qaMembers = collectBranchMemberUserIds('dept-qa', tree);
  assert.deepEqual(qaMembers, ['u-qa-1']);
});

test('collectBranchMemberUserIds handles non-existent or empty nodes gracefully', () => {
  const tree = [
    { id: 'dept-empty', parentId: null, memberUserIds: [] },
  ];
  assert.deepEqual(collectBranchMemberUserIds('dept-empty', tree), []);
  assert.deepEqual(collectBranchMemberUserIds('dept-none', tree), []);
});

