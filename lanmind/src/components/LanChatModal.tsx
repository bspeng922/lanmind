import { scopedStorageKey, getWorkspaceContext } from "../utils/workspaceContext";
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
  LocalOrgUnit,
} from '../types';
import { ApiService } from '../services/api';
import { TaskReferenceText } from './TaskReferenceText';
import { ChatMessageText } from './ChatMessageText';
import { ChatMentionPicker } from './ChatMentionPicker';
import {
  extractMentionIds,
  isUserMentioned,
  detectMentionQuery,
  formatMentionInsertion,
} from '../utils/chatMentions';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { EmojiPicker } from './EmojiPicker';
import { ThemeCheckbox } from './ThemeCheckbox';
import { ChatFilesModal } from './ChatFilesModal';
import { SharedFilesModal } from './SharedFilesModal';
import { EditGroupModal } from './EditGroupModal';
import { GroupActionModal, GroupAction } from './GroupActionModal';
import { CreateGroupModal } from './CreateGroupModal';
import { GroupedMemberSelector, SelectableGroup } from './GroupedMemberSelector';
import { ReadReceiptsModal } from './ReadReceiptsModal';
import { ForwardMessageModal } from './ForwardMessageModal';
import { GroupAnnouncementModal } from './GroupAnnouncementModal';
import { GroupAnnouncementBanner } from './GroupAnnouncementBanner';
import { GroupMemberManagementModal } from './GroupMemberManagementModal';
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
  AtSign,
  Wifi,
  FileText,
  Download,
  Users,
  Building2,
  FolderTree,
  FolderUp,
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
  ChevronLeft,
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
  /** 页面路径（聊天视图内嵌）：填满画布，不渲染遮罩与关闭按钮。 */
  embedded?: boolean;
  onClose?: () => void;
  currentUser: User;
  users: User[];
  projects?: Project[];
  targetUser?: User | null;
  initialConversation?: ChatConversationRef;
  unreadSummaries?: ChatUnreadSummary[];
  onConversationRead?: (conversationKey?: string, messageIds?: string[]) => void;
  onCreateTaskFromMessage?: (content: string) => void;
  localDirectory?: LocalDirectory;
  onActiveConversationChange?: (target: ActiveTargetType, conversation: ChatConversationRef) => void;
}

