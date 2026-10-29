import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { LanChatMessage, LanGroupAnnouncement, User } from '../../types';
import { getWorkspaceContext } from '../../utils/workspaceContext';
import { isUserMentioned } from '../../utils/chatMentions';
import { tr } from '../../i18n';
import { featureEnabled, useFeatures } from '../state';

type Notify = (title: string, body: string, kind: 'message' | 'reminder', feature?: 'chat') => Promise<boolean>;

/** Chat owns its event subscriptions; disabling it leaves task notification handlers alone. */
export function useChatNotifications(user: User, refreshUnread: () => Promise<void>, notify: Notify) {
  const enabled = useFeatures().chat;
  useEffect(() => {
    if (!isTauri() || !enabled) return;
    let disposed = false;
    const disposers: Array<() => void> = [];
    const subscribe = (dispose: () => void) => { if (disposed) dispose(); else disposers.push(dispose); };
    const currentScope = (payload: { workspaceId?: string; workspaceRevision?: number }) => {
      const scope = getWorkspaceContext();
      return !disposed && featureEnabled('chat') && scope && payload.workspaceId === scope.workspaceId && payload.workspaceRevision === scope.revision;
    };
    void listen<LanChatMessage & { workspaceRevision?: number }>('chat://message', event => {
      const message = event.payload;
      if (!currentScope(message) || message.senderId === user.id) return;
      void refreshUnread();
      const mentioned = isUserMentioned(message, user.id, user.nickname, user.username);
      const title = mentioned ? tr('common:app.userMentionedYou', { value0: message.senderName }) : tr('common:app.newMessageFrom', { value0: message.senderName });
      const body = message.type === 'vault_share' ? tr('vault:shareCard') : message.type === 'text' ? message.content : message.fileName || tr('common:app.fileReceived');
      void notify(title, body, mentioned ? 'reminder' : 'message', 'chat').catch(error => console.error('Failed to send chat notification', error));
    }).then(subscribe);
    void listen<LanGroupAnnouncement & { workspaceRevision?: number }>('chat://announcement_received', event => {
      const announcement = event.payload;
      if (!currentScope(announcement) || !announcement.groupId) return;
      void notify(
        tr('common:app.postedAGroupAnnouncement', { value0: announcement.authorName || tr('common:labels.groupAdministrator') }),
        `${announcement.title}\n${announcement.content}`, 'message', 'chat',
      ).catch(error => console.error('Failed to send group announcement notification', error));
    }).then(subscribe);
    return () => { disposed = true; disposers.forEach(dispose => dispose()); };
  }, [enabled, user.id, user.nickname, user.username, refreshUnread, notify]);
}
