import React, { useState, useRef, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { User, LanChatMessage, LanChatGroup, Project } from '../types';
import { ApiService } from '../services/api';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { EmojiPicker } from './EmojiPicker';
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
  Loader2,
  ZoomIn,
  LockKeyhole,
} from 'lucide-react';

interface LanChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  users: User[];
  projects?: Project[];
  targetUser?: User | null;
  onConversationRead?: (userId?: string) => void;
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

const groupAdminIds = (group: LanChatGroup) =>
  group.adminIds && group.adminIds.length > 0 ? group.adminIds : [group.createdBy];

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

/**
 * Normalizes heterogeneous message timestamps (ISO 8601, HH:mm, or msg-epoch ID)
 * to numeric epoch milliseconds for strict ascending chronological ordering.
 */
export const parseMessageEpoch = (msg: LanChatMessage): number => {
  if (msg.timestamp) {
    const trimmed = msg.timestamp.trim();
    // 1. ISO 8601 or standard date format with year
    const parsed = Date.parse(trimmed);
    if (!isNaN(parsed) && parsed > 1000000000000) {
      return parsed;
    }
    // 2. Time-only format (HH:mm or HH:mm:ss)
    const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      const idMatch = msg.id.match(/^msg-(\d{10,13})/);
      const baseDate = idMatch ? new Date(parseInt(idMatch[1], 10)) : new Date();
      baseDate.setHours(hours, minutes, seconds, 0);
      return baseDate.getTime();
    }
  }
  // 3. Fallback to extracting millisecond timestamp from message ID
  const idMatch = msg.id.match(/^msg-(\d{10,13})/);
  if (idMatch) {
    const idNum = parseInt(idMatch[1], 10);
    return idNum < 10000000000 ? idNum * 1000 : idNum;
  }
  return 0;
};

/**
 * User-friendly display format for message timestamp.
 * Displays "HH:mm" for today's messages, or "MM-DD HH:mm" for historical dates.
 */
