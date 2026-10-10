import { currentLocale } from '../i18n/core';
import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
import { TaskReferenceText } from './TaskReferenceText';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { EmojiPicker } from './EmojiPicker';
import { ThemeCheckbox } from './ThemeCheckbox';
import { ChatFilesModal } from './ChatFilesModal';
import { EditGroupModal } from './EditGroupModal';
import { GroupActionModal, GroupAction } from './GroupActionModal';
import { CreateGroupModal } from './CreateGroupModal';
import { GroupedMemberSelector, SelectableGroup } from './GroupedMemberSelector';
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
  canTransferOrDeleteGroup,
} from '../utils/groupPermissions';
import {
  X,
  Maximize2,
  Minimize2,
  Send,
  Image as ImageIcon,
  Paperclip,
  Scissors,
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
  MoreHorizontal,
  Eraser,
  ArrowRightLeft,
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

interface PastedImage {
  id: string;
  dataUrl: string;
  fileName: string;
  sizeBytes: number;
}

const STORAGE_KEY_MESSAGES = 'lan_chat_messages_v2';
const STORAGE_KEY_GROUPS = 'lan_chat_groups_v2';
const CHAT_PAGE_SIZE = 30;
const INITIAL_CHAT_LIMIT = CHAT_PAGE_SIZE * 3;

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
  useLocale();
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
  const [showGroupMoreMenu, setShowGroupMoreMenu] = useState(false);
  const [groupAction, setGroupAction] = useState<GroupAction | null>(null);
  const groupMoreRef = useRef<HTMLDivElement>(null);
  const groupMoreButtonRef = useRef<HTMLButtonElement>(null);
  const activeConversationKey = conversationKeyForTarget(activeTarget);
  const [showScreenshotMenu, setShowScreenshotMenu] = useState(false);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const sendingMessageRef = useRef(false);
  const pasteRequestRef = useRef(0);
  const screenshotMenuRef = useRef<HTMLDivElement>(null);
  const screenshotMenuButtonRef = useRef<HTMLButtonElement>(null);
  const screenshotRequestRef = useRef(0);
  const screenshotInFlightRef = useRef(false);

  useEffect(() => {
    setShowScreenshotMenu(false);
    setPastedImages([]);
    pasteRequestRef.current += 1;
    screenshotRequestRef.current += 1;
    if (screenshotInFlightRef.current) void ApiService.cancelChatScreenshot().catch(console.error);
  }, [isOpen, activeConversationKey]);

  useEffect(() => () => {
    pasteRequestRef.current += 1;
    screenshotRequestRef.current += 1;
    if (screenshotInFlightRef.current) void ApiService.cancelChatScreenshot().catch(console.error);
  }, []);

  useEffect(() => {
    if (!showScreenshotMenu) return;
    screenshotMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!screenshotMenuRef.current?.contains(event.target as Node)) setShowScreenshotMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowScreenshotMenu(false);
        screenshotMenuButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [showScreenshotMenu]);

  useEffect(() => {
    setShowGroupMoreMenu(false);
    setGroupAction(null);
  }, [isOpen, activeConversationKey]);

  useEffect(() => {
    if (!showGroupMoreMenu) return;
    groupMoreRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const handleOutsideClick = (event: PointerEvent) => {
      if (!groupMoreRef.current?.contains(event.target as Node)) setShowGroupMoreMenu(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowGroupMoreMenu(false);
        groupMoreButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showGroupMoreMenu]);

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

  // Window and modal states
  const [isMaximized, setIsMaximized] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);

  const accessibleProjects = (projects || []).filter(
    (project) =>
      project &&
      (project.createdBy === currentUser.id ||
        (Array.isArray(project.admins) && project.admins.includes(currentUser.id)) ||
        (Array.isArray(project.members) && project.members.includes(currentUser.id))),
  );

  const localOrgUnitMemberIds = (orgUnitId: string) => {
    const safeDirectory = localDirectory || { units: [], members: [] };
    const unitIds = new Set([orgUnitId]);
    let changed = true;
    while (changed) {
      changed = false;
      safeDirectory.units.forEach((unit) => {
        if (unit.parentId && unitIds.has(unit.parentId) && !unitIds.has(unit.id)) {
          unitIds.add(unit.id);
          changed = true;
        }
      });
    }
    return new Set(
      safeDirectory.members
        .filter((member) => unitIds.has(member.orgUnitId))
        .map((member) => member.userId),
    );
  };

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
        name: tr("chat:lanChatModal.aiAndArchitectureTeam"),
        description: tr("chat:lanChatModal.collaborateOnModelTuningAndEmbeddedInference"),
        avatar: '🚀',
        memberIds: users.map((u) => u.id),
        adminIds: ['user-01'],
        createdBy: 'user-01',
        createdAt: '10:00',
      },
      {
        id: 'group-2',
        name: tr("chat:lanChatModal.projectDeliveryTeam"),
        description: tr("chat:lanChatModal.coordinateMilestonesAndRequirements"),
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
      name: tr("chat:lanChatModal.project", { value0: p.name }),
      description: p.description || tr("chat:lanChatModal.discussionAndFileSharingFor", { value0: p.name }),
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
      senderName: tr("chat:lanChatModal.liBackendEngineer"),
      senderAvatar: '👨‍💻',
      type: 'text',
      content: tr("chat:lanChatModal.theLanPeersAreConnectedYouCan"),
      timestamp: '10:15',
    },
    {
      id: 'msg-2',
      senderId: 'user-03',
      senderName: tr("chat:lanChatModal.wangProjectManager"),
      senderAvatar: '👩‍💼',
      type: 'text',
      content: tr("chat:lanChatModal.pleaseShareTheLatestAiArchitectureReport"),
      timestamp: '10:18',
    },
    {
      id: 'msg-3',
      senderId: 'user-02',
      senderName: tr("chat:lanChatModal.liBackendEngineer"),
      senderAvatar: '👨‍💻',
      type: 'file',
      content: tr("chat:lanChatModal.backendArchitectureV2Pdf"),
      fileName: tr("chat:lanChatModal.backendArchitectureV2Pdf"),
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
              name: tr("chat:lanChatModal.project", { value0: p.name }),
              description: p.description || tr("chat:lanChatModal.discussionAndFileSharingFor", { value0: p.name }),
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
  const [loadingHistory, setLoadingHistory] = useState(false);
  const hasMoreHistoryRef = useRef(false);
  const historyCursorRef = useRef<string | undefined>();
  const historyConversationKeyRef = useRef('');
  const loadingHistoryRef = useRef(false);
  const historyRequestRef = useRef(0);

  const conversationQuery = (target: ActiveTargetType) => ({
    conversationType: target.type,
    targetId: target.type === 'broadcast' ? undefined : target.type === 'user' ? target.user.id : target.group.id,
  });

  const loadConversationHistory = useCallback(async (target: ActiveTargetType, reset: boolean) => {
    if (!isTauri() || (!reset && loadingHistoryRef.current)) return;
    const key = conversationKeyForTarget(target);
    const requestId = reset ? ++historyRequestRef.current : historyRequestRef.current;
    if (reset) {
      historyConversationKeyRef.current = key;
      historyCursorRef.current = undefined;
      hasMoreHistoryRef.current = false;
      setMessages([]);
    } else if (historyConversationKeyRef.current !== key || !hasMoreHistoryRef.current) {
      return;
    }
    loadingHistoryRef.current = true;
    setLoadingHistory(true);
    try {
      const page = await ApiService.getChatMessagePage({
        currentUserId: currentUser.id,
        ...conversationQuery(target),
        cursor: historyCursorRef.current,
        limit: reset ? INITIAL_CHAT_LIMIT : CHAT_PAGE_SIZE,
      });
      if (historyRequestRef.current !== requestId || historyConversationKeyRef.current !== key) return;
      historyCursorRef.current = page.nextCursor;
      hasMoreHistoryRef.current = page.hasMore;
      setMessages((previous) => deduplicateMessages([...page.messages, ...previous]));
    } catch (error) {
      console.error('Failed to load paged chat history', error);
    } finally {
      if (historyRequestRef.current === requestId) {
        loadingHistoryRef.current = false;
        setLoadingHistory(false);
      }
    }
  }, [currentUser.id]);

  const loadOlderHistory = useCallback(async () => {
    const container = messagesContainerRef.current;
    if (!container || loadingHistoryRef.current || !hasMoreHistoryRef.current) return;
    const conversationKey = conversationKeyForTarget(activeTarget);
    const previousHeight = container.scrollHeight;
    await loadConversationHistory(activeTarget, false);
    if (historyConversationKeyRef.current !== conversationKey) return;
    window.requestAnimationFrame(() => {
      const current = messagesContainerRef.current;
      if (current && historyConversationKeyRef.current === conversationKey) {
        current.scrollTop += current.scrollHeight - previousHeight;
      }
    });
  }, [activeTarget, loadConversationHistory]);

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
        const savedGroups = await ApiService.getChatGroups();
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
      void loadConversationHistory(activeTargetRef.current, true);
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
  }, [isOpen, currentUser.id, loadConversationHistory]);

  useEffect(() => {
    if (!isOpen || !isTauri()) return;
    void loadConversationHistory(activeTarget, true);
  }, [activeTarget, isOpen, loadConversationHistory]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !isOpen || !isTauri()) return;
    const onScroll = () => {
      if (container.scrollTop <= 80) void loadOlderHistory();
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [isOpen, loadOlderHistory]);

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
      window.alert(tr("chat:lanChatModal.onlyGroupCreatorsAndAdministratorsCanCreate"));
      return;
    }
    setIsCreateGroupOpen(true);
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
        timestamp: new Date().toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => appendUniqueMessage(prev, localMsg));
    }
  };

  const handleCreateTaskFromMessage = (msg: LanChatMessage) => {
    const taskTitle = msg.type === 'file' ? tr("chat:lanChatModal.processingFile", { value0: msg.fileName || msg.content }) : msg.content;
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

  const handleSendTextMessage = async (overrideContent?: string) => {
    const textToSend = overrideContent || inputText.trim();
    if (!textToSend) return true;
    if (isActiveProjectGroupReadOnly) {
      setSendError(tr("chat:lanChatModal.youAreNoLongerAMemberOf"));
      return false;
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
      setSendError(error instanceof Error ? error.message : tr("chat:lanChatModal.couldNotSendMessage"));
      return false;
    }
    setMessages((prev) => appendUniqueMessage(prev, savedMessage));
    if (!overrideContent && conversationKeyForTarget(activeTargetRef.current) === activeConversationKey) {
      setInputText((current) => current === inputText ? '' : current);
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
          content: tr("chat:lanChatModal.nodeP2pMessageReceivedAndSavedLocally", { value0: respondent.nickname }),
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
            content: tr("chat:lanChatModal.memberGroupMessageReceivedAndSavedLocally", { value0: respondent.nickname }),
            timestamp: new Date().toISOString(),
            readBy: [respondent.id],
          };
          setMessages((prev) => appendUniqueMessage(prev, autoReply));
        }, 1500);
      }
    }
    return true;
  };

  const handleSendMessage = async (overrideContent?: string) => {
    if (sendingMessageRef.current || isActiveProjectGroupReadOnly) return;
    const imagesToSend = overrideContent ? [] : pastedImages;
    if (!(overrideContent || inputText.trim()) && imagesToSend.length === 0) return;
    const replyTo = quotedMessage ? {
      id: quotedMessage.id,
      senderName: quotedMessage.senderName,
      content: quotedMessage.type === 'file' ? quotedMessage.fileName || quotedMessage.content : quotedMessage.content,
      type: quotedMessage.type,
    } : undefined;
    sendingMessageRef.current = true;
    setIsSendingMessage(true);
    setSendError(null);
    try {
      if (!await handleSendTextMessage(overrideContent)) return;
      for (const image of imagesToSend) {
        const message: LanChatMessage = {
          id: `msg-${crypto.randomUUID()}`,
          senderId: currentUser.id,
          senderName: currentUser.nickname,
          senderAvatar: currentUser.avatar,
          type: 'image',
          content: image.fileName,
          fileName: image.fileName,
          fileUrl: image.dataUrl,
          fileSize: formatFileSize(image.sizeBytes),
          timestamp: new Date().toISOString(),
          readBy: [currentUser.id],
          replyTo,
        };
        if (activeTarget.type === 'group') message.groupId = activeTarget.group.id;
        if (activeTarget.type === 'user') message.receiverId = activeTarget.user.id;
        const saved = isTauri() ? await ApiService.sendChatMessage(message) : message;
        setMessages((previous) => appendUniqueMessage(previous, saved));
        setPastedImages((previous) => previous.filter((item) => item.id !== image.id));
      }
      if (!overrideContent && conversationKeyForTarget(activeTargetRef.current) === activeConversationKey) {
        setQuotedMessage(null);
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : tr('chat:lanChatModal.couldNotSendMessage'));
    } finally {
      sendingMessageRef.current = false;
      setIsSendingMessage(false);
    }
  };

  const handlePasteImage = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (isActiveProjectGroupReadOnly) return;
    const files = Array.from<DataTransferItem>(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile()).filter((file): file is File => !!file);
    if (files.length === 0) return;
    event.preventDefault();
    const request = pasteRequestRef.current;
    void Promise.all(files.map((file) => new Promise<PastedImage>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(tr('chat:screenshot.pasteFailed')));
      reader.onload = () => resolve({
        id: crypto.randomUUID(),
        dataUrl: reader.result as string,
        fileName: file.name || `Screenshot-${Date.now()}.png`,
        sizeBytes: file.size,
      });
      reader.readAsDataURL(file);
    }))).then((images) => {
      if (request === pasteRequestRef.current) setPastedImages((previous) => [...previous, ...images]);
    }).catch(() => {
      if (request === pasteRequestRef.current) setSendError(tr('chat:screenshot.pasteFailed'));
    });
  };

  const handleScreenshot = async (hideWindow = false) => {
    if (screenshotInFlightRef.current || isActiveProjectGroupReadOnly) return;
    screenshotInFlightRef.current = true;
    const request = ++screenshotRequestRef.current;
    setIsCapturingScreenshot(true);
    setShowScreenshotMenu(false);
    setShowEmojiPicker(false);
    setSendError(null);
    try {
      await ApiService.captureChatScreenshot(hideWindow);
      if (request === screenshotRequestRef.current) messageInputRef.current?.focus();
    } catch (error) {
      console.error('Failed to capture screenshot', error);
      if (request === screenshotRequestRef.current) {
        setSendError(error instanceof Error && error.message === tr('chat:screenshot.desktopRequired')
          ? error.message : tr('chat:screenshot.failed'));
      }
    } finally {
      screenshotInFlightRef.current = false;
      setIsCapturingScreenshot(false);
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
      window.alert(tr("chat:lanChatModal.chooseAPngJpgGifWebpBmp"));
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
      const selected = await open({ multiple: false, directory: false, title: tr("chat:lanChatModal.chooseAFileToSend") });
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
    const destination = await save({ defaultPath: message.fileName || tr("chat:lanChatModal.lanmindFiles") });
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
  const canTransferOrDeleteActiveGroup =
    activeTarget.type === 'group' &&
    canTransferOrDeleteGroup({
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

  const manageOrgSelectableGroups: SelectableGroup[] = localDirectory.units.map((unit) => {
    const directMemberIds = localDirectory.members
      .filter((m) => m.orgUnitId === unit.id)
      .map((m) => m.userId)
      .filter((id) => activeGroupCandidateUsers.some((u) => u.id === id));
    return {
      id: unit.id,
      name: unit.name,
      parentId: unit.parentId || null,
      icon: <FolderKanban className="w-3.5 h-3.5 text-accent shrink-0" />,
      memberUserIds: directMemberIds,
    };
  });

  const activeGroupCreatorId = activeTarget.type === 'group' ? activeTarget.group?.createdBy : undefined;

  const toggleLocalOrgUnit = (orgUnitId: string) => {
    if (!canManageActiveGroupMembers) return;
    const orgMemberIds = Array.from(localOrgUnitMemberIds(orgUnitId));
    const candidateIds = new Set(activeGroupCandidateUsers.map((user) => user.id));
    const allowedIds = orgMemberIds.filter((id) => candidateIds.has(id) && id !== activeGroupCreatorId && id !== currentUser.id);
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
    .filter((user) => user.id !== activeGroupCreatorId && user.id !== currentUser.id)
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
      content: tr("chat:lanChatModal.updatedTheGroup", { value0: currentUser.nickname, value1: updatedGroup.name }),
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
      content: tr("chat:lanChatModal.transferredGroupOwnershipTo", { value0: currentUser.nickname, value1: targetName }),
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
    <div className={`fixed inset-0 bg-overlay backdrop-blur-md z-50 flex items-center justify-center transition-all ${
      isMaximized ? 'p-0 sm:p-2' : 'p-4'
    }`}>
      <div className={`lan-chat-modal bg-surface border border-edge flex flex-col shadow-popover overflow-hidden animate-in fade-in zoom-in-95 duration-150 relative transition-all ${
        isMaximized
          ? 'w-full h-full max-w-none max-h-none rounded-none sm:rounded-2xl'
          : 'max-w-4xl w-full h-[680px] max-h-[calc(100vh-2rem)] rounded-2xl'
      }`}>
        {/* Top Header Bar */}
        <div
          onDoubleClick={() => setIsMaximized((prev) => !prev)}
          className="lan-chat-header flex-shrink-0 px-5 py-3.5 bg-canvas border-b border-edge flex items-center justify-between select-none cursor-default"
        >
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-success">
              <Wifi className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-extrabold text-main">{tr("chat:lanChatModal.lanChat")}</h2>
                <span className="chat-badge-storage text-[10px] bg-emerald-500/20 text-success font-mono px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                  <HardDrive className="w-3 h-3 text-success" />
                  {tr("chat:lanChatModal.storedLocally")}</span>
              </div>
              <p className="text-xs text-sub mt-0.5">
                {tr("chat:lanChatModal.groupChatDirectMessagesFilesAndImages")}</p>
            </div>
          </div>

          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={() => setIsMaximized((prev) => !prev)}
              className="p-1.5 hover:bg-hover text-sub hover:text-main rounded-lg transition-colors"
              title={isMaximized ? tr("chat:lanChatModal.restoreDown") : tr("chat:lanChatModal.maximizeChat")}
              aria-label={isMaximized ? tr("chat:lanChatModal.restoreDown") : tr("chat:lanChatModal.maximizeChat")}
            >
              {isMaximized ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 hover:bg-hover text-sub hover:text-main rounded-lg transition-colors"
              title={tr("chat:lanChatModal.close")}
              aria-label={tr("chat:lanChatModal.close")}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
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
                <span>{tr("chat:lanChatModal.lanLobby")}</span>
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
                    <div className="channel-title truncate font-medium">{tr("chat:lanChatModal.broadcastChannel")}</div>
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
                  <span>{tr("chat:lanChatModal.collaborationGroups", { value0: visibleGroups.length })}</span>
                </span>
                {canUserCreateGroup && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenCreateGroup();
                    }}
                    className="chat-btn-create-group flex h-6 w-6 shrink-0 items-center justify-center bg-accent/15 hover:bg-accent text-accent hover:text-on-accent rounded-lg transition-colors border border-accent/30"
                    title={tr("chat:lanChatModal.createGroup")}
                    aria-label={tr("chat:lanChatModal.createGroup")}
                  >
                    <Plus className="w-3 h-3" aria-hidden="true" />
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
                                title={tr("chat:lanChatModal.associatedProject", { value0: linkedProj.name })}
                              >
                                <FolderKanban className="w-2.5 h-2.5 shrink-0 text-accent" />
                                <span className="truncate">{linkedProj.name}</span>
                              </span>
                            )}
                            <span className="shrink-0 text-quiet font-mono">{tr("chat:lanChatModal.members", { value0: group.memberIds.length })}</span>
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
                <span>{tr("chat:lanChatModal.directContacts", { value0: users.filter((u) => u.id !== currentUser.id).length })}</span>
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
                      {activeTarget.type === 'broadcast' && tr("chat:lanChatModal.broadcastChannel2")}
                      {activeTarget.type === 'user' &&
                        `${activeTarget.user.nickname} (${activeTarget.user.ip})`}
                      {activeTarget.type === 'group' && activeTarget.group.name}
                    </strong>
                    {activeTarget.type === 'group' && (
                      <span className="chat-badge-member-count text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded border border-accent/30 flex-shrink-0 font-medium">{tr("chat:lanChatModal.groupOf", { value0: activeTarget.group.memberIds.length })}</span>
                    )}
                    {activeTarget.type === 'group' && (() => {
                      const activeProj = projects.find((p) => p.id === activeTarget.group.projectId);
                      return activeProj ? (
                        <span
                          className="chat-badge-project text-[10px] bg-info/15 text-info px-1.5 py-0.5 rounded border border-info/30 flex items-center gap-1 max-w-[150px] truncate font-medium flex-shrink-0"
                          title={tr("chat:lanChatModal.project2", { value0: activeProj.name })}
                        >
                          <FolderKanban className="w-3 h-3 shrink-0" />
                          <span className="truncate">{activeProj.name}</span>
                        </span>
                      ) : null;
                    })()}
                    {isActiveProjectGroupReadOnly && (
                      <span className="flex flex-shrink-0 items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-warning">
                        <LockKeyhole className="h-3 w-3" aria-hidden="true" />
                        {tr("chat:lanChatModal.leftProjectReadOnlyHistory")}</span>
                    )}
                  </div>
                  {activeTarget.type === 'group' && activeTarget.group.description && (
                    <div className="text-[10px] text-sub truncate max-w-md mt-0.5">
                      {activeTarget.group.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Conversation tools and group actions */}
              <div className="flex items-center space-x-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setSearchOpen((current) => !current)}
                  className={`h-8 w-8 rounded-lg border flex items-center justify-center transition-colors ${searchOpen ? 'bg-blue-600 text-on-solid border-blue-500' : 'bg-transparent hover:bg-hover text-info border-transparent hover:border-subtle/50'}`}
                  title={tr("chat:lanChatModal.searchMessagesAndFilenamesInThisConversation")}
                  aria-label={tr("chat:lanChatModal.searchMessagesAndFilenamesInThisConversation")}
                >
                  <Search className="w-4 h-4" />
                </button>
                {/* 0. 群公告 (仅群聊可见) */}
                {activeTarget.type === 'group' && (
                  <button
                    type="button"
                    onClick={handleOpenAnnouncementsModal}
                    className="relative h-8 w-8 rounded-lg bg-transparent hover:bg-hover text-warning hover:text-warning flex items-center justify-center border border-transparent hover:border-subtle/50 transition-colors"
                    title={tr("chat:lanChatModal.groupAnnouncements")}
                    aria-label={tr("chat:lanChatModal.viewAndManageAnnouncements")}
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

                {/* 2. 群成员管理 (仅群聊可见) */}
                {activeTarget.type === 'group' && (
                  <button
                    type="button"
                    onClick={() =>
                      showGroupMembersModal
                        ? setShowGroupMembersModal(false)
                        : handleOpenGroupMembers(activeTarget.group)
                    }
                    className="h-8 w-8 rounded-lg bg-transparent hover:bg-hover text-feature hover:text-feature flex items-center justify-center border border-transparent hover:border-subtle/50 transition-colors"
                    title={canManageActiveGroupMembers ? tr("chat:lanChatModal.manageGroupMembers") : tr("chat:lanChatModal.viewGroupMembers")}
                    aria-label={canManageActiveGroupMembers ? tr("chat:lanChatModal.manageGroupMembers") : tr("chat:lanChatModal.viewGroupMembers")}
                  >
                    <UserCheck className="w-4 h-4" />
                  </button>
                )}

                {/* 聊天文件 */}
                <button
                  type="button"
                  onClick={() => setShowChatFilesModal(true)}
                  className="h-8 w-8 rounded-lg bg-transparent hover:bg-hover text-info hover:text-info flex items-center justify-center border border-transparent hover:border-subtle/50 transition-colors"
                  title={tr("chat:lanChatModal.chatFiles")}
                  aria-label={tr("chat:lanChatModal.viewConversationFiles")}
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                {activeTarget.type === 'group' && canManageActiveGroupMembers && (
                  <button
                    type="button"
                    onClick={() => setShowEditGroupModal(true)}
                    className="h-8 w-8 rounded-lg bg-transparent hover:bg-hover text-sub hover:text-main flex items-center justify-center border border-transparent hover:border-subtle/50 transition-colors"
                    title={tr("chat:lanChatModal.editGroupProperties")}
                    aria-label={tr("chat:lanChatModal.groupSettings")}
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                )}

                {activeTarget.type === 'group' ? (
                  <div ref={groupMoreRef} className="relative">
                    <button
                      ref={groupMoreButtonRef}
                      type="button"
                      onClick={() => setShowGroupMoreMenu((current) => !current)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          setShowGroupMoreMenu(true);
                        }
                      }}
                      className={`h-8 w-8 rounded-lg border flex items-center justify-center transition-colors ${showGroupMoreMenu ? 'bg-hover text-main border-subtle' : 'bg-transparent hover:bg-hover text-sub hover:text-main border-transparent hover:border-subtle/50'}`}
                      title={tr("chat:lanChatModal.more")}
                      aria-label={tr("chat:lanChatModal.moreGroupActions")}
                      aria-haspopup="menu"
                      aria-expanded={showGroupMoreMenu}
                      aria-controls={showGroupMoreMenu ? 'group-more-menu' : undefined}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    {showGroupMoreMenu && (
                      <div
                        id="group-more-menu"
                        role="menu"
                        aria-label={tr("chat:lanChatModal.groupActions")}
                        className="absolute right-0 top-10 z-40 min-w-44 rounded-xl border border-edge bg-surface/95 backdrop-blur-md p-1.5 shadow-popover animate-in fade-in zoom-in-95 duration-100 select-none"
                        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                          const items = Array.from<HTMLButtonElement>(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
                          const index = items.indexOf(document.activeElement as HTMLButtonElement);
                          let nextIndex: number;
                          if (event.key === 'ArrowDown') nextIndex = (index + 1) % items.length;
                          else if (event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
                          else if (event.key === 'Home') nextIndex = 0;
                          else if (event.key === 'End') nextIndex = items.length - 1;
                          else if (event.key === 'Tab') { setShowGroupMoreMenu(false); return; }
                          else return;
                          event.preventDefault();
                          items[nextIndex]?.focus();
                        }}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          disabled={isClearingChat}
                          onClick={() => {
                            setShowGroupMoreMenu(false);
                            groupMoreButtonRef.current?.focus();
                            void handleClearCurrentChat();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none disabled:cursor-wait disabled:opacity-60 transition-colors"
                        >
                          <Eraser className="h-4 w-4 text-sub" />
                          <span>{isClearingChat ? tr("chat:lanChatModal.clearing") : tr("chat:lanChatModal.clearChatHistory")}</span>
                        </button>
                        {canTransferOrDeleteActiveGroup && (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => { setShowGroupMoreMenu(false); setGroupAction('transfer'); }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                            >
                              <ArrowRightLeft className="h-4 w-4 text-warning" />
                              <span>{tr("chat:lanChatModal.transferGroup")}</span>
                            </button>
                            <div className="my-1 border-t border-edge" />
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => { setShowGroupMoreMenu(false); setGroupAction('delete'); }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-danger bg-transparent hover:bg-rose-500/10 focus:bg-rose-500/10 focus:outline-none transition-colors"
                            >
                              <Trash2 className="h-4 w-4 text-danger" />
                              <span className="font-semibold text-danger">{tr("chat:lanChatModal.deleteGroup")}</span>
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleClearCurrentChat}
                    disabled={isClearingChat}
                    className="chat-btn-clear h-8 w-8 rounded-lg bg-rose-500/10 hover:bg-rose-600/20 text-danger hover:text-danger flex items-center justify-center border border-rose-500/20 transition-colors disabled:cursor-wait disabled:opacity-60"
                    title={isClearingChat ? tr("chat:lanChatModal.clearing") : tr("chat:lanChatModal.clearConversation")}
                    aria-label={tr("chat:lanChatModal.clearConversation")}
                  >
                    <Eraser className="w-4 h-4" />
                  </button>
                )}
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
                    placeholder={tr("chat:lanChatModal.searchMessagesOrFilenames")}
                    className="w-full rounded-lg border border-subtle bg-surface py-1.5 pl-9 pr-3 text-xs text-main outline-none focus:border-accent"
                  />
                </div>
                {normalizedSearchQuery && (
                  <div className="max-h-36 overflow-y-auto space-y-1">
                    {(isTauri() ? serverSearchResults.length === 0 : filteredMessages.length === 0) ? (
                      <div className="px-2 py-2 text-[11px] text-quiet">{tr("chat:lanChatModal.noMatchingMessages")}</div>
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
                      <div className="px-2 py-1 text-[10px] text-quiet">{tr("chat:lanChatModal.showingOf", { value0: serverSearchResults.length, value1: serverSearchTotal })}</div>
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
                      <span>{tr("chat:lanChatModal.groupMembers", { value0: canManageActiveGroupMembers ? managedMemberIds.length : activeTarget.group.memberIds.length })}</span>
                      {activeTarget.group.createdBy === currentUser.id ? (
                        <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-warning"><Crown className="h-3 w-3" /> {tr("chat:lanChatModal.owner")}</span>
                      ) : isGroupCreatorOrAdmin(activeTarget.group, currentUser.id) ? (
                        <span className="flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[9px] text-info"><Shield className="h-3 w-3" /> {tr("chat:lanChatModal.administrator")}</span>
                      ) : null}
                    </span>
                    <p className="mt-0.5 text-[10px] text-quiet">
                      {canManageActiveGroupMembers ? tr("chat:lanChatModal.searchAndFilterMembersForBulkChanges") : tr("chat:lanChatModal.groupMemberList")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowGroupMembersModal(false)}
                    className="rounded p-1 text-sub hover:bg-hover hover:text-main"
                    aria-label={tr("chat:lanChatModal.closeMemberSettings")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="relative">
                  {canManageActiveGroupMembers && (
                    <div className="mb-2 flex rounded-lg border border-edge bg-canvas p-0.5" role="tablist" aria-label={tr("chat:lanChatModal.memberSource")}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={memberSource === 'people'}
                        onClick={() => setMemberSource('people')}
                        className={`flex-1 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${memberSource === 'people' ? 'bg-accent text-on-accent' : 'text-sub hover:bg-hover hover:text-main'}`}
                      >
                        {tr("chat:lanChatModal.people")}</button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={memberSource === 'org'}
                        onClick={() => setMemberSource('org')}
                        className={`flex-1 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${memberSource === 'org' ? 'bg-accent text-on-accent' : 'text-sub hover:bg-hover hover:text-main'}`}
                      >{tr("chat:lanChatModal.localOrganizations", { value0: localDirectory.units.length })}</button>
                    </div>
                  )}
                  <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-sub" />
                  <input
                    value={memberSearchQuery}
                    onChange={(event) => setMemberSearchQuery(event.target.value)}
                    placeholder={
                      memberSource === 'org'
                        ? tr("chat:lanChatModal.searchLocalOrganizationsAndPeople")
                        : tr("chat:lanChatModal.searchNameAccountIpOrDevice")
                    }
                    className="w-full rounded-lg border border-subtle bg-canvas py-2 pl-8 pr-3 text-xs text-main outline-none transition-colors placeholder-quiet focus:border-accent"
                    aria-label={tr("chat:lanChatModal.searchGroupMembers")}
                  />
                  </div>
                </div>
                {canManageActiveGroupMembers && activeTarget.type === 'group' && memberSource === 'org' && (
                  <GroupedMemberSelector
                    groups={manageOrgSelectableGroups}
                    users={activeGroupCandidateUsers}
                    selectedUserIds={managedMemberIds}
                    disabledUserIds={[activeTarget.group?.createdBy || currentUser.id]}
                    onToggleUser={(userId) => {
                      if (activeTarget.type === 'group') {
                        handleToggleManagedMember(activeTarget.group, userId);
                      }
                    }}
                    onUpdateSelection={(newIds) => {
                      const groupCreator = (activeTarget.type === 'group' ? activeTarget.group?.createdBy : undefined) || currentUser.id;
                      const finalized = Array.from(new Set([groupCreator, ...newIds]));
                      setManagedMemberIds(finalized);
                    }}
                    searchQuery={memberSearchQuery}
                    emptyText={
                      localDirectory.units.length === 0
                        ? tr("chat:lanChatModal.configureLocalOrganizationsInTheLanNodes")
                        : tr("chat:lanChatModal.noMatchingLocalOrganizations")
                    }
                    maxHeightClass="max-h-72"
                    readOnly={!canManageActiveGroupMembers}
                    currentUserId={currentUser.id}
                    creatorId={activeTarget.group?.createdBy}
                    adminIds={activeTarget.group?.adminIds || []}
                  />
                )}
                <div className={`${memberSource !== 'people' ? 'hidden' : ''} flex flex-wrap items-center gap-1.5`}>
                  {canManageActiveGroupMembers && (
                    <div className="flex rounded-lg border border-edge bg-canvas p-0.5" role="tablist" aria-label={tr("chat:lanChatModal.membership")}>
                      {([
                        ['all', tr("chat:lanChatModal.all")],
                        ['included', tr("chat:lanChatModal.joined")],
                        ['excluded', tr("chat:lanChatModal.notJoined")],
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
                  <div className="w-24">
                    <ThemeSelect
                      ariaLabel={tr("chat:lanChatModal.onlineStatus")}
                      value={memberPresence}
                      onChange={(eventValue) => setMemberPresence(eventValue as typeof memberPresence)}
                      options={[
                        { value: 'all', label: tr("chat:lanChatModal.anyStatus"), tone: 'slate' },
                        { value: 'online', label: tr("chat:lanChatModal.onlineOnly"), tone: 'emerald' },
                        { value: 'offline', label: tr("chat:lanChatModal.offlineOnly"), tone: 'amber' },
                      ]}
                      width="100%"
                    />
                  </div>
                  <span className="ml-auto text-[10px] text-quiet">{tr("chat:lanChatModal.showing", { value0: visibleGroupMembers.length, value1: activeGroupCandidateUsers.length })}</span>
                </div>
                {canManageActiveGroupMembers && (
                  <div className={`${memberSource !== 'people' ? 'hidden' : ''} flex items-center justify-between rounded-lg border border-edge bg-canvas/50 px-2 py-1.5`}>
                    <span className="text-[10px] text-sub">{tr("chat:lanChatModal.selected", { value0: managedMemberIds.length })}</span>
                    <button
                      type="button"
                      onClick={toggleVisibleGroupMembers}
                      disabled={editableVisibleGroupMemberIds.length === 0}
                      className="text-[10px] font-semibold text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {areAllVisibleMembersSelected ? tr("chat:lanChatModal.deselectCurrentResults") : tr("chat:lanChatModal.selectCurrentResults")}
                    </button>
                  </div>
                )}
                <div className={`${memberSource !== 'people' ? 'hidden' : ''} max-h-80 overflow-y-auto space-y-1.5 pr-1`}>
                  {visibleGroupMembers.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-edge bg-canvas/40 px-3 py-6 text-center text-[11px] text-quiet">{tr("chat:lanChatModal.noMatchingLanMembers")}</div>
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
                            <span className="min-w-0 truncate font-medium text-main">{member.nickname}{member.id === currentUser.id && <span className="ml-1 text-[10px] text-feature font-normal">{tr("chat:lanChatModal.me")}</span>}</span>
                          </span>
                          {isCreator ? <span className="flex flex-shrink-0 items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-warning"><Crown className="h-3 w-3" /> {tr("chat:lanChatModal.owner")}</span> : isAdmin ? <span className="flex flex-shrink-0 items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[9px] text-info"><Shield className="h-3 w-3" /> {tr("chat:lanChatModal.administrator")}</span> : <span className="flex-shrink-0 text-[9px] text-quiet">{tr("chat:lanChatModal.member")}</span>}
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
                          <ThemeCheckbox checked={isMember} onChange={() => canEdit && handleToggleManagedMember(activeTarget.group, member.id)} disabled={!canEdit} size="sm" ariaLabel={tr("chat:lanChatModal.member2", { value0: member.nickname })} />
                          <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-subtle bg-card text-sm">
                            {avatar}<span className={`absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full border border-edge ${member.isOnline ? 'bg-emerald-400' : 'bg-muted'}`} />
                          </span>
                          <span className="min-w-0 truncate font-medium text-main">{member.nickname}{member.id === currentUser.id && <span className="ml-1 text-[10px] text-accent font-normal">{tr("chat:lanChatModal.me")}</span>}</span>
                        </span>
                        {isCreator ? <span className="flex flex-shrink-0 items-center gap-1 text-[9px] text-warning"><Crown className="h-3 w-3" /> {tr("chat:lanChatModal.owner")}</span> : isAdmin ? <span className="flex flex-shrink-0 items-center gap-1 text-[9px] text-info"><Shield className="h-3 w-3" /> {tr("chat:lanChatModal.administrator")}</span> : <span className="flex-shrink-0 text-[9px] text-quiet">{isMember ? tr("chat:lanChatModal.joined") : tr("chat:lanChatModal.notJoined")}</span>}
                      </button>
                    );
                  })}
                </div>
                {memberManagementError && (
                  <p className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10px] text-danger">{localizeMessage(memberManagementError)}</p>
                )}
                {canManageActiveGroupMembers ? (
                  <div className="flex justify-end gap-2 border-t border-edge pt-2">
                    <button type="button" onClick={() => setShowGroupMembersModal(false)} className="ui-cancel-button rounded-lg px-3 py-1.5 text-[11px]">{tr("chat:lanChatModal.cancel")}</button>
                    <button type="button" disabled={isSavingMembers} onClick={() => handleSaveGroupMembers(activeTarget.group)} className="theme-btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50">{isSavingMembers && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{tr("chat:lanChatModal.saveMembers")}</button>
                  </div>
                ) : (
                  <div className="flex justify-end border-t border-edge pt-2">
                    <button type="button" onClick={() => setShowGroupMembersModal(false)} className="ui-cancel-button rounded-lg px-3 py-1.5 text-[11px]">{tr("chat:lanChatModal.close")}</button>
                  </div>
                )}
              </div>
            )}
            {/* Chat Stream List */}
            <div ref={messagesContainerRef} className="relative flex-1 min-h-0 p-4 overflow-y-auto space-y-3">
              {loadingHistory && (
                <div className="sticky top-0 z-10 mx-auto w-fit rounded-full border border-edge bg-surface/95 px-3 py-1 text-[10px] text-sub shadow-soft">
                  {tr("chat:lanChatModal.loadingEarlierMessages")}</div>
              )}
              {activeUnreadIds.size > 0 && (
                <button
                  type="button"
                  onClick={handleJumpToUnread}
                  className="sticky bottom-2 left-full z-10 ml-auto flex items-center gap-1.5 rounded-full border border-blue-400/50 bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-on-solid shadow-lg transition hover:bg-blue-500"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  {activeUnreadIds.size > 99 ? '99+' : activeUnreadIds.size} {tr("chat:lanChatModal.newMessages")}</button>
              )}
              {renderedMessages.length === 0 ? (
                <div className="text-center py-16 text-quiet text-xs">
                  <Bot className="w-8 h-8 text-quiet mx-auto mb-2" />
                  <p>{tr("chat:lanChatModal.noMessagesYet")}</p>
                  <p className="text-[10px] text-quiet mt-1">
                    {tr("chat:lanChatModal.sendAMessageFileOrImageBelow")}</p>
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
                                  {msg.replyTo.type === 'file' ? tr("chat:lanChatModal.file", { value0: msg.replyTo.content }) : msg.replyTo.content}
                                </div>
                              </div>
                            )}

                            <div><TaskReferenceText value={msg.content} /></div>
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
                                  {msg.replyTo.type === 'file' ? tr("chat:lanChatModal.file", { value0: msg.replyTo.content }) : msg.replyTo.content}
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
                                    name: msg.fileName || msg.content || tr("chat:lanChatModal.chatImage"),
                                  })
                                }
                                title={tr("chat:lanChatModal.previewImage")}
                              >
                                <img
                                  src={msg.fileUrl}
                                  alt={msg.fileName || tr("chat:lanChatModal.chatImage")}
                                  className="max-h-52 w-auto object-contain transition-opacity group-hover:opacity-90"
                                />
                                <span className="absolute inset-0 flex items-center justify-center bg-canvas/0 text-main opacity-0 transition-all group-hover:bg-hover/30 group-hover:opacity-100">
                                  <ZoomIn className="h-5 w-5" />
                                </span>
                              </button>
                            ) : (
                              <div className="text-xs text-sub p-2">{tr("chat:lanChatModal.imageFile", { value0: msg.content })}</div>
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
                                  {msg.replyTo.type === 'file' ? tr("chat:lanChatModal.file", { value0: msg.replyTo.content }) : msg.replyTo.content}
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
                                  {msg.fileSize || tr("chat:lanChatModal.sendFile")}
                                </div>
                              </div>
                              {msg.fileUrl && msg.fileUrl !== '#' && (
                                <button
                                  type="button"
                                  onClick={() => handleDownloadFile(msg)}
                                  className="theme-btn-primary p-1.5 rounded-lg transition-colors flex-shrink-0"
                                  title={tr("chat:lanChatModal.downloadLanFile")}
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
                                <span className="text-success font-medium" title={tr("chat:lanChatModal.readByRecipient")}>
                                  {tr("chat:lanChatModal.read")}</span>
                              ) : (
                                <span className="text-quiet" title={tr("chat:lanChatModal.notReadByRecipient")}>
                                  {tr("chat:lanChatModal.unread")}</span>
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
                                    title={tr("chat:lanChatModal.viewGroupReadReceipts")}
                                  >
                                    {allRead ? tr("chat:lanChatModal.everyoneHasRead") : tr("chat:lanChatModal.unread2", { value0: unreadCount })}
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
                      {tr("chat:lanChatModal.reply")}{quotedMessage.senderName}:
                    </span>
                    <span className="truncate text-xs opacity-80" style={{ color: 'var(--text-sub)' }}>
                      {quotedMessage.type === 'file'
                        ? tr("chat:lanChatModal.file", { value0: quotedMessage.fileName || quotedMessage.content })
                        : quotedMessage.content}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuotedMessage(null)}
                    className="p-1 text-sub hover:text-main rounded-md hover:bg-hover/60 flex-shrink-0 ml-2 transition-colors"
                    title={tr("chat:lanChatModal.cancelReply")}
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
                      title={showEmojiPicker ? tr("chat:lanChatModal.closeEmojisEsc") : tr("chat:lanChatModal.insertEmoji")}
                    >
                      <Smile className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={isActiveProjectGroupReadOnly}
                      className="chat-tool-btn p-1.5 hover:bg-hover text-sub hover:text-feature rounded-lg transition-colors text-xs flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40"
                      title={tr("chat:lanChatModal.sendImage")}
                    >
                      <ImageIcon className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => (isTauri() ? handleDesktopFileUpload() : fileInputRef.current?.click())}
                      disabled={isActiveProjectGroupReadOnly}
                      className="chat-tool-btn p-1.5 hover:bg-hover text-sub hover:text-info rounded-lg transition-colors text-xs flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40"
                      title={tr("chat:lanChatModal.sendFile")}
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>

                    <div ref={screenshotMenuRef} role="group" aria-label={tr('chat:screenshot.capture')} className="chat-screenshot-tools relative inline-flex items-center rounded-lg border border-transparent hover:border-subtle hover:bg-hover">
                      <button
                        type="button"
                        onClick={() => void handleScreenshot()}
                        disabled={isActiveProjectGroupReadOnly || isCapturingScreenshot}
                        className="chat-tool-btn chat-screenshot-capture transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        title={tr('chat:screenshot.capture')}
                        aria-label={tr('chat:screenshot.capture')}
                        aria-busy={isCapturingScreenshot}
                      >
                        {isCapturingScreenshot ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                      </button>
                      <button
                        ref={screenshotMenuButtonRef}
                        type="button"
                        onClick={() => setShowScreenshotMenu((previous) => !previous)}
                        disabled={isActiveProjectGroupReadOnly || isCapturingScreenshot}
                        className="chat-tool-btn chat-screenshot-options transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        title={tr('chat:screenshot.options')}
                        aria-label={tr('chat:screenshot.options')}
                        aria-haspopup="menu"
                        aria-expanded={showScreenshotMenu}
                        aria-controls={showScreenshotMenu ? 'chat-screenshot-menu' : undefined}
                      >
                        <ChevronDown className="w-3 h-4" />
                      </button>
                      {showScreenshotMenu && (
                        <div id="chat-screenshot-menu" role="menu" aria-label={tr('chat:screenshot.options')} className="absolute bottom-full left-0 z-50 mb-2 min-w-max rounded-xl border border-edge bg-surface/95 backdrop-blur-md p-1.5 shadow-popover animate-in fade-in zoom-in-95 duration-100 select-none">
                          <button type="button" role="menuitem" onClick={() => void handleScreenshot(true)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors">
                            <Scissors className="w-3.5 h-3.5 text-sub" />{tr('chat:screenshot.hideWindow')}
                          </button>
                        </div>
                      )}
                    </div>

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
                    {isActiveProjectGroupReadOnly ? tr("chat:lanChatModal.historyIsKeptNewMessagesAreNo") : tr("chat:lanChatModal.enterToSendShiftEnterForA")}
                  </div>
                </div>

                {sendError && (
                  <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[10px] text-danger">
                    {localizeMessage(sendError)}
                  </p>
                )}

                {/* Input Text Field & Send */}
                {pastedImages.length > 0 && (
                  <div role="group" aria-label={tr('chat:screenshot.pastedImages')} className="flex gap-2 overflow-x-auto py-1">
                    {pastedImages.map((image) => (
                      <div key={image.id} className="relative shrink-0 rounded-lg border border-subtle bg-card p-1">
                        <img src={image.dataUrl} alt={image.fileName} className="h-16 max-w-32 rounded-md object-contain" />
                        <button type="button" onClick={() => setPastedImages((previous) => previous.filter((item) => item.id !== image.id))} disabled={isSendingMessage} aria-label={tr('chat:screenshot.removeImage')} title={tr('chat:screenshot.removeImage')} className="absolute -right-1 -top-1 rounded-full border border-subtle bg-surface p-0.5 text-sub hover:text-danger disabled:opacity-40"><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-end space-x-2">
                  <textarea
                    ref={messageInputRef}
                    rows={2}
                    value={inputText}
                    disabled={isActiveProjectGroupReadOnly}
                    onChange={(e) => setInputText(e.target.value)}
                    onPaste={handlePasteImage}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder={
                      isActiveProjectGroupReadOnly
                        ? tr("chat:lanChatModal.youHaveLeftThisProjectHistoryIs")
                        : activeTarget.type === 'group'
                        ? tr("chat:lanChatModal.messageShiftEnterForANewLine", { value0: activeTarget.group.name })
                        : activeTarget.type === 'user'
                        ? tr("chat:lanChatModal.messageShiftEnterForANewLine2", { value0: activeTarget.user.nickname })
                        : tr("chat:lanChatModal.broadcastToEveryoneShiftEnterForA")
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
                    disabled={(!inputText.trim() && pastedImages.length === 0) || isActiveProjectGroupReadOnly || isSendingMessage}
                    className="theme-btn-primary h-[64px] font-bold px-5 rounded-xl text-xs flex items-center justify-center space-x-1.5 shadow-panel flex-shrink-0 disabled:opacity-40"
                  >
                    {isSendingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    <span>{tr("chat:lanChatModal.send")}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Create Group Modal */}
        <CreateGroupModal
          isOpen={isCreateGroupOpen}
          onClose={() => setIsCreateGroupOpen(false)}
          currentUser={currentUser}
          users={users}
          projects={projects}
          localDirectory={localDirectory}
          canUserCreateGroup={canUserCreateGroup}
          onGroupCreated={(savedGroup, savedSystemMessage) => {
            setGroups((prev) => [savedGroup, ...prev]);
            setMessages((prev) => appendUniqueMessage(prev, savedSystemMessage));
            setActiveTarget({ type: 'group', group: savedGroup });
          }}
        />

        {/* Chat Files Modal */}
        <ChatFilesModal
          isOpen={showChatFilesModal}
          onClose={() => setShowChatFilesModal(false)}
          messages={conversationMessages}
          onDownloadFile={handleDownloadFile}
          onPreviewImage={(url) => setPreviewImage({ url, name: tr("chat:lanChatModal.imagePreview") })}
        />

        {/* Edit Group Modal */}
        {activeTarget.type === 'group' && (
          <EditGroupModal
            isOpen={showEditGroupModal}
            onClose={() => setShowEditGroupModal(false)}
            group={activeTarget.group}
            projects={projects}
            currentUser={currentUser}
            onGroupUpdated={handleGroupUpdated}
          />
        )}

        {activeTarget.type === 'group' && groupAction && (
          <GroupActionModal
            key={`${activeTarget.group.id}:${groupAction}`}
            action={groupAction}
            onClose={() => { setGroupAction(null); groupMoreButtonRef.current?.focus(); }}
            group={activeTarget.group}
            projects={projects}
            users={users}
            currentUser={currentUser}
            isProjectReadOnly={isActiveProjectGroupReadOnly}
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
              ? tr("chat:lanChatModal.announcementReadReceipts", { value0: selectedReceiptAnnouncement.title })
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
            role="menu"
            aria-label={tr("chat:lanChatModal.groupActions")}
            className="chat-context-menu fixed z-[100] min-w-[130px] rounded-xl border border-edge bg-surface/95 backdrop-blur-md p-1.5 shadow-popover animate-in fade-in zoom-in-95 duration-100 select-none"
            style={{
              top: contextMenu.y,
              left: contextMenu.x,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => handleCopyMessage(contextMenu.message)}
              className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-2 text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
            >
              <Copy className="h-3.5 w-3.5 text-sub" />
              <span>{tr("chat:lanChatModal.copy")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => handleQuoteMessage(contextMenu.message)}
              className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-2 text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
            >
              <Reply className="h-3.5 w-3.5 text-info" />
              <span>{tr("chat:lanChatModal.reply2")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => handleOpenForwardModal(contextMenu.message)}
              className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-2 text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
            >
              <Forward className="h-3.5 w-3.5 text-feature" />
              <span>{tr("chat:lanChatModal.forward")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => handleCreateTaskFromMessage(contextMenu.message)}
              className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-2 text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
            >
              <CalendarPlus className="h-3.5 w-3.5 text-success" />
              <span>{tr("chat:lanChatModal.schedule")}</span>
            </button>
            <div className="my-1 border-t border-edge" />
            <button
              type="button"
              role="menuitem"
              onClick={() => handleDeleteMessage(contextMenu.message)}
              className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-2 text-xs text-danger bg-transparent hover:bg-rose-500/10 focus:bg-rose-500/10 focus:outline-none transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5 text-danger" />
              <span className="font-semibold text-danger">{tr("chat:lanChatModal.delete")}</span>
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
          aria-label={tr("chat:lanChatModal.chatImagePreview")}
        >
          <div
            className="relative flex max-h-full max-w-full flex-col items-center"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute -right-3 -top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-subtle bg-surface text-main shadow-popover transition-colors hover:bg-hover hover:text-main"
              title={tr("chat:lanChatModal.closePreview")}
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