export type ActiveTargetType =
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
  embedded = false,
  onClose = () => {},
  currentUser,
  users,
  projects = [],
  targetUser: initialTargetUser,
  initialConversation,
  unreadSummaries = [],
  onConversationRead,
  onCreateTaskFromMessage,
  localDirectory = { units: [], members: [] },
  onActiveConversationChange,
}) => {
  useLocale();

  const accessibleProjects = (projects || []).filter(
    (project) =>
      project &&
      (project.createdBy === currentUser.id ||
        (Array.isArray(project.admins) && project.admins.includes(currentUser.id)) ||
        (Array.isArray(project.members) && project.members.includes(currentUser.id))),
  );

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

  const [groups, setGroups] = useState<LanChatGroup[]>(() => {
    try {
      const saved = localStorage.getItem(scopedStorageKey(STORAGE_KEY_GROUPS));
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

  const [activeTarget, setActiveTarget] = useState<ActiveTargetType>(() => {
    if (initialConversation?.kind === 'user') {
      const u = users.find((item) => item.id === initialConversation.targetId) || initialTargetUser;
      if (u) return { type: 'user', user: u };
    } else if (initialConversation?.kind === 'group') {
      const g = groups.find((item) => item.id === initialConversation.targetId);
      if (g) return { type: 'group', group: g };
    }
    return initialTargetUser ? { type: 'user', user: initialTargetUser } : { type: 'broadcast' };
  });

  const activeTargetRef = useRef(activeTarget);
  const initialTargetKey = initialConversation?.kind === 'broadcast'
    ? 'broadcast'
    : initialConversation
    ? `${initialConversation.kind}:${initialConversation.targetId}`
    : null;
  const appliedInitialConversationRef = useRef<string | null>(
    (activeTarget.type === 'broadcast' && initialConversation?.kind === 'broadcast') ||
    (activeTarget.type === 'user' && initialConversation?.kind === 'user' && activeTarget.user.id === initialConversation.targetId) ||
    (activeTarget.type === 'group' && initialConversation?.kind === 'group' && activeTarget.group.id === initialConversation.targetId)
      ? initialTargetKey
      : null
  );

  const onActiveConversationChangeRef = useRef(onActiveConversationChange);
  useEffect(() => {
    onActiveConversationChangeRef.current = onActiveConversationChange;
  });

  const lastReportedConversationKeyRef = useRef<string | null>(initialTargetKey);

  const selectTarget = useCallback((target: ActiveTargetType) => {
    const key = conversationKeyForTarget(target);
    appliedInitialConversationRef.current = key;
    lastReportedConversationKeyRef.current = key;
    setActiveTarget((prev) => {
      const prevKey = conversationKeyForTarget(prev);
      if (prevKey === key) return prev;
      return target;
    });
    const ref: ChatConversationRef =
      target.type === 'broadcast'
        ? { kind: 'broadcast' }
        : target.type === 'user'
        ? { kind: 'user', targetId: target.user.id }
        : { kind: 'group', targetId: target.group.id };
    onActiveConversationChangeRef.current?.(target, ref);
  }, []);

  useEffect(() => {
    if (!isOpen && !embedded) return;

    const currentKey = conversationKeyForTarget(activeTarget);
    if (lastReportedConversationKeyRef.current === currentKey) return;
    lastReportedConversationKeyRef.current = currentKey;

    activeTargetRef.current = activeTarget;
    const ref: ChatConversationRef =
      activeTarget.type === 'broadcast'
        ? { kind: 'broadcast' }
        : activeTarget.type === 'user'
        ? { kind: 'user', targetId: activeTarget.user.id }
        : { kind: 'group', targetId: activeTarget.group.id };
    onActiveConversationChangeRef.current?.(activeTarget, ref);
  }, [activeTarget, isOpen, embedded]);

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
  const [shareTarget, setShareTarget] = useState<User | null>(null);
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
  const [directMessageViewMode, setDirectMessageViewMode] = useState<'org' | 'flat'>('org');
  const [collapsedDeptIds, setCollapsedDeptIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setShowScreenshotMenu(false);
    setShowMentionPicker(false);
    setMentionQuery('');
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
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
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
    document.addEventListener('pointerdown', handleOutsideClick, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick, true);
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: LanChatMessage; selectedText?: string } | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');

  const activeGroupMembers = useMemo(() => {
    if (activeTarget.type !== 'group') return [];
    return users.filter(
      (u) => activeTarget.group.memberIds.includes(u.id) && u.id !== currentUser.id
    );
  }, [activeTarget, users, currentUser.id]);

  const handleSelectMention = useCallback(
    (target: { id: string; name: string }) => {
      const textarea = messageInputRef.current;
      const cursor = textarea?.selectionEnd ?? inputText.length;
      const { newText, newCursor } = formatMentionInsertion(inputText, cursor, target.name);
      setInputText(newText);
      setShowMentionPicker(false);
      setMentionQuery('');
      setTimeout(() => {
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(newCursor, newCursor);
        }
      }, 0);
    },
    [inputText]
  );

  // Resizable Composer Height State
  const [composerHeight, setComposerHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('lanmind_chat_composer_height');
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 100 && val <= 500) return val;
      }
    } catch {}
    return 150;
  });
  const isResizingComposerRef = useRef(false);
  const composerStartYRef = useRef(0);
  const composerStartHeightRef = useRef(150);

  const handleComposerResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingComposerRef.current = true;
    composerStartYRef.current = e.clientY;
    composerStartHeightRef.current = composerHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingComposerRef.current) return;
      const deltaY = composerStartYRef.current - moveEvent.clientY;
      const nextHeight = Math.max(100, Math.min(500, composerStartHeightRef.current + deltaY));
      setComposerHeight(nextHeight);
      try {
        localStorage.setItem('lanmind_chat_composer_height', String(nextHeight));
      } catch {}
    };

    const onMouseUp = () => {
      isResizingComposerRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [composerHeight]);

  // Group announcements state
  const [announcements, setAnnouncements] = useState<LanGroupAnnouncement[]>([]);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [dismissedBannerGroupIds, setDismissedBannerGroupIds] = useState<Set<string>>(new Set());

  // Section collapse states
  const [isBroadcastCollapsed, setIsBroadcastCollapsed] = useState(false);
  const [isGroupsCollapsed, setIsGroupsCollapsed] = useState(false);
  const [isNodesCollapsed, setIsNodesCollapsed] = useState(false);
  const [isDirectCollapsed, setIsDirectCollapsed] = useState(false);

  // Window and modal states
  const [isMaximized, setIsMaximized] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);

  // accessibleProjects is hoisted to component top

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

  // getDefaultGroups is hoisted to component top

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

  // groups state is hoisted to component top

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
      const saved = localStorage.getItem(scopedStorageKey(STORAGE_KEY_MESSAGES));
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
      localStorage.setItem(scopedStorageKey(STORAGE_KEY_GROUPS), JSON.stringify(groups));
    } catch (e) {
      console.error('Failed to save groups to localStorage', e);
    }
  }, [groups]);

  // Save messages to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(scopedStorageKey(STORAGE_KEY_MESSAGES), JSON.stringify(messages));
    } catch (e) {
      console.error('Failed to save messages to localStorage', e);
    }
  }, [messages]);

  useEffect(() => {
    if ((!isOpen && !embedded) || !initialConversation) return;
    const conversationKey = initialConversation.kind === 'broadcast'
      ? 'broadcast'
      : `${initialConversation.kind}:${initialConversation.targetId}`;

    // `initialConversation` is an external navigation request, not a source
    // of truth for the sidebar selection. Apply each request once so a later
    // users/groups refresh cannot reset an in-modal selection back to the
    // conversation that originally opened the modal.
    if (appliedInitialConversationRef.current === conversationKey) return;

    if (initialConversation.kind === 'broadcast') {
      appliedInitialConversationRef.current = conversationKey;
      lastReportedConversationKeyRef.current = conversationKey;
      setActiveTarget((prev) => (prev.type === 'broadcast' ? prev : { type: 'broadcast' }));
    } else if (initialConversation.kind === 'user') {
      const user = users.find((item) => item.id === initialConversation.targetId) || initialTargetUser;
      if (user) {
        appliedInitialConversationRef.current = conversationKey;
        lastReportedConversationKeyRef.current = conversationKey;
        setActiveTarget((prev) => (prev.type === 'user' && prev.user.id === user.id ? prev : { type: 'user', user }));
      }
    } else {
      const group = groups.find((item) => item.id === initialConversation.targetId);
      if (group) {
        appliedInitialConversationRef.current = conversationKey;
        lastReportedConversationKeyRef.current = conversationKey;
        setActiveTarget((prev) => (prev.type === 'group' && prev.group.id === group.id ? prev : { type: 'group', group }));
      }
    }
  }, [groups, initialConversation, isOpen, embedded, users, initialTargetUser]);

  useEffect(() => {
    if (!isOpen && !embedded) {
      appliedInitialConversationRef.current = null;
    }
  }, [isOpen, embedded]);

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
            if (previous.type === 'group') {
              const refreshed = nextGroups.find((group) => group.id === previous.group.id);
              if (refreshed && Array.isArray(refreshed.memberIds) && refreshed.memberIds.includes(currentUser.id)) {
                if (
                  previous.group.name === refreshed.name &&
                  previous.group.description === refreshed.description &&
                  previous.group.avatar === refreshed.avatar &&
                  previous.group.memberIds.length === refreshed.memberIds.length &&
                  previous.group.memberIds.every((id, idx) => id === refreshed.memberIds[idx])
                ) {
                  return previous;
                }
                return { type: 'group', group: refreshed };
              }
              return { type: 'broadcast' };
            }
            if (previous.type === 'broadcast' && initialConversation?.kind === 'group') {
              const targetGroup = nextGroups.find((group) => group.id === initialConversation.targetId);
              if (targetGroup && Array.isArray(targetGroup.memberIds) && targetGroup.memberIds.includes(currentUser.id)) {
                appliedInitialConversationRef.current = `group:${targetGroup.id}`;
                lastReportedConversationKeyRef.current = `group:${targetGroup.id}`;
                return { type: 'group', group: targetGroup };
              }
            }
            return previous;
          });
        }
      } catch (error) {
        console.error('Failed to load desktop chat history', error);
      }
    };
    void loadDesktopHistory();
    listen<LanChatMessage>('chat://message', (event) => {
      const message = event.payload;
      if (message.workspaceId && message.workspaceId !== getWorkspaceContext()?.workspaceId) return;
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
      if (ann.workspaceId && ann.workspaceId !== getWorkspaceContext()?.workspaceId) return;
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
      if (updated.workspaceId && updated.workspaceId !== getWorkspaceContext()?.workspaceId) return;
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

  const currentHistoryKeyRef = useRef<string>('');
  useEffect(() => {
    if (!isOpen || !isTauri()) return;
    const key = conversationKeyForTarget(activeTarget);
    if (currentHistoryKeyRef.current === key && messages.length > 0) return;
    currentHistoryKeyRef.current = key;
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
    window.addEventListener('contextmenu', handleGlobalClick);
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('contextmenu', handleGlobalClick);
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
      selectTarget({ type: 'group', group: savedGroup });
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
    const selectedText = window.getSelection()?.toString().trim();
    const menuWidth = 160;
    const menuHeight = 260;
    const x = Math.max(10, Math.min(e.clientX, window.innerWidth - menuWidth - 10));
    const y = Math.max(10, Math.min(e.clientY, window.innerHeight - menuHeight - 10));
    setContextMenu({ x, y, message: msg, selectedText });
  };

  const handleCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setContextMenu(null);
  };

  const handleCopyImage = async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    } catch (err) {
      console.warn('Failed to copy image to clipboard', err);
    }
    setContextMenu(null);
  };

  const handleCopyMessage = async (msg: LanChatMessage) => {
    const textToCopy = msg.type === 'file' ? (msg.fileName || msg.content) : msg.content;
    await handleCopyText(textToCopy);
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
      const groupMembers = users.filter((u) => activeTarget.group.memberIds.includes(u.id));
      const extractedMentions = extractMentionIds(textToSend, groupMembers);
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
        mentions: extractedMentions.length > 0 ? extractedMentions : undefined,
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
      setShowMentionPicker(false);
      setMentionQuery('');
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
      selectTarget({ type: 'broadcast' });
    }
  };

  // ==========================================================================
  //  Embedded full-page workspace
  // ==========================================================================
  //  This block backs the `embedded` render path (the in-canvas chat page) and
  //  is shared with the modal path through the extraction frames:
  //
  //    renderChatHeaderFrame()        conversation title strip
  //    renderChatSearchFrame()        in-conversation message search
  //    renderChatBannerFrame()        pinned announcement banner
  //    renderChatGroupMembersPopover() group member management panel
  //    renderChatThreadFrame()        message stream + composer
  //    renderChatModalsFrame()        dialogs (create / edit group, files, ...)
  //
  //  Workspace layout: conversation list (280px) | thread | detail panel
  //  (264px, collapsible). The detail panel is what replaces the popup-style
  //  member and file dialogs on this path.
  //
  //  SIDE EFFECTS: none of its own; every handler it calls is defined above,
  //  so switching between the modal and the page keeps the conversation, the
  //  draft text and the pending attachments.

  const [conversationSearch, setConversationSearch] = useState('');
  const unreadCountForConversation = useCallback(
    (key: string) => unreadSummaries.find((summary) => summary.key === key)?.count || 0,
    [unreadSummaries],
  );

  const matchesConversation = useCallback(
    (message: LanChatMessage, target: ActiveTargetType) => {
      if (target.type === 'group') return message.groupId === target.group.id;
      if (target.type === 'user') {
        const peerId = target.user.id;
        return (
          !message.groupId &&
          ((message.senderId === currentUser.id && message.receiverId === peerId) ||
            (message.senderId === peerId && message.receiverId === currentUser.id))
        );
      }
      return !message.groupId && !message.receiverId;
    },
    [currentUser.id],
  );

  /** 会话目录：广播、群组、点对点三段共用同一套预览与未读统计。 */
  const workspaceDirectory = useMemo(() => {
    const query = conversationSearch.trim().toLocaleLowerCase();
    const lastMessageFor = (target: ActiveTargetType) => {
      const sorted = messages
        .filter((message) => matchesConversation(message, target))
        .sort((left, right) => parseMessageEpoch(left) - parseMessageEpoch(right));
      return sorted.length ? sorted[sorted.length - 1] : null;
    };
    return {
      broadcastLast: lastMessageFor({ type: 'broadcast' }),
      groups: visibleGroups
        .filter(
          (group) =>
            !query ||
            group.name.toLocaleLowerCase().includes(query) ||
            (group.description || '').toLocaleLowerCase().includes(query),
        )
        .map((group) => ({
          group,
          last: lastMessageFor({ type: 'group', group }),
          unread: unreadCountForConversation(`group:${group.id}`),
          hasMention: messages.some(
            (message) =>
              message.groupId === group.id &&
              message.senderId !== currentUser.id &&
              !message.readBy?.includes(currentUser.id) &&
              isUserMentioned(message, currentUser.id, currentUser.nickname, currentUser.username),
          ),
        })),
      peers: (users || [])
        .filter((user) => user.id !== currentUser.id)
        .filter(
          (user) =>
            !query ||
            user.nickname.toLocaleLowerCase().includes(query) ||
            user.username.toLocaleLowerCase().includes(query) ||
            user.ip.includes(query),
        )
        .map((user) => ({
          user,
          last: lastMessageFor({ type: 'user', user }),
          unread: unreadCountForConversation(`user:${user.id}`),
        })),
    };
  }, [
    conversationSearch,
    currentUser.id,
    currentUser.nickname,
    currentUser.username,
    matchesConversation,
    messages,
    unreadCountForConversation,
    users,
  ]);

  interface OrgTreeNode {
    unitId: string;
    unitName: string;
    peers: typeof workspaceDirectory.peers;
    children: OrgTreeNode[];
    totalCount: number;
    onlineCount: number;
    unreadTotal: number;
  }

  /** 按工作区多级组织架构树构建私聊成员层级 */
  const orgTreeData = useMemo(() => {
    const units = localDirectory.units || [];
    const dirMembers = localDirectory.members || [];
    const userToUnitId = new Map<string, string>();
    dirMembers.forEach((m) => {
      userToUnitId.set(m.userId, m.orgUnitId);
    });

    const validUnitIds = new Set(units.map((u) => u.id));

    // 构建 children 映射与根部门
    const childrenMap = new Map<string, LocalOrgUnit[]>();
    const rootUnits: LocalOrgUnit[] = [];

    units.forEach((unit) => {
      const pId = unit.parentId && validUnitIds.has(unit.parentId) ? unit.parentId : null;
      if (pId) {
        const list = childrenMap.get(pId) || [];
        list.push(unit);
        childrenMap.set(pId, list);
      } else {
        rootUnits.push(unit);
      }
    });

    // 排序
    const sortUnits = (list: LocalOrgUnit[]) =>
      list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name));

    sortUnits(rootUnits);
    childrenMap.forEach((list) => sortUnits(list));

    // 递归构建树节点与聚合统计
    const buildNode = (unit: LocalOrgUnit): OrgTreeNode => {
      const directPeers = workspaceDirectory.peers.filter(
        (p) => userToUnitId.get(p.user.id) === unit.id
      );
      const childUnits = childrenMap.get(unit.id) || [];
      const childNodes = childUnits.map(buildNode);

      const directOnline = directPeers.filter((p) => p.user.isOnline).length;
      const directUnread = directPeers.reduce((sum, p) => sum + (p.unread || 0), 0);

      const totalCount = directPeers.length + childNodes.reduce((sum, c) => sum + c.totalCount, 0);
      const onlineCount = directOnline + childNodes.reduce((sum, c) => sum + c.onlineCount, 0);
      const unreadTotal = directUnread + childNodes.reduce((sum, c) => sum + c.unreadTotal, 0);

      return {
        unitId: unit.id,
        unitName: unit.name,
        peers: directPeers,
        children: childNodes,
        totalCount,
        onlineCount,
        unreadTotal,
      };
    };

    const tree: OrgTreeNode[] = rootUnits.map(buildNode);

    // 未分配部门成员
    const unassignedPeers = workspaceDirectory.peers.filter((p) => {
      const uId = userToUnitId.get(p.user.id);
      return !uId || !validUnitIds.has(uId);
    });

    if (unassignedPeers.length > 0 || units.length === 0) {
      const onlineCount = unassignedPeers.filter((p) => p.user.isOnline).length;
      const unreadTotal = unassignedPeers.reduce((sum, p) => sum + (p.unread || 0), 0);
      tree.push({
        unitId: '__unassigned__',
        unitName: units.length > 0 ? tr('settings:workspaceSettings.unassignedOrg') : tr('chat:workspace.sectionDirect', { value0: unassignedPeers.length }),
        peers: unassignedPeers,
        children: [],
        totalCount: unassignedPeers.length,
        onlineCount,
        unreadTotal,
      });
    }

    return tree;
  }, [workspaceDirectory.peers, localDirectory.units, localDirectory.members]);

  const groupsUnreadTotal = useMemo(
    () => workspaceDirectory.groups.reduce((sum, g) => sum + (g.unread || 0), 0),
    [workspaceDirectory.groups]
  );

  const directUnreadTotal = useMemo(
    () => workspaceDirectory.peers.reduce((sum, p) => sum + (p.unread || 0), 0),
    [workspaceDirectory.peers]
  );

  const workspaceOnlinePeerCount = (users || []).filter(
    (user) => user.id !== currentUser.id && user.isOnline,
  ).length;

  const workspaceActiveGroup = activeTarget.type === 'group' ? activeTarget.group : null;

  const workspaceActiveProject = workspaceActiveGroup
    ? projects.find((project) => project.id === workspaceActiveGroup.projectId) || null
    : null;

  /** 群成员：创建者、管理员、在线状态依次排序，与成员管理弹窗口径一致。 */
  const workspaceGroupMembers = useMemo(() => {
    if (!workspaceActiveGroup) return [];
    const memberIds = Array.isArray(workspaceActiveGroup.memberIds)
      ? workspaceActiveGroup.memberIds
      : [];
    const admins = new Set(groupAdminIds(workspaceActiveGroup));
    return memberIds
      .map((memberId) => (users || []).find((candidate) => candidate.id === memberId))
      .filter((member): member is User => Boolean(member))
      .map((member) => ({
        member,
        isCreator: member.id === workspaceActiveGroup.createdBy,
        isAdmin: admins.has(member.id),
      }))
      .sort((left, right) => {
        if (left.isCreator !== right.isCreator) return left.isCreator ? -1 : 1;
        if (left.isAdmin !== right.isAdmin) return left.isAdmin ? -1 : 1;
        if (left.member.isOnline !== right.member.isOnline) return left.member.isOnline ? -1 : 1;
        return left.member.nickname.localeCompare(right.member.nickname);
      });
  }, [users, workspaceActiveGroup]);

  const workspaceConversationFiles = useMemo(
    () =>
      conversationMessages
        .filter((message) => message.type === 'file' || message.type === 'image')
        .slice()
        .reverse(),
    [conversationMessages],
  );

  const workspaceAnnouncementPreview = pinnedAnnouncement || announcements[0] || null;

  const workspaceConversationTitle = activeTarget.type === 'group'
    ? activeTarget.group.name
    : activeTarget.type === 'user'
      ? activeTarget.user.nickname
      : tr('chat:lanChatModal.broadcastChannel');

  /** 会话行时间戳：今天显示时刻，昨天与本周内显示相对称谓，其余显示日期。 */
  const formatConversationStamp = (message: LanChatMessage | null) => {
    if (!message) return '';
    const epoch = parseMessageEpoch(message);
    if (!epoch) return '';
    const now = new Date();
    const day = new Date(epoch);
    if (day.toDateString() === now.toDateString()) {
      return formatMessageDisplayTime(message.timestamp, message.id);
    }
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (day.toDateString() === yesterday.toDateString()) return tr('ai:time.yesterday');
    const diffDays = Math.round((now.getTime() - epoch) / 86400000);
    if (diffDays > 0 && diffDays < 7) {
      return new Intl.DateTimeFormat(currentLocale(), { weekday: 'short' }).format(day);
    }
    return new Intl.DateTimeFormat(currentLocale(), { month: '2-digit', day: '2-digit' }).format(day);
  };

  /** 消息流按「日期分隔 + 连续同发送者合并」生成渲染序列。 */
  const workspaceThreadRows = useMemo(() => {
    const rows: Array<{ message: LanChatMessage; showHeader: boolean; dayLabel: string | null }> = [];
    let previousEpoch = 0;
    let previousSender: string | null = null;
    conversationMessages.forEach((message) => {
      const epoch = parseMessageEpoch(message);
      const day = epoch ? new Date(epoch) : null;
      const isNewDay = Boolean(day) && (!previousEpoch || new Date(previousEpoch).toDateString() !== day.toDateString());
      let dayLabel: string | null = null;
      if (isNewDay && day) {
        const now = new Date();
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        if (day.toDateString() === now.toDateString()) dayLabel = tr('chat:lanChatModal.today');
        else if (day.toDateString() === yesterday.toDateString()) dayLabel = tr('ai:time.yesterday');
        else {
          dayLabel = new Intl.DateTimeFormat(currentLocale(), {
            month: '2-digit',
            day: '2-digit',
            weekday: 'short',
          }).format(day);
        }
      }
      rows.push({
        message,
        showHeader: isNewDay || previousSender !== message.senderId,
        dayLabel,
      });
      if (epoch) previousEpoch = epoch;
      previousSender = message.senderId;
    });
    return rows;
  }, [conversationMessages]);
  /** 消息行：modal 与 embedded 两条路径共用同一份提取出来的渲染逻辑。 */
  const renderChatMessageRow = (message: LanChatMessage, showHeader: boolean) => {
    const msg = message;
    const isSelf = msg.senderId === currentUser.id;
    const latestSender = isSelf
      ? currentUser
      : (users || []).find((u) => u.id === msg.senderId);
    const resolvedAvatar = latestSender?.avatar || msg.senderAvatar;
    const isImgAvatar =
      resolvedAvatar &&
      (resolvedAvatar.startsWith('data:image') ||
        resolvedAvatar.startsWith('http'));
    const senderDisplayName =
      latestSender?.nickname || latestSender?.username || msg.senderName;
    return (
        <div
          key={msg.id}
          ref={(element) => {
            messageElementRefs.current[msg.id] = element;
          }}
          data-chat-message-id={msg.id}
          className={`flex items-start gap-2.5 group relative transition-shadow ${
            highlightedMessageId === msg.id ? 'rounded-xl ring-2 ring-info/80 ring-offset-2 ring-offset-canvas' : ''
          } ${
            isSelf ? 'flex-row-reverse' : 'flex-row'
          }`}
        >
          {/* Avatar */}
          <div
            aria-hidden={!showHeader}
            className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs overflow-hidden flex-shrink-0 mt-0.5 border shadow-soft font-bold ${showHeader ? '' : 'invisible'}`}
            style={{
              backgroundColor: isSelf ? 'var(--accent-subtle)' : 'var(--bg-hover)',
              borderColor: isSelf ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border-subtle)',
              color: isSelf ? 'var(--accent)' : 'var(--text-main)',
            }}
          >
            {isImgAvatar ? (
              <img
                src={resolvedAvatar}
                alt={senderDisplayName}
                className="w-full h-full object-cover"
              />
            ) : (
              resolvedAvatar || senderDisplayName.charAt(0)
            )}
          </div>

          {/* Content Bubble */}
          <div
            className={`max-w-[75%] space-y-1 flex flex-col ${
              isSelf ? 'items-end' : 'items-start'
            }`}
          >
            {showHeader && (() => {
              const isMentionedToMe = !isSelf && isUserMentioned(msg, currentUser.id, currentUser.nickname, currentUser.username);
              return (
                <>
                  <div
                    className={`flex items-center space-x-2 text-[10px] text-sub ${
                      isSelf ? 'flex-row-reverse space-x-reverse' : ''
                    }`}
                  >
                    <span className="font-semibold" style={{ color: isSelf ? 'var(--accent)' : 'var(--text-main)' }}>
                      {senderDisplayName}
                    </span>
                    {isMentionedToMe && (
                      <span className="inline-flex items-center rounded-full bg-warning/20 border border-warning/35 px-1.5 py-0.2 text-[9px] font-bold text-warning animate-pulse">
                        {tr("chat:lanChatModal.mentionedMeTag")}
                      </span>
                    )}
                    <span className="font-mono text-quiet">{formatMessageDisplayTime(msg.timestamp, msg.id)}</span>
                  </div>

                  {/* Render Text */}
                  {msg.type === 'text' && (
                    <div
                      onContextMenu={(e) => handleMessageContextMenu(e, msg)}
                      data-selectable="true"
                      className={`chat-bubble px-4 py-2.5 rounded-2xl text-xs leading-relaxed inline-block break-words max-w-full text-left transition-all select-text cursor-text ${
                        isSelf
                          ? 'chat-bubble-self rounded-br-xs'
                          : 'chat-bubble-other rounded-bl-xs'
                      } ${isMentionedToMe ? 'ring-2 ring-warning/60 shadow-md bg-warning/5' : ''}`}
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

                      <div className="select-text cursor-text" data-selectable="true">
                        <ChatMessageText
                          content={msg.content}
                          currentUserId={currentUser.id}
                          currentUserNickname={currentUser.nickname}
                          currentUserUsername={currentUser.username}
                        />
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Render Image */}
            {msg.type === 'image' && (
              <div
                onContextMenu={(e) => handleMessageContextMenu(e, msg)}
                data-selectable="true"
                className="chat-media-card p-2 rounded-xl inline-block max-w-sm text-left select-auto"
              >
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
                    className="group relative block overflow-hidden rounded-lg transition-transform hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-info"
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
              <div
                onContextMenu={(e) => handleMessageContextMenu(e, msg)}
                className="chat-media-card p-3 rounded-xl inline-flex flex-col space-y-2 max-w-sm text-left"
              >
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
  };

  /** 会话标题条：标题、成员 / 关联项目徽标与操作按钮，两条路径共用。 */
  const renderChatHeaderFrame = () => (
    <div className="lan-chat-subheader flex flex-shrink-0 items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-2 text-xs">
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
              <span className="flex flex-shrink-0 items-center gap-1 rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
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
        {activeTarget.type === 'user' && (
          <button
            type="button"
            onClick={() => setShareTarget(activeTarget.user)}
            title={tr('chat:shares.open')}
            aria-label={tr('chat:shares.open')}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-transparent text-sub transition-colors hover:border-subtle/50 hover:bg-hover hover:text-main"
          >
            <FolderUp className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setSearchOpen((current) => !current)}
          className={`h-8 w-8 rounded-lg border flex items-center justify-center transition-colors ${searchOpen ? 'bg-info text-on-solid border-info' : 'bg-transparent hover:bg-hover text-info border-transparent hover:border-subtle/50'}`}
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
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning"></span>
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
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-danger bg-transparent hover:bg-danger/10 focus:bg-danger/10 focus:outline-none transition-colors"
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
            className="chat-btn-clear h-8 w-8 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger hover:text-danger flex items-center justify-center border border-danger/20 transition-colors disabled:cursor-wait disabled:opacity-60"
            title={isClearingChat ? tr("chat:lanChatModal.clearing") : tr("chat:lanChatModal.clearConversation")}
            aria-label={tr("chat:lanChatModal.clearConversation")}
          >
            <Eraser className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  /** 会话内搜索：消息与文件名匹配，命中后跳转并高亮。 */
  const renderChatSearchFrame = () => (
    <>
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
        </>
  );

  /** 置顶公告横幅，仅群聊且未关闭时出现。 */
  const renderChatBannerFrame = () => (
    <>
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
        </>
  );

  /** 群成员管理浮层/弹窗，仅群聊可见。 */
  const renderChatGroupMembersPopover = () => (
    <>
      {showGroupMembersModal && activeTarget.type === 'group' && (
        <GroupMemberManagementModal
          isOpen={showGroupMembersModal}
          onClose={() => setShowGroupMembersModal(false)}
          group={activeTarget.group}
          currentUser={currentUser}
          users={users}
          projects={projects}
          localDirectory={localDirectory}
          canManage={canManageActiveGroupMembers}
          onGroupUpdated={(updatedGroup) => {
            setGroups((prev) => prev.map((g) => (g.id === updatedGroup.id ? updatedGroup : g)));
            setActiveTarget({ type: 'group', group: updatedGroup });
          }}
        />
      )}
    </>
  );

  /** 输入区：引用条、表情与 @ 选择器、附件按钮与发送动作。 */
  const renderChatComposerFrame = () => (
    <>
      {/* Input Bar Section */}
      <div
        className="lan-chat-input-bar flex-shrink-0 bg-canvas/90 border-t border-edge flex flex-col relative"
        style={{ height: composerHeight }}
      >
        {/* Resize drag handle */}
        <div
          onMouseDown={handleComposerResizeStart}
          className="group absolute -top-1.5 left-0 right-0 h-3 cursor-ns-resize z-30 flex items-center justify-center select-none"
          title="拖动调整对话框大小"
        >
          <div className="h-1 w-12 rounded-full bg-edge/60 group-hover:bg-accent group-hover:w-16 transition-all duration-150" />
        </div>
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

        <div className="flex flex-1 min-h-0 flex-col p-3">
          {/* Modern Dismissable Emoji Picker */}
          <EmojiPicker
            isOpen={showEmojiPicker}
            onClose={() => setShowEmojiPicker(false)}
            onSelect={(emoji) => {
              setInputText((prev) => prev + emoji);
            }}
            triggerRef={emojiButtonRef}
          />

          {sendError && (
            <p className="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-[10px] text-danger">
              {localizeMessage(sendError)}
            </p>
          )}

          <div className="relative flex flex-1 min-h-0 flex-col">
            {/* Mention Picker Popup */}
            {showMentionPicker && activeTarget.type === 'group' && (
              <ChatMentionPicker
                query={mentionQuery}
                members={activeGroupMembers}
                onSelect={handleSelectMention}
                onClose={() => setShowMentionPicker(false)}
              />
            )}

            {/* Integrated Modern Input Card */}
            <div
              className="flex flex-1 min-h-0 flex-col rounded-2xl border border-subtle bg-surface shadow-xs transition-colors focus-within:border-accent/60 overflow-hidden"
              style={{
                backgroundColor: 'var(--bg-input)',
              }}
            >
              {/* Pasted Images Preview */}
              {pastedImages.length > 0 && (
                <div role="group" aria-label={tr('chat:screenshot.pastedImages')} className="flex gap-2 overflow-x-auto p-2.5 pb-0">
                  {pastedImages.map((image) => (
                    <div key={image.id} className="relative shrink-0 rounded-lg border border-subtle bg-card p-1">
                      <img src={image.dataUrl} alt={image.fileName} className="h-14 max-w-28 rounded-md object-contain" />
                      <button
                        type="button"
                        onClick={() => setPastedImages((previous) => previous.filter((item) => item.id !== image.id))}
                        disabled={isSendingMessage}
                        aria-label={tr('chat:screenshot.removeImage')}
                        title={tr('chat:screenshot.removeImage')}
                        className="absolute -right-1 -top-1 rounded-full border border-subtle bg-surface p-0.5 text-sub hover:text-danger disabled:opacity-40"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Textarea on Top */}
              <textarea
                ref={messageInputRef}
                rows={2}
                value={inputText}
                disabled={isActiveProjectGroupReadOnly}
                onChange={(e) => {
                  const val = e.target.value;
                  setInputText(val);
                  if (activeTarget.type === 'group') {
                    const cursor = e.target.selectionEnd ?? val.length;
                    const detected = detectMentionQuery(val, cursor);
                    setShowMentionPicker(detected.active);
                    setMentionQuery(detected.query);
                  } else if (showMentionPicker) {
                    setShowMentionPicker(false);
                  }
                }}
                onPaste={handlePasteImage}
                onKeyDown={(e) => {
                  if (showMentionPicker && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
                    return;
                  }
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
                  color: 'var(--text-main)',
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  boxShadow: 'none',
                }}
                className="w-full flex-1 min-h-0 resize-none bg-transparent px-3.5 pt-2.5 pb-1 text-xs placeholder-quiet focus:outline-none min-h-[38px] disabled:cursor-not-allowed disabled:opacity-60 border-0 outline-none rounded-t-2xl shadow-none overflow-y-auto"
              />

              {/* Bottom Toolbar & Send Button */}
              <div className="flex shrink-0 items-center justify-between px-2.5 pb-2 pt-1 border-t border-edge/30">
                {/* Action Tools Left */}
                <div className="flex items-center space-x-1">
                  <button
                    ref={emojiButtonRef}
                    type="button"
                    onClick={() => setShowEmojiPicker((prev) => !prev)}
                    disabled={isActiveProjectGroupReadOnly}
                    className={`chat-tool-btn p-1.5 rounded-lg transition-all text-xs flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40 ${
                      showEmojiPicker
                        ? 'bg-warning/20 text-warning border border-warning/40 shadow-soft'
                        : 'hover:bg-hover text-sub hover:text-warning border border-transparent'
                    }`}
                    title={showEmojiPicker ? tr("chat:lanChatModal.closeEmojisEsc") : tr("chat:lanChatModal.insertEmoji")}
                  >
                    <Smile className="w-4 h-4" />
                  </button>

                  {activeTarget.type === 'group' && (
                    <button
                      type="button"
                      onClick={() => {
                        const textarea = messageInputRef.current;
                        const cursor = textarea?.selectionEnd ?? inputText.length;
                        const before = inputText.slice(0, cursor);
                        const after = inputText.slice(cursor);
                        setInputText(`${before}@${after}`);
                        setShowMentionPicker(true);
                        setMentionQuery('');
                        setTimeout(() => {
                          if (textarea) {
                            textarea.focus();
                            textarea.setSelectionRange(cursor + 1, cursor + 1);
                          }
                        }, 0);
                      }}
                      disabled={isActiveProjectGroupReadOnly}
                      className="chat-tool-btn p-1.5 hover:bg-hover text-sub hover:text-primary rounded-lg transition-all text-xs flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
                      title={tr("chat:lanChatModal.mentionMember")}
                      aria-label={tr("chat:lanChatModal.mentionMember")}
                    >
                      <AtSign className="w-4 h-4" />
                    </button>
                  )}

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

                {/* Right: Shortcut Hint + Send Button */}
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] text-quiet font-mono hidden sm:inline select-none">
                    {isActiveProjectGroupReadOnly ? tr("chat:lanChatModal.historyIsKeptNewMessagesAreNo") : tr("chat:lanChatModal.enterToSendShiftEnterForA")}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSendMessage()}
                    disabled={(!inputText.trim() && pastedImages.length === 0) || isActiveProjectGroupReadOnly || isSendingMessage}
                    className="theme-btn-primary px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 shadow-xs disabled:opacity-40 transition-all"
                  >
                    {isSendingMessage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    <span>{tr("chat:lanChatModal.send")}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
        </>
  );

  /** 会话列表行：头像、名称、最后一条消息、时间与未读徽标。 */
  const renderConversationRow = (options: {
    key: string;
    title: string;
    subtitle: string;
    avatar: React.ReactNode;
    selected: boolean;
    unread: number;
    hasMention?: boolean;
    online?: boolean;
    lastStamp?: string;
    onSelect: () => void;
  }) => (
    <button
      key={options.key}
      type="button"
      onClick={options.onSelect}
      data-active={options.selected}
      className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
        options.selected
          ? 'border-accent/50 bg-accent/10'
          : 'border-transparent hover:bg-hover'
      }`}
    >
      <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-subtle bg-card text-xs">
        {options.avatar}
        {options.online !== undefined && (
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-card ${
              options.online ? 'bg-success' : 'bg-muted'
            }`}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate text-xs font-medium text-main">{options.title}</span>
          {options.hasMention && (
            <span className="flex-shrink-0 rounded border border-warning/30 bg-warning/10 px-1 text-[9px] font-semibold text-warning">
              {tr('chat:lanChatModal.mentionedMeTag')}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-quiet">{options.subtitle}</span>
      </span>
      <span className="flex flex-shrink-0 flex-col items-end gap-0.5">
        {options.lastStamp ? (
          <span className="whitespace-nowrap font-mono text-[10px] text-quiet">{options.lastStamp}</span>
        ) : null}
        {options.unread > 0 ? (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-on-solid">
            {options.unread > 99 ? '99+' : options.unread}
          </span>
        ) : null}
      </span>
    </button>
  );
  /** 消息流：日期分隔、未读锚点、"加载更早消息" 分页。 */
  const renderWorkspaceStream = () => (
    <div
      ref={messagesContainerRef}
      className="relative flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 py-3"
    >
      {hasMoreHistoryRef.current && !loadingHistory && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadOlderHistory()}
            className="rounded-full border border-subtle bg-surface px-3 py-1 text-[10px] text-sub transition-colors hover:bg-hover hover:text-main"
          >
            {tr('chat:workspace.loadOlder')}
          </button>
        </div>
      )}
      {loadingHistory && (
        <div className="sticky top-0 z-10 mx-auto w-fit rounded-full border border-edge bg-surface/95 px-3 py-1 text-[10px] text-sub shadow-soft">
          {tr('chat:lanChatModal.loadingEarlierMessages')}
        </div>
      )}
      {activeUnreadIds.size > 0 && (
        <button
          type="button"
          onClick={handleJumpToUnread}
          className="sticky bottom-2 z-10 mr-1 ml-auto flex items-center gap-1.5 rounded-full bg-info px-3 py-1.5 text-[11px] font-semibold text-on-solid shadow-soft transition hover:opacity-90"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {activeUnreadIds.size > 99 ? '99+' : activeUnreadIds.size}{' '}
          {tr('chat:lanChatModal.newMessages')}
        </button>
      )}
      {workspaceThreadRows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-subtle bg-surface text-quiet">
            <MessageSquare className="h-5 w-5" />
          </div>
          <p className="text-xs font-medium text-sub">{tr('chat:workspace.emptyConversationTitle')}</p>
          <p className="mt-1 max-w-sm text-[11px] leading-5 text-quiet">
            {tr('chat:workspace.emptyConversationHint')}
          </p>
        </div>
      ) : (
        workspaceThreadRows.map((row) => (
          <React.Fragment key={row.message.id}>
            {row.dayLabel && (
              <div className="my-2 flex select-none items-center gap-2">
                <span className="h-px flex-1 bg-subtle" />
                <span className="rounded-full border border-subtle bg-surface px-2 py-0.5 text-[10px] text-quiet">
                  {row.dayLabel}
                </span>
                <span className="h-px flex-1 bg-subtle" />
              </div>
            )}
            {renderChatMessageRow(row.message, row.showHeader)}
          </React.Fragment>
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );


  /** 会话列表：搜索、广播、协作群组与点对点三段。 */
  const renderWorkspaceConversationList = () => {
    const renderOrgTreeNode = (node: OrgTreeNode, depth = 0): React.ReactNode => {
      const isCollapsed = collapsedDeptIds.has(node.unitId);
      const hasSubtree = node.peers.length > 0 || node.children.length > 0;
      if (conversationSearch && node.totalCount === 0) return null;

      return (
        <div key={node.unitId} className="space-y-0.5 pt-0.5">
          <button
            type="button"
            onClick={() => {
              setCollapsedDeptIds((prev) => {
                const next = new Set(prev);
                if (next.has(node.unitId)) next.delete(node.unitId);
                else next.add(node.unitId);
                return next;
              });
            }}
            style={{ paddingLeft: `${4 + depth * 10}px` }}
            className="flex w-full items-center justify-between pr-1.5 py-1 text-left text-[11px] font-medium text-sub hover:text-main rounded-lg hover:bg-hover/60 transition-colors"
          >
            <span className="flex items-center gap-1.5 truncate min-w-0">
              {hasSubtree ? (
                isCollapsed ? (
                  <ChevronRight className="h-3 w-3 text-quiet shrink-0" />
                ) : (
                  <ChevronDown className="h-3 w-3 text-quiet shrink-0" />
                )
              ) : (
                <span className="w-3 shrink-0" />
              )}
              {depth === 0 ? (
                <Building2 className="h-3 w-3 text-feature shrink-0" />
              ) : (
                <FolderTree className="h-3 w-3 text-accent/80 shrink-0" />
              )}
              <span className="truncate font-medium">{node.unitName}</span>
            </span>
            <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px] text-quiet ml-1">
              <span>{node.onlineCount}/{node.totalCount}</span>
              {isCollapsed && node.unreadTotal > 0 && (
                <span className="flex h-2 w-2 rounded-full bg-danger animate-pulse" />
              )}
            </div>
          </button>

          {!isCollapsed && (
            <>
              {node.peers.map(({ user, last, unread }) => {
                const isImageAvatar =
                  user.avatar && (user.avatar.startsWith('data:image') || user.avatar.startsWith('http'));
                return (
                  <div key={user.id} style={{ paddingLeft: `${14 + depth * 10}px` }}>
                    {renderConversationRow({
                      key: user.id,
                      title: user.nickname,
                      subtitle: last
                        ? `${last.senderId === currentUser.id ? tr('chat:workspace.you') : last.senderName}: ${
                            last.type === 'file' ? last.fileName || last.content : last.content
                          }`
                        : user.ip,
                      avatar: isImageAvatar ? (
                        <img src={user.avatar} alt={user.nickname} className="h-full w-full object-cover" />
                      ) : (
                        <span>{user.avatar || user.nickname.charAt(0)}</span>
                      ),
                      selected: activeTarget.type === 'user' && activeTarget.user.id === user.id,
                      unread,
                      online: user.isOnline,
                      lastStamp: formatConversationStamp(last),
                      onSelect: () => selectTarget({ type: 'user', user }),
                    })}
                  </div>
                );
              })}

              {node.children.map((child) => renderOrgTreeNode(child, depth + 1))}
            </>
          )}
        </div>
      );
    };

    return (
      <aside className="flex w-[280px] shrink-0 flex-col overflow-hidden border-r border-edge bg-surface">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquare className="h-4 w-4 shrink-0 text-info" />
            <h2 className="truncate text-xs font-semibold text-main">{tr('chat:workspace.title')}</h2>
            <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-quiet">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {tr('chat:workspace.onlineCount', { value0: workspaceOnlinePeerCount })}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShareTarget(currentUser)}
            title={tr('chat:shares.mine')}
            aria-label={tr('chat:shares.mine')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main"
          >
            <FolderUp className="h-4 w-4" />
          </button>
        </div>

        <div className="shrink-0 px-2 py-2">
          <label className="flex items-center gap-2 rounded-md border border-subtle bg-input px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-quiet" />
            <input
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder={tr('chat:workspace.searchConversations')}
              aria-label={tr('chat:workspace.searchConversations')}
              className="h-7 min-w-0 flex-1 bg-transparent text-xs text-main outline-none placeholder:text-placeholder"
            />
            {conversationSearch && (
              <button
                type="button"
                onClick={() => setConversationSearch('')}
                aria-label={tr('chat:workspace.clearSearch')}
                className="shrink-0 rounded p-0.5 text-quiet transition-colors hover:text-main"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-2">
          <div className="space-y-0.5">
            <div className="px-1 py-0.5 text-[10px] font-semibold tracking-wider text-quiet uppercase">
              {tr('chat:workspace.sectionBroadcast')}
            </div>
            {renderConversationRow({
              key: 'broadcast',
              title: tr('chat:lanChatModal.broadcastChannel'),
              subtitle: tr('chat:workspace.everyoneOnThisNetwork'),
              avatar: <Users className="h-3.5 w-3.5 text-info" />,
              selected: activeTarget.type === 'broadcast',
              unread: unreadCountForConversation('broadcast'),
              lastStamp: formatConversationStamp(workspaceDirectory.broadcastLast),
              onSelect: () => selectTarget({ type: 'broadcast' }),
            })}
          </div>

          <div className="space-y-0.5">
            <div className="flex items-center justify-between px-1 py-0.5">
              <button
                type="button"
                onClick={() => setIsGroupsCollapsed((prev) => !prev)}
                className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-quiet uppercase hover:text-main transition-colors select-none"
              >
                {isGroupsCollapsed ? (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                )}
                <span>{tr('chat:workspace.sectionGroups', { value0: workspaceDirectory.groups.length })}</span>
                {isGroupsCollapsed && groupsUnreadTotal > 0 && (
                  <span className="flex h-2 w-2 rounded-full bg-danger animate-pulse ml-0.5" />
                )}
              </button>
              {canUserCreateGroup && (
                <button
                  type="button"
                  onClick={handleOpenCreateGroup}
                  title={tr('chat:lanChatModal.createGroup')}
                  aria-label={tr('chat:lanChatModal.createGroup')}
                  className="flex h-5 w-5 items-center justify-center rounded border border-accent/30 bg-accent/10 text-accent transition-colors hover:bg-accent hover:text-on-accent"
                >
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </div>
            {!isGroupsCollapsed && (
              <>
                {workspaceDirectory.groups.map(({ group, last, unread, hasMention }) =>
                  renderConversationRow({
                    key: group.id,
                    title: group.name,
                    subtitle: last
                      ? `${last.senderName}: ${
                          last.type === 'file' ? last.fileName || last.content : last.content
                        }`
                      : group.description || tr('chat:lanChatModal.members', { value0: group.memberIds.length }),
                    avatar: <span>{group.avatar || '👥'}</span>,
                    selected: activeTarget.type === 'group' && activeTarget.group.id === group.id,
                    unread,
                    hasMention,
                    lastStamp: formatConversationStamp(last),
                    onSelect: () => selectTarget({ type: 'group', group }),
                  }),
                )}
                {workspaceDirectory.groups.length === 0 && (
                  <p className="px-2 py-3 text-center text-[11px] text-quiet">
                    {conversationSearch
                      ? tr('chat:workspace.noSearchResult')
                      : tr('chat:workspace.noGroups')}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="space-y-0.5">
            <div className="flex items-center justify-between px-1 py-0.5 text-[10px] font-semibold tracking-wider text-quiet uppercase">
              <button
                type="button"
                onClick={() => setIsDirectCollapsed((prev) => !prev)}
                className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-quiet uppercase hover:text-main transition-colors select-none"
              >
                {isDirectCollapsed ? (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                )}
                <span>{tr('chat:workspace.sectionDirect', { value0: workspaceDirectory.peers.length })}</span>
                {isDirectCollapsed && directUnreadTotal > 0 && (
                  <span className="flex h-2 w-2 rounded-full bg-danger animate-pulse ml-0.5" />
                )}
              </button>
              {(localDirectory.units || []).length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDirectMessageViewMode((m) => (m === 'org' ? 'flat' : 'org'));
                  }}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-sub hover:bg-hover hover:text-main lowercase tracking-normal transition-colors"
                  title={directMessageViewMode === 'org' ? tr('chat:lanChatModal.switchToFlat') : tr('chat:lanChatModal.switchToOrg')}
                >
                  {directMessageViewMode === 'org' ? (
                    <>
                      <FolderTree className="h-3 w-3 text-accent" />
                      <span>{tr('chat:lanChatModal.viewByOrg')}</span>
                    </>
                  ) : (
                    <>
                      <Users className="h-3 w-3 text-sub" />
                      <span>{tr('chat:lanChatModal.viewFlat')}</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {!isDirectCollapsed && (
              <>
                {/* 组织架构树状层级模式 */}
                {directMessageViewMode === 'org' && (localDirectory.units || []).length > 0 ? (
                  orgTreeData.map((node) => renderOrgTreeNode(node, 0))
                ) : (
                  /* 平铺联系人模式 */
                workspaceDirectory.peers.map(({ user, last, unread }) => {
                  const isImageAvatar =
                    user.avatar && (user.avatar.startsWith('data:image') || user.avatar.startsWith('http'));
                  return renderConversationRow({
                    key: user.id,
                    title: user.nickname,
                    subtitle: last
                      ? `${last.senderId === currentUser.id ? tr('chat:workspace.you') : last.senderName}: ${
                          last.type === 'file' ? last.fileName || last.content : last.content
                        }`
                      : user.ip,
                    avatar: isImageAvatar ? (
                      <img src={user.avatar} alt={user.nickname} className="h-full w-full object-cover" />
                    ) : (
                      <span>{user.avatar || user.nickname.charAt(0)}</span>
                    ),
                    selected: activeTarget.type === 'user' && activeTarget.user.id === user.id,
                    unread,
                    online: user.isOnline,
                    lastStamp: formatConversationStamp(last),
                    onSelect: () => selectTarget({ type: 'user', user }),
                  });
                })
              )}

              {workspaceDirectory.peers.length === 0 && (
                <p className="px-2 py-3 text-center text-[11px] text-quiet">
                  {conversationSearch
                    ? tr('chat:workspace.noSearchResult')
                    : tr('chat:workspace.noPeers')}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-edge px-3 py-1.5 text-[10px] text-quiet">
        <HardDrive className="h-3 w-3 shrink-0" />
        {tr('chat:lanChatModal.storedLocally')}
      </div>
    </aside>
  );
};

  /** 完整页面工作区：会话列表 / 消息流 / 详情面板三栏，不渲染全局导航。 */
  const renderEmbeddedWorkspace = () => (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-canvas text-main">
      <div className="lan-chat-modal flex min-h-0 flex-1 overflow-hidden bg-canvas">
        {renderWorkspaceConversationList()}

        <section
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas"
          aria-label={workspaceConversationTitle}
        >
          {renderChatHeaderFrame()}
          {renderChatSearchFrame()}
          {renderChatBannerFrame()}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas">
            {renderWorkspaceStream()}
            {renderChatComposerFrame()}
          </div>

          {renderChatGroupMembersPopover()}

        </section>
      </div>
    </div>
  );

  /** 对话框集合：创建 / 编辑群组、文件、转发、回执与更多操作菜单。 */
  const renderChatModalsFrame = () => (
    <>
      {shareTarget && <SharedFilesModal key={shareTarget.id} user={shareTarget} currentUser={currentUser} onClose={() => setShareTarget(null)} />}
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
          selectTarget({ type: 'group', group: savedGroup });
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
          {contextMenu.selectedText && (
            <button
              type="button"
              role="menuitem"
              onClick={() => handleCopyText(contextMenu.selectedText!)}
              className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-accent bg-accent/10 hover:bg-accent/20 transition-colors"
            >
              <Copy className="h-3.5 w-3.5 text-accent" />
              <span className="truncate">复制选中文本</span>
            </button>
          )}
          {contextMenu.message.type === 'image' && contextMenu.message.fileUrl && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => handleCopyImage(contextMenu.message.fileUrl!)}
                className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-2 text-xs text-main bg-transparent hover:bg-hover focus:bg-hover transition-colors"
              >
                <Copy className="h-3.5 w-3.5 text-feature" />
                <span>复制图片</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPreviewImage({
                    url: contextMenu.message.fileUrl!,
                    name: contextMenu.message.fileName || contextMenu.message.content || '图片',
                  });
                  setContextMenu(null);
                }}
                className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-2 text-xs text-main bg-transparent hover:bg-hover focus:bg-hover transition-colors"
              >
                <ZoomIn className="h-3.5 w-3.5 text-info" />
                <span>预览图片</span>
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleCopyMessage(contextMenu.message)}
            className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-2 text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
          >
            <Copy className="h-3.5 w-3.5 text-sub" />
            <span>{contextMenu.selectedText ? '复制整条消息' : tr("chat:lanChatModal.copy")}</span>
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
            className="flex w-full items-center space-x-2 rounded-lg px-2.5 py-2 text-xs text-danger bg-transparent hover:bg-danger/10 focus:bg-danger/10 focus:outline-none transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5 text-danger" />
            <span className="font-semibold text-danger">{tr("chat:lanChatModal.delete")}</span>
          </button>
        </div>
      )}
    </>
  );

  /** 会话浮层：图片预览与右键菜单。 */
  const renderChatOverlaysFrame = () => (
    <>
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
    </>
  );

  // 页面路径：三栏工作区填满画布，无遮罩、无对话框语义、无关闭按钮。
  if (embedded) {
    return (
      <>
        {renderEmbeddedWorkspace()}
        {renderChatModalsFrame()}
        {renderChatOverlaysFrame()}
      </>
    );
  }

  // Modal rendering
  if (!isOpen) return null;

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
                    <div className="p-2 bg-success/10 border border-success/30 rounded-xl text-success">
                      <Wifi className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h2 className="text-sm font-extrabold text-main">{tr("chat:lanChatModal.lanChat")}</h2>
                        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-quiet">
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                          {tr('chat:workspace.onlineCount', { value0: workspaceOnlinePeerCount })}
                        </span>
                        <span className="chat-badge-storage text-[10px] bg-success/20 text-success font-mono px-2 py-0.5 rounded-full border border-success/30 flex items-center gap-1">
                          <HardDrive className="w-3 h-3 text-success" />
                          {tr("chat:lanChatModal.storedLocally")}</span>
                      </div>
                      <p className="text-xs text-sub mt-0.5">
                        {tr("chat:lanChatModal.groupChatDirectMessagesFilesAndImages")}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1">
                    <button type="button" onClick={() => setShareTarget(currentUser)} title={tr('chat:shares.mine')} aria-label={tr('chat:shares.mine')} className="flex h-8 w-8 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main"><FolderUp className="h-4 w-4" /></button>
                    <button
                      type="button"
                      onClick={() => setIsMaximized((prev) => !prev)}
                      className="flex h-8 w-8 items-center justify-center hover:bg-hover text-sub hover:text-main rounded-lg transition-colors"
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
                      className="flex h-8 w-8 items-center justify-center hover:bg-hover text-sub hover:text-main rounded-lg transition-colors"
                      title={tr("chat:lanChatModal.close")}
                      aria-label={tr("chat:lanChatModal.close")}
                    >
                      <X className="w-4 h-4" />
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
                            onClick={() => selectTarget({ type: 'broadcast' })}
                            data-active={activeTarget.type === 'broadcast'}
                            className={`chat-channel-btn w-full p-2.5 rounded-xl border text-left flex items-center space-x-2.5 text-xs transition-all ${
                              activeTarget.type === 'broadcast'
                                ? 'bg-info/20 border-info/50 text-info font-bold shadow-soft'
                                : 'bg-surface border-edge text-sub hover:bg-hover/80'
                            }`}
                          >
                            <div className="channel-icon p-1.5 bg-info/20 text-info rounded-lg flex-shrink-0">
                              <Users className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="channel-title truncate font-medium">{tr("chat:lanChatModal.broadcastChannel")}</div>
                             <div className="channel-subtitle text-[10px] text-quiet font-mono">LAN Broadcast</div>
                            </div>
                            {(() => {
                              const count = unreadSummaries.find((summary) => summary.key === 'broadcast')?.count || 0;
                              return count > 0 ? <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-on-solid">{count > 99 ? '99+' : count}</span> : null;
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
                                  onClick={() => selectTarget({ type: 'group', group })}
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
                                    const hasMention = messages.some((m) =>
                                      m.groupId === group.id &&
                                      m.senderId !== currentUser.id &&
                                      !m.readBy?.includes(currentUser.id) &&
                                      isUserMentioned(m, currentUser.id, currentUser.nickname, currentUser.username)
                                    );
                                    if (count <= 0 && !hasMention) return null;
                                    return (
                                      <div className="flex items-center gap-1 shrink-0">
                                        {hasMention && (
                                          <span className="rounded bg-warning/20 border border-warning/30 px-1 py-0.2 text-[9px] font-bold text-warning animate-pulse">
                                            {tr("chat:lanChatModal.mentionedMeTag")}
                                          </span>
                                        )}
                                        {count > 0 && (
                                          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-on-solid">
                                            {count > 99 ? '99+' : count}
                                          </span>
                                        )}
                                      </div>
                                    );
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
                                    onClick={() => selectTarget({ type: 'user', user })}
                                    data-active={isSelected}
                                    className={`chat-node-item w-full min-w-0 p-2 rounded-xl border text-left flex items-center space-x-2 text-xs transition-all ${
                                      isSelected
                                        ? 'bg-info/20 border-info/50 text-info font-bold'
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
                                          user.isOnline ? 'bg-success' : 'bg-muted'
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
                                      return count > 0 ? <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-on-solid">{count > 99 ? '99+' : count}</span> : null;
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
            {renderChatHeaderFrame()}
            {renderChatSearchFrame()}
            {renderChatBannerFrame()}
            {renderChatGroupMembersPopover()}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {renderWorkspaceStream()}
              {renderChatComposerFrame()}
            </div>
          </div>
        </div>

        {renderChatModalsFrame()}
      </div>
      {renderChatOverlaysFrame()}
    </div>
  );
};