export const formatMessageDisplayTime = (rawTimestamp: string): string => {
  if (!rawTimestamp) return '';
  const trimmed = rawTimestamp.trim();
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) {
    return trimmed;
  }
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) {
    return timeStr;
  }
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}-${day} ${timeStr}`;
};

export const LanChatModal: React.FC<LanChatModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  users,
  projects = [],
  targetUser: initialTargetUser,
  onConversationRead,
}) => {
  const [activeTarget, setActiveTarget] = useState<ActiveTargetType>(
    initialTargetUser ? { type: 'user', user: initialTargetUser } : { type: 'broadcast' }
  );

  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGroupMembersModal, setShowGroupMembersModal] = useState(false);
  const [managedMemberIds, setManagedMemberIds] = useState<string[]>([]);
  const [isSavingMembers, setIsSavingMembers] = useState(false);
  const [isClearingChat, setIsClearingChat] = useState(false);
  const [memberManagementError, setMemberManagementError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);

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
  const [createGroupError, setCreateGroupError] = useState<string | null>(null);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const accessibleProjects = projects.filter(
    (project) =>
      project.createdBy === currentUser.id ||
      project.admins.includes(currentUser.id) ||
      project.members.includes(currentUser.id),
  );
  const selectedProject = accessibleProjects.find((project) => project.id === selectedProjectId);
  const selectedProjectMemberIds = selectedProject
    ? new Set([selectedProject.createdBy, ...selectedProject.admins, ...selectedProject.members])
    : null;
  const selectableGroupUsers = selectedProjectMemberIds
    ? users.filter((user) => selectedProjectMemberIds.has(user.id))
    : users;
  const projectSelectOptions: ThemeSelectOption[] = [
    { value: '', label: '不关联特定项目（通用组）', tone: 'slate' },
    ...accessibleProjects.map((project) => ({
      value: project.id,
      label: project.name,
      tone: 'blue' as const,
    })),
  ];

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
      memberIds: Array.from(new Set([p.createdBy, ...p.admins, ...p.members])),
      adminIds: p.admins.length > 0 ? p.admins : [p.createdBy || currentUser.id],
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
          // Merge any newly added projects into saved groups if not already present
          const existingIds = new Set(parsed.map((g) => g.id));
          const newProjectGroups = accessibleProjects
            .filter((p) => !existingIds.has(`group-proj-${p.id}`))
            .map((p) => ({
              id: `group-proj-${p.id}`,
              name: `项目组: ${p.name}`,
              description: p.description || `针对《${p.name}》的研讨与文件分享`,
              avatar: '📁',
              memberIds: Array.from(new Set([p.createdBy, ...p.admins, ...p.members])),
              adminIds: p.admins.length > 0 ? p.admins : [p.createdBy || currentUser.id],
              createdBy: p.createdBy || currentUser.id,
              createdAt: '09:00',
              projectId: p.id,
            }));
          return [...newProjectGroups, ...parsed];
        }
      }
    } catch (e) {
      console.warn('Failed to parse lan_chat_groups from localStorage', e);
    }
    return getDefaultGroups();
  });

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
            return refreshed && refreshed.memberIds.includes(currentUser.id)
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
      setMessages((previous) => appendUniqueMessage(previous, message));
    }).then((dispose) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    });
    listen('sync://operation', () => loadDesktopHistory()).then((dispose) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    });
    return () => {
      disposed = true;
      disposers.forEach((dispose) => dispose());
    };
  }, [isOpen, currentUser.id, projects]);

  useEffect(() => {
    if (!isOpen) return;
    setSendError(null);
    if (activeTarget.type === 'user') {
      onConversationRead?.(activeTarget.user.id);
    } else if (activeTarget.type === 'group') {
      activeTarget.group.memberIds.forEach((memberId) => onConversationRead?.(memberId));
    } else {
      onConversationRead?.();
    }
  }, [activeTarget, isOpen, onConversationRead]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages, activeTarget]);

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
    setNewGroupName('');
    setNewGroupDesc('');
    setNewGroupAvatar('👥');
    setSelectedProjectId('');
    setSelectedMemberIds(users.map((u) => u.id));
    setCreateGroupError(null);
    setIsCreateGroupOpen(true);
  };

  const handleToggleMember = (userId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
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
    setShowGroupMembersModal(true);
  };

  const handleToggleManagedMember = (group: LanChatGroup, userId: string) => {
    if (groupAdminIds(group).includes(userId)) return;
    setManagedMemberIds((previous) =>
      previous.includes(userId)
        ? previous.filter((memberId) => memberId !== userId)
        : [...previous, userId],
    );
  };

  const handleSaveGroupMembers = async (group: LanChatGroup) => {
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

  const handleSendMessage = async (overrideContent?: string) => {
    const textToSend = overrideContent || inputText.trim();
    if (!textToSend) return;
    if (isActiveProjectGroupReadOnly) {
      setSendError('你已不在关联项目中，只能查看历史消息');
      return;
    }
    setSendError(null);

    const timestamp = new Date().toISOString();

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
    if (!overrideContent) setInputText('');
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
        };
        setMessages((prev) => appendUniqueMessage(prev, autoReply));
      }, 1200);
    } else if (!isTauri() && activeTarget.type === 'group') {
      const targetGroup = activeTarget.group;
      const otherMembers = users.filter(
        (u) => targetGroup.memberIds.includes(u.id) && u.id !== currentUser.id
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
  const visibleGroups = groups.filter((group) => group.memberIds.includes(currentUser.id));
  const isActiveProjectGroupReadOnly =
    activeTarget.type === 'group' &&
    Boolean(
      activeTarget.group.projectId &&
        !accessibleProjectIds.has(activeTarget.group.projectId),
    );
  const canManageActiveGroupMembers =
    activeTarget.type === 'group' &&
    !isActiveProjectGroupReadOnly &&
    groupAdminIds(activeTarget.group).includes(currentUser.id);
  const filteredMessages = messages
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

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="lan-chat-modal bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full h-[680px] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 relative">
        {/* Top Header Bar */}
        <div className="lan-chat-header px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
              <Wifi className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-extrabold text-white">局域网与项目组即时通讯</h2>
                <span className="chat-badge-storage text-[10px] bg-emerald-500/20 text-emerald-300 font-mono px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                  <HardDrive className="w-3 h-3 text-emerald-400" />
                  本地存储持久化
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                支持项目协同群组沟通、单对单传输、图片/文件发送与本地记录保留
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Middle Content Split: Left Sidebar + Right Chat Stream */}
        <div className="flex-1 flex min-h-0">
          {/* Left Sidebar */}
          <div className="lan-chat-sidebar w-64 bg-slate-950/70 border-r border-slate-800 p-3 space-y-3 flex flex-col overflow-y-auto">
            {/* All Broadcast Channel Button */}
            <div>
              <div 
                onClick={() => setIsBroadcastCollapsed(!isBroadcastCollapsed)}
                className="chat-section-title text-[10px] font-bold text-slate-500 hover:text-slate-300 uppercase tracking-wider px-1 py-1 rounded hover:bg-slate-800/40 cursor-pointer select-none flex items-center gap-1 transition-colors mb-1"
              >
                {isBroadcastCollapsed ? (
                  <ChevronRight className="w-3 h-3 text-slate-400" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                )}
                <span>全网大厅</span>
              </div>
              {!isBroadcastCollapsed && (
                <button
                  onClick={() => setActiveTarget({ type: 'broadcast' })}
                  data-active={activeTarget.type === 'broadcast'}
                  className={`chat-channel-btn w-full p-2.5 rounded-xl border text-left flex items-center space-x-2.5 text-xs transition-all ${
                    activeTarget.type === 'broadcast'
                      ? 'bg-blue-600/20 border-blue-500/50 text-blue-300 font-bold shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800/80'
                  }`}
                >
                  <div className="channel-icon p-1.5 bg-blue-500/20 text-blue-400 rounded-lg flex-shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="channel-title truncate font-medium">全员广播频道</div>
                    <div className="channel-subtitle text-[10px] text-slate-500 font-mono">LAN Broadcast</div>
                  </div>
                </button>
              )}
            </div>

            {/* Groups Section with Create Group Button */}
            <div className="space-y-1.5">
              <div 
                onClick={() => setIsGroupsCollapsed(!isGroupsCollapsed)}
                className="flex items-center justify-between px-1 py-1 rounded hover:bg-slate-800/40 cursor-pointer select-none group/title"
              >
                <span className="chat-section-title text-[10px] font-bold text-slate-500 group-hover/title:text-slate-300 uppercase tracking-wider flex items-center gap-1 transition-colors">
                  {isGroupsCollapsed ? (
                    <ChevronRight className="w-3 h-3 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-3 h-3 text-slate-400" />
                  )}
                  <FolderKanban className="w-3 h-3 text-purple-400" />
                  <span>项目与协同群组 ({visibleGroups.length})</span>
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenCreateGroup();
                  }}
                  className="chat-btn-create-group p-1 bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white rounded-lg transition-colors text-[10px] flex items-center gap-0.5 border border-purple-500/30"
                  title="新建项目或项目组"
                >
                  <Plus className="w-3 h-3" />
                  <span>建群</span>
                </button>
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
                            ? 'bg-purple-600/20 border-purple-500/60 text-purple-200 font-bold shadow-sm'
                            : 'bg-slate-900/80 border-slate-800/80 text-slate-300 hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="chat-group-avatar-placeholder w-7 h-7 rounded-lg bg-purple-950/60 border border-purple-800/50 flex items-center justify-center text-sm flex-shrink-0">
                          {group.avatar || '👥'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium flex items-center gap-1">
                            <span>{group.name}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono truncate flex items-center gap-1">
                            {linkedProj && (
                              <span className="chat-group-badge text-purple-400 bg-purple-950/50 px-1 rounded border border-purple-800/50">
                                项目
                              </span>
                            )}
                            <span>{group.memberIds.length} 成员</span>
                          </div>
                        </div>
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
                className="chat-section-title text-[10px] font-bold text-slate-500 hover:text-slate-300 uppercase tracking-wider px-1 py-1 rounded hover:bg-slate-800/40 cursor-pointer select-none flex items-center gap-1 transition-colors"
              >
                {isNodesCollapsed ? (
                  <ChevronRight className="w-3 h-3 text-slate-400" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-slate-400" />
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
                              ? 'bg-blue-600/20 border-blue-500/50 text-blue-200 font-bold'
                              : 'bg-slate-900/60 border-slate-800/60 text-slate-300 hover:bg-slate-800/60'
                          }`}
                        >
                          <div className="relative flex-shrink-0">
                            <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-sm overflow-hidden">
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
                              className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-slate-900 ${
                                user.isOnline ? 'bg-emerald-400' : 'bg-slate-600'
                              }`}
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold">{user.nickname}</div>
                            <div className="text-[10px] text-slate-500 font-mono truncate">
                              {user.ip}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          {/* Right Main Chat Window */}
          <div className="flex-1 flex flex-col bg-slate-900/40 relative">
            {/* Active Channel Subheader */}
            <div className="lan-chat-subheader px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2 text-slate-300 font-medium min-w-0 flex-1">
                {activeTarget.type === 'group' ? (
                  <span className="text-base flex-shrink-0">{activeTarget.group.avatar || '👥'}</span>
                ) : (
                  <MessageSquare className="w-4 h-4 text-blue-400 flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    <strong className="text-white text-xs truncate">
                      {activeTarget.type === 'broadcast' && '全员广播频道 (LAN Broadcast)'}
                      {activeTarget.type === 'user' &&
                        `${activeTarget.user.nickname} (${activeTarget.user.ip})`}
                      {activeTarget.type === 'group' && activeTarget.group.name}
                    </strong>
                    {activeTarget.type === 'group' && (
                      <span className="chat-badge-member-count text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30 flex-shrink-0">
                        {activeTarget.group.memberIds.length} 人群组
                      </span>
                    )}
                    {isActiveProjectGroupReadOnly && (
                      <span className="flex flex-shrink-0 items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                        <LockKeyhole className="h-3 w-3" aria-hidden="true" />
                        已退出项目 · 历史只读
                      </span>
                    )}
                  </div>
                  {activeTarget.type === 'group' && activeTarget.group.description && (
                    <div className="text-[10px] text-slate-400 truncate max-w-md mt-0.5">
                      {activeTarget.group.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Tools in Subheader */}
              <div className="flex items-center space-x-2 flex-shrink-0">
                {activeTarget.type === 'group' && (
                  <button
                    onClick={() =>
                      showGroupMembersModal
                        ? setShowGroupMembersModal(false)
                        : handleOpenGroupMembers(activeTarget.group)
                    }
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-[11px] flex items-center space-x-1 transition-colors"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-purple-400" />
                    <span>
                      {canManageActiveGroupMembers ? '成员管理' : '成员'}
                    </span>
                  </button>
                )}

                {/* Clear Chat Button */}
                <button
                  type="button"
                  onClick={handleClearCurrentChat}
                  disabled={isClearingChat}
                  className="chat-btn-clear p-1.5 bg-rose-500/10 hover:bg-rose-600/20 text-rose-400 hover:text-rose-300 rounded-lg text-[11px] flex items-center space-x-1 border border-rose-500/20 transition-colors disabled:cursor-wait disabled:opacity-60"
                  title="清空当前对话记录"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isClearingChat ? '正在清空...' : '清空当前对话'}</span>
                </button>

                <span className="text-[10px] text-slate-500 font-mono">
                  {filteredMessages.length} 条记录
                </span>
              </div>
            </div>

            {/* Group Members Popover */}
            {showGroupMembersModal && activeTarget.type === 'group' && (
              <div className="lan-chat-submodal absolute top-12 right-4 w-80 bg-slate-900 border border-slate-700 rounded-xl p-3 shadow-2xl z-30 space-y-2.5 animate-in fade-in duration-100">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div>
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>群组成员 ({managedMemberIds.length})</span>
                      {groupAdminIds(activeTarget.group).includes(currentUser.id) && (
                        <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-300">
                          <Crown className="h-3 w-3" /> 管理员
                        </span>
                      )}
                    </span>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {canManageActiveGroupMembers
                        ? '勾选局域网节点以增加或移除群成员'
                        : '仅群管理员可以修改成员'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowGroupMembersModal(false)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                  {users
                    .filter(
                      (user) => {
                        const project = activeTarget.group.projectId
                          ? accessibleProjects.find(
                              (item) => item.id === activeTarget.group.projectId,
                            )
                          : null;
                        const belongsToAssociatedProject = !project ||
                          project.createdBy === user.id ||
                          project.admins.includes(user.id) ||
                          project.members.includes(user.id);
                        return belongsToAssociatedProject &&
                          (canManageActiveGroupMembers ||
                            activeTarget.group.memberIds.includes(user.id));
                      },
                    )
                    .map((member) => {
                      const isAdmin = groupAdminIds(activeTarget.group).includes(member.id);
                      const isMember = managedMemberIds.includes(member.id);
                      const canEdit = canManageActiveGroupMembers && !isAdmin;
                      return (
                        <button
                          key={member.id}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => handleToggleManagedMember(activeTarget.group, member.id)}
                          className={`flex w-full items-center justify-between rounded border p-2 text-left text-xs transition-colors ${
                            isMember
                              ? 'border-purple-500/30 bg-purple-500/10'
                              : 'border-slate-800 bg-slate-950/60'
                          } ${canEdit ? 'cursor-pointer hover:border-purple-500/60' : 'cursor-default'}`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {isMember ? (
                              <CheckSquare className="h-4 w-4 flex-shrink-0 text-purple-400" />
                            ) : (
                              <Square className="h-4 w-4 flex-shrink-0 text-slate-600" />
                            )}
                            <span className="text-sm">{member.avatar || '👤'}</span>
                            <span className="truncate font-medium text-slate-200">{member.nickname}</span>
                          </span>
                          {isAdmin ? (
                            <span className="flex flex-shrink-0 items-center gap-1 text-[9px] text-amber-300">
                              <Crown className="h-3 w-3" /> 管理员
                            </span>
                          ) : (
                            <span className="flex-shrink-0 text-[9px] text-slate-500">
                              {isMember ? '已加入' : '未加入'}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
                {memberManagementError && (
                  <p className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-300">
                    {memberManagementError}
                  </p>
                )}
                {canManageActiveGroupMembers && (
                  <div className="flex justify-end gap-2 border-t border-slate-800 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowGroupMembersModal(false)}
                      className="ui-cancel-button rounded-lg px-3 py-1.5 text-[11px]"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={isSavingMembers}
                      onClick={() => handleSaveGroupMembers(activeTarget.group)}
                      className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
                    >
                      {isSavingMembers && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      保存成员
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Chat Stream List */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3">
              {filteredMessages.length === 0 ? (
                <div className="text-center py-16 text-slate-500 text-xs">
                  <Bot className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p>暂无通信消息或记录已被清空</p>
                  <p className="text-[10px] text-slate-600 mt-1">
                    在下方发送局域网消息、文件或图片，内容将自动保存在本地
                  </p>
                </div>
              ) : (
                filteredMessages.map((msg) => {
                  const isSelf = msg.senderId === currentUser.id;
                  const isImgAvatar =
                    msg.senderAvatar &&
                    (msg.senderAvatar.startsWith('data:image') ||
                      msg.senderAvatar.startsWith('http'));

                  return (
                    <div
                      key={msg.id}
                      className={`flex items-start gap-2.5 ${
                        isSelf ? 'flex-row-reverse' : 'flex-row'
                      }`}
                    >
                      {/* Avatar */}
                      <div
                        className="w-7 h-7 rounded-xl flex items-center justify-center text-xs overflow-hidden flex-shrink-0 mt-0.5 border shadow-sm font-bold"
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
                        className={`max-w-[75%] space-y-1 ${
                          isSelf ? 'items-end text-right' : 'items-start text-left'
                        }`}
                      >
                        <div className="flex items-center space-x-2 text-[10px] text-slate-400">
                          <span className="font-semibold" style={{ color: isSelf ? 'var(--accent)' : 'var(--text-main)' }}>
                            {msg.senderName}
                          </span>
                          <span className="font-mono text-slate-500">{formatMessageDisplayTime(msg.timestamp)}</span>
                        </div>

                        {/* Render Text */}
                        {msg.type === 'text' && (
                          <div
                            className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed inline-block break-words shadow-sm ${
                              isSelf
                                ? 'text-white rounded-br-xs shadow-md'
                                : 'rounded-bl-xs border'
                            }`}
                            style={{
                              background: isSelf ? 'var(--accent-gradient)' : 'var(--bg-card)',
                              color: isSelf ? '#ffffff' : 'var(--text-main)',
                              borderColor: isSelf ? 'transparent' : 'var(--border-main)',
                              boxShadow: isSelf ? '0 4px 14px var(--accent-glow)' : 'none',
                            }}
                          >
                            {msg.content}
                          </div>
                        )}

                        {/* Render Image */}
                        {msg.type === 'image' && (
                          <div className="bg-slate-950 border border-slate-800 p-2 rounded-xl inline-block max-w-sm">
                            {msg.fileUrl ? (
                              <button
                                type="button"
                                className="group relative block overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
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
                                <span className="absolute inset-0 flex items-center justify-center bg-slate-950/0 text-white opacity-0 transition-all group-hover:bg-slate-950/30 group-hover:opacity-100">
                                  <ZoomIn className="h-5 w-5" />
                                </span>
                              </button>
                            ) : (
                              <div className="text-xs text-slate-400 p-2">图片文件：{msg.content}</div>
                            )}
                            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                              <span className="truncate max-w-[150px]">{msg.fileName}</span>
                              <span className="font-mono">{msg.fileSize}</span>
                            </div>
                          </div>
                        )}

                        {/* Render File */}
                        {msg.type === 'file' && (
                          <div className="bg-slate-800/90 border border-slate-700 p-3 rounded-xl inline-flex items-center space-x-3 max-w-sm text-left">
                            <div className="p-2.5 bg-purple-500/20 text-purple-300 rounded-lg">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold text-white truncate">
                                {msg.fileName || msg.content}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                {msg.fileSize || '传输文件'}
                              </div>
                            </div>
                            {msg.fileUrl && msg.fileUrl !== '#' && (
                              <button
                                type="button"
                                onClick={() => handleDownloadFile(msg)}
                                className="p-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors flex-shrink-0"
                                title="下载局域网文件"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            )}
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
            <div className="lan-chat-input-bar p-3 bg-slate-950/90 border-t border-slate-800 space-y-2 relative">
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
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm'
                        : 'hover:bg-slate-800 text-slate-400 hover:text-amber-400 border border-transparent'
                    }`}
                    title={showEmojiPicker ? '关闭表情 (Esc)' : '插入表情'}
                  >
                    <Smile className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={isActiveProjectGroupReadOnly}
                    className="chat-tool-btn p-1.5 hover:bg-slate-800 text-slate-400 hover:text-purple-400 rounded-lg transition-colors text-xs flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40"
                    title="发送图片"
                  >
                    <ImageIcon className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => (isTauri() ? handleDesktopFileUpload() : fileInputRef.current?.click())}
                    disabled={isActiveProjectGroupReadOnly}
                    className="chat-tool-btn p-1.5 hover:bg-slate-800 text-slate-400 hover:text-blue-400 rounded-lg transition-colors text-xs flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40"
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

                <div className="text-[10px] text-slate-500 font-mono">
                  {isActiveProjectGroupReadOnly ? '历史消息保留，已停止接收新消息' : '按 Enter 键发送 · Shift + Enter 换行'}
                </div>
              </div>

              {sendError && (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[10px] text-rose-300">
                  {sendError}
                </p>
              )}

              {/* Input Text Field & Send */}
              <div className="flex items-end space-x-2">
                <textarea
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
                  className="flex-1 rounded-xl px-3.5 py-2.5 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40 resize-none min-h-[64px] disabled:cursor-not-allowed disabled:opacity-60 shadow-inner"
                />

                <button
                  type="button"
                  onClick={() => handleSendMessage()}
                  disabled={!inputText.trim() || isActiveProjectGroupReadOnly}
                  className="theme-btn-primary h-[64px] font-bold px-5 rounded-xl text-xs flex items-center justify-center space-x-1.5 shadow-md flex-shrink-0 disabled:opacity-40"
                >
                  <Send className="w-4 h-4" />
                  <span>发送</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Create Group Modal Overlay */}
        {isCreateGroupOpen && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md z-40 flex items-center justify-center p-6">
            <form
              onSubmit={handleCreateGroupSubmit}
              className="lan-chat-submodal bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <div className="p-2 bg-purple-500/20 text-purple-400 rounded-xl">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">创建项目与局域网协同群组</h3>
                    <p className="text-[11px] text-slate-400">建立专属项目群组并挑选局域网协同成员</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateGroupOpen(false)}
                  className="p-1 text-slate-400 hover:text-white rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Group Name & Icon Picker */}
              <div className="space-y-3">
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Users className="h-3.5 w-3.5 text-blue-400" />
                    <span>群组名称 <span className="text-rose-400">*</span></span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="例如: 前端与 AI 专项攻坚组"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>

                {/* Project Association Dropdown */}
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <FolderKanban className="h-3.5 w-3.5 text-purple-400" />
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
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Smile className="h-3.5 w-3.5 text-amber-400" />
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
                            ? 'bg-purple-600/30 border-purple-500 text-purple-200 scale-105'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <FileText className="h-3.5 w-3.5 text-slate-400" />
                    <span>群组宗旨 / 简介</span>
                  </label>
                  <input
                    type="text"
                    value={newGroupDesc}
                    onChange={(e) => setNewGroupDesc(e.target.value)}
                    placeholder="例如: 用于分享架构设计图与后端性能优化报告"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>

                {/* Member Selection List */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                      <Users className="h-3.5 w-3.5 text-emerald-400" />
                      <span>选择初始群成员 ({selectedMemberIds.length} 人)</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleSelectAllMembers}
                      className="btn-select-all text-[10px] text-purple-400 hover:underline"
                    >
                      {selectableGroupUsers.every((user) => selectedMemberIds.includes(user.id))
                        ? '反选'
                        : '全选'}
                    </button>
                  </div>

                  <div className="member-list-box max-h-32 overflow-y-auto space-y-1 bg-slate-950/80 border border-slate-800 rounded-xl p-2">
                    {selectableGroupUsers.map((u) => {
                      const isChecked = selectedMemberIds.includes(u.id);
                      const isSelf = u.id === currentUser.id;

                      return (
                        <div
                          key={u.id}
                          onClick={() => handleToggleMember(u.id)}
                          className="member-item flex items-center justify-between p-1.5 rounded hover:bg-slate-800/80 cursor-pointer text-xs"
                        >
                          <div className="flex items-center space-x-2">
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-purple-400" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-600" />
                            )}
                            <span className="member-item-title text-slate-200 font-medium">{u.nickname}</span>
                            {isSelf && (
                              <span className="member-item-owner text-[9px] bg-blue-500/20 text-blue-300 px-1 rounded">
                                我 (群主)
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">{u.ip}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Form Action Buttons */}
              {createGroupError && (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {createGroupError}
                </p>
              )}
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
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
                  className="btn-confirm-group bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-xl text-xs transition-all shadow-md shadow-purple-600/30"
                >
                  {isCreatingGroup ? '正在创建...' : '确认创建群组'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/90 p-6 backdrop-blur-sm"
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
              className="absolute -right-3 -top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-slate-200 shadow-xl transition-colors hover:bg-slate-800 hover:text-white"
              title="关闭预览"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={previewImage.url}
              alt={previewImage.name}
              className="max-h-[calc(100vh-7rem)] max-w-[calc(100vw-5rem)] rounded-lg object-contain shadow-2xl"
            />
            <div className="mt-3 max-w-[min(80vw,720px)] truncate rounded-md bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200">
              {previewImage.name}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
