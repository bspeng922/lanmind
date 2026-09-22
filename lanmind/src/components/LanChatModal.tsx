import React, { useState, useRef, useEffect, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  User,
  LanChatMessage,
  LanChatGroup,
  LanGroupAnnouncement,
  Project,
  ChatUnreadSummary,
  ChatConversationRef,
  LocalDirectory,
} from '../types';
import { ApiService } from '../services/api';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { EmojiPicker } from './EmojiPicker';
import { ThemeCheckbox } from './ThemeCheckbox';
import { ChatFilesModal } from './ChatFilesModal';
import { EditGroupModal } from './EditGroupModal';
import { ReadReceiptsModal } from './ReadReceiptsModal';
import { ForwardMessageModal } from './ForwardMessageModal';
import { GroupAnnouncementModal } from './GroupAnnouncementModal';
import { GroupAnnouncementBanner } from './GroupAnnouncementBanner';
import { formatMessageDisplayTime, parseMessageEpoch } from '../utils/chatTime';
import {
  isGroupCreatorOrAdmin,
  groupAdminIds,
  canUserCreateChatGroup,
  canManageGroupMembers,
  canManageGroupAnnouncements,
} from '../utils/groupPermissions';
import {
  X,
  Send,
  Image as ImageIcon,
  Paperclip,
  Smile,
  Wifi,
  FileText,
  Download,
  Users,
  MessageSquare,
  Bot,
  Plus,
  Trash2,
  FolderKanban,
  HardDrive,
  CheckSquare,
  Square,
  UserCheck,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Crown,
  Shield,
  Loader2,
  ZoomIn,
  LockKeyhole,
  Settings,
  Copy,
  Reply,
  Forward,
  CalendarPlus,
  Check,
  CheckCheck,
  Megaphone,
  Search,
  ArrowDown,
} from 'lucide-react';

interface LanChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  users: User[];
  projects?: Project[];
  targetUser?: User | null;
  initialConversation?: ChatConversationRef;
  unreadSummaries?: ChatUnreadSummary[];
  onConversationRead?: (conversationKey?: string, messageIds?: string[]) => void;
  onCreateTaskFromMessage?: (content: string) => void;
  localDirectory?: LocalDirectory;
}

type ActiveTargetType =
  | { type: 'broadcast' }
  | { type: 'user'; user: User }
  | { type: 'group'; group: LanChatGroup };

const STORAGE_KEY_MESSAGES = 'lan_chat_messages_v2';
const STORAGE_KEY_GROUPS = 'lan_chat_groups_v2';

const COMMON_EMOJIS = [
  '😊', '👍', '🎉', '🚀', '💡', '🔥', '📝', '📁',
  '🤖', '💻', '⚡', '🙏', '📦', '🎯', '✅', '❤️',
  '👏', '⭐', '📊', '🤝', '⚙️', '🔍', '📌', '💬',
];

const GROUP_ICONS = ['👥', '🚀', '⚡', '💡', '📁', '⚙️', '📦', '🎯', '🔥', '📊'];

const conversationKeyForTarget = (target: ActiveTargetType) =>
  target.type === 'broadcast'
    ? 'broadcast'
    : target.type === 'user'
      ? `user:${target.user.id}`
      : `group:${target.group.id}`;

const appendUniqueMessage = (messages: LanChatMessage[], message: LanChatMessage) =>
  messages.some((item) => item.id === message.id) ? messages : [...messages, message];

const deduplicateMessages = (messages: LanChatMessage[]) =>
  Array.from(new Map(messages.map((message) => [message.id, message])).values());

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export {
  formatMessageDisplayTime,
  parseMessageEpoch,
  isGroupCreatorOrAdmin,
  groupAdminIds,
  canUserCreateChatGroup,
  canManageGroupMembers,
};

