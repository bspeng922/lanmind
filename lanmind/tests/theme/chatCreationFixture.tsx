import React, { useState } from 'react';
import { mockIPC } from '@tauri-apps/api/mocks';
import { LanChatModal } from '../../src/components/LanChatModal';
import { ApiService } from '../../src/services/api';
import { scopedStorageKey, setWorkspaceContext } from '../../src/utils/workspaceContext';
import type { LanChatGroup, User, Workspace, WorkspaceMember } from '../../src/types';

if (new URLSearchParams(location.search).get('view') === 'chat-creation') {
  mockIPC(() => null, { shouldMockEvents: true });
  Object.defineProperty(window, 'isTauri', { value: true, configurable: true });
}

export function ChatCreationFixture() {
  const [groups] = useState<LanChatGroup[]>([]);
  ApiService.getChatGroups = async () => [...groups];
  ApiService.getChatMessagePage = async () => ({ messages: [], hasMore: false });
  ApiService.getGroupAnnouncements = async () => [];
  ApiService.markChatMessagesRead = async () => [];
  ApiService.saveChatGroup = async group => { groups.push(group); return group; };
  ApiService.sendChatMessage = async message => ({ ...message, id: 'created-group-message', timestamp: new Date().toISOString() });
  const params = new URLSearchParams(location.search);
  const role = params.get('role') || 'owner';
  const user: User = { id: 'chat-owner', username: 'owner', nickname: 'Owner', deviceId: 'fixture', role: 'user', ip: '', isOnline: true, lastActive: '' };
  const peer: User = { ...user, id: 'chat-peer', username: 'peer', nickname: 'Teammate' };
  const workspace: Workspace = { id: 'empty-workspace', name: 'Empty workspace', slug: 'empty-workspace', ownerId: role === 'owner' ? user.id : 'another-owner', timezone: 'Asia/Shanghai', createdAt: '', updatedAt: '' };
  const member: WorkspaceMember = {
    workspaceId: role === 'other-workspace' ? 'another-workspace' : workspace.id,
    userId: user.id,
    role: role === 'pending' || role === 'other-workspace' ? 'admin' : role as WorkspaceMember['role'],
    status: role === 'pending' ? 'pending' : 'member', requestedAt: '',
  };
  useState(() => {
    setWorkspaceContext({ workspaceId: workspace.id, userId: user.id, revision: 1 });
    localStorage.setItem(scopedStorageKey('lan_chat_groups_v2'), '[]');
    localStorage.setItem(scopedStorageKey('lan_chat_messages_v2'), '[]');
    return true;
  });
  return <div className="flex h-screen min-h-0 flex-col">
    <LanChatModal isOpen embedded={params.has('embedded')} currentUser={user} users={[user, peer]}
      workspace={workspace} workspaceMembers={[member]} projects={[]} />
  </div>;
}