export const LanChatModal: React.FC<LanChatModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  users,
  projects = [],
  targetUser: initialTargetUser,
  initialConversation,
  unreadSummaries = [],
  onConversationRead,
  onCreateTaskFromMessage,
  localDirectory = { units: [], members: [] },
}) => {
  const [activeTarget, setActiveTarget] = useState<ActiveTargetType>(
    initialTargetUser ? { type: 'user', user: initialTargetUser } : { type: 'broadcast' }
  );
  const activeTargetRef = useRef(activeTarget);
  const appliedInitialConversationRef = useRef<string | null>(null);

  useEffect(() => {
    activeTargetRef.current = activeTarget;
  }, [activeTarget]);

  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGroupMembersModal, setShowGroupMembersModal] = useState(false);
  const [managedMemberIds, setManagedMemberIds] = useState<string[]>([]);
  const [isSavingMembers, setIsSavingMembers] = useState(false);
  const [isClearingChat, setIsClearingChat] = useState(false);
  const [memberManagementError, setMemberManagementError] = useState<string | null>(null);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberScope, setMemberScope] = useState<'all' | 'included' | 'excluded'>('all');
  const [memberPresence, setMemberPresence] = useState<'all' | 'online' | 'offline'>('all');
  const [memberSource, setMemberSource] = useState<'people' | 'org'>('people');
  const [sendError, setSendError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [serverSearchResults, setServerSearchResults] = useState<LanChatMessage[]>([]);
  const [serverSearchTotal, setServerSearchTotal] = useState(0);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [showChatFilesModal, setShowChatFilesModal] = useState(false);
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);

  // Read receipts and message interaction states
  const [selectedReceiptMessage, setSelectedReceiptMessage] = useState<LanChatMessage | null>(null);
  const [selectedReceiptAnnouncement, setSelectedReceiptAnnouncement] = useState<LanGroupAnnouncement | null>(null);
  const [showReadReceiptsModal, setShowReadReceiptsModal] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState<LanChatMessage | null>(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [quotedMessage, setQuotedMessage] = useState<LanChatMessage | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: LanChatMessage } | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  // Group announcements state
  const [announcements, setAnnouncements] = useState<LanGroupAnnouncement[]>([]);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [dismissedBannerGroupIds, setDismissedBannerGroupIds] = useState<Set<string>>(new Set());

  // Section collapse states
  const [isBroadcastCollapsed, setIsBroadcastCollapsed] = useState(false);
  const [isGroupsCollapsed, setIsGroupsCollapsed] = useState(false);
  const [isNodesCollapsed, setIsNodesCollapsed] = useState(false);

  // Create Group Modal state
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupAvatar, setNewGroupAvatar] = useState('👥');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [createMemberSearchQuery, setCreateMemberSearchQuery] = useState('');
  const [createMemberSource, setCreateMemberSource] = useState<'people' | 'org'>('people');
  const [createGroupError, setCreateGroupError] = useState<string | null>(null);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const accessibleProjects = (projects || []).filter(
    (project) =>
      project &&
      (project.createdBy === currentUser.id ||
        (Array.isArray(project.admins) && project.admins.includes(currentUser.id)) ||
        (Array.isArray(project.members) && project.members.includes(currentUser.id))),
  );
  const creatableProjects = accessibleProjects.filter(
    (project) =>
      currentUser.role === 'admin' ||
      project.createdBy === currentUser.id ||
      (Array.isArray(project.admins) && project.admins.includes(currentUser.id)),
  );
  const selectedProject = accessibleProjects.find((project) => project.id === selectedProjectId);
  const selectedProjectMemberIds = selectedProject
    ? new Set([
        selectedProject.createdBy,
        ...(Array.isArray(selectedProject.admins) ? selectedProject.admins : []),
        ...(Array.isArray(selectedProject.members) ? selectedProject.members : []),
      ])
    : null;
  const selectableGroupUsers = selectedProjectMemberIds
    ? (users || []).filter((user) => selectedProjectMemberIds.has(user.id))
    : (users || []);
  const localOrgUnitMemberIds = (orgUnitId: string) => {
    const unitIds = new Set([orgUnitId]);
    let changed = true;
    while (changed) {
      changed = false;
      localDirectory.units.forEach((unit) => {
        if (unit.parentId && unitIds.has(unit.parentId) && !unitIds.has(unit.id)) {
          unitIds.add(unit.id);
          changed = true;
        }
      });
    }
    return new Set(
      localDirectory.members
        .filter((member) => unitIds.has(member.orgUnitId))
        .map((member) => member.userId),
    );
  };
  const normalizedCreateMemberSearchQuery = createMemberSearchQuery.trim().toLocaleLowerCase();
  const visibleSelectableGroupUsers = selectableGroupUsers.filter((user) => {
    if (!normalizedCreateMemberSearchQuery) return true;
    return [user.nickname, user.username, user.deviceId, user.ip]
      .filter(Boolean)
      .some((value) => value.toLocaleLowerCase().includes(normalizedCreateMemberSearchQuery));
  });
  const projectSelectOptions: ThemeSelectOption[] = [
    { value: '', label: '不关联特定项目（通用组）', tone: 'slate' },
    ...creatableProjects.map((project) => ({
      value: project.id,
      label: project.name,
      tone: 'blue' as const,
    })),
  ];

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  // Default initial groups
  const getDefaultGroups = (): LanChatGroup[] => {
    const baseGroups: LanChatGroup[] = [
      {
        id: 'group-1',
        name: 'AI 与架构联合攻坚组',
        description: '负责局域网模型微调与嵌入式推理交付协同',
        avatar: '🚀',
        memberIds: users.map((u) => u.id),
        adminIds: ['user-01'],
        createdBy: 'user-01',
        createdAt: '10:00',
      },
      {
        id: 'group-2',
        name: '项目 PM & 交付协同群',
        description: '协同对齐节点进度与需求看板',
        avatar: '📊',
        memberIds: [currentUser.id, users[1]?.id || 'user-02', users[2]?.id || 'user-03'],
        adminIds: [users[2]?.id || 'user-03'],
        createdBy: users[2]?.id || 'user-03',
        createdAt: '09:30',
      },
    ];

    // Automatically generate project channels if projects exist
    const projectGroups: LanChatGroup[] = accessibleProjects.map((p) => ({
      id: `group-proj-${p.id}`,
      name: `项目组: ${p.name}`,
      description: p.description || `针对《${p.name}》的研讨与文件分享`,
      avatar: '📁',
      memberIds: Array.from(
        new Set([
          p.createdBy,
          ...(Array.isArray(p.admins) ? p.admins : []),
          ...(Array.isArray(p.members) ? p.members : []),
        ]),
      ),
      adminIds:
        Array.isArray(p.admins) && p.admins.length > 0
          ? p.admins
          : [p.createdBy || currentUser.id],
      createdBy: p.createdBy || currentUser.id,
      createdAt: '09:00',
      projectId: p.id,
    }));

    return [...projectGroups, ...baseGroups];
  };

  // Default initial messages
  const getDefaultMessages = (): LanChatMessage[] => [
    {
      id: 'msg-1',
      senderId: 'user-02',
      senderName: '李工-后端工程',
      senderAvatar: '👨‍💻',
      type: 'text',
      content: '大家伙好，局域网 P2P 点对点传输节点已在线打通，随时支持发文件/大模型报告！',
      timestamp: '10:15',
    },
    {
      id: 'msg-2',
      senderId: 'user-03',
      senderName: '王经理-项目PM',
      senderAvatar: '👩‍💼',
      type: 'text',
      content: '请把最新的 AI 架构评估报告发送在协同频道，我这边直接导出 PPT 演示版。',
      timestamp: '10:18',
    },
    {
      id: 'msg-3',
      senderId: 'user-02',
      senderName: '李工-后端工程',
      senderAvatar: '👨‍💻',
      type: 'file',
      content: '后端高并发扩展架构_v2.pdf',
      fileName: '后端高并发扩展架构_v2.pdf',
      fileSize: '2.4 MB',
      fileUrl: '#',
      timestamp: '10:20',
    },
  ];

  // Initialize groups state with localStorage fallback
  const [groups, setGroups] = useState<LanChatGroup[]>(() => {
    if (isTauri()) return [];
    try {
      const saved = localStorage.getItem(STORAGE_KEY_GROUPS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const normalized = parsed.map((g: any) => ({
            ...g,
            memberIds: Array.isArray(g.memberIds)
              ? g.memberIds
              : g.createdBy
              ? [g.createdBy]
              : [],
            adminIds: Array.isArray(g.adminIds) ? g.adminIds : [],
          }));
          const existingIds = new Set(normalized.map((g: any) => g.id));
          const newProjectGroups = accessibleProjects
            .filter((p) => !existingIds.has(`group-proj-${p.id}`))
            .map((p) => ({
              id: `group-proj-${p.id}`,
              name: `项目组: ${p.name}`,
              description: p.description || `针对《${p.name}》的研讨与文件分享`,
              avatar: '📁',
              memberIds: Array.from(
                new Set([
                  p.createdBy,
                  ...(Array.isArray(p.admins) ? p.admins : []),
                  ...(Array.isArray(p.members) ? p.members : []),
                ]),
              ),
              adminIds:
                Array.isArray(p.admins) && p.admins.length > 0
                  ? p.admins
                  : [p.createdBy || currentUser.id],
              createdBy: p.createdBy || currentUser.id,
              createdAt: '09:00',
              projectId: p.id,
            }));
          return [...newProjectGroups, ...normalized];
        }
      }
    } catch (e) {
      console.warn('Failed to parse lan_chat_groups from localStorage', e);
    }
    return getDefaultGroups();
  });

  const canUserCreateGroup = useMemo(
    () =>
      canUserCreateChatGroup({
        currentUserRole: currentUser.role,
        currentUserId: currentUser.id,
        groups,
        projects,
      }),
    [currentUser.id, currentUser.role, groups, projects],
  );

  // Initialize messages state with localStorage fallback
  const [messages, setMessages] = useState<LanChatMessage[]>(() => {
    if (isTauri()) return [];
    try {
      const saved = localStorage.getItem(STORAGE_KEY_MESSAGES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return deduplicateMessages(parsed);
      }
    } catch (e) {
      console.warn('Failed to parse lan_chat_messages from localStorage', e);
    }
    return getDefaultMessages();
  });

  // Save groups to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(groups));
    } catch (e) {
      console.error('Failed to save groups to localStorage', e);
    }
  }, [groups]);

  // Save messages to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
    } catch (e) {
      console.error('Failed to save messages to localStorage', e);
    }
  }, [messages]);

  useEffect(() => {
    if (initialTargetUser) {
      setActiveTarget({ type: 'user', user: initialTargetUser });
    }
  }, [initialTargetUser]);

  useEffect(() => {
    if (!isOpen || !initialConversation) return;
    const conversationKey = initialConversation.kind === 'broadcast'
      ? 'broadcast'
      : `${initialConversation.kind}:${initialConversation.targetId}`;

    // `initialConversation` is an external navigation request, not a source
    // of truth for the sidebar selection. Apply each request once so a later
    // users/groups refresh cannot reset an in-modal selection back to the
    // conversation that originally opened the modal.
    if (appliedInitialConversationRef.current === conversationKey) return;

    if (initialConversation.kind === 'broadcast') {
      setActiveTarget({ type: 'broadcast' });
      appliedInitialConversationRef.current = conversationKey;
    } else if (initialConversation.kind === 'user') {
      const user = users.find((item) => item.id === initialConversation.targetId);
      if (user) {
        setActiveTarget({ type: 'user', user });
        appliedInitialConversationRef.current = conversationKey;
      }
    } else {
      const group = groups.find((item) => item.id === initialConversation.targetId);
      if (group) {
        setActiveTarget({ type: 'group', group });
        appliedInitialConversationRef.current = conversationKey;
      }
    }
  }, [groups, initialConversation, isOpen, users]);

  useEffect(() => {
    if (!isOpen) {
      appliedInitialConversationRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!isOpen || !query || !isTauri()) {
      setServerSearchResults([]);
      setServerSearchTotal(0);
      return;
    }
    let disposed = false;
    const timer = window.setTimeout(() => {
      const conversationType = activeTarget.type === 'broadcast' ? 'broadcast' : activeTarget.type;
      const targetId = activeTarget.type === 'broadcast' ? undefined : activeTarget.type === 'user' ? activeTarget.user.id : activeTarget.group.id;
      ApiService.searchChatMessages({
        currentUserId: currentUser.id,
        conversationType,
        targetId,
        query,
        limit: 100,
      }).then((page) => {
        if (disposed) return;
        setServerSearchResults(page.results.map((result) => result.message));
        setServerSearchTotal(page.total);
      }).catch((error) => console.error('Failed to search chat messages', error));
    }, 180);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [activeTarget, currentUser.id, isOpen, searchQuery]);

  useEffect(() => {
    if (!isOpen || !isTauri()) return;
    let disposed = false;
    const disposers: Array<() => void> = [];
    const loadDesktopHistory = async () => {
      try {
        const [savedGroups, savedMessages] = await Promise.all([
          ApiService.getChatGroups(),
          ApiService.getChatMessages(currentUser.id),
        ]);
        const nextGroups = savedGroups;
        if (!disposed) {
          setGroups(nextGroups);
          setActiveTarget((previous) => {
            if (previous.type !== 'group') return previous;
            const refreshed = nextGroups.find((group) => group.id === previous.group.id);
            return refreshed && Array.isArray(refreshed.memberIds) && refreshed.memberIds.includes(currentUser.id)
              ? { type: 'group', group: refreshed }
              : { type: 'broadcast' };
          });
          setMessages(deduplicateMessages(savedMessages));
        }
      } catch (error) {
        console.error('Failed to load desktop chat history', error);
      }
    };
    void loadDesktopHistory();
    listen<LanChatMessage>('chat://message', (event) => {
      const message = event.payload;
      setMessages((previous) => {
        const index = previous.findIndex((m) => m.id === message.id);
        if (index !== -1) {
          const updated = [...previous];
          updated[index] = message;
          return updated;
        }
        return appendUniqueMessage(previous, message);
      });
    }).then((dispose) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    });
    listen<{ id: string }>('chat://message_deleted', (event) => {
      if (event.payload?.id) {
        setMessages((previous) => previous.filter((m) => m.id !== event.payload.id));
      }
    }).then((dispose) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    });
    listen<{ message_ids: string[]; reader_id: string }>('chat://messages_read', (event) => {
      const { message_ids, reader_id } = event.payload || {};
      if (Array.isArray(message_ids) && reader_id) {
        setMessages((previous) =>
          previous.map((m) => {
            if (message_ids.includes(m.id)) {
              const currentReadBy = m.readBy || [];
              if (!currentReadBy.includes(reader_id)) {
                return { ...m, readBy: [...currentReadBy, reader_id] };
              }
            }
            return m;
          })
        );
      }
    }).then((dispose) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    });
    listen<LanGroupAnnouncement>('chat://announcement_updated', (event) => {
      const ann = event.payload;
      if (!ann?.groupId) return;
      setAnnouncements((previous) => {
        const index = previous.findIndex((a) => a.id === ann.id);
        if (index !== -1) {
          const updated = [...previous];
          updated[index] = ann;
          return updated.sort(
            (a, b) =>
              (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt),
          );
        }
        return [ann, ...previous].sort(
          (a, b) =>
            (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt),
        );
      });
    }).then((dispose) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    });
    listen<string>('chat://announcement_deleted', (event) => {
      const deletedId = event.payload;
      if (deletedId) {
        setAnnouncements((previous) => previous.filter((a) => a.id !== deletedId));
      }
    }).then((dispose) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    });
    listen<LanChatGroup>('chat://group_updated', (event) => {
      const updated = event.payload;
      if (!updated?.id) return;
      setGroups((previous) => {
        const index = previous.findIndex((g) => g.id === updated.id);
        if (index !== -1) {
          const next = [...previous];
          next[index] = updated;
          return next;
        }
        return [...previous, updated];
      });
      setActiveTarget((previous) => {
        if (previous.type === 'group' && previous.group.id === updated.id) {
          return { type: 'group', group: updated };
        }
        return previous;
      });
    }).then((dispose) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    });
    listen<string>('chat://group_deleted', (event) => {
      const deletedId = event.payload;
      if (!deletedId) return;
      setGroups((previous) => previous.filter((g) => g.id !== deletedId));
      setActiveTarget((previous) => {
        if (previous.type === 'group' && previous.group.id === deletedId) {
          return { type: 'broadcast' };
        }
        return previous;
      });
    }).then((dispose) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    });
    listen('sync://operation', () => {
      loadDesktopHistory();
      const currentTarget = activeTargetRef.current;
      if (currentTarget.type === 'group' && currentTarget.group?.id) {
        ApiService.getGroupAnnouncements(currentTarget.group.id)
          .then((data) => setAnnouncements(data))
          .catch(console.error);
      }
    }).then((dispose) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    });
    return () => {
      disposed = true;
      disposers.forEach((dispose) => dispose());
    };
  }, [isOpen, currentUser.id]);

  // Load announcements for active group
  useEffect(() => {
    if (!isOpen || activeTarget.type !== 'group' || !activeTarget.group?.id) {
      setAnnouncements([]);
      return;
    }
    const groupId = activeTarget.group.id;
    if (isTauri()) {
      ApiService.getGroupAnnouncements(groupId)
        .then((data) => setAnnouncements(data))
        .catch((err) => console.error('Failed to load group announcements', err));
    }
  }, [isOpen, activeTarget]);

  useEffect(() => {
    if (!isOpen) return;
    setSendError(null);
  }, [activeTarget, isOpen]);

  // Mark only messages that actually enter the viewport. This keeps the unread
  // counter useful while a user is reading older history above the fold.
  useEffect(() => {
    if (!isOpen || !messages.length) return;
    const conversationKey = conversationKeyForTarget(activeTarget);
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleIds = entries
          .filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)
          .map((entry) => (entry.target as HTMLElement).dataset.chatMessageId)
          .filter((id): id is string => Boolean(id));
        const unreadIds = visibleIds.filter((id) => {
          const message = messages.find((item) => item.id === id);
          return Boolean(message && message.senderId !== currentUser.id && !message.readBy?.includes(currentUser.id));
        });
        if (!unreadIds.length) return;
        setMessages((previous) =>
          previous.map((message) =>
            unreadIds.includes(message.id)
              ? { ...message, readBy: Array.from(new Set([...(message.readBy || []), currentUser.id])) }
              : message,
          ),
        );
        onConversationRead?.(conversationKey, unreadIds);
        if (isTauri()) {
          ApiService.markChatMessagesRead(unreadIds, currentUser.id).catch((error) =>
            console.error('Failed to mark messages read:', error),
          );
        }
      },
      { root: messagesContainerRef.current, threshold: [0.5] },
    );
    (Object.values(messageElementRefs.current) as Array<HTMLDivElement | null>).forEach((element) => {
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [activeTarget, currentUser.id, isOpen, messages, onConversationRead]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleGlobalClick = () => setContextMenu(null);
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [contextMenu]);

  const previousScrollConversationRef = useRef('');
  const previousVisibleMessageCountRef = useRef(0);
  useEffect(() => {
    if (!isOpen) {
      previousScrollConversationRef.current = '';
      previousVisibleMessageCountRef.current = 0;
      return;
    }

    const conversationKey = activeTarget.type === 'broadcast'
      ? 'broadcast'
      : activeTarget.type === 'user'
        ? `user:${activeTarget.user.id}`
        : `group:${activeTarget.group.id}`;
    const isSameConversation = previousScrollConversationRef.current === conversationKey;
    const visibleMessageCount = messages.filter((message) => {
      if (activeTarget.type === 'group') return message.groupId === activeTarget.group.id;
      if (activeTarget.type === 'user') {
        const targetUserId = activeTarget.user.id;
        return (
          !message.groupId &&
          ((message.senderId === currentUser.id && message.receiverId === targetUserId) ||
            (message.senderId === targetUserId && message.receiverId === currentUser.id))
        );
      }
      return !message.groupId && !message.receiverId;
    }).length;
    const previousCount = previousVisibleMessageCountRef.current;
    const container = messagesContainerRef.current;
    const isNearBottom = container
      ? container.scrollHeight - container.scrollTop - container.clientHeight < 120
      : true;

    const firstUnread = messages
      .filter((message) => {
        if (message.senderId === currentUser.id || message.readBy?.includes(currentUser.id)) return false;
        if (activeTarget.type === 'group') return message.groupId === activeTarget.group.id;
        if (activeTarget.type === 'user') {
          return !message.groupId && ((message.senderId === currentUser.id && message.receiverId === activeTarget.user.id)
            || (message.senderId === activeTarget.user.id && message.receiverId === currentUser.id));
        }
        return !message.groupId && !message.receiverId;
      })
      .sort((left, right) => parseMessageEpoch(left) - parseMessageEpoch(right))[0];

    // Open/switch loads land on the first unread when one exists, otherwise at
    // the end. Later incoming messages follow only while already near bottom.
    if (!isSameConversation || (visibleMessageCount > previousCount && (previousCount === 0 || isNearBottom))) {
      window.requestAnimationFrame(() => {
        // The initial desktop history load can happen after the conversation
        // identity has already been recorded. Treat an empty previous view as
        // an opening load too, so the first unread message remains the anchor.
        if (firstUnread && (!isSameConversation || previousCount === 0) && messageElementRefs.current[firstUnread.id]) {
          messageElementRefs.current[firstUnread.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }
    previousScrollConversationRef.current = conversationKey;
    previousVisibleMessageCountRef.current = visibleMessageCount;
  }, [activeTarget, currentUser.id, isOpen, messages.length]);

  useEffect(() => {
    if (!previewImage) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewImage(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewImage]);

  if (!isOpen) return null;

  // Open Create Group Dialog
  const handleOpenCreateGroup = () => {
    if (!canUserCreateGroup) {
      window.alert('非群创建者和群管理员无法创建群聊天');
      return;
    }
    setNewGroupName('');
    setNewGroupDesc('');
    setNewGroupAvatar('👥');
    setSelectedProjectId('');
    setSelectedMemberIds([currentUser.id]);
    setCreateMemberSearchQuery('');
    setCreateMemberSource('people');
    setCreateGroupError(null);
    setIsCreateGroupOpen(true);
  };

  const handleToggleMember = (userId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleToggleCreateLocalOrgUnit = (orgUnitId: string) => {
    const orgMemberIds = Array.from(localOrgUnitMemberIds(orgUnitId))
      .filter((id) => selectableGroupUsers.some((user) => user.id === id));
    if (orgMemberIds.length === 0) return;
    setSelectedMemberIds((previous) => {
      const allIncluded = orgMemberIds.every((id) => previous.includes(id));
      return allIncluded
        ? previous.filter((id) => !orgMemberIds.includes(id))
        : Array.from(new Set([...previous, ...orgMemberIds]));
    });
  };

  const handleSelectAllMembers = () => {
    const selectableIds = selectableGroupUsers.map((user) => user.id);
    if (selectableIds.every((id) => selectedMemberIds.includes(id))) {
      setSelectedMemberIds([currentUser.id]);
    } else {
      setSelectedMemberIds(selectableIds);
    }
  };

  const handleGroupProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId);
    const project = accessibleProjects.find((item) => item.id === projectId);
    if (!project) return;
    const projectMemberIds = new Set([project.createdBy, ...project.admins, ...project.members]);
    setSelectedMemberIds((current) =>
      Array.from(new Set([currentUser.id, ...current.filter((id) => projectMemberIds.has(id))])),
    );
    if (!newGroupName) {
      setNewGroupName(`项目: ${project.name}`);
      setNewGroupDesc(project.description);
    }
  };

  const handleOpenGroupMembers = (group: LanChatGroup) => {
    setManagedMemberIds(group.memberIds);
    setMemberManagementError(null);
    setMemberSearchQuery('');
    setMemberScope('included');
    setMemberPresence('all');
    setMemberSource('people');
    setShowGroupMembersModal(true);
  };

  const handleToggleManagedMember = (group: LanChatGroup, userId: string) => {
    if (!canManageActiveGroupMembers) return;
    if (group.createdBy === userId) return;
    setManagedMemberIds((previous) =>
      previous.includes(userId)
        ? previous.filter((memberId) => memberId !== userId)
        : [...previous, userId],
    );
  };

  const handleSaveGroupMembers = async (group: LanChatGroup) => {
    if (!canManageActiveGroupMembers) return;
    setIsSavingMembers(true);
    setMemberManagementError(null);
    try {
      const memberIds = Array.from(new Set([...managedMemberIds, ...groupAdminIds(group)]));
      const savedGroup = isTauri()
        ? await ApiService.updateChatGroupMembers(group.id, memberIds, currentUser.id)
        : { ...group, memberIds };
      setGroups((previous) =>
        previous.map((item) => (item.id === savedGroup.id ? savedGroup : item)),
      );
      setActiveTarget({ type: 'group', group: savedGroup });
      setShowGroupMembersModal(false);
    } catch (error) {
      setMemberManagementError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingMembers(false);
    }
  };

  const handleCreateGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUserCreateGroup) {
      setCreateGroupError('非群创建者和群管理员无法创建群聊天');
      return;
    }
    if (!newGroupName.trim()) return;

    setCreateGroupError(null);
    setIsCreatingGroup(true);

    try {
      const allowedMemberIds = selectedProjectMemberIds;
      const ensuredMemberIds = Array.from(
        new Set([
          currentUser.id,
          ...selectedMemberIds.filter((id) => !allowedMemberIds || allowedMemberIds.has(id)),
        ]),
      );
      const newGroup: LanChatGroup = {
        id: `group-${Date.now()}`,
        name: newGroupName.trim(),
        description: newGroupDesc.trim() || '局域网私密协同群组',
        avatar: newGroupAvatar,
        memberIds: ensuredMemberIds,
        adminIds: [currentUser.id],
        createdBy: currentUser.id,
        createdAt: new Date().toISOString(),
        projectId: selectedProjectId || undefined,
      };

      const savedGroup = isTauri() ? await ApiService.saveChatGroup(newGroup) : newGroup;
      setGroups((prev) => [savedGroup, ...prev]);

      const systemMsg: LanChatMessage = {
        id: `msg-${Date.now()}`,
        senderId: currentUser.id,
        senderName: currentUser.nickname,
        senderAvatar: currentUser.avatar,
        groupId: savedGroup.id,
        type: 'text',
        content: `🎉 ${currentUser.nickname} 创建了项目群组《${newGroup.name}》，共 ${ensuredMemberIds.length} 名成员已加入频道！`,
        timestamp: new Date().toISOString(),
      };

      const savedSystemMessage = isTauri() ? await ApiService.sendChatMessage(systemMsg) : systemMsg;
      setMessages((prev) => appendUniqueMessage(prev, savedSystemMessage));
      setIsCreateGroupOpen(false);
      setActiveTarget({ type: 'group', group: savedGroup });
    } catch (error) {
      setCreateGroupError(error instanceof Error ? error.message : '创建群组失败');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleMessageContextMenu = (e: React.MouseEvent, msg: LanChatMessage) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 140;
    const menuHeight = 220;
    const x = Math.max(10, Math.min(e.clientX, window.innerWidth - menuWidth - 10));
    const y = Math.max(10, Math.min(e.clientY, window.innerHeight - menuHeight - 10));
    setContextMenu({ x, y, message: msg });
  };

  const handleCopyMessage = async (msg: LanChatMessage) => {
    const textToCopy = msg.type === 'file' ? (msg.fileName || msg.content) : msg.content;
    try {
      await navigator.clipboard.writeText(textToCopy);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setContextMenu(null);
  };

  const handleQuoteMessage = (msg: LanChatMessage) => {
    setQuotedMessage(msg);
    setContextMenu(null);
    setTimeout(() => {
      messageInputRef.current?.focus({ preventScroll: true });
    }, 50);
  };

  const handleOpenForwardModal = (msg: LanChatMessage) => {
    setForwardingMessage(msg);
    setShowForwardModal(true);
    setContextMenu(null);
  };

  const handleForwardMessage = async (
    targetType: 'user' | 'group' | 'broadcast',
    targetId: string,
  ) => {
    if (!forwardingMessage) return;
    const newMsg: Omit<LanChatMessage, 'id' | 'timestamp'> = {
      senderId: currentUser.id,
      senderName: currentUser.nickname,
      senderAvatar: currentUser.avatar,
      type: forwardingMessage.type,
      content: forwardingMessage.content,
      fileName: forwardingMessage.fileName,
      fileSize: forwardingMessage.fileSize,
      fileUrl: forwardingMessage.fileUrl,
      replyTo: forwardingMessage.replyTo,
      groupId: targetType === 'group' ? targetId : undefined,
      receiverId: targetType === 'user' ? targetId : undefined,
      readBy: [currentUser.id],
    };

    if (isTauri()) {
      const saved = await ApiService.sendChatMessage(newMsg);
      setMessages((prev) => appendUniqueMessage(prev, saved));
    } else {
      const localMsg: LanChatMessage = {
        ...newMsg,
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => appendUniqueMessage(prev, localMsg));
    }
  };

  const handleCreateTaskFromMessage = (msg: LanChatMessage) => {
    const taskTitle = msg.type === 'file' ? `处理文件: ${msg.fileName || msg.content}` : msg.content;
    onCreateTaskFromMessage?.(taskTitle);
    setContextMenu(null);
  };

  const handleDeleteMessage = async (msg: LanChatMessage) => {
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    if (isTauri()) {
      try {
        await ApiService.deleteChatMessage(msg.id, currentUser.id);
      } catch (e) {
        console.error('Failed to delete chat message:', e);
      }
    }
    setContextMenu(null);
  };

  const handleSendMessage = async (overrideContent?: string) => {
    const textToSend = overrideContent || inputText.trim();
    if (!textToSend) return;
    if (isActiveProjectGroupReadOnly) {
      setSendError('你已不在关联项目中，只能查看历史消息');
      return;
    }
    setSendError(null);

    const timestamp = new Date().toISOString();
    const replyTo = quotedMessage
      ? {
          id: quotedMessage.id,
          senderName: quotedMessage.senderName,
          content:
            quotedMessage.type === 'file'
              ? quotedMessage.fileName || quotedMessage.content
              : quotedMessage.content,
          type: quotedMessage.type,
        }
      : undefined;

    let newMessage: LanChatMessage;

    if (activeTarget.type === 'group') {
      newMessage = {
        id: `msg-${Date.now()}`,
        senderId: currentUser.id,
        senderName: currentUser.nickname,
        senderAvatar: currentUser.avatar,
        groupId: activeTarget.group.id,
        type: 'text',
        content: textToSend,
        timestamp,
        replyTo,
        readBy: [currentUser.id],
      };
    } else if (activeTarget.type === 'user') {
      newMessage = {
        id: `msg-${Date.now()}`,
        senderId: currentUser.id,
        senderName: currentUser.nickname,
        senderAvatar: currentUser.avatar,
        receiverId: activeTarget.user.id,
        type: 'text',
        content: textToSend,
        timestamp,
        replyTo,
        readBy: [currentUser.id],
      };
    } else {
      newMessage = {
        id: `msg-${Date.now()}`,
        senderId: currentUser.id,
        senderName: currentUser.nickname,
        senderAvatar: currentUser.avatar,
        type: 'text',
        content: textToSend,
        timestamp,
        replyTo,
        readBy: [currentUser.id],
      };
    }

    let savedMessage: LanChatMessage;
    try {
      savedMessage = isTauri() ? await ApiService.sendChatMessage(newMessage) : newMessage;
    } catch (error) {
      setSendError(error instanceof Error ? error.message : '消息发送失败');
      return;
    }
    setMessages((prev) => appendUniqueMessage(prev, savedMessage));
    if (!overrideContent) {
      setInputText('');
      setQuotedMessage(null);
    }
    setShowEmojiPicker(false);

    // Auto simulated reply
    if (!isTauri() && activeTarget.type === 'user' && activeTarget.user.id !== currentUser.id) {
      const respondent = activeTarget.user;
      setTimeout(() => {
        const autoReply: LanChatMessage = {
          id: `msg-${Date.now() + 1}`,
          senderId: respondent.id,
          senderName: respondent.nickname,
          senderAvatar: respondent.avatar,
          receiverId: currentUser.id,
          type: 'text',
          content: `[节点 ${respondent.nickname}] 收到 P2P 消息！数据已同步保存在本地。`,
          timestamp: new Date().toISOString(),
          readBy: [respondent.id],
        };
        setMessages((prev) => appendUniqueMessage(prev, autoReply));
      }, 1200);
    } else if (!isTauri() && activeTarget.type === 'group') {
      const targetGroup = activeTarget.group;
      const otherMembers = users.filter(
        (u) =>
          Array.isArray(targetGroup.memberIds) &&
          targetGroup.memberIds.includes(u.id) &&
          u.id !== currentUser.id,
      );
      if (otherMembers.length > 0) {
        const respondent = otherMembers[Math.floor(Math.random() * otherMembers.length)];
        setTimeout(() => {
          const autoReply: LanChatMessage = {
            id: `msg-${Date.now() + 1}`,
            senderId: respondent.id,
            senderName: respondent.nickname,
            senderAvatar: respondent.avatar,
            groupId: targetGroup.id,
            type: 'text',
            content: `[群员 ${respondent.nickname}] 收到项目组内消息，已完成接收并保存至本地数据库。`,
            timestamp: new Date().toISOString(),
            readBy: [respondent.id],
          };
          setMessages((prev) => appendUniqueMessage(prev, autoReply));
        }, 1500);
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const supportedImage =
      ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'].includes(
        file.type.toLowerCase(),
      ) || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name);
    if (!supportedImage) {
      e.target.value = '';
      window.alert('请选择 PNG、JPG、GIF、WebP、BMP 或 AVIF 图片');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      const timestamp = new Date().toISOString();

      let newMsg: LanChatMessage = {
        id: `msg-${Date.now()}`,
        senderId: currentUser.id,
        senderName: currentUser.nickname,
        senderAvatar: currentUser.avatar,
        type: 'image',
        content: file.name,
        fileUrl: dataUrl,
        fileName: file.name,
        fileSize: `${(file.size / 1024).toFixed(1)} KB`,
        timestamp,
        readBy: [currentUser.id],
      };

      if (activeTarget.type === 'group') {
        newMsg.groupId = activeTarget.group.id;
      } else if (activeTarget.type === 'user') {
        newMsg.receiverId = activeTarget.user.id;
      }

      try {
        const savedMessage = isTauri() ? await ApiService.sendChatMessage(newMsg) : newMsg;
        setMessages((prev) => appendUniqueMessage(prev, savedMessage));
      } catch (error) {
        console.error('Failed to send LAN image', error);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      const timestamp = new Date().toISOString();

      let newMsg: LanChatMessage = {
        id: `msg-${Date.now()}`,
        senderId: currentUser.id,
        senderName: currentUser.nickname,
        senderAvatar: currentUser.avatar,
        type: 'file',
        content: file.name,
        fileUrl: dataUrl,
        fileName: file.name,
        fileSize: `${sizeMb} MB`,
        timestamp,
        readBy: [currentUser.id],
      };

      if (activeTarget.type === 'group') {
        newMsg.groupId = activeTarget.group.id;
      } else if (activeTarget.type === 'user') {
        newMsg.receiverId = activeTarget.user.id;
      }

      setMessages((prev) => appendUniqueMessage(prev, newMsg));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleDesktopFileUpload = async () => {
    try {
      const selected = await open({ multiple: false, directory: false, title: '选择要发送的文件' });
      if (!selected || Array.isArray(selected)) return;
      const offer = await ApiService.registerFileForTransfer(selected);
      const newMessage: LanChatMessage = {
        id: `msg-${Date.now()}`,
        senderId: currentUser.id,
        senderName: currentUser.nickname,
        senderAvatar: currentUser.avatar,
        type: 'file',
        content: offer.fileName,
        fileUrl: offer.url,
        fileName: offer.fileName,
        fileSize: formatFileSize(offer.sizeBytes),
        timestamp: new Date().toISOString(),
        readBy: [currentUser.id],
      };
      if (activeTarget.type === 'group') newMessage.groupId = activeTarget.group.id;
      if (activeTarget.type === 'user') newMessage.receiverId = activeTarget.user.id;
      const saved = await ApiService.sendChatMessage(newMessage);
      setMessages((previous) => appendUniqueMessage(previous, saved));
    } catch (error) {
      console.error('Failed to prepare LAN file transfer', error);
    }
  };

  const handleDownloadFile = async (message: LanChatMessage) => {
    if (!message.fileUrl) return;
    if (!isTauri() || !message.fileUrl.startsWith('zhiyu-file://')) {
      window.open(message.fileUrl, '_blank');
      return;
    }
    const destination = await save({ defaultPath: message.fileName || '智域协同文件' });
    if (!destination) return;
    try {
      await ApiService.downloadFileFromPeer(message.fileUrl, destination);
    } catch (error) {
      console.error('Failed to download LAN file', error);
    }
  };

  const handleClearCurrentChat = async () => {
    if (isClearingChat) return;
    const conversationType =
      activeTarget.type === 'group'
        ? 'group'
        : activeTarget.type === 'user'
          ? 'user'
          : 'broadcast';
    const targetId =
      activeTarget.type === 'group'
        ? activeTarget.group.id
        : activeTarget.type === 'user'
          ? activeTarget.user.id
          : undefined;
    setIsClearingChat(true);
    try {
      if (isTauri()) {
        await ApiService.clearChatMessages(currentUser.id, conversationType, targetId);
      }
    } catch (error) {
      console.error('Failed to clear current chat', error);
      return;
    } finally {
      setIsClearingChat(false);
    }

    if (activeTarget.type === 'group') {
      const groupId = activeTarget.group.id;
      setMessages((prev) => prev.filter((m) => m.groupId !== groupId));
    } else if (activeTarget.type === 'user') {
      const targetUserId = activeTarget.user.id;
      setMessages((prev) =>
        prev.filter(
          (m) =>
            m.groupId ||
            !(
              (m.senderId === currentUser.id && m.receiverId === targetUserId) ||
              (m.senderId === targetUserId && m.receiverId === currentUser.id)
            )
        )
      );
    } else {
      setMessages((prev) => prev.filter((m) => m.groupId || m.receiverId));
    }
  };

  // Conversation identity is encoded by routing fields: broadcasts have no
  // receiver, direct messages have an explicit receiver, and groups have groupId.
  // Keep these cases disjoint so broadcasts never leak into a sender's direct chat.
  const accessibleProjectIds = new Set(accessibleProjects.map((project) => project.id));
  const visibleGroups = (groups || []).filter(
    (group) => group && Array.isArray(group.memberIds) && group.memberIds.includes(currentUser.id),
  );
  const isActiveProjectGroupReadOnly =
    activeTarget.type === 'group' &&
    Boolean(
      activeTarget.group.projectId &&
        !accessibleProjectIds.has(activeTarget.group.projectId),
    );
  const canManageActiveGroupMembers =
    activeTarget.type === 'group' &&
    canManageGroupMembers({
      group: activeTarget.group,
      userId: currentUser.id,
      isProjectReadOnly: isActiveProjectGroupReadOnly,
    });
  const canManageActiveGroupAnnouncements =
    activeTarget.type === 'group' &&
    canManageGroupAnnouncements({
      group: activeTarget.group,
      userId: currentUser.id,
      isProjectReadOnly: isActiveProjectGroupReadOnly,
    });
  const activeGroupProject = activeTarget.type === 'group'
    ? accessibleProjects.find((project) => project.id === activeTarget.group.projectId)
    : undefined;
  const activeGroupCandidateUsers = activeTarget.type === 'group'
    ? (users || []).filter((user) => {
        if (!activeGroupProject) {
          return !canManageActiveGroupMembers
            ? activeTarget.group.memberIds.includes(user.id)
            : true;
        }
        return activeGroupProject.createdBy === user.id
          || activeGroupProject.admins.includes(user.id)
          || activeGroupProject.members.includes(user.id);
      })
    : [];
  const toggleLocalOrgUnit = (orgUnitId: string) => {
    if (!canManageActiveGroupMembers) return;
    const orgMemberIds = Array.from(localOrgUnitMemberIds(orgUnitId));
    const candidateIds = new Set(activeGroupCandidateUsers.map((user) => user.id));
    const allowedIds = orgMemberIds.filter((id) => candidateIds.has(id) && id !== activeTarget.group.createdBy && id !== currentUser.id);
    if (allowedIds.length === 0) return;
    setManagedMemberIds((previous) => {
      const allIncluded = allowedIds.every((id) => previous.includes(id));
      return allIncluded
        ? previous.filter((id) => !allowedIds.includes(id))
        : Array.from(new Set([...previous, ...allowedIds]));
    });
  };
  const normalizedMemberSearchQuery = memberSearchQuery.trim().toLocaleLowerCase();
  const visibleGroupMembers = activeGroupCandidateUsers.filter((user) => {
    if (memberScope === 'included' && !managedMemberIds.includes(user.id)) return false;
    if (memberScope === 'excluded' && managedMemberIds.includes(user.id)) return false;
    if (memberPresence === 'online' && !user.isOnline) return false;
    if (memberPresence === 'offline' && user.isOnline) return false;
    if (!normalizedMemberSearchQuery) return true;
    return [user.nickname, user.username, user.deviceId, user.ip]
      .filter(Boolean)
      .some((value) => value.toLocaleLowerCase().includes(normalizedMemberSearchQuery));
  });
  const editableVisibleGroupMemberIds = visibleGroupMembers
    .filter((user) => user.id !== activeTarget.group.createdBy && user.id !== currentUser.id)
    .map((user) => user.id);
  const areAllVisibleMembersSelected = editableVisibleGroupMemberIds.length > 0
    && editableVisibleGroupMemberIds.every((id) => managedMemberIds.includes(id));
  const toggleVisibleGroupMembers = () => {
    if (!canManageActiveGroupMembers || editableVisibleGroupMemberIds.length === 0) return;
    setManagedMemberIds((previous) => {
      if (areAllVisibleMembersSelected) {
        return previous.filter((id) => !editableVisibleGroupMemberIds.includes(id));
      }
      return Array.from(new Set([...previous, ...editableVisibleGroupMemberIds]));
    });
  };
  const pinnedAnnouncement =
    activeTarget.type === 'group' ? announcements.find((a) => a.pinned) || null : null;
  const hasUnreadAnnouncements =
    activeTarget.type === 'group' &&
    announcements.some((a) => !a.readBy?.includes(currentUser.id));
  const conversationMessages = messages
    .filter((m) => {
      if (activeTarget.type === 'group') {
        return m.groupId === activeTarget.group.id;
      }
      if (activeTarget.type === 'user') {
        const targetUserId = activeTarget.user.id;
        return (
          !m.groupId &&
          ((m.senderId === currentUser.id && m.receiverId === targetUserId) ||
            (m.senderId === targetUserId && m.receiverId === currentUser.id))
        );
      }
      // Broadcast is the only conversation with neither routing field.
      return !m.groupId && !m.receiverId;
    })
    .sort((a, b) => parseMessageEpoch(a) - parseMessageEpoch(b));

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredMessages = conversationMessages.filter((message) => {
    if (!normalizedSearchQuery) return true;
    return message.content.toLocaleLowerCase().includes(normalizedSearchQuery)
      || (message.fileName || '').toLocaleLowerCase().includes(normalizedSearchQuery);
  });
  const renderedMessages = conversationMessages;
  const activeUnreadIds = new Set(
    conversationMessages
      .filter((message) =>
        message.senderId !== currentUser.id && !message.readBy?.includes(currentUser.id),
      )
      .map((message) => message.id),
  );

  const scrollToMessage = (messageId: string) => {
    const element = messageElementRefs.current[messageId];
    if (!element) return;
    setHighlightedMessageId(messageId);
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => setHighlightedMessageId((current) => current === messageId ? null : current), 1800);
  };

  const handleSearchResultClick = async (message: LanChatMessage) => {
    if (!isTauri()) {
      scrollToMessage(message.id);
      return;
    }
    const conversationType = activeTarget.type === 'broadcast' ? 'broadcast' : activeTarget.type;
    const targetId = activeTarget.type === 'broadcast' ? undefined : activeTarget.type === 'user' ? activeTarget.user.id : activeTarget.group.id;
    try {
      const context = await ApiService.getChatMessageContext({
        currentUserId: currentUser.id,
        conversationType,
        targetId,
        messageId: message.id,
        before: 30,
        after: 30,
      });
      setMessages((previous) => deduplicateMessages([...previous, ...context, message]));
      window.requestAnimationFrame(() => scrollToMessage(message.id));
    } catch (error) {
      console.error('Failed to load chat message context', error);
      scrollToMessage(message.id);
    }
  };

  const handleJumpToUnread = () => {
    const firstUnread = conversationMessages.find((message) => activeUnreadIds.has(message.id));
    if (firstUnread) scrollToMessage(firstUnread.id);
  };

  // This component returns early while closed, so keep this derived value
  // hook-free. A useMemo here would change the Hook order when the modal opens.
  const handleOpenAnnouncementsModal = async () => {
    setShowAnnouncementModal(true);
    if (activeTarget.type === 'group' && isTauri()) {
      const unreadList = announcements.filter((a) => !a.readBy?.includes(currentUser.id));
      for (const ann of unreadList) {
        try {
          const updated = await ApiService.markGroupAnnouncementRead(ann.id, currentUser.id);
          setAnnouncements((prev) =>
            prev.map((a) => (a.id === updated.id ? updated : a))
          );
        } catch (err) {
          console.error('Failed to mark announcement read', err);
        }
      }
    }
  };

  const handleSaveAnnouncement = async (announcementData: Partial<LanGroupAnnouncement>) => {
    if (activeTarget.type !== 'group') return;
    if (isTauri()) {
      const saved = await ApiService.saveGroupAnnouncement(announcementData, currentUser.id);
      setAnnouncements((prev) => {
        const exists = prev.some((a) => a.id === saved.id);
        const list = exists ? prev.map((a) => (a.id === saved.id ? saved : a)) : [saved, ...prev];
        return list.sort(
          (a, b) =>
            (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt),
        );
      });
    } else {
      const localAnn: LanGroupAnnouncement = {
        id: `ann-${Date.now()}`,
        groupId: activeTarget.group.id,
        title: announcementData.title || '',
        content: announcementData.content || '',
        authorId: currentUser.id,
        authorName: currentUser.nickname || currentUser.username,
        createdAt: new Date().toISOString(),
        pinned: announcementData.pinned || false,
        readBy: [currentUser.id],
      };
      setAnnouncements((prev) =>
        [localAnn, ...prev].sort(
          (a, b) =>
            (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt),
        ),
      );
    }
  };

  const handleDeleteAnnouncement = async (announcementId: string) => {
    if (isTauri()) {
      await ApiService.deleteGroupAnnouncement(announcementId, currentUser.id);
    }
    setAnnouncements((prev) => prev.filter((a) => a.id !== announcementId));
  };

  const handlePinAnnouncement = async (announcementId: string, pinned: boolean) => {
    if (isTauri()) {
      const updated = await ApiService.pinGroupAnnouncement(announcementId, pinned, currentUser.id);
      setAnnouncements((prev) =>
        prev
          .map((a) => (a.id === updated.id ? updated : a))
          .sort(
            (a, b) =>
              (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt),
          ),
      );
    } else {
      setAnnouncements((prev) =>
        prev
          .map((a) => (a.id === announcementId ? { ...a, pinned } : a))
          .sort(
            (a, b) =>
              (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt),
          ),
      );
    }
  };

  const handleGroupUpdated = (updatedGroup: LanChatGroup) => {
    setGroups((prev) => prev.map((g) => (g.id === updatedGroup.id ? updatedGroup : g)));
    if (activeTarget.type === 'group' && activeTarget.group.id === updatedGroup.id) {
      setActiveTarget({ type: 'group', group: updatedGroup });
    }
    const systemMsg: LanChatMessage = {
      id: `msg-${Date.now()}`,
      senderId: currentUser.id,
      senderName: currentUser.nickname,
      senderAvatar: currentUser.avatar,
      groupId: updatedGroup.id,
      type: 'text',
      content: `📢 ${currentUser.nickname} 更新了群组《${updatedGroup.name}》的资料与设置。`,
      timestamp: new Date().toISOString(),
    };
    if (isTauri()) {
      ApiService.sendChatMessage(systemMsg).catch(console.error);
    }
    setMessages((prev) => appendUniqueMessage(prev, systemMsg));
  };

  const handleGroupTransferred = (updatedGroup: LanChatGroup) => {
    setGroups((prev) => prev.map((g) => (g.id === updatedGroup.id ? updatedGroup : g)));
    if (activeTarget.type === 'group' && activeTarget.group.id === updatedGroup.id) {
      setActiveTarget({ type: 'group', group: updatedGroup });
    }
    const newOwner = (users || []).find((u) => u.id === updatedGroup.createdBy);
    const targetName = newOwner?.nickname || updatedGroup.createdBy;
    const systemMsg: LanChatMessage = {
      id: `msg-${Date.now()}`,
      senderId: currentUser.id,
      senderName: currentUser.nickname,
      senderAvatar: currentUser.avatar,
      groupId: updatedGroup.id,
      type: 'text',
      content: `🔄 ${currentUser.nickname} 已将群主转让给 ${targetName}。`,
      timestamp: new Date().toISOString(),
    };
    if (isTauri()) {
      ApiService.sendChatMessage(systemMsg).catch(console.error);
    }
    setMessages((prev) => appendUniqueMessage(prev, systemMsg));
  };

  const handleGroupDeleted = (groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    if (activeTarget.type === 'group' && activeTarget.group.id === groupId) {
      setActiveTarget({ type: 'broadcast' });
    }
  };

  return (
    <div className="fixed inset-0 bg-overlay backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="lan-chat-modal bg-surface border border-edge rounded-2xl max-w-4xl w-full h-[680px] max-h-[calc(100vh-2rem)] flex flex-col shadow-popover overflow-hidden animate-in fade-in zoom-in-95 duration-150 relative">
        {/* Top Header Bar */}
        <div className="lan-chat-header flex-shrink-0 px-5 py-3.5 bg-canvas border-b border-edge flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-success">
              <Wifi className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-extrabold text-main">局域网与项目组即时通讯</h2>
                <span className="chat-badge-storage text-[10px] bg-emerald-500/20 text-success font-mono px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                  <HardDrive className="w-3 h-3 text-success" />
                  本地存储持久化
                </span>
              </div>
              <p className="text-xs text-sub mt-0.5">
                支持项目协同群组沟通、单对单传输、图片/文件发送与本地记录保留
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-hover text-sub hover:text-main rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Middle Content Split: Left Sidebar + Right Chat Stream */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Sidebar */}
          <div className="lan-chat-sidebar w-64 flex-shrink-0 bg-canvas/70 border-r border-edge p-3 space-y-3 flex flex-col overflow-y-auto">
            {/* All Broadcast Channel Button */}
            <div>
              <div 
                onClick={() => setIsBroadcastCollapsed(!isBroadcastCollapsed)}
                className="chat-section-title text-[10px] font-bold text-quiet hover:text-sub uppercase tracking-wider px-1 py-1 rounded hover:bg-hover/40 cursor-pointer select-none flex items-center gap-1 transition-colors mb-1"
              >
                {isBroadcastCollapsed ? (
                  <ChevronRight className="w-3 h-3 text-sub" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-sub" />
                )}
                <span>全网大厅</span>
              </div>
              {!isBroadcastCollapsed && (
                <button
                  onClick={() => setActiveTarget({ type: 'broadcast' })}
                  data-active={activeTarget.type === 'broadcast'}
                  className={`chat-channel-btn w-full p-2.5 rounded-xl border text-left flex items-center space-x-2.5 text-xs transition-all ${
                    activeTarget.type === 'broadcast'
                      ? 'bg-blue-600/20 border-blue-500/50 text-info font-bold shadow-soft'
                      : 'bg-surface border-edge text-sub hover:bg-hover/80'
                  }`}
                >
                  <div className="channel-icon p-1.5 bg-blue-500/20 text-info rounded-lg flex-shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="channel-title truncate font-medium">全员广播频道</div>
                   <div className="channel-subtitle text-[10px] text-quiet font-mono">LAN Broadcast</div>
                  </div>
                  {(() => {
                    const count = unreadSummaries.find((summary) => summary.key === 'broadcast')?.count || 0;
                    return count > 0 ? <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-on-solid">{count > 99 ? '99+' : count}</span> : null;
                  })()}
                </button>
              )}
            </div>

            {/* Groups Section with Create Group Button */}
            <div className="space-y-1.5">
              <div 
                onClick={() => setIsGroupsCollapsed(!isGroupsCollapsed)}
                className="flex items-center justify-between px-1 py-1 rounded hover:bg-hover/40 cursor-pointer select-none group/title"
              >
                <span className="chat-section-title text-[10px] font-bold text-quiet group-hover/title:text-sub uppercase tracking-wider flex items-center gap-1 transition-colors">
                  {isGroupsCollapsed ? (
                    <ChevronRight className="w-3 h-3 text-sub" />
                  ) : (
                    <ChevronDown className="w-3 h-3 text-sub" />
                  )}
                  <FolderKanban className="w-3 h-3 text-accent" />
                  <span>项目与协同群组 ({visibleGroups.length})</span>
                </span>
                {canUserCreateGroup && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenCreateGroup();
                    }}
                    className="chat-btn-create-group p-1 bg-accent/15 hover:bg-accent text-accent hover:text-on-accent rounded-lg transition-colors text-[10px] flex items-center gap-0.5 border border-accent/30"
                    title="新建项目或项目组"
                  >
                    <Plus className="w-3 h-3" />
                    <span>建群</span>
                  </button>
                )}
              </div>

              {!isGroupsCollapsed && (
                <div className="space-y-1 max-h-52 overflow-y-auto pr-1 animate-in fade-in duration-150">
                  {visibleGroups.map((group) => {
                    const isSelected =
                      activeTarget.type === 'group' && activeTarget.group.id === group.id;
                    const linkedProj = projects.find((p) => p.id === group.projectId);

                    return (
                      <button
                        key={group.id}
                        onClick={() => setActiveTarget({ type: 'group', group })}
                        data-active={isSelected}
                        className={`chat-group-item w-full p-2 rounded-xl border text-left flex items-center space-x-2.5 text-xs transition-all ${
                          isSelected
                            ? 'bg-accent/15 border-accent/60 text-accent font-bold shadow-soft'
                            : 'bg-surface/80 border-edge/80 text-sub hover:bg-hover/60'
                        }`}
                      >
                        <div className="chat-group-avatar-placeholder w-7 h-7 rounded-lg bg-accent/10 border border-accent/30 text-accent flex items-center justify-center text-sm flex-shrink-0">
                          {group.avatar || '👥'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium flex items-center gap-1">
                            <span>{group.name}</span>
                          </div>
                          <div className="text-[10px] text-quiet flex items-center gap-1.5 min-w-0 mt-0.5">
                            {linkedProj && (
                              <span
                                className="chat-group-badge inline-flex items-center gap-1 text-accent bg-accent/10 px-1.5 py-0.5 rounded border border-accent/30 font-medium truncate max-w-[120px]"
                                title={`关联项目：${linkedProj.name}`}
                              >
                                <FolderKanban className="w-2.5 h-2.5 shrink-0 text-accent" />
                                <span className="truncate">{linkedProj.name}</span>
                              </span>
                            )}
                            <span className="shrink-0 text-quiet font-mono">{group.memberIds.length} 成员</span>
                          </div>
                        </div>
                        {(() => {
                          const count = unreadSummaries.find((summary) => summary.key === `group:${group.id}`)?.count || 0;
                          return count > 0 ? <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-on-solid">{count > 99 ? '99+' : count}</span> : null;
                        })()}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Individual Nodes Direct Chat */}
            <div className="space-y-1.5 flex-1 flex flex-col min-h-0">
              <div 
                onClick={() => setIsNodesCollapsed(!isNodesCollapsed)}
                className="chat-section-title text-[10px] font-bold text-quiet hover:text-sub uppercase tracking-wider px-1 py-1 rounded hover:bg-hover/40 cursor-pointer select-none flex items-center gap-1 transition-colors"
              >
                {isNodesCollapsed ? (
                  <ChevronRight className="w-3 h-3 text-sub" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-sub" />
                )}
                <span>单对单节点 ({users.filter((u) => u.id !== currentUser.id).length})</span>
              </div>

              {!isNodesCollapsed && (
                <div className="flex-1 overflow-y-auto space-y-1 pr-1 animate-in fade-in duration-150">
                  {users
                    .filter((u) => u.id !== currentUser.id)
                    .map((user) => {
                      const isSelected =
                        activeTarget.type === 'user' && activeTarget.user.id === user.id;
                      const isImg =
                        user.avatar &&
                        (user.avatar.startsWith('data:image') || user.avatar.startsWith('http'));

                      return (
                        <button
                          key={user.id}
                          onClick={() => setActiveTarget({ type: 'user', user })}
                          data-active={isSelected}
                          className={`chat-node-item w-full p-2 rounded-xl border text-left flex items-center space-x-2 text-xs transition-all ${
                            isSelected
                              ? 'bg-blue-600/20 border-blue-500/50 text-info font-bold'
                              : 'bg-surface/60 border-edge/60 text-sub hover:bg-hover/60'
                          }`}
                        >
                          <div className="relative flex-shrink-0">
                            <div className="w-7 h-7 rounded-lg bg-card border border-subtle flex items-center justify-center text-sm overflow-hidden">
                              {isImg ? (
                                <img
                                  src={user.avatar}
                                  alt={user.nickname}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                user.avatar || user.nickname.charAt(0)
                              )}
                            </div>
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-edge ${
                                user.isOnline ? 'bg-emerald-400' : 'bg-muted'
                              }`}
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold">{user.nickname}</div>
                            <div className="text-[10px] text-quiet font-mono truncate">
                              {user.ip}
                            </div>
                          </div>
                          {(() => {
                            const count = unreadSummaries.find((summary) => summary.key === `user:${user.id}`)?.count || 0;
                            return count > 0 ? <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-on-solid">{count > 99 ? '99+' : count}</span> : null;
                          })()}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          {/* Right Main Chat Window */}
          <div className="lan-chat-main-window flex-1 flex flex-col min-h-0 overflow-hidden relative">
            {/* Active Channel Subheader */}
            <div className="lan-chat-subheader flex-shrink-0 px-4 py-2.5 bg-surface/90 border-b border-edge flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2 text-sub font-medium min-w-0 flex-1">
                {activeTarget.type === 'group' ? (
                  <span className="text-base flex-shrink-0">{activeTarget.group.avatar || '👥'}</span>
                ) : (
                  <MessageSquare className="w-4 h-4 text-info flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    <strong className="subheader-title text-xs font-bold truncate">
                      {activeTarget.type === 'broadcast' && '全员广播频道 (LAN Broadcast)'}
                      {activeTarget.type === 'user' &&
                        `${activeTarget.user.nickname} (${activeTarget.user.ip})`}
                      {activeTarget.type === 'group' && activeTarget.group.name}
                    </strong>
                    {activeTarget.type === 'group' && (
                      <span className="chat-badge-member-count text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded border border-accent/30 flex-shrink-0 font-medium">
                        {activeTarget.group.memberIds.length} 人群组
                      </span>
                    )}
                    {activeTarget.type === 'group' && (() => {
                      const activeProj = projects.find((p) => p.id === activeTarget.group.projectId);
                      return activeProj ? (
                        <span
                          className="chat-badge-project text-[10px] bg-info/15 text-info px-1.5 py-0.5 rounded border border-info/30 flex items-center gap-1 max-w-[150px] truncate font-medium flex-shrink-0"
                          title={`所属项目：${activeProj.name}`}
                        >
                          <FolderKanban className="w-3 h-3 shrink-0" />
                          <span className="truncate">{activeProj.name}</span>
                        </span>
                      ) : null;
                    })()}
                    {isActiveProjectGroupReadOnly && (
                      <span className="flex flex-shrink-0 items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-warning">
                        <LockKeyhole className="h-3 w-3" aria-hidden="true" />
                        已退出项目 · 历史只读
                      </span>
                    )}
                  </div>
                  {activeTarget.type === 'group' && activeTarget.group.description && (
                    <div className="text-[10px] text-sub truncate max-w-md mt-0.5">
                      {activeTarget.group.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Tools in Subheader: All icon-only buttons */}
              <div className="flex items-center space-x-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setSearchOpen((current) => !current)}
                  className={`h-8 w-8 rounded-lg border flex items-center justify-center transition-colors ${searchOpen ? 'bg-blue-600 text-on-solid border-blue-500' : 'bg-card/80 hover:bg-hover text-info border-subtle/60'}`}
                  title="搜索当前对话消息和文件名"
                  aria-label="搜索当前对话消息和文件名"
                >
                  <Search className="w-4 h-4" />
                </button>
                {/* 0. 群公告 (仅群聊可见) */}
                {activeTarget.type === 'group' && (
                  <button
                    type="button"
                    onClick={handleOpenAnnouncementsModal}
                    className="relative h-8 w-8 rounded-lg bg-card/80 hover:bg-hover text-warning hover:text-warning flex items-center justify-center border border-subtle/60 transition-colors"
                    title="群公告"
                    aria-label="查看与管理群公告"
                  >
                    <Megaphone className="w-4 h-4" />
                    {hasUnreadAnnouncements && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                      </span>
                    )}
                  </button>
                )}

                {/* 1. 群设置 (仅群聊且管理员/创建者可见) */}
                {activeTarget.type === 'group' && canManageActiveGroupMembers && (
                  <button
                    type="button"
                    onClick={() => setShowEditGroupModal(true)}
                    className="h-8 w-8 rounded-lg bg-card/80 hover:bg-hover text-sub hover:text-main flex items-center justify-center border border-subtle/60 transition-colors"
                    title="群设置 / 修改群属性"
                    aria-label="群设置"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                )}

                {/* 2. 群成员管理 (仅群聊可见) */}
                {activeTarget.type === 'group' && (
                  <button
                    type="button"
                    onClick={() =>
                      showGroupMembersModal
                        ? setShowGroupMembersModal(false)
                        : handleOpenGroupMembers(activeTarget.group)
                    }
                    className="h-8 w-8 rounded-lg bg-card/80 hover:bg-hover text-feature hover:text-feature flex items-center justify-center border border-subtle/60 transition-colors"
                    title={canManageActiveGroupMembers ? '群成员管理' : '查看群成员'}
                    aria-label={canManageActiveGroupMembers ? '群成员管理' : '查看群成员'}
                  >
                    <UserCheck className="w-4 h-4" />
                  </button>
                )}

                {/* 3. 聊天文件 (在清空会话前面) */}
                <button
                  type="button"
                  onClick={() => setShowChatFilesModal(true)}
                  className="h-8 w-8 rounded-lg bg-card/80 hover:bg-hover text-info hover:text-info flex items-center justify-center border border-subtle/60 transition-colors"
                  title="聊天文件"
                  aria-label="查看当前对话历史文件"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                {/* 4. 清空当前会话 */}
                <button
                  type="button"
                  onClick={handleClearCurrentChat}
                  disabled={isClearingChat}
                  className="chat-btn-clear h-8 w-8 rounded-lg bg-rose-500/10 hover:bg-rose-600/20 text-danger hover:text-danger flex items-center justify-center border border-rose-500/20 transition-colors disabled:cursor-wait disabled:opacity-60"
                  title={isClearingChat ? '正在清空...' : '清空当前会话'}
                  aria-label="清空当前会话"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {searchOpen && (
              <div className="flex-shrink-0 border-b border-edge bg-canvas/80 p-2.5 space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-sub" />
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="搜索当前对话正文或文件名..."
                    className="w-full rounded-lg border border-subtle bg-surface py-1.5 pl-9 pr-3 text-xs text-main outline-none focus:border-accent"
                  />
                </div>
                {normalizedSearchQuery && (
                  <div className="max-h-36 overflow-y-auto space-y-1">
                    {(isTauri() ? serverSearchResults.length === 0 : filteredMessages.length === 0) ? (
                      <div className="px-2 py-2 text-[11px] text-quiet">没有匹配的聊天记录</div>
                    ) : (isTauri() ? serverSearchResults : filteredMessages.slice().reverse().slice(0, 20)).map((message) => (
                      <button
                        type="button"
                        key={message.id}
                        onClick={() => void handleSearchResultClick(message)}
                        className="w-full rounded-md border border-edge bg-surface/60 px-2 py-1.5 text-left hover:bg-hover"
                      >
                        <div className="flex items-center justify-between gap-2 text-[10px] text-quiet">
                          <span className="truncate">{message.senderName}</span>
                          <span className="flex-shrink-0 font-mono">{formatMessageDisplayTime(message.timestamp, message.id)}</span>
                        </div>
                        <div className="truncate text-xs text-main">{message.fileName || message.content}</div>
                      </button>
                    ))}
                    {isTauri() && serverSearchTotal > serverSearchResults.length && (
                      <div className="px-2 py-1 text-[10px] text-quiet">显示前 {serverSearchResults.length} 条，共 {serverSearchTotal} 条</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Top Pinned Announcement Banner */}
            {activeTarget.type === 'group' &&
              pinnedAnnouncement &&
              !dismissedBannerGroupIds.has(activeTarget.group.id) && (
                <div className="flex-shrink-0">
                  <GroupAnnouncementBanner
                    pinnedAnnouncement={pinnedAnnouncement}
                    totalAnnouncementsCount={announcements.length}
                    onOpenAnnouncementsModal={handleOpenAnnouncementsModal}
                    onDismiss={() => {
                      setDismissedBannerGroupIds((prev) => new Set([...prev, activeTarget.group.id]));
                    }}
                  />
                </div>
              )}

            {/* Group Members Popover */}
            {showGroupMembersModal && activeTarget.type === 'group' && (
              <div className="lan-chat-submodal absolute top-12 right-4 z-30 w-[min(30rem,calc(100%-2rem))] space-y-2.5 rounded-xl border border-subtle bg-surface p-3 shadow-popover animate-in fade-in duration-100">
                <div className="flex items-start justify-between border-b border-edge pb-2">
                  <div>
                    <span className="flex items-center gap-1.5 text-xs font-bold text-main">
                      <span>群组成员 ({canManageActiveGroupMembers ? managedMemberIds.length : activeTarget.group.memberIds.length})</span>
                      {activeTarget.group.createdBy === currentUser.id ? (
                        <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-warning"><Crown className="h-3 w-3" /> 群主</span>
                      ) : isGroupCreatorOrAdmin(activeTarget.group, currentUser.id) ? (
                        <span className="flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[9px] text-info"><Shield className="h-3 w-3" /> 管理员</span>
                      ) : null}
                    </span>
                    <p className="mt-0.5 text-[10px] text-quiet">
                      {canManageActiveGroupMembers ? '搜索或按状态筛选后批量管理成员' : '当前群组成员列表'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowGroupMembersModal(false)}
                    className="rounded p-1 text-sub hover:bg-hover hover:text-main"
                    aria-label="关闭群成员设置"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="relative">
                  {canManageActiveGroupMembers && (
                    <div className="mb-2 flex rounded-lg border border-edge bg-canvas p-0.5" role="tablist" aria-label="成员来源">
                      {([
                        ['people', '人员'],
                        ['org', '本地组织'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="tab"
                          aria-selected={memberSource === value}
                          onClick={() => setMemberSource(value)}
                          className={`flex-1 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${memberSource === value ? 'bg-accent text-on-accent' : 'text-sub hover:bg-hover hover:text-main'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-sub" />
                  <input
                    value={memberSearchQuery}
                    onChange={(event) => setMemberSearchQuery(event.target.value)}
                    placeholder={memberSource === 'org' ? '搜索本地组织' : '搜索姓名、账号、IP 或设备名'}
                    className="w-full rounded-lg border border-subtle bg-canvas py-2 pl-8 pr-3 text-xs text-main outline-none transition-colors placeholder-quiet focus:border-accent"
                    aria-label="搜索群成员"
                  />
                  </div>
                </div>
                {canManageActiveGroupMembers && memberSource === 'org' && (
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-edge bg-canvas/50 p-1.5">
                    {localDirectory.units.length === 0 ? (
                      <div className="px-2 py-3 text-center text-[10px] text-quiet">请先在局域网节点面板配置本地组织</div>
                    ) : localDirectory.units.filter((unit) => !normalizedMemberSearchQuery || unit.name.toLocaleLowerCase().includes(normalizedMemberSearchQuery)).map((unit) => {
                      const orgMemberIds = Array.from(localOrgUnitMemberIds(unit.id));
                      const availableIds = orgMemberIds.filter((id) => activeGroupCandidateUsers.some((user) => user.id === id));
                      const included = availableIds.length > 0 && availableIds.every((id) => managedMemberIds.includes(id));
                      return (
                        <button key={unit.id} type="button" onClick={() => toggleLocalOrgUnit(unit.id)} className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors ${included ? 'border-accent/30 bg-accent/10 text-accent' : 'border-transparent text-sub hover:border-edge hover:bg-hover'}`}>
                          <span className="flex min-w-0 items-center gap-1.5"><FolderKanban className="h-3.5 w-3.5" /><span className="truncate">{unit.name}</span></span>
                          <span className="text-[10px] text-quiet">{availableIds.length} 人</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className={`${memberSource === 'org' ? 'hidden' : ''} flex flex-wrap items-center gap-1.5`}>
                  {canManageActiveGroupMembers && (
                    <div className="flex rounded-lg border border-edge bg-canvas p-0.5" role="tablist" aria-label="成员范围">
                      {([
                        ['all', '全部'],
                        ['included', '已加入'],
                        ['excluded', '未加入'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="tab"
                          aria-selected={memberScope === value}
                          onClick={() => setMemberScope(value)}
                          className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${memberScope === value ? 'bg-accent text-on-accent' : 'text-sub hover:bg-hover hover:text-main'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <select
                    value={memberPresence}
                    onChange={(event) => setMemberPresence(event.target.value as typeof memberPresence)}
                    className="rounded-lg border border-edge bg-canvas px-2 py-1.5 text-[10px] text-sub outline-none focus:border-accent"
                    aria-label="在线状态"
                  >
                    <option value="all">全部状态</option>
                    <option value="online">仅在线</option>
                    <option value="offline">仅离线</option>
                  </select>
                  <span className="ml-auto text-[10px] text-quiet">显示 {visibleGroupMembers.length} / {activeGroupCandidateUsers.length}</span>
                </div>
                {canManageActiveGroupMembers && (
                  <div className={`${memberSource === 'org' ? 'hidden' : ''} flex items-center justify-between rounded-lg border border-edge bg-canvas/50 px-2 py-1.5`}>
                    <span className="text-[10px] text-sub">已选择 {managedMemberIds.length} 人</span>
                    <button
                      type="button"
                      onClick={toggleVisibleGroupMembers}
                      disabled={editableVisibleGroupMemberIds.length === 0}
                      className="text-[10px] font-semibold text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {areAllVisibleMembersSelected ? '取消选择当前结果' : '选择当前结果'}
                    </button>
                  </div>
                )}
                <div className={`${memberSource === 'org' ? 'hidden' : ''} max-h-80 overflow-y-auto space-y-1.5 pr-1`}>
                  {visibleGroupMembers.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-edge bg-canvas/40 px-3 py-6 text-center text-[11px] text-quiet">未找到匹配的局域网成员</div>
                  ) : visibleGroupMembers.map((member) => {
                    const isCreator = activeTarget.group.createdBy === member.id;
                    const isAdmin = !isCreator && (activeTarget.group.adminIds || []).includes(member.id);
                    const isMember = managedMemberIds.includes(member.id);
                    const canEdit = canManageActiveGroupMembers && !isCreator && member.id !== currentUser.id;
                    const isImageAvatar = member.avatar && (member.avatar.startsWith('data:image') || member.avatar.startsWith('http'));
                    const avatar = isImageAvatar
                      ? <img src={member.avatar} alt={member.nickname} className="h-full w-full object-cover" />
                      : member.avatar || member.nickname.charAt(0);
                    if (!canManageActiveGroupMembers) {
                      return (
                        <div key={member.id} className="flex w-full items-center justify-between rounded-lg border border-edge bg-canvas/60 p-2 text-xs select-none">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-subtle bg-card text-sm">
                              {avatar}<span className={`absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full border border-edge ${member.isOnline ? 'bg-emerald-400' : 'bg-muted'}`} />
                            </span>
                            <span className="min-w-0 truncate font-medium text-main">{member.nickname}{member.id === currentUser.id && <span className="ml-1 text-[10px] text-feature font-normal">(我)</span>}</span>
                          </span>
                          {isCreator ? <span className="flex flex-shrink-0 items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-warning"><Crown className="h-3 w-3" /> 群主</span> : isAdmin ? <span className="flex flex-shrink-0 items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[9px] text-info"><Shield className="h-3 w-3" /> 管理员</span> : <span className="flex-shrink-0 text-[9px] text-quiet">成员</span>}
                        </div>
                      );
                    }
                    return (
                      <button
                        key={member.id}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => canEdit && handleToggleManagedMember(activeTarget.group, member.id)}
                        className={`flex w-full items-center justify-between rounded-lg border p-2 text-left text-xs transition-colors ${isMember ? 'border-accent/30 bg-accent/10' : 'border-edge bg-canvas/60'} ${canEdit ? 'cursor-pointer hover:border-accent/60' : 'cursor-default'}`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <ThemeCheckbox checked={isMember} onChange={() => canEdit && handleToggleManagedMember(activeTarget.group, member.id)} disabled={!canEdit} size="sm" ariaLabel={`成员：${member.nickname}`} />
                          <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-subtle bg-card text-sm">
                            {avatar}<span className={`absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full border border-edge ${member.isOnline ? 'bg-emerald-400' : 'bg-muted'}`} />
                          </span>
                          <span className="min-w-0 truncate font-medium text-main">{member.nickname}{member.id === currentUser.id && <span className="ml-1 text-[10px] text-accent font-normal">(我)</span>}</span>
                        </span>
                        {isCreator ? <span className="flex flex-shrink-0 items-center gap-1 text-[9px] text-warning"><Crown className="h-3 w-3" /> 群主</span> : isAdmin ? <span className="flex flex-shrink-0 items-center gap-1 text-[9px] text-info"><Shield className="h-3 w-3" /> 管理员</span> : <span className="flex-shrink-0 text-[9px] text-quiet">{isMember ? '已加入' : '未加入'}</span>}
                      </button>
                    );
                  })}
                </div>
                {memberManagementError && (
                  <p className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10px] text-danger">{memberManagementError}</p>
                )}
                {canManageActiveGroupMembers ? (
                  <div className="flex justify-end gap-2 border-t border-edge pt-2">
                    <button type="button" onClick={() => setShowGroupMembersModal(false)} className="ui-cancel-button rounded-lg px-3 py-1.5 text-[11px]">取消</button>
                    <button type="button" disabled={isSavingMembers} onClick={() => handleSaveGroupMembers(activeTarget.group)} className="theme-btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50">
                      {isSavingMembers && <Loader2 className="h-3.5 w-3.5 animate-spin" />}保存成员
                    </button>
                  </div>
                ) : (
                  <div className="flex justify-end border-t border-edge pt-2">
                    <button type="button" onClick={() => setShowGroupMembersModal(false)} className="ui-cancel-button rounded-lg px-3 py-1.5 text-[11px]">关闭</button>
                  </div>
                )}
              </div>
            )}
            {/* Chat Stream List */}
            <div ref={messagesContainerRef} className="relative flex-1 min-h-0 p-4 overflow-y-auto space-y-3">
              {activeUnreadIds.size > 0 && (
                <button
                  type="button"
                  onClick={handleJumpToUnread}
                  className="sticky bottom-2 left-full z-10 ml-auto flex items-center gap-1.5 rounded-full border border-blue-400/50 bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-on-solid shadow-lg transition hover:bg-blue-500"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  {activeUnreadIds.size > 99 ? '99+' : activeUnreadIds.size} 条新消息
                </button>
              )}
              {renderedMessages.length === 0 ? (
                <div className="text-center py-16 text-quiet text-xs">
                  <Bot className="w-8 h-8 text-quiet mx-auto mb-2" />
                  <p>暂无通信消息或记录已被清空</p>
                  <p className="text-[10px] text-quiet mt-1">
                    在下方发送局域网消息、文件或图片，内容将自动保存在本地
                  </p>
                </div>
              ) : (
                renderedMessages.map((msg) => {
                  const isSelf = msg.senderId === currentUser.id;
                  const isImgAvatar =
                    msg.senderAvatar &&
                    (msg.senderAvatar.startsWith('data:image') ||
                      msg.senderAvatar.startsWith('http'));

                  return (
                    <div
                      key={msg.id}
                      ref={(element) => {
                        messageElementRefs.current[msg.id] = element;
                      }}
                      data-chat-message-id={msg.id}
                      onContextMenu={(e) => handleMessageContextMenu(e, msg)}
                      className={`flex items-start gap-2.5 group relative transition-shadow ${
                        highlightedMessageId === msg.id ? 'rounded-xl ring-2 ring-blue-400/80 ring-offset-2 ring-offset-canvas' : ''
                      } ${
                        isSelf ? 'flex-row-reverse' : 'flex-row'
                      }`}
                    >
                      {/* Avatar */}
                      <div
                        className="w-7 h-7 rounded-xl flex items-center justify-center text-xs overflow-hidden flex-shrink-0 mt-0.5 border shadow-soft font-bold"
                        style={{
                          backgroundColor: isSelf ? 'var(--accent-subtle)' : 'var(--bg-hover)',
                          borderColor: isSelf ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border-subtle)',
                          color: isSelf ? 'var(--accent)' : 'var(--text-main)',
                        }}
                      >
                        {isImgAvatar ? (
                          <img
                            src={msg.senderAvatar}
                            alt={msg.senderName}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          msg.senderAvatar || msg.senderName.charAt(0)
                        )}
                      </div>

                      {/* Content Bubble */}
                      <div
                        className={`max-w-[75%] space-y-1 flex flex-col ${
                          isSelf ? 'items-end' : 'items-start'
                        }`}
                      >
                        <div
                          className={`flex items-center space-x-2 text-[10px] text-sub ${
                            isSelf ? 'flex-row-reverse space-x-reverse' : ''
                          }`}
                        >
                          <span className="font-semibold" style={{ color: isSelf ? 'var(--accent)' : 'var(--text-main)' }}>
                            {msg.senderName}
                          </span>
                          <span className="font-mono text-quiet">{formatMessageDisplayTime(msg.timestamp, msg.id)}</span>
                        </div>

                        {/* Render Text */}
                        {msg.type === 'text' && (
                          <div
                            className={`chat-bubble px-4 py-2.5 rounded-2xl text-xs leading-relaxed inline-block break-words max-w-full text-left ${
                              isSelf
                                ? 'chat-bubble-self rounded-br-xs'
                                : 'chat-bubble-other rounded-bl-xs'
                            }`}
                          >
                            {/* Quoted Message Preview inside text bubble */}
                            {msg.replyTo && (
                              <div
                                className={`mb-2 rounded-lg border-l-2 p-1.5 px-2.5 text-left text-xs ${
                                  isSelf ? 'chat-quote-self' : 'chat-quote-other'
                                }`}
                              >
                                <div
                                  className={`text-[10px] font-semibold mb-0.5 flex items-center gap-1 ${
                                    isSelf ? 'chat-quote-author-self' : 'chat-quote-author-other'
                                  }`}
                                >
                                  <Reply className="w-3 h-3 flex-shrink-0" />
                                  <span>@{msg.replyTo.senderName}</span>
                                </div>
                                <div className="truncate text-[11px] opacity-90">
                                  {msg.replyTo.type === 'file' ? `[文件] ${msg.replyTo.content}` : msg.replyTo.content}
                                </div>
                              </div>
                            )}

                            <div>{msg.content}</div>
                          </div>
                        )}

                        {/* Render Image */}
                        {msg.type === 'image' && (
                          <div className="chat-media-card p-2 rounded-xl inline-block max-w-sm text-left">
                            {msg.replyTo && (
                              <div
                                className={`mb-2 rounded-lg border-l-2 p-1.5 px-2.5 text-left text-xs ${
                                  isSelf ? 'chat-quote-self' : 'chat-quote-other'
                                }`}
                              >
                                <div
                                  className={`text-[10px] font-semibold mb-0.5 flex items-center gap-1 ${
                                    isSelf ? 'chat-quote-author-self' : 'chat-quote-author-other'
                                  }`}
                                >
                                  <Reply className="w-3 h-3 flex-shrink-0" />
                                  <span>@{msg.replyTo.senderName}</span>
                                </div>
                                <div className="truncate text-[11px] opacity-90">
                                  {msg.replyTo.type === 'file' ? `[文件] ${msg.replyTo.content}` : msg.replyTo.content}
                                </div>
                              </div>
                            )}
                            {msg.fileUrl ? (
                              <button
                                type="button"
                                className="group relative block overflow-hidden rounded-lg transition-transform hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-blue-400"
                                onClick={() =>
                                  setPreviewImage({
                                    url: msg.fileUrl!,
                                    name: msg.fileName || msg.content || '聊天图片',
                                  })
                                }
                                title="预览图片"
                              >
                                <img
                                  src={msg.fileUrl}
                                  alt={msg.fileName || '聊天图片'}
                                  className="max-h-52 w-auto object-contain transition-opacity group-hover:opacity-90"
                                />
                                <span className="absolute inset-0 flex items-center justify-center bg-canvas/0 text-main opacity-0 transition-all group-hover:bg-hover/30 group-hover:opacity-100">
                                  <ZoomIn className="h-5 w-5" />
                                </span>
                              </button>
                            ) : (
                              <div className="text-xs text-sub p-2">图片文件：{msg.content}</div>
                            )}
                            <div className="chat-media-meta mt-1 flex items-center justify-between text-[10px] text-sub">
                              <span className="truncate max-w-[150px]">{msg.fileName}</span>
                              <span className="font-mono">{msg.fileSize}</span>
                            </div>
                          </div>
                        )}

                        {/* Render File */}
                        {msg.type === 'file' && (
                          <div className="chat-media-card p-3 rounded-xl inline-flex flex-col space-y-2 max-w-sm text-left">
                            {msg.replyTo && (
                              <div
                                className={`rounded-lg border-l-2 p-1.5 px-2.5 text-left text-xs ${
                                  isSelf ? 'chat-quote-self' : 'chat-quote-other'
                                }`}
                              >
                                <div
                                  className={`text-[10px] font-semibold mb-0.5 flex items-center gap-1 ${
                                    isSelf ? 'chat-quote-author-self' : 'chat-quote-author-other'
                                  }`}
                                >
                                  <Reply className="w-3 h-3 flex-shrink-0" />
                                  <span>@{msg.replyTo.senderName}</span>
                                </div>
                                <div className="truncate text-[11px] opacity-90">
                                  {msg.replyTo.type === 'file' ? `[文件] ${msg.replyTo.content}` : msg.replyTo.content}
                                </div>
                              </div>
                            )}
                            <div className="flex items-center space-x-3">
                              <div className="p-2.5 bg-accent/15 text-accent rounded-lg flex-shrink-0">
                                <FileText className="w-5 h-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="chat-file-title text-xs font-bold truncate">
                                  {msg.fileName || msg.content}
                                </div>
                                <div className="chat-file-size text-[10px] text-sub font-mono mt-0.5">
                                  {msg.fileSize || '传输文件'}
                                </div>
                              </div>
                              {msg.fileUrl && msg.fileUrl !== '#' && (
                                <button
                                  type="button"
                                  onClick={() => handleDownloadFile(msg)}
                                  className="theme-btn-primary p-1.5 rounded-lg transition-colors flex-shrink-0"
                                  title="下载局域网文件"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Read status indicator for outgoing messages */}
                        {isSelf && (
                          <div className="flex items-center justify-end space-x-1 text-[10px] select-none mt-0.5">
                            {activeTarget.type === 'user' ? (
                              Array.isArray(msg.readBy) && msg.readBy.includes(activeTarget.user.id) ? (
                                <span className="text-success font-medium" title="对方已读">
                                  已读
                                </span>
                              ) : (
                                <span className="text-quiet" title="对方未读">
                                  未读
                                </span>
                              )
                            ) : activeTarget.type === 'group' ? (
                              (() => {
                                const memberIds = Array.isArray(activeTarget.group.memberIds)
                                  ? activeTarget.group.memberIds.filter((id) => id !== currentUser.id)
                                  : [];
                                const readCount = (msg.readBy || []).filter(
                                  (id) => id !== currentUser.id && memberIds.includes(id),
                                ).length;
                                const unreadCount = Math.max(0, memberIds.length - readCount);
                                const allRead = unreadCount === 0 && memberIds.length > 0;

                                return (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedReceiptAnnouncement(null);
                                      setSelectedReceiptMessage(msg);
                                      setShowReadReceiptsModal(true);
                                    }}
                                    className={`hover:underline cursor-pointer font-medium transition-colors ${
                                      allRead ? 'text-success' : 'text-warning'
                                    }`}
                                    title="点击查看群成员已读详情"
                                  >
                                    {allRead ? '全部已读' : `${unreadCount}人未读`}
                                  </button>
                                );
                              })()
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar Section */}
            <div className="lan-chat-input-bar flex-shrink-0 bg-canvas/90 border-t border-edge flex flex-col relative">
              {/* Quoted Message Strip - Top Docked Header */}
              {quotedMessage && (
                <div
                  className="chat-quoted-bar flex items-center justify-between px-3.5 py-1.5 text-xs border-b border-edge/80 transition-all flex-shrink-0"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-main)',
                  }}
                >
                  <div className="flex items-center space-x-2 truncate min-w-0">
                    <span className="text-info font-semibold flex items-center gap-1 flex-shrink-0 text-xs">
                      <Reply className="w-3.5 h-3.5" />
                      回复 @{quotedMessage.senderName}:
                    </span>
                    <span className="truncate text-xs opacity-80" style={{ color: 'var(--text-sub)' }}>
                      {quotedMessage.type === 'file'
                        ? `[文件] ${quotedMessage.fileName || quotedMessage.content}`
                        : quotedMessage.content}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuotedMessage(null)}
                    className="p-1 text-sub hover:text-main rounded-md hover:bg-hover/60 flex-shrink-0 ml-2 transition-colors"
                    title="取消引用"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="p-3 space-y-2">
                {/* Modern Dismissable Emoji Picker */}
                <EmojiPicker
                  isOpen={showEmojiPicker}
                  onClose={() => setShowEmojiPicker(false)}
                  onSelect={(emoji) => {
                    setInputText((prev) => prev + emoji);
                  }}
                  triggerRef={emojiButtonRef}
                />

                {/* Action Tools Row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <button
                      ref={emojiButtonRef}
                      type="button"
                      onClick={() => setShowEmojiPicker((prev) => !prev)}
                      disabled={isActiveProjectGroupReadOnly}
                      className={`chat-tool-btn p-1.5 rounded-lg transition-all text-xs flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40 ${
                        showEmojiPicker
                          ? 'bg-amber-500/20 text-warning border border-amber-500/40 shadow-soft'
                          : 'hover:bg-hover text-sub hover:text-warning border border-transparent'
                      }`}
                      title={showEmojiPicker ? '关闭表情 (Esc)' : '插入表情'}
                    >
                      <Smile className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={isActiveProjectGroupReadOnly}
                      className="chat-tool-btn p-1.5 hover:bg-hover text-sub hover:text-feature rounded-lg transition-colors text-xs flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40"
                      title="发送图片"
                    >
                      <ImageIcon className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => (isTauri() ? handleDesktopFileUpload() : fileInputRef.current?.click())}
                      disabled={isActiveProjectGroupReadOnly}
                      className="chat-tool-btn p-1.5 hover:bg-hover text-sub hover:text-info rounded-lg transition-colors text-xs flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40"
                      title="传输文件"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>

                    {/* Hidden File Inputs */}
                    <input
                      type="file"
                      ref={imageInputRef}
                      onChange={handleImageUpload}
                      accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.avif,image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif"
                      className="hidden"
                    />
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>

                  <div className="text-[10px] text-quiet font-mono">
                    {isActiveProjectGroupReadOnly ? '历史消息保留，已停止接收新消息' : '按 Enter 键发送 · Shift + Enter 换行'}
                  </div>
                </div>

                {sendError && (
                  <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[10px] text-danger">
                    {sendError}
                  </p>
                )}

                {/* Input Text Field & Send */}
                <div className="flex items-end space-x-2">
                  <textarea
                    ref={messageInputRef}
                    rows={2}
                    value={inputText}
                    disabled={isActiveProjectGroupReadOnly}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder={
                      isActiveProjectGroupReadOnly
                        ? '已退出该项目，仅可查看历史消息'
                        : activeTarget.type === 'group'
                        ? `在《${activeTarget.group.name}》发言... (Shift + Enter 换行)`
                        : activeTarget.type === 'user'
                        ? `给 ${activeTarget.user.nickname} 发送局域网即时消息... (Shift + Enter 换行)`
                        : '发送局域网全员广播消息... (Shift + Enter 换行)'
                    }
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-main)',
                      borderWidth: '1px',
                      borderStyle: 'solid',
                    }}
                    className="flex-1 rounded-xl px-3.5 py-2.5 text-xs placeholder-quiet focus:outline-none focus:border-accent/50 resize-none min-h-[64px] disabled:cursor-not-allowed disabled:opacity-60 shadow-inner"
                  />

                  <button
                    type="button"
                    onClick={() => handleSendMessage()}
                    disabled={!inputText.trim() || isActiveProjectGroupReadOnly}
                    className="theme-btn-primary h-[64px] font-bold px-5 rounded-xl text-xs flex items-center justify-center space-x-1.5 shadow-panel flex-shrink-0 disabled:opacity-40"
                  >
                    <Send className="w-4 h-4" />
                    <span>发送</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Create Group Modal Overlay */}
        {isCreateGroupOpen && (
          <div className="absolute inset-0 bg-canvas/85 backdrop-blur-md z-40 flex items-center justify-center p-6">
            <form
              onSubmit={handleCreateGroupSubmit}
              className="lan-chat-submodal bg-surface border border-subtle rounded-2xl max-w-md w-full p-5 space-y-4 shadow-popover animate-in zoom-in-95 duration-150"
            >
              <div className="flex items-center justify-between border-b border-edge pb-3">
                <div className="flex items-center space-x-2">
                  <div className="p-2 bg-accent/15 text-accent rounded-xl">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-main">创建项目与局域网协同群组</h3>
                    <p className="text-[11px] text-sub">建立专属项目群组并挑选局域网协同成员</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateGroupOpen(false)}
                  className="p-1 text-sub hover:text-main rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Group Name & Icon Picker */}
              <div className="space-y-3">
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
                    <Users className="h-3.5 w-3.5 text-info" />
                    <span>群组名称 <span className="text-danger">*</span></span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="例如: 前端与 AI 专项攻坚组"
                    className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-xs text-main placeholder-quiet focus:outline-none focus:border-accent/50"
                  />
                </div>

                {/* Project Association Dropdown */}
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
                    <FolderKanban className="h-3.5 w-3.5 text-accent" />
                    <span>关联项目组（可选）</span>
                  </label>
                  <ThemeSelect
                    ariaLabel="选择群组关联项目"
                    value={selectedProjectId}
                    options={projectSelectOptions}
                    onChange={handleGroupProjectChange}
                  />
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
                    <Smile className="h-3.5 w-3.5 text-warning" />
                    <span>选择群组徽标</span>
                  </label>
                  <div className="flex items-center space-x-2 overflow-x-auto pb-1">
                    {GROUP_ICONS.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        onClick={() => setNewGroupAvatar(icon)}
                        className={`w-8 h-8 rounded-lg text-sm flex items-center justify-center border transition-all ${
                          newGroupAvatar === icon
                            ? 'bg-accent/20 border-accent text-accent scale-105'
                            : 'bg-canvas border-edge text-sub hover:border-subtle'
                        }`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
                    <FileText className="h-3.5 w-3.5 text-sub" />
                    <span>群组宗旨 / 简介</span>
                  </label>
                  <input
                    type="text"
                    value={newGroupDesc}
                    onChange={(e) => setNewGroupDesc(e.target.value)}
                    placeholder="例如: 用于分享架构设计图与后端性能优化报告"
                    className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-xs text-main placeholder-quiet focus:outline-none focus:border-accent/50"
                  />
                </div>

                {/* Member Selection List */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-sub">
                      <Users className="h-3.5 w-3.5 text-success" />
                      <span>选择初始群成员 ({selectedMemberIds.length} 人)</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleSelectAllMembers}
                      className="btn-select-all text-[10px] text-accent hover:underline font-semibold"
                    >
                      {selectableGroupUsers.every((user) => selectedMemberIds.includes(user.id))
                        ? '反选'
                        : '全选'}
                    </button>
                  </div>

                  <div className="relative mb-1.5">
                    <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-sub" />
                    <input
                      value={createMemberSearchQuery}
                      onChange={(event) => setCreateMemberSearchQuery(event.target.value)}
                      placeholder="搜索要加入的人员"
                      className="w-full rounded-lg border border-subtle bg-canvas py-1.5 pl-8 pr-3 text-xs text-main outline-none placeholder-quiet focus:border-accent"
                      aria-label="搜索初始群成员"
                    />
                  </div>

                  <div className="mb-1.5 flex rounded-lg border border-edge bg-canvas p-0.5" role="tablist" aria-label="初始成员来源">
                    <button type="button" role="tab" aria-selected={createMemberSource === 'people'} onClick={() => setCreateMemberSource('people')} className={`flex-1 rounded-md px-2 py-1 text-[10px] font-semibold ${createMemberSource === 'people' ? 'bg-accent text-on-accent' : 'text-sub hover:bg-hover'}`}>人员</button>
                    <button type="button" role="tab" aria-selected={createMemberSource === 'org'} onClick={() => setCreateMemberSource('org')} className={`flex-1 rounded-md px-2 py-1 text-[10px] font-semibold ${createMemberSource === 'org' ? 'bg-accent text-on-accent' : 'text-sub hover:bg-hover'}`}>本地组织</button>
                  </div>

                  {createMemberSource === 'org' && (
                    <div className="mb-1.5 max-h-24 space-y-1 overflow-y-auto rounded-lg border border-edge bg-canvas/50 p-1.5">
                      {localDirectory.units.length === 0 ? <div className="px-2 py-2 text-center text-[10px] text-quiet">暂无本地组织</div> : localDirectory.units.filter((unit) => !normalizedCreateMemberSearchQuery || unit.name.toLocaleLowerCase().includes(normalizedCreateMemberSearchQuery)).map((unit) => {
                        const orgMemberIds = Array.from(localOrgUnitMemberIds(unit.id)).filter((id) => selectableGroupUsers.some((user) => user.id === id));
                        const included = orgMemberIds.length > 0 && orgMemberIds.every((id) => selectedMemberIds.includes(id));
                        return <button key={unit.id} type="button" onClick={() => handleToggleCreateLocalOrgUnit(unit.id)} className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-[10px] ${included ? 'border-accent/30 bg-accent/10 text-accent' : 'border-transparent text-sub hover:border-edge hover:bg-hover'}`}><span className="truncate">{unit.name}</span><span className="text-[9px] text-quiet">{orgMemberIds.length} 人</span></button>;
                      })}
                    </div>
                  )}

                  <div className="member-list-box max-h-32 overflow-y-auto space-y-1 bg-canvas/80 border border-edge rounded-xl p-2">
                    {createMemberSource === 'people' && visibleSelectableGroupUsers.map((u) => {
                      const isChecked = selectedMemberIds.includes(u.id);
                      const isSelf = u.id === currentUser.id;

                      return (
                        <div
                          key={u.id}
                          onClick={() => handleToggleMember(u.id)}
                          className="member-item flex items-center justify-between p-1.5 rounded hover:bg-hover/80 cursor-pointer text-xs"
                        >
                          <div className="flex items-center space-x-2">
                            <ThemeCheckbox
                              checked={isChecked}
                              onChange={() => handleToggleMember(u.id)}
                              size="sm"
                              ariaLabel={`选择成员：${u.nickname}`}
                            />
                            <span className="member-item-title text-main font-medium">{u.nickname}</span>
                            {isSelf && (
                              <span className="member-item-owner text-[9px] bg-blue-500/20 text-info px-1 rounded">
                                我 (群主)
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-quiet font-mono">{u.ip}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Form Action Buttons */}
              {createGroupError && (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-danger">
                  {createGroupError}
                </p>
              )}
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-edge">
                <button
                  type="button"
                  onClick={() => setIsCreateGroupOpen(false)}
                  className="ui-cancel-button px-4 py-2 rounded-xl text-xs"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!newGroupName.trim() || isCreatingGroup}
                  className="btn-confirm-group theme-btn-primary disabled:opacity-40 font-bold px-4 py-2 rounded-xl text-xs transition-all shadow-soft"
                >
                  {isCreatingGroup ? '正在创建...' : '确认创建群组'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Chat Files Modal */}
        <ChatFilesModal
          isOpen={showChatFilesModal}
          onClose={() => setShowChatFilesModal(false)}
          messages={conversationMessages}
          onDownloadFile={handleDownloadFile}
          onPreviewImage={(url) => setPreviewImage({ url, name: '图片预览' })}
        />

        {/* Edit Group Modal */}
        {activeTarget.type === 'group' && (
          <EditGroupModal
            isOpen={showEditGroupModal}
            onClose={() => setShowEditGroupModal(false)}
            group={activeTarget.group}
            projects={projects}
            users={users}
            currentUser={currentUser}
            onGroupUpdated={handleGroupUpdated}
            onGroupTransferred={handleGroupTransferred}
            onGroupDeleted={handleGroupDeleted}
          />
        )}

        {/* Group Announcement Modal */}
        {activeTarget.type === 'group' && (
          <GroupAnnouncementModal
            isOpen={showAnnouncementModal}
            onClose={() => {
              setShowAnnouncementModal(false);
              setSelectedReceiptAnnouncement(null);
            }}
            group={activeTarget.group}
            currentUserId={currentUser.id}
            currentUserDisplayName={currentUser.nickname || currentUser.username}
            groupMembers={
              (users || []).filter(
                (u) =>
                  Array.isArray(activeTarget.group.memberIds) &&
                  activeTarget.group.memberIds.includes(u.id),
              )
            }
            announcements={announcements}
            canManage={canManageActiveGroupAnnouncements}
            onSaveAnnouncement={handleSaveAnnouncement}
            onDeleteAnnouncement={handleDeleteAnnouncement}
            onPinAnnouncement={handlePinAnnouncement}
            onViewReadReceipts={(ann) => {
              setSelectedReceiptMessage(null);
              setSelectedReceiptAnnouncement(ann);
              setShowReadReceiptsModal(true);
            }}
          />
        )}

        {/* Forward Message Modal */}
        <ForwardMessageModal
          isOpen={showForwardModal}
          onClose={() => setShowForwardModal(false)}
          message={forwardingMessage}
          users={users || []}
          groups={visibleGroups}
          currentUserId={currentUser.id}
          onForward={handleForwardMessage}
        />

        {/* Read Receipts Modal - Rendered on top of GroupAnnouncementModal and ForwardMessageModal with z-[70] */}
        <ReadReceiptsModal
          isOpen={showReadReceiptsModal}
          onClose={() => {
            setShowReadReceiptsModal(false);
            setSelectedReceiptMessage(null);
            setSelectedReceiptAnnouncement(null);
          }}
          message={selectedReceiptMessage}
          targetTitle={
            selectedReceiptAnnouncement
              ? `群公告已读详情: ${selectedReceiptAnnouncement.title}`
              : undefined
          }
          targetContent={selectedReceiptAnnouncement?.content}
          readBy={selectedReceiptAnnouncement ? selectedReceiptAnnouncement.readBy : undefined}
          authorId={selectedReceiptAnnouncement ? selectedReceiptAnnouncement.authorId : undefined}
          groupMembers={
            activeTarget.type === 'group'
              ? (users || []).filter(
                  (u) =>
                    Array.isArray(activeTarget.group.memberIds) &&
                    activeTarget.group.memberIds.includes(u.id),
                )
              : users || []
          }
          currentUserId={currentUser.id}
        />

        {/* Context Menu Popup */}
        {contextMenu && (
          <div
            className="chat-context-menu fixed z-[100] min-w-[130px] rounded-xl border p-1 shadow-popover backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 select-none"
            style={{
              top: contextMenu.y,
              left: contextMenu.x,
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-main)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => handleCopyMessage(contextMenu.message)}
              className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-hover transition-colors"
              style={{ color: 'var(--text-main)' }}
            >
              <Copy className="h-3.5 w-3.5 text-sub" />
              <span>复制</span>
            </button>
            <button
              type="button"
              onClick={() => handleQuoteMessage(contextMenu.message)}
              className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-hover transition-colors"
              style={{ color: 'var(--text-main)' }}
            >
              <Reply className="h-3.5 w-3.5 text-info" />
              <span>引用</span>
            </button>
            <button
              type="button"
              onClick={() => handleOpenForwardModal(contextMenu.message)}
              className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-hover transition-colors"
              style={{ color: 'var(--text-main)' }}
            >
              <Forward className="h-3.5 w-3.5 text-feature" />
              <span>转发</span>
            </button>
            <button
              type="button"
              onClick={() => handleCreateTaskFromMessage(contextMenu.message)}
              className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-hover transition-colors"
              style={{ color: 'var(--text-main)' }}
            >
              <CalendarPlus className="h-3.5 w-3.5 text-success" />
              <span>日程</span>
            </button>
            <div
              className="my-1 border-t"
              style={{ borderColor: 'var(--border-subtle)' }}
            />
            <button
              type="button"
              onClick={() => handleDeleteMessage(contextMenu.message)}
              className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs text-danger hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5 text-danger" />
              <span>删除</span>
            </button>
          </div>
        )}
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-overlay p-6 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="聊天图片预览"
        >
          <div
            className="relative flex max-h-full max-w-full flex-col items-center"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute -right-3 -top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-subtle bg-surface text-main shadow-popover transition-colors hover:bg-hover hover:text-main"
              title="关闭预览"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={previewImage.url}
              alt={previewImage.name}
              className="max-h-[calc(100vh-7rem)] max-w-[calc(100vw-5rem)] rounded-lg object-contain shadow-popover"
            />
            <div className="mt-3 max-w-[min(80vw,720px)] truncate rounded-md bg-surface/90 px-3 py-1.5 text-xs text-main">
              {previewImage.name}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
