import { scopedStorageKey, getWorkspaceContext } from "./utils/workspaceContext";
import { currentLocale } from './i18n/core';
import { localizeMessage } from './i18n/messages';
import { tr, useLocale } from "./i18n";
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { AlertCircle, Archive, BookOpen, LoaderCircle, QrCode, RefreshCw, RotateCcw } from 'lucide-react';
import {
  User,
  Project,
  Task,
  TaskStatus,
  WorkItemState,
  Workspace,
  WorkspaceMember,
  LanChatMessage,
  LanGroupAnnouncement,
  TaskAssignmentNotification,
  ChatUnreadSummary,
  ChatConversationRef,
  LocalDirectory,
} from './types';
import { calculateNextDueDate } from './utils/recurrence';
import {
  calculateReminderTime,
  formatLocalTaskDateTime,
  formatTaskDueDate,
  inferReminderMinutes,
  parseTaskDateTime,
} from './utils/taskDateTime';
import { ApiService, NetworkPeer, NetworkStatus, TASKS_CHANGED_EVENT } from './services/api';
import { Header } from './components/Header';
import { Sidebar, MainView } from './components/Sidebar';
import { ListView } from './components/ListView';
import { CalendarView } from './components/CalendarView';
import { TimelineView } from './components/TimelineView';
import { KanbanView } from './components/KanbanView';
import { LLMReportStudio } from './components/LLMReportStudio';
import { QuickAddModal } from './components/QuickAddModal';
import { TaskModal } from './components/TaskModal';
import { TaskActivityModal } from './components/TaskActivityModal';
import { TaskInfoModal } from './components/TaskInfoModal';
import { taskIdFromLink } from './utils/taskLinks';
import { getCurrent as getDeepLinks, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { getTaskTagUsage } from './utils/taskTags';
import { ProjectModal } from './components/ProjectModal';
import { ProjectCreateModal } from './components/ProjectCreateModal';
import { ProjectSettingsModal } from './components/ProjectSettingsModal';
import { ProjectArchiveModal } from './components/ProjectArchiveModal';
import { ArchivedProjectsModal } from './components/ArchivedProjectsModal';
import { ProjectToolbar } from './components/ProjectToolbar';
import { ProjectFilesPanel } from './components/ProjectFilesPanel';
import { filterTasksByLayout, parseGroupFilterValue, useTaskLayout, useTaskToday } from './utils/taskLayout';
import { GROUP_TO_LEGACY_STATUS, defaultStateFor } from './utils/workItemState';
import { expandTaskOccurrences } from './utils/recurrence';
import { RiskAlertsModal } from './components/RiskAlertsModal';
import { SyncMonitorModal } from './components/SyncMonitorModal';
import { LLMConfigModal } from './components/LLMConfigModal';
import { LANNodesRightPanel } from './components/LANNodesRightPanel';
import { UserProfileModal } from './components/UserProfileModal';
import { LanChatModal } from './components/LanChatModal';
import { ThemeModal } from './components/ThemeModal';
import { ShortcutModal, ShortcutItem, DEFAULT_SHORTCUTS } from './components/ShortcutModal';
import { SettingsModal, SettingsTab } from './components/SettingsModal';
import { WorkspaceModal } from './components/workspace/WorkspaceModal';
import { AppContextMenu, AppContextMenuItem } from './components/AppContextMenu';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { AppLockGate } from './components/AppLockGate';
import { AppStartupReady, StartupLockView } from './components/AppStartupReady';
import { buildTaskDuplicate } from './utils/taskDuplicate';
import { isUserMentioned } from './utils/chatMentions';
import { AppShell } from './app/AppShell';
import { AppRail, AppSection } from './app/AppRail';
import { CommandPalette, CommandItem, defaultCommandIcons } from './components/command/CommandPalette';
import { WikiView } from './components/wiki/WikiView';
import { loadWikiState, saveWikiState, createWikiDocument } from './components/wiki/wikiStore';
import { wikiIdFromLink } from './components/wiki/wikiLinks';
import { aiConversationIdFromLink } from './components/ai/aiLinks';
import { LanMindAIDrawer } from './components/drawer/LanMindAIDrawer';
import { RightDrawerRoot } from './components/drawer/RightDrawerRoot';
import { IssuePeekDrawer } from './components/drawer/IssuePeekDrawer';
import OpticalTransferApp from './optical/OpticalTransferApp';
import { AIWorkspace } from './components/ai/AIWorkspace';

const BROWSER_FALLBACK_USER: User = {
  id: 'local-user@desktop',
  username: 'local-user',
  deviceId: 'desktop',
  get nickname() { return tr("common:app.localUser"); },
  role: 'admin',
  ip: '127.0.0.1',
  isOnline: true,
  lastActive: new Date().toISOString(),
};

const avatarToTrayRgba = async (avatar: string | undefined, fallback: string): Promise<number[]> => {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) return [];
  context.clearRect(0, 0, 32, 32);
  context.fillStyle = '#2563eb';
  context.fillRect(0, 0, 32, 32);
  if (avatar && (avatar.startsWith('data:image') || avatar.startsWith('http'))) {
    try {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = avatar;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('avatar image failed'));
      });
      context.drawImage(image, 0, 0, 32, 32);
    } catch {
      context.fillStyle = '#2563eb';
      context.fillRect(0, 0, 32, 32);
    }
  } else {
    context.fillStyle = '#2563eb';
    context.fillRect(0, 0, 32, 32);
    context.fillStyle = '#ffffff';
    context.font = '20px "Segoe UI Emoji", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(avatar || fallback || '•', 16, 16);
  }
  try {
    return Array.from(context.getImageData(0, 0, 32, 32).data);
  } catch {
    return [];
  }
};

const canWriteTask = (task: Task, userId: string, projects: Project[]) => {
  const project = task.projectId
    ? projects.find((item) => item.id === task.projectId)
    : undefined;
  const isProjectAdmin = Boolean(
    project &&
      (project.createdBy === userId || project.admins.includes(userId)),
  );
  if (isProjectAdmin) return true;
  if (task.creatorId === userId || task.assigneeId === userId) return true;
  if (task.projectId && task.isShared) {
    return Boolean(
      project &&
        (project.createdBy === userId ||
          project.admins.includes(userId) ||
          project.members.includes(userId)),
    );
  }
  return !task.isShared && (task.sharedWith || []).includes(userId);
};

const loadSavedShortcuts = (): ShortcutItem[] => {
  const saved = localStorage.getItem('p2p_studio_shortcuts');
  if (!saved) return DEFAULT_SHORTCUTS;
  try {
    const parsed = JSON.parse(saved) as ShortcutItem[];
    if (!Array.isArray(parsed)) return DEFAULT_SHORTCUTS;
    return DEFAULT_SHORTCUTS.map((fallback) => {
      const stored = parsed.find((item) => item.id === fallback.id);
      if (!stored) return fallback;
      const isLegacyQuickAdd =
        stored.id === 'quickAdd' &&
        stored.code === 'Space' &&
        stored.altKey &&
        !stored.ctrlKey &&
        !stored.shiftKey;
      return isLegacyQuickAdd
        ? fallback
        : {
            ...fallback,
            ...stored,
            name: fallback.name,
            description: fallback.description,
          };
    });
  } catch {
    return DEFAULT_SHORTCUTS;
  }
};

const shortcutBindings = (items: ShortcutItem[]) =>
  items.map((item) => ({
    action: item.id,
    accelerator: item.keyLabel.replace(/\s+\+\s+/g, '+'),
  }));

// v2 intentionally invalidates the old marker set.  The previous version
// recorded a reminder as sent while the notification window could still be
// hidden/not ready, so those tasks were then skipped forever.
const SENT_REMINDERS_KEY = 'lanmind_sent_task_reminders_v2';

function MainApp({ initialUser }: { initialUser: User }) {
  useLocale();
  const { currentTheme, themePreference } = useTheme();

  // State
  const [users, setUsers] = useState<User[]>([]);
  const [localDirectory, setLocalDirectory] = useState<LocalDirectory>({ units: [], members: [] });
  const [networkPeers, setNetworkPeers] = useState<NetworkPeer[]>([]);
  const [currentUser, setCurrentUser] = useState<User>(initialUser);

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  /** 所有已知的工作项状态（含个人与各项目）。 */
  const [allStates, setAllStates] = useState<WorkItemState[]>([]);
  /** 个人任务的状态列表（projectId 为 null 的那一套）。项目状态按需单独读取。 */
  const [personalStates, setPersonalStates] = useState<WorkItemState[]>([]);
  /** 当前选中项目的状态列表。切换项目时重新读取。 */
  const [projectStates, setProjectStates] = useState<WorkItemState[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const tagSuggestions = useMemo(() => getTaskTagUsage(tasks), [tasks]);
  const [syncVersion, setSyncVersion] = useState<number>(1);
  const [riskCount, setRiskCount] = useState<number>(0);
  const [assignmentNotifications, setAssignmentNotifications] = useState<TaskAssignmentNotification[]>([]);
  const announcedAssignmentIds = useRef(new Set<string>());
  const refreshRequestId = useRef(0);

  const lanUsers = useMemo(() => {
    const merged = new Map<string, User>(
      users.map((user) => [
        user.id,
        { ...user, isOnline: user.id === currentUser.id },
      ] as const),
    );
    for (const peer of networkPeers) {
      const existing = merged.get(peer.userId);
      merged.set(peer.userId, {
        id: peer.userId,
        username: existing?.username || peer.displayName,
        deviceId: existing?.deviceId || peer.deviceId,
        nickname: existing?.nickname || peer.displayName,
        role: existing?.role || 'user',
        ip: peer.address,
        isOnline: true,
        lastActive: peer.lastSeen,
        avatar: existing?.avatar,
      });
    }
    return Array.from(merged.values());
  }, [currentUser.id, networkPeers, users]);

  const workspaceUserIds = useMemo(
    () => new Set(workspaceMembers.map((m) => m.userId)),
    [workspaceMembers],
  );

  const workspaceLanUsers = useMemo(() => {
    if (workspaceMembers.length === 0) return [];
    return lanUsers.filter((u) => u.id === currentUser.id || workspaceUserIds.has(u.id));
  }, [lanUsers, workspaceMembers, workspaceUserIds, currentUser.id]);

  // Active View State
  const [currentView, setCurrentView] = useState<MainView>(() => {
    const hash = window.location.hash.replace('#', '').split('?')[0];
    if (hash === 'report') return 'llm_studio';
    if (hash.startsWith('ai/') || hash.startsWith('/ai/')) return 'ai';
    if (hash.startsWith('wiki/') || hash.startsWith('/wiki/')) return 'wiki';
    if (['inbox', 'today', 'upcoming', 'calendar', 'kanban', 'llm_studio', 'wiki', 'chat', 'ai'].includes(hash)) {
      return hash as MainView;
    }
    return 'inbox';
  });
  const [taskListDateFilter, setTaskListDateFilter] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const { layout: projectLayout, updateLayout: updateProjectLayout } = useTaskLayout(currentUser.id, selectedProjectId);
  const taskToday = useTaskToday();
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const activeView = selectedProjectId ? projectLayout.view : currentView;
  /**
   * 当前作用域的状态列表。
   * 选中项目时使用该项目的状态列表；全局跨项目视图返回空列表，让视图退回按 5 个标准状态组渲染。
   */
  const activeStates = selectedProjectId ? projectStates : [];

  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [linkedWikiId, setLinkedWikiId] = useState<string | null>(null);
  const [linkedAiConversationId, setLinkedAiConversationId] = useState<string | null>(() => aiConversationIdFromLink(window.location.href));
  const [linkedTaskId, setLinkedTaskId] = useState<string | null>(() => taskIdFromLink(window.location.href));
  const [taskToEdit, setTaskToEdit] = useState<Task | null>(null);

  // Navigation History (Back & Forward)
  const [navHistory, setNavHistory] = useState<Array<{ view: MainView; projectId: string | null }>>(() => [
    { view: currentView, projectId: null },
  ]);
  const [navIndex, setNavIndex] = useState<number>(0);
  const isHistoryNavRef = useRef(false);

  useEffect(() => {
    if (isHistoryNavRef.current) {
      isHistoryNavRef.current = false;
      return;
    }
    setNavHistory((prev) => {
      const currentEntry = prev[navIndex];
      if (currentEntry && currentEntry.view === currentView && currentEntry.projectId === selectedProjectId) {
        return prev;
      }
      const trimmed = prev.slice(0, navIndex + 1);
      return [...trimmed, { view: currentView, projectId: selectedProjectId }];
    });
    setNavIndex((prev) => prev + 1);
  }, [currentView, selectedProjectId]);

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;

  const handleGoBack = () => {
    if (navIndex > 0) {
      const target = navHistory[navIndex - 1];
      if (target) {
        isHistoryNavRef.current = true;
        setNavIndex(navIndex - 1);
        setSelectedProjectId(target.projectId);
        setTaskListDateFilter(null);
        setCurrentView(target.view);
      }
    }
  };

  const handleGoForward = () => {
    if (navIndex < navHistory.length - 1) {
      const target = navHistory[navIndex + 1];
      if (target) {
        isHistoryNavRef.current = true;
        setNavIndex(navIndex + 1);
        setSelectedProjectId(target.projectId);
        setTaskListDateFilter(null);
        setCurrentView(target.view);
      }
    }
  };
  const [activityTask, setActivityTask] = useState<Task | null>(null);
  const [initialTaskDate, setInitialTaskDate] = useState<string | undefined>(undefined);
  const [initialTaskStateId, setInitialTaskStateId] = useState<string | undefined>(undefined);
  const [initialTaskProjectId, setInitialTaskProjectId] = useState<string | undefined>(undefined);
  const [taskModalInitialTitle, setTaskModalInitialTitle] = useState('');
  const [taskModalInitialDescription, setTaskModalInitialDescription] = useState('');

  const editingTaskStates = useMemo(() => {
    if (selectedProjectId && projectStates.length) return projectStates;
    const targetPid = taskToEdit?.projectId || initialTaskProjectId;
    if (targetPid) {
      const scoped = allStates.filter((s) => s.projectId === targetPid);
      if (scoped.length) return scoped;
    }
    return personalStates;
  }, [selectedProjectId, projectStates, taskToEdit?.projectId, initialTaskProjectId, allStates, personalStates]);

  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isProjectCreateModalOpen, setIsProjectCreateModalOpen] = useState(false);
  const [isProjectSettingsModalOpen, setIsProjectSettingsModalOpen] = useState(false);
  const [projectToManage, setProjectToManage] = useState<Project | null>(null);
  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);
  const [projectAction, setProjectAction] = useState<'manage' | 'transfer' | 'delete'>('manage');
  const [filesProject, setFilesProject] = useState<Project | null>(null);

  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [projectToArchive, setProjectToArchive] = useState<Project | null>(null);
  const [isArchivedProjectsModalOpen, setIsArchivedProjectsModalOpen] = useState(false);

  const handleConfirmArchiveProject = async (proj: Project) => {
    const archivedAt = new Date().toISOString();
    await ApiService.updateProject(proj.id, { isArchived: true, archivedAt }, currentUser.id);
    setProjects((prev) =>
      prev.map((p) => (p.id === proj.id ? { ...p, isArchived: true, archivedAt } : p))
    );
    if (selectedProjectId === proj.id) {
      setSelectedProjectId(null);
      setCurrentView('inbox');
    }
  };

  const handleRestoreProject = async (proj: Project) => {
    await ApiService.updateProject(proj.id, { isArchived: false, archivedAt: null }, currentUser.id);
    setProjects((prev) =>
      prev.map((p) => (p.id === proj.id ? { ...p, isArchived: false, archivedAt: null } : p))
    );
  };

  const [isLLMConfigOpen, setIsLLMConfigOpen] = useState(false);
  const [isRiskScannerOpen, setIsRiskScannerOpen] = useState(false);
  const [isSyncMonitorOpen, setIsSyncMonitorOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [isShortcutModalOpen, setIsShortcutModalOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);

  // LAN Chat Modal State
  const [isLanChatOpen, setIsLanChatOpen] = useState(false);
  const [lanChatTarget, setLanChatTarget] = useState<User | null>(null);
  const [lanChatConversation, setLanChatConversation] = useState<ChatConversationRef | undefined>();
  const [unreadSummaries, setUnreadSummaries] = useState<ChatUnreadSummary[]>([]);
  const refreshUnreadSummaries = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setUnreadSummaries(await ApiService.getChatUnreadSummaries(currentUser.id));
    } catch (error) {
      console.warn('Failed to refresh chat unread summaries', error);
    }
  }, [currentUser.id]);

  const unreadMessagesByUser = useMemo(() => Object.fromEntries(
    unreadSummaries
      .filter((summary) => summary.conversation.kind === 'user')
      .map((summary) => [summary.conversation.kind === 'user' ? summary.conversation.targetId : summary.key, summary.count]),
  ), [unreadSummaries]);
  const unreadMessageTotal = unreadSummaries.reduce((total, summary) => total + summary.count, 0);

  const markConversationMessagesRead = useCallback((conversationKey?: string, messageIds: string[] = []) => {
    if (!conversationKey || !messageIds.length) return;
    setUnreadSummaries((previous) => previous
      .map((summary) => summary.key === conversationKey
        ? { ...summary, count: Math.max(0, summary.count - messageIds.length), firstUnreadMessageId: undefined }
        : summary)
      .filter((summary) => summary.count > 0));
  }, []);

  const handleOpenLanChat = (targetUser?: User, conversation?: ChatConversationRef) => {
    setLanChatTarget(targetUser || null);
    setLanChatConversation(conversation || (targetUser ? { kind: 'user', targetId: targetUser.id } : { kind: 'broadcast' }));
    setSelectedProjectId(null);
    setCurrentView('chat');
  };

  // Settings Modal State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<SettingsTab>(() => {
    if (window.location.hash.includes('llm')) return 'llm';
    return 'basic';
  });

  const handleOpenSettingsModal = (tab: SettingsTab = 'basic') => {
    setSettingsDefaultTab(tab);
    setSelectedProjectId(null);
    setCurrentView('settings');
  };

  const closeContextMenu = useCallback(() => setContextMenuPosition(null), []);
  const contextMenuItems = useMemo<AppContextMenuItem[]>(
    () => [
      {
        id: 'refresh',
        label: tr("common:app.refresh"),
        icon: RefreshCw,
        onSelect: () => window.location.reload(),
      },
    ],
    [currentLocale()],
  );

  // Custom Keyboard Shortcuts State
  const [shortcuts, setShortcuts] = useState<ShortcutItem[]>(loadSavedShortcuts);

  const handleSaveShortcuts = async (newShortcuts: ShortcutItem[]) => {
    await ApiService.setGlobalShortcuts(shortcutBindings(newShortcuts));
    setShortcuts(newShortcuts);
    localStorage.setItem('p2p_studio_shortcuts', JSON.stringify(newShortcuts));
  };

  // Right LAN Nodes Panel State
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('lan_nodes_panel_open');
      if (saved !== null) {
        return saved === 'true';
      }
    } catch {
      // ignore
    }
    return true;
  });

  const handleToggleRightPanel = useCallback(() => {
    setIsRightPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('lan_nodes_panel_open', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Contextual drawers are mounted once at the shell level so they can be opened
  // from any workspace without interrupting the current task view.
  const [drawerMode, setDrawerMode] = useState<'none' | 'ai'>('none');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Load Data
  const refreshAllData = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    try {
      const [uList, pList, tList, syncData, risks, assignmentNotices, directory, states, currentWorkspace, wsMembers] = await Promise.all([
        ApiService.getUsers(),
        ApiService.getProjects(currentUser.id),
        ApiService.getTasks(currentUser.id),
        ApiService.getSyncLogsPage({ pageSize: 1 }),
        ApiService.getRiskWarnings(currentUser.id),
        ApiService.getTaskAssignmentNotifications(currentUser.id),
        ApiService.getLocalDirectory(),
        ApiService.getStates(null, currentUser.id),
        ApiService.getWorkspace(),
        ApiService.getWorkspaceMembers(currentUser.id).catch(() => []),
      ]);

      if (requestId !== refreshRequestId.current) return;
      setUsers(uList);
      setLocalDirectory(directory);
      setProjects(pList);
      setTasks(tList);
      setSyncVersion(syncData.latestVersion);
      setRiskCount(risks.length);
      setAssignmentNotifications(assignmentNotices);
      setAllStates(states);
      setPersonalStates(states.filter((s) => !s.projectId));
      setWorkspace(currentWorkspace);
      setWorkspaceMembers(wsMembers);

      // Keep currentUser synced
      const me = uList.find((u) => u.id === currentUser.id);
      if (me) setCurrentUser(me);
    } catch (e) {
      if (requestId === refreshRequestId.current) {
        console.error('Error fetching data', e);
      }
    }
  }, [currentUser.id]);

  const showDesktopNotification = useCallback(async (
    title: string,
    body: string,
    kind: 'assignment' | 'message' | 'reminder',
  ) => {
    if (!isTauri()) return false;
    await ApiService.showNotificationWindow({
      id: `${kind}:${crypto.randomUUID()}`,
      kind,
      title,
      body,
      createdAt: new Date().toISOString(),
      themeId: currentTheme.id,
      themePreference,
    });
    return true;
  }, [currentTheme.id, themePreference]);

  useEffect(() => {
    if (!isTauri() || assignmentNotifications.length === 0) return;
    const freshNotifications = assignmentNotifications.filter(
      (notification) => !announcedAssignmentIds.current.has(notification.id),
    );
    if (freshNotifications.length === 0) return;
    freshNotifications.forEach((notification) => announcedAssignmentIds.current.add(notification.id));

    freshNotifications.forEach((notification) => {
      void (async () => {
        let sent = false;
        try {
          sent = await showDesktopNotification(
            tr("common:app.assignedANewTask", { value0: notification.assignerName }),
            notification.taskTitle,
            'assignment',
          );
        } catch (error) {
          announcedAssignmentIds.current.delete(notification.id);
          console.error('Failed to send task assignment notification', error);
          return;
        }
        if (!sent) {
          announcedAssignmentIds.current.delete(notification.id);
          return;
        }

        try {
          await ApiService.markTaskAssignmentNotificationsRead(
            [notification.id],
            currentUser.id,
          );
          setAssignmentNotifications((previous) =>
            previous.filter((item) => item.id !== notification.id),
          );
        } catch (error) {
          console.error('Failed to mark task assignment notification as read', error);
        }
      })();
    });
  }, [assignmentNotifications, currentUser.id, showDesktopNotification]);

  useEffect(() => {
    if (!isTauri()) return;
    void refreshUnreadSummaries();
  }, [refreshUnreadSummaries]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const subscriptions: Array<() => void> = [];
    const keepSubscription = (dispose: () => void) => {
      if (disposed) dispose();
      else subscriptions.push(dispose);
    };

    void listen('sync://operation', () => void refreshAllData()).then(keepSubscription);
    void listen(TASKS_CHANGED_EVENT, () => void refreshAllData()).then(keepSubscription);
    void listen('workspace://changed', () => void refreshAllData()).then(keepSubscription);

    return () => {
      disposed = true;
      subscriptions.forEach((dispose) => dispose());
    };
  }, [refreshAllData]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    const snoozeTimers: number[] = [];

    listen<{
      id: string;
      title: string;
      body: string;
      kind: 'assignment' | 'message' | 'reminder';
      snoozeMinutes: number;
    }>('notification://snooze', (event) => {
      const { title, body, kind, snoozeMinutes } = event.payload;
      const delayMs = Math.max(1, snoozeMinutes) * 60_000;
      const timerId = window.setTimeout(() => {
        void showDesktopNotification(title, body, kind);
      }, delayMs);
      snoozeTimers.push(timerId);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
      snoozeTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [showDesktopNotification]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const refreshNetworkPeers = async () => {
      try {
        const status = await ApiService.getNetworkStatus();
        if (!disposed && status) setNetworkPeers(status.peers);
      } catch (error) {
        console.error('Failed to load LAN presence', error);
      }
    };

    void refreshNetworkPeers();
    const timer = window.setInterval(refreshNetworkPeers, 3000);
    listen<NetworkStatus>('presence://changed', (event) => {
      if (!disposed) setNetworkPeers(event.payload.peers);
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });

    return () => {
      disposed = true;
      window.clearInterval(timer);
      unlisten?.();
    };
  }, []);

  // Desktop calendar can hand off a selected day to the full task form.
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenForm: (() => void) | undefined;
    let unlistenList: (() => void) | undefined;
    listen<{ date?: string }>('task-form://open', (event) => {
      setTaskToEdit(null);
      setInitialTaskDate(event.payload?.date);
      setInitialTaskStateId(undefined);
      setInitialTaskProjectId(undefined);
      setIsTaskModalOpen(true);
    }).then((dispose) => { unlistenForm = dispose; });
    listen<{ date?: string }>('task-list://open', (event) => {
      setCurrentView('inbox');
      setSelectedProjectId(null);
      setSearchQuery('');
      setTaskListDateFilter(event.payload?.date || null);
    }).then((dispose) => { unlistenList = dispose; });
    return () => {
      unlistenForm?.();
      unlistenList?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const disposers: Array<() => void> = [];

    listen<LanChatMessage & { workspaceRevision?: number }>('chat://message', (event) => {
      if (disposed) return;
      const message = event.payload;
      const scope = getWorkspaceContext();
      if (!scope || message.workspaceId !== scope.workspaceId || message.workspaceRevision !== scope.revision) return;
      if (message.senderId === currentUser.id) return;
      void refreshUnreadSummaries();
      const body = message.type === 'text'
        ? message.content
        : message.fileName || tr("common:app.fileReceived");
      const isMentioned = isUserMentioned(message, currentUser.id, currentUser.nickname, currentUser.username);
      const title = isMentioned
        ? tr("common:app.userMentionedYou", { value0: message.senderName })
        : tr("common:app.newMessageFrom", { value0: message.senderName });
      void showDesktopNotification(
        title,
        body,
        isMentioned ? 'reminder' : 'message',
      ).catch((error) => console.error('Failed to send chat notification', error));
    }).then((dispose) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    });

    // This event is emitted only for announcements received through network
    // sync. Local publish/update commands emit announcement_updated instead.
    listen<LanGroupAnnouncement & { workspaceRevision?: number }>('chat://announcement_received', (event) => {
      if (disposed) return;
      const announcement = event.payload;
      const scope = getWorkspaceContext();
      if (!scope || announcement.workspaceId !== scope.workspaceId || announcement.workspaceRevision !== scope.revision) return;
      if (!announcement?.groupId) return;
      void showDesktopNotification(
        tr("common:app.postedAGroupAnnouncement", { value0: announcement.authorName || tr('common:labels.groupAdministrator') }),
        `${announcement.title}\n${announcement.content}`,
        'message',
      ).catch((error) => console.error('Failed to send group announcement notification', error));
    }).then((dispose) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    });

    return () => {
      disposed = true;
      disposers.forEach((dispose) => dispose());
    };
  }, [currentUser.id, refreshUnreadSummaries, showDesktopNotification]);

  useEffect(() => {
    if (!isTauri()) return;
    let dispose: (() => void) | undefined;
    listen<ChatConversationRef>('chat://open_conversation', (event) => {
      const conversation = event.payload;
      const target = conversation?.kind === 'user'
        ? lanUsers.find((user) => user.id === conversation.targetId)
          || (() => {
            const summary = unreadSummaries.find((item) => item.key === `user:${conversation.targetId}`);
            if (!summary) return null;
            return {
              id: conversation.targetId,
              username: conversation.targetId,
              deviceId: '',
              nickname: summary.name,
              role: 'user' as const,
              ip: '',
              isOnline: false,
              lastActive: '',
              avatar: summary.avatar,
            };
          })()
        : null;
      handleOpenLanChat(target || undefined, conversation);
    }).then((unlisten) => { dispose = unlisten; });
    return () => dispose?.();
  }, [lanUsers, unreadSummaries]);

  // Synchronize LAN chat unread state with desktop tray icon blinking & tooltips
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    void Promise.all(unreadSummaries.map(async (summary) => ({
      key: summary.key,
      name: summary.name,
      count: summary.count,
      conversation: summary.conversation,
      iconRgba: await avatarToTrayRgba(summary.avatar, summary.name.slice(0, 1)),
    }))).then((unreadUsers) => {
      if (disposed) return;
      return import('./services/api').then(({ invoke: scopedInvoke }) => scopedInvoke('update_tray_unread_status', { unreadUsers }));
    }).catch((err) => console.warn('Failed to update tray unread status', err));
    return () => { disposed = true; };
  }, [unreadSummaries]);

  useEffect(() => {
    if (!isTauri()) return;
    ApiService.setGlobalShortcuts(shortcutBindings(shortcuts)).catch((error) =>
      console.error('Failed to register global shortcuts', error)
    );
  }, []);

  /**
   * 选中项目变化时读取该项目的状态列表。
   * 个人任务作用域直接复用 `personalStates`，无需再请求。
   */
  useEffect(() => {
    if (!selectedProjectId) {
      setProjectStates([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await ApiService.getStates(selectedProjectId, currentUser.id);
        if (!cancelled) setProjectStates(list);
      } catch (error) {
        if (!cancelled) {
          console.error('Error fetching work item states', error);
          setProjectStates([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProjectId, currentUser.id, syncVersion]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    listen<string>('shortcut://action', (event) => {
      if (event.payload === 'quickAdd') setIsQuickAddOpen(true);
      if (event.payload === 'toggleRightPanel') handleToggleRightPanel();
      if (event.payload === 'toggleRiskScanner') setIsRiskScannerOpen((prev) => !prev);
      if (event.payload === 'toggleTheme') handleOpenSettingsModal('theme');
      if (event.payload === 'openReportStudio') { setSelectedProjectId(null); setCurrentView('llm_studio'); }
      if (event.payload === 'openToday') { setSelectedProjectId(null); setCurrentView('today'); }
      if (event.payload === 'openInbox') { setSelectedProjectId(null); setCurrentView('inbox'); }
      if (event.payload === 'openCalendar') { setSelectedProjectId(null); setCurrentView('calendar'); }
      if (event.payload === 'openSettings') handleOpenSettingsModal('basic');
      if (event.payload === 'openAiChat') { setSelectedProjectId(null); setCurrentView('ai'); }
      if (event.payload === 'openLanChat') { setSelectedProjectId(null); setCurrentView('chat'); }
      if (event.payload === 'openWiki') { setSelectedProjectId(null); setCurrentView('wiki'); }
      if (event.payload === 'openCommandPalette') setIsCommandPaletteOpen(true);
      if (event.payload === 'openOpticalTransfer') { setSelectedProjectId(null); setCurrentView('optical'); }
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    refreshAllData();

    // Auto-poll sync every 5 seconds to simulate LAN live multi-user P2P updates
    const timer = setInterval(() => {
      refreshAllData();
    }, 5000);

    return () => clearInterval(timer);
  }, [refreshAllData]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const checkTaskReminders = async () => {
      const now = new Date();
      let sentKeys: string[] = [];
      try {
        const saved = JSON.parse(localStorage.getItem(scopedStorageKey(SENT_REMINDERS_KEY)) || '[]');
        if (Array.isArray(saved)) sentKeys = saved.filter((item): item is string => typeof item === 'string');
      } catch {
        sentKeys = [];
      }
      const sent = new Set(sentKeys);
      const dueTasks = tasks.filter((task) => {
        if (task.status === 'completed' || task.assigneeId !== currentUser.id || !task.reminderTime) {
          return false;
        }
        const reminderAt = parseTaskDateTime(task.reminderTime);
        const dueAt = parseTaskDateTime(task.dueDate);
        if (!reminderAt || reminderAt > now) return false;
        if (dueAt && now.getTime() > dueAt.getTime() + 15 * 60_000) return false;
        return !sent.has(`${task.id}:${task.reminderTime}`);
      });
      if (dueTasks.length === 0 || cancelled) return;

      for (const task of dueTasks) {
        const key = `${task.id}:${task.reminderTime}`;
        const dueAt = parseTaskDateTime(task.dueDate);
        const reminderAt = parseTaskDateTime(task.reminderTime);
        const isDueNow = Boolean(
          dueAt && reminderAt && dueAt.getTime() === reminderAt.getTime(),
        );
        const title = isDueNow ? tr("common:app.taskDueReminder") : tr("common:app.taskDueSoon");
        const body = tr("common:app.due", { value0: task.title, value1: formatTaskDueDate(task.dueDate) });
        try {
          if (await showDesktopNotification(title, body, 'reminder')) sent.add(key);
        } catch (error) {
          console.error('Failed to send task reminder', error);
        }
      }
      if (!cancelled) {
        localStorage.setItem(scopedStorageKey(SENT_REMINDERS_KEY), JSON.stringify(Array.from(sent).slice(-500)));
      }
    };

    const scheduleNextCheck = async () => {
      if (cancelled) return;
      await checkTaskReminders();
      if (cancelled) return;
      const now = Date.now();
      const nextReminderAt = tasks
        .filter((task) => task.status !== 'completed' && task.assigneeId === currentUser.id)
        .map((task) => parseTaskDateTime(task.reminderTime)?.getTime())
        .filter((value): value is number => typeof value === 'number' && value > now)
        .sort((left, right) => left - right)[0];
      const delay = nextReminderAt
        ? Math.max(250, Math.min(60_000, nextReminderAt - now))
        : 60_000;
      timer = window.setTimeout(() => void scheduleNextCheck(), delay);
    };

    void scheduleNextCheck();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [tasks, currentUser.id, showDesktopNotification]);

  // Task Operations
  const handleUpdateTask = async (id: string, updates: Partial<Task>) => {
    try {
      const targetTask = tasks.find((t) => t.id === id);
      if (targetTask && !canWriteTask(targetTask, currentUser.id, projects)) return;
      const updatedTask = await ApiService.updateTask(id, updates, currentUser.id);
      setTasks((previous) =>
        previous.map((task) => (task.id === updatedTask.id ? updatedTask : task)),
      );
      // Browser preview still uses the legacy TypeScript store. The desktop
      // runtime performs this atomically in Rust for both UI and MCP callers.
      if (
        !isTauri() &&
        targetTask &&
        updates.status === 'completed' &&
        targetTask.status !== 'completed' &&
        updatedTask.recurrence &&
        updatedTask.recurrence !== 'none'
      ) {
        const nextDueDate = calculateNextDueDate(
          updatedTask.dueDate,
          updatedTask.recurrence,
          updatedTask.recurrenceRule,
          new Date()
        );
        const reminderMinutes = inferReminderMinutes(updatedTask.dueDate, updatedTask.reminderTime);
        await ApiService.createTask(
          {
            title: updatedTask.title,
            description: updatedTask.description,
            priority: updatedTask.priority,
            status: 'todo',
            dueDate: nextDueDate,
            reminderTime: calculateReminderTime(nextDueDate, reminderMinutes),
            recurrence: updatedTask.recurrence,
            recurrenceRule: updatedTask.recurrenceRule || null,
            creatorId: updatedTask.creatorId,
            assigneeId: updatedTask.assigneeId,
            projectId: updatedTask.projectId,
            isShared: updatedTask.isShared,
            sharedWith: updatedTask.sharedWith || [],
            subtasks: (updatedTask.subtasks || []).map((subtask) => ({ ...subtask, completed: false })),
            tags: updatedTask.tags || [],
          },
          currentUser.id
        );
      }
      void refreshAllData();
    } catch (e) {
      console.error('Failed to update task', e);
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      const targetTask = tasks.find((task) => task.id === id);
      if (targetTask && !canWriteTask(targetTask, currentUser.id, projects)) return;
      const children = tasks.filter((task) => task.parentTaskId === id);
      if (children.length > 0) {
        const cascade = window.confirm(tr("common:app.thisTaskHasChildTasksChooseOk", { value0: children.length }));
        if (!cascade) {
          await Promise.all(children.map((child) => ApiService.updateTask(child.id, { parentTaskId: null }, currentUser.id)));
        } else {
          await Promise.all(children.map((child) => ApiService.deleteTask(child.id, currentUser.id)));
        }
      }
      await ApiService.deleteTask(id, currentUser.id);
      setTasks((previous) => previous.filter((task) => task.id !== id));
      void refreshAllData();
    } catch (e) {
      console.error('Failed to delete task', e);
    }
  };

  const handleDuplicateTask = async (source: Task) => {
    if (!canWriteTask(source, currentUser.id, projects)) return;
    try {
      const copy = buildTaskDuplicate(source, tasks, currentUser.id);
      const duplicate = await ApiService.saveTaskWithChildren(null, copy.task, copy.childTasks, [], currentUser.id);
      setTasks((previous) => [duplicate, ...previous]);
      void refreshAllData();
    } catch (error) {
      console.error('Failed to duplicate task', error);
    }
  };

  useEffect(() => {
    const openLinkValue = (url: string) => {
      const wiki = wikiIdFromLink(url);
      if (wiki) { setLinkedWikiId(wiki); setSelectedProjectId(null); setCurrentView('wiki'); return true; }
      const ai = aiConversationIdFromLink(url);
      if (ai) { setLinkedAiConversationId(ai); setSelectedProjectId(null); setCurrentView('ai'); return true; }
      const task = taskIdFromLink(url);
      if (task) { setLinkedTaskId(task); return true; }
      return false;
    };
    const hashChange = () => { openLinkValue(window.location.href); };
    const openLink = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.('a[href]');
      if (!anchor || !openLinkValue(anchor.getAttribute('href') || '')) return;
      event.preventDefault(); event.stopPropagation();
    };
    hashChange();
    window.addEventListener('hashchange', hashChange);
    document.addEventListener('click', openLink, true);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      const openUrls = (urls: string[]) => { if (!disposed) urls.some(openLinkValue); };
      void onOpenUrl(openUrls).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; });
      void getDeepLinks().then((urls) => { if (urls) openUrls(urls); });
    }
    return () => { disposed = true; unlisten?.(); window.removeEventListener('hashchange', hashChange); document.removeEventListener('click', openLink, true); };
  }, [workspace?.id]);

  const handleSaveTask = async (taskData: any) => {
    try {
      const { childTasks = [], detachedChildIds = [], ...taskPayload } = taskData || {};
      if (taskToEdit && !canWriteTask(taskToEdit, currentUser.id, projects)) throw new Error(tr("common:app.youDoNotHavePermissionToEdit"));
      const saved = await ApiService.saveTaskWithChildren(taskToEdit?.id || null, taskPayload, childTasks, detachedChildIds, currentUser.id, taskToEdit?.version);
      localStorage.removeItem(scopedStorageKey(`lanmind_task_attachments:${saved.id}`));
      setTasks((previous) => [saved, ...previous.filter((task) => task.id !== saved.id)]);
      await refreshAllData();
    } catch (e) {
      console.error('Failed to save task', e);
      throw e;
    }
  };

  const archivedProjectIds = useMemo(
    () => new Set(projects.filter((p) => p.isArchived).map((p) => p.id)),
    [projects]
  );

  // Filter Tasks by Main View
  const getDisplayTasks = () => {
    if (selectedProjectId) {
      return tasks.filter((task) => task.projectId === selectedProjectId);
    }
    const todayStr = taskToday;

    return tasks.filter((t) => {
      if (t.parentTaskId) return false;
      if (t.projectId && archivedProjectIds.has(t.projectId)) return false;
      // Filter views
      if (currentView === 'today') {
        return t.dueDate?.slice(0, 10) === todayStr || t.status === 'in_progress';
      } else if (currentView === 'upcoming') {
        return t.dueDate && t.dueDate > todayStr;
      }

      // Default Inbox / All
      return true;
    });
  };

  const visibleTasks = useMemo(() => {
    const list = getDisplayTasks();
    const layout = selectedProjectId ? projectLayout : { ...projectLayout, projectFilter: [] };
    const filtered = filterTasksByLayout(
      list,
      layout,
      searchQuery,
      new Date(taskToday + 'T12:00:00')
    );
    if (!selectedProjectId && taskListDateFilter) {
      return filtered.filter(
        (task) =>
          task.dueDate?.slice(0, 10) === taskListDateFilter ||
          expandTaskOccurrences(task, taskListDateFilter, taskListDateFilter).length > 0
      );
    }
    return filtered;
  }, [tasks, selectedProjectId, currentView, searchQuery, taskToday, projectLayout, taskListDateFilter]);

  const navigateTo = (view: MainView) => {
    setSelectedProjectId(null);
    setTaskListDateFilter(null);
    setCurrentView(view);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCtrlOrMeta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      // Command palette: Ctrl+K or Cmd+K
      if (isCtrlOrMeta && !event.altKey && key === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }
      // Quick navigation combos (Ctrl+Alt)
      if (isCtrlOrMeta && event.altKey) {
        if (key === 'a') {
          event.preventDefault();
          navigateTo('ai');
        } else if (key === 'l') {
          event.preventDefault();
          navigateTo('chat');
        } else if (key === 'k') {
          event.preventDefault();
          navigateTo('wiki');
        } else if (key === 'o') {
          event.preventDefault();
          navigateTo('optical');
        } else if (key === 'w') {
          event.preventDefault();
          setCurrentView('llm_studio');
        } else if (key === 'd') {
          event.preventDefault();
          navigateTo('today');
        } else if (key === 'i') {
          event.preventDefault();
          navigateTo('inbox');
        } else if (key === 'c') {
          event.preventDefault();
          navigateTo('calendar');
        }
      }
      // Alt combos (Alt+R, Alt+N, Alt+T)
      if (event.altKey && !isCtrlOrMeta) {
        if (key === 'r') {
          event.preventDefault();
          setIsRiskScannerOpen((prev) => !prev);
        } else if (key === 'n') {
          event.preventDefault();
          handleToggleRightPanel();
        } else if (key === 't') {
          event.preventDefault();
          handleOpenSettingsModal('theme');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleToggleRightPanel]);

  const commandItems = useMemo<CommandItem[]>(() => [
    { id: 'work', label: 'Open Work', hint: 'Tasks and views', icon: defaultCommandIcons.work, onSelect: () => navigateTo('inbox') },
    { id: 'wiki', label: 'Open Wiki', hint: 'Local knowledge base', icon: BookOpen, onSelect: () => navigateTo('wiki') },
    { id: 'ai', label: 'Open AI', hint: 'Workspace briefing', icon: defaultCommandIcons.ai, onSelect: () => setDrawerMode('ai') },
    { id: 'chat', label: 'Open Chat', hint: 'Local conversations', icon: defaultCommandIcons.chat, onSelect: () => navigateTo('chat') },
    { id: 'transfer', label: 'Open Optical Transfer', hint: 'Air-gap file transfer', icon: QrCode, onSelect: () => navigateTo('optical') },
    { id: 'new-task', label: 'Create work item', hint: 'Quick add', icon: defaultCommandIcons.add, onSelect: () => setIsQuickAddOpen(true) },
    { id: 'settings', label: 'Open Settings', hint: 'Preferences', icon: defaultCommandIcons.settings, onSelect: () => handleOpenSettingsModal('basic') },
  ], []);

  const activeSection: AppSection =
    currentView === 'settings'
      ? 'settings'
      : currentView === 'wiki'
      ? 'wiki'
      : currentView === 'chat'
      ? 'chat'
      : currentView === 'optical'
      ? 'transfer'
      : currentView === 'ai'
      ? 'ai'
      : 'work';

  /** 全局导航栏切换到某一段。rail 只负责切段，具体视图仍由 Sidebar 与画布决定。 */
  const goToSection = (section: AppSection) => {
    if (section === 'work') {
      setSelectedProjectId(null);
      setCurrentView('inbox');
    } else if (section === 'wiki') {
      setSelectedProjectId(null);
      setCurrentView('wiki');
    } else if (section === 'ai') {
      setSelectedProjectId(null);
      setCurrentView('ai');
    } else if (section === 'chat') {
      setSelectedProjectId(null);
      setCurrentView('chat');
    } else if (section === 'transfer') {
      setSelectedProjectId(null);
      setCurrentView('optical');
    }
  };

  const appRail = (
    <AppRail
      activeSection={activeSection}
      onWork={() => goToSection('work')}
      onWiki={() => goToSection('wiki')}
      onAI={() => goToSection('ai')}
      onChat={() => goToSection('chat')}
      onTransfer={() => goToSection('transfer')}
      onSettings={() => handleOpenSettingsModal('basic')}
      currentUser={currentUser}
      onOpenProfileModal={() => setIsProfileModalOpen(true)}
      unreadCount={unreadMessageTotal}
      riskCount={riskCount}
    />
  );

  const appTopbar = (
    <Header
      onOpenQuickAdd={() => setIsQuickAddOpen(true)}
      onOpenLLMConfig={() => handleOpenSettingsModal('llm')}
      onOpenRiskScanner={() => setIsRiskScannerOpen(true)}
      onOpenSyncMonitor={() => setIsSyncMonitorOpen(true)}
      onOpenProfileModal={() => setIsProfileModalOpen(true)}
      onOpenThemeModal={() => handleOpenSettingsModal('theme')}
      onOpenShortcutModal={() => handleOpenSettingsModal('shortcuts')}
      onOpenSettingsModal={handleOpenSettingsModal}
      onOpenOpticalTransfer={() => {
        setSelectedProjectId(null);
        setCurrentView('optical');
      }}
      riskCount={riskCount}
      syncVersion={syncVersion}
      canNavigateBack={canGoBack}
      canNavigateForward={canGoForward}
      onNavigateBack={handleGoBack}
      onNavigateForward={handleGoForward}
      workspace={workspace}
      workspaceMembers={workspaceMembers}
      currentUserId={currentUser.id}
      onOpenWorkspaceSettings={() => setIsWorkspaceModalOpen(true)}
    />
  );

  const appSidebar = activeSection === 'work' ? (
    <Sidebar
      currentView={currentView}
      setCurrentView={(view) => {
        if (view === 'sync_logs') setIsSyncMonitorOpen(true);
        else { setTaskListDateFilter(null); setCurrentView(view); }
      }}
      projects={projects}
      selectedProjectId={selectedProjectId}
      setSelectedProjectId={setSelectedProjectId}
      onOpenCreateProject={() => setIsProjectCreateModalOpen(true)}
      onOpenQuickAdd={() => setIsQuickAddOpen(true)}
      onOpenThemeModal={() => handleOpenSettingsModal('theme')}
      onOpenShortcutModal={() => handleOpenSettingsModal('shortcuts')}
      onOpenProfileModal={() => setIsProfileModalOpen(true)}
      currentUser={currentUser}
      allUsers={workspaceLanUsers}
      tasks={tasks}
      unreadMessageTotal={unreadMessageTotal}
      onOpenArchivedProjects={() => setIsArchivedProjectsModalOpen(true)}
    />
  ) : null;

  const appDrawer = (
    <RightDrawerRoot mode={drawerMode}>
      {drawerMode === 'peek' && (
        <IssuePeekDrawer
          task={taskToEdit}
          isOpen={drawerMode === 'peek'}
          onClose={() => { setDrawerMode('none'); setTaskToEdit(null); }}
          states={editingTaskStates}
          projects={projects}
          users={workspaceLanUsers}
          currentUser={currentUser}
          onSaveTask={handleSaveTask}
          onDeleteTask={handleDeleteTask}
          visibleTasks={getDisplayTasks()}
          onNavigateTask={(t) => setTaskToEdit(t)}
        />
      )}
    </RightDrawerRoot>
  );

  return (
    <div
      className="flex h-screen w-screen select-none flex-col overflow-hidden bg-canvas font-sans text-main"
      data-context-menu-scope="app"
      onContextMenu={(event) => {
        const selection = window.getSelection()?.toString().trim();
        const target = event.target as HTMLElement | null;
        const isEditable = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
        const isSelectable = target?.closest('.select-text') || target?.closest('[data-selectable]') || target?.tagName === 'IMG';
        if (selection || isEditable || isSelectable) {
          return;
        }
        event.preventDefault();
        setContextMenuPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      <AppShell rail={appRail} sidebar={appSidebar} topbar={appTopbar} drawer={appDrawer}>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
          {selectedProject &&
            activeView !== 'wiki' &&
            activeView !== 'chat' &&
            activeView !== 'optical' &&
            activeView !== 'ai' &&
            activeView !== 'settings' && (
              <ProjectToolbar
                key={selectedProject.id}
                project={selectedProject}
                users={workspaceLanUsers}
                currentUser={currentUser}
                tasks={tasks.filter((task) => task.projectId === selectedProject.id)}
                taskCount={filterTasksByLayout(getDisplayTasks(), projectLayout, searchQuery, new Date(taskToday + 'T12:00:00')).length}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onOpenCreateTask={() => {
                  setTaskToEdit(null);
                  setInitialTaskDate(undefined);
                  setInitialTaskStateId(undefined);
                  setInitialTaskProjectId(selectedProject.id);
                  setIsTaskModalOpen(true);
                }}
                layout={projectLayout}
                onLayoutChange={updateProjectLayout}
                onOpenFiles={() => setFilesProject(selectedProject)}
                onProjectAction={(action) => {
                  if (action === 'manage') {
                    setProjectToManage(selectedProject);
                    setIsProjectSettingsModalOpen(true);
                  } else if (action === 'archive') {
                    setProjectToArchive(selectedProject);
                    setIsArchiveModalOpen(true);
                  } else {
                    setProjectToEdit(selectedProject);
                    setProjectAction(action);
                    setIsProjectModalOpen(true);
                  }
                }}
              />
            )}
          {selectedProject?.isArchived && (
            <div className="flex items-center justify-between border-b border-warning/30 bg-warning/15 px-6 py-2.5 text-xs text-warning">
              <div className="flex items-center gap-2">
                <Archive className="h-4 w-4 shrink-0" />
                <span>
                  本项目已归档（处于只读归档状态）。所有历史工作项与数据完整保留。
                </span>
              </div>
              {(selectedProject.admins.includes(currentUser.id) || selectedProject.createdBy === currentUser.id) && (
                <button
                  type="button"
                  onClick={() => handleRestoreProject(selectedProject)}
                  className="flex items-center gap-1.5 rounded-lg bg-warning px-3 py-1 text-xs font-semibold text-on-warning hover:bg-warning/90 transition-colors shadow-2xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>恢复项目</span>
                </button>
              )}
            </div>
          )}
          {activeView === 'wiki' && (
            <WikiView
              key={`${workspace?.id}:${currentUser.id}`}
              workspaceId={workspace?.id}
              linkedDocumentId={linkedWikiId}
              currentUser={currentUser}
              users={workspaceLanUsers}
            />
          )}
          {activeView === 'chat' && (
            <div className="flex h-full w-full flex-1 flex-col overflow-hidden bg-canvas">
              <LanChatModal
                isOpen={true}
                embedded={true}
                currentUser={currentUser}
                users={workspaceLanUsers}
                projects={projects}
                localDirectory={localDirectory}
                targetUser={lanChatTarget}
                initialConversation={lanChatConversation}
                unreadSummaries={unreadSummaries}
                onConversationRead={markConversationMessagesRead}
                onCreateTaskFromMessage={(content) => {
                  setTaskToEdit(null);
                  setTaskModalInitialTitle(content);
                  setIsTaskModalOpen(true);
                }}
              />
            </div>
          )}
          {activeView === 'optical' && (
            <div className="flex h-full w-full flex-1 flex-col overflow-hidden bg-canvas">
              <OpticalTransferApp />
            </div>
          )}
          {activeView === 'ai' && (
            <div className="flex h-full w-full flex-1 flex-col overflow-hidden bg-canvas">
              <AIWorkspace key={`${workspace?.id}:${currentUser.id}`}
                tasks={tasks}
                projects={projects}
                currentUser={currentUser}
                workspaceId={workspace?.id}
                initialConversationId={linkedAiConversationId}
                onOpenCreateTask={(initialTitle, initialDescription) => {
                  setTaskToEdit(null);
                  setTaskModalInitialTitle(initialTitle || '');
                  setTaskModalInitialDescription(initialDescription || '');
                  setIsTaskModalOpen(true);
                }}
                onOpenCreateWiki={async (initialContent, initialTitle) => {
                  try {
                    const wsId = workspace?.id ?? null;
                    const scope = getWorkspaceContext();
                    const state = loadWikiState(wsId, scope);
                    const newDoc = createWikiDocument({
                      title: initialTitle || '',
                      content: initialContent || '',
                      parentId: null,
                      sortOrder: state.documents.length,
                    });
                    (newDoc as { workspaceId?: string }).workspaceId = wsId ?? undefined;
                    const nextState = {
                      ...state,
                      documents: [...state.documents, newDoc],
                      selectedId: newDoc.id,
                    };
                    saveWikiState(nextState, wsId, scope, true);
                    setLinkedWikiId(newDoc.id);
                    setSelectedProjectId(null);
                    setCurrentView('wiki');
                  } catch (err) {
                    console.error('Failed to create wiki page from AI message:', err);
                  }
                }}
              />
            </div>
          )}
          {activeView === 'settings' && (
            <div className="flex h-full w-full flex-1 flex-col overflow-hidden bg-canvas">
              <SettingsModal
                isOpen={true}
                embedded={true}
                shortcuts={shortcuts}
                onSaveShortcuts={handleSaveShortcuts}
                currentUserId={currentUser.id}
                onTasksImported={refreshAllData}
                defaultTab={settingsDefaultTab}
                workspace={workspace}
                users={lanUsers}
                currentUser={currentUser}
                projects={projects}
                onWorkspaceUpdated={setWorkspace}
                localDirectory={localDirectory}
                onLocalDirectoryChange={setLocalDirectory}
              />
            </div>
          )}
          <div className={activeView === 'llm_studio' ? 'flex min-h-0 flex-1' : 'hidden'}>
            <LLMReportStudio projects={projects} currentUser={currentUser} allTasks={tasks} />
          </div>
          {activeView !== 'llm_studio' &&
            activeView !== 'wiki' &&
            activeView !== 'chat' &&
            activeView !== 'optical' &&
            activeView !== 'ai' &&
            activeView !== 'settings' && (
            activeView === 'calendar' ? (
              <CalendarView
                states={activeStates}
                compact={Boolean(selectedProject)}
                tasks={selectedProjectId ? tasks.filter((task) => task.projectId === selectedProjectId) : getDisplayTasks()}
                layout={projectLayout}
                onLayoutChange={updateProjectLayout}
                scope={selectedProjectId ? 'project' : 'task'}
                users={workspaceLanUsers}
                currentUserId={currentUser.id}
                searchQuery={searchQuery}
                projects={projects}
                canEditTask={(task) => canWriteTask(task, currentUser.id, projects)}
                onUpdateTask={handleUpdateTask}
                onOpenCreateTaskWithDate={(dStr) => {
                  setTaskToEdit(null);
                  setInitialTaskDate(dStr);
                  setInitialTaskStateId(undefined);
                  setInitialTaskProjectId(selectedProjectId || undefined);
                  setIsTaskModalOpen(true);
                }}
                onOpenEditTask={(t) => {
                  if (!canWriteTask(t, currentUser.id, projects)) return;
                  setTaskToEdit(t);
                  setIsTaskModalOpen(true);
                }}
              />
            ) : activeView === 'timeline' ? (
              <TimelineView
                states={activeStates}
                tasks={selectedProjectId ? tasks.filter((task) => task.projectId === selectedProjectId) : getDisplayTasks()}
                layout={projectLayout}
                onLayoutChange={updateProjectLayout}
                scope={selectedProjectId ? 'project' : 'task'}
                currentUserId={currentUser.id}
                searchQuery={searchQuery}
                projects={projects}
                users={workspaceLanUsers}
                canEditTask={(task) => canWriteTask(task, currentUser.id, projects)}
                onOpenEditTask={(task) => {
                  if (!canWriteTask(task, currentUser.id, projects)) return;
                  setTaskToEdit(task);
                  setIsTaskModalOpen(true);
                }}
              />
            ) : activeView === 'kanban' ? (
              <KanbanView
                tasks={getDisplayTasks()}
                states={activeStates}
                layout={projectLayout}
                onLayoutChange={updateProjectLayout}
                scope={selectedProjectId ? 'project' : 'task'}
                searchQuery={searchQuery}
                users={workspaceLanUsers}
                currentUserId={currentUser.id}
                projects={projects}
                canEditTask={(task) => canWriteTask(task, currentUser.id, projects)}
                onUpdateTaskState={(taskId, targetStateId) => {
                  // 看板列在无状态定义时是状态组令牌，需要解析成该作用域下的具体状态。
                  const group = parseGroupFilterValue(targetStateId);
                  const task = tasks.find((t) => t.id === taskId);
                  const targetProjectId = selectedProjectId || task?.projectId || null;
                  const resolved = group
                    ? (defaultStateFor(selectedProjectId ? projectStates : allStates, targetProjectId, group)?.id ||
                       defaultStateFor(personalStates, null, group)?.id)
                    : targetStateId;
                  if (resolved) handleUpdateTask(taskId, { stateId: resolved });
                }}
                onOpenCreateTaskWithState={(targetStateId) => {
                  const group = parseGroupFilterValue(targetStateId);
                  const resolved = group
                    ? defaultStateFor(selectedProjectId ? projectStates : personalStates, selectedProjectId ?? null, group)?.id
                    : targetStateId;
                  setTaskToEdit(null);
                  setInitialTaskStateId(resolved);
                  setInitialTaskDate(undefined);
                  setInitialTaskProjectId(selectedProjectId || undefined);
                  setIsTaskModalOpen(true);
                }}
                onOpenEditTask={(t) => {
                  if (!canWriteTask(t, currentUser.id, projects)) return;
                  setTaskToEdit(t);
                  setIsTaskModalOpen(true);
                }}
              />
            ) : (
              <ListView
                tasks={getDisplayTasks()}
                allTasks={tasks}
                states={activeStates}
                projects={projects}
                users={workspaceLanUsers}
                currentUser={currentUser}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={handleDeleteTask}
                onDuplicateTask={handleDuplicateTask}
                onOpenTaskActivity={(task) => {
                  setActivityTask(task);
                }}
                onOpenCreateTask={() => {
                  setTaskToEdit(null);
                  setInitialTaskDate(undefined);
                  setInitialTaskStateId(undefined);
                  setInitialTaskProjectId(selectedProjectId || undefined);
                  setIsTaskModalOpen(true);
                }}
                onOpenEditTask={(t) => {
                  if (!canWriteTask(t, currentUser.id, projects)) { setLinkedTaskId(t.id); return; }
                  setTaskToEdit(t);
                  setIsTaskModalOpen(true);
                }}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                selectedProjectId={selectedProjectId}
                projectLayout={selectedProjectId ? projectLayout : undefined}
                onLayoutChange={updateProjectLayout}
                viewTitle={currentView === 'today' ? tr("common:app.todaySSchedule") : currentView === 'upcoming' ? tr("common:app.upcomingMilestones") : tr("common:app.allTasks")}
                dateFilter={selectedProjectId ? null : taskListDateFilter}
                onClearDateFilter={() => setTaskListDateFilter(null)}
              />
            )
          )}
        </main>

      </AppShell>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        commands={commandItems}
      />

      {/* Modals & Dialog Overlays */}
      <LanChatModal
        isOpen={isLanChatOpen}
        onClose={() => setIsLanChatOpen(false)}
        currentUser={currentUser}
        users={workspaceLanUsers}
        projects={projects}
        localDirectory={localDirectory}
        targetUser={lanChatTarget}
        initialConversation={lanChatConversation}
        unreadSummaries={unreadSummaries}
        onConversationRead={markConversationMessagesRead}
        onCreateTaskFromMessage={(content) => {
          setTaskToEdit(null);
          setTaskModalInitialTitle(content);
          setIsTaskModalOpen(true);
        }}
      />
      <QuickAddModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        projects={projects}
        users={workspaceLanUsers}
        currentUser={currentUser}
        onTaskCreated={refreshAllData}
      />

      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false);
          setTaskModalInitialTitle('');
          setTaskModalInitialDescription('');
        }}
        taskToEdit={taskToEdit}
        projects={projects}
        users={workspaceLanUsers}
        tasks={tasks}
        states={editingTaskStates}
        visibleTasks={visibleTasks}
        currentUser={currentUser}
        onSaveTask={handleSaveTask}
        onDeleteTask={handleDeleteTask}
        onDuplicateTask={handleDuplicateTask}
        onOpenTaskActivity={(task) => setActivityTask(task)}
        onNavigateTask={(task) => setTaskToEdit(task)}
        initialDate={initialTaskDate}
        initialStatus={initialTaskStateId
          ? GROUP_TO_LEGACY_STATUS[
              editingTaskStates.find((item) => item.id === initialTaskStateId)?.group ?? 'unstarted'
            ]
          : undefined}
        initialProjectId={initialTaskProjectId}
        initialTitle={taskModalInitialTitle}
        initialDescription={taskModalInitialDescription}
        tagSuggestions={tagSuggestions}
        canEditTask={(task) => canWriteTask(task, currentUser.id, projects)}
      />

      <WorkspaceModal
        isOpen={isWorkspaceModalOpen}
        onClose={() => setIsWorkspaceModalOpen(false)}
        workspace={workspace}
        users={lanUsers}
        currentUser={currentUser}
        onWorkspaceUpdated={setWorkspace}
        localDirectory={localDirectory}
        onLocalDirectoryChange={setLocalDirectory}
      />

      {activityTask && <TaskActivityModal task={activityTask} currentUser={currentUser} users={lanUsers} onClose={() => setActivityTask(null)} />}
      {linkedTaskId && <TaskInfoModal currentUserId={currentUser.id} task={tasks.find((task) => task.id === linkedTaskId) || null} tasks={tasks} projects={projects} users={lanUsers} canEdit={Boolean(tasks.find((task) => task.id === linkedTaskId && canWriteTask(task, currentUser.id, projects)))} onClose={() => { setLinkedTaskId(null); if (window.location.hash.startsWith('#task/')) window.history.replaceState(null, '', window.location.pathname + window.location.search); }} onOpen={(task) => setLinkedTaskId(task.id)} onEdit={(task) => { setLinkedTaskId(null); setTaskToEdit(task); setIsTaskModalOpen(true); }} />}

      <ProjectCreateModal
        isOpen={isProjectCreateModalOpen}
        onClose={() => setIsProjectCreateModalOpen(false)}
        users={lanUsers}
        currentUser={currentUser}
        onProjectCreated={async (newProj) => {
          await refreshAllData();
          setSelectedProjectId(newProj.id);
          setCurrentView('project');
        }}
      />

      {projectToManage && (
        <ProjectSettingsModal
          isOpen={isProjectSettingsModalOpen}
          onClose={() => setIsProjectSettingsModalOpen(false)}
          project={projectToManage}
          users={lanUsers}
          currentUser={currentUser}
          localDirectory={localDirectory}
          onProjectSaved={async () => {
            await refreshAllData();
          }}
          onStatesChanged={(next) => {
            if (selectedProjectId && projectToManage?.id === selectedProjectId) setProjectStates(next);
          }}
          onProjectDeleted={async (projectId) => {
            if (selectedProjectId === projectId) {
              setSelectedProjectId(null);
              setCurrentView('inbox');
            }
            await refreshAllData();
          }}
        />
      )}

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        projectToEdit={projectToEdit}
        initialAction={projectAction}
        users={lanUsers}
        currentUser={currentUser}
        localDirectory={localDirectory}
        onProjectSaved={refreshAllData}
        onStatesChanged={(next) => {
          if (selectedProjectId && projectToEdit?.id === selectedProjectId) setProjectStates(next);
        }}
        onProjectDeleted={async (projectId) => {
          if (selectedProjectId === projectId) {
            setSelectedProjectId(null);
            setCurrentView('inbox');
          }
          await refreshAllData();
        }}
      />

      <ProjectArchiveModal
        isOpen={isArchiveModalOpen}
        onClose={() => {
          setIsArchiveModalOpen(false);
          setProjectToArchive(null);
        }}
        project={projectToArchive}
        onConfirm={handleConfirmArchiveProject}
      />

      <ArchivedProjectsModal
        isOpen={isArchivedProjectsModalOpen}
        onClose={() => setIsArchivedProjectsModalOpen(false)}
        archivedProjects={projects.filter((p) => Boolean(p.isArchived))}
        currentUser={currentUser}
        onRestoreProject={handleRestoreProject}
        onDeleteProject={async (proj) => {
          await ApiService.deleteProject(proj.id, currentUser.id);
          setProjects((prev) => prev.filter((p) => p.id !== proj.id));
          if (selectedProjectId === proj.id) {
            setSelectedProjectId(null);
            setCurrentView('inbox');
          }
        }}
        onSelectProject={(proj) => {
          setSelectedProjectId(proj.id);
          setCurrentView('project');
        }}
      />

      {filesProject && <ProjectFilesPanel project={filesProject} users={lanUsers} currentUser={currentUser} onClose={() => setFilesProject(null)} />}

      <LLMConfigModal
        isOpen={isLLMConfigOpen}
        onClose={() => setIsLLMConfigOpen(false)}
      />

      <RiskAlertsModal
        isOpen={isRiskScannerOpen}
        onClose={() => setIsRiskScannerOpen(false)}
      />

      <SyncMonitorModal
        isOpen={isSyncMonitorOpen}
        onClose={() => setIsSyncMonitorOpen(false)}
        syncVersion={syncVersion}
      />

      <UserProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        currentUser={currentUser}
        onUserUpdated={(updatedUser) => {
          setCurrentUser(updatedUser);
          void refreshAllData();
        }}
      />

      <ThemeModal
        isOpen={isThemeModalOpen}
        onClose={() => setIsThemeModalOpen(false)}
      />

      <ShortcutModal
        isOpen={isShortcutModalOpen}
        onClose={() => setIsShortcutModalOpen(false)}
        shortcuts={shortcuts}
        onSaveShortcuts={handleSaveShortcuts}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        shortcuts={shortcuts}
        onSaveShortcuts={handleSaveShortcuts}
        currentUserId={currentUser.id}
        onTasksImported={refreshAllData}
        defaultTab={settingsDefaultTab}
        workspace={workspace}
        users={lanUsers}
        currentUser={currentUser}
        projects={projects}
        onWorkspaceUpdated={setWorkspace}
        localDirectory={localDirectory}
        onLocalDirectoryChange={setLocalDirectory}
      />

      {contextMenuPosition && (
        <AppContextMenu
          x={contextMenuPosition.x}
          y={contextMenuPosition.y}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}

function SessionGate({ onReady }: { onReady: (ready: boolean) => void }) {
  useLocale();
  const desktop = isTauri();
  const [desktopUser, setDesktopUser] = useState<User | null>(null);
  const [bootstrapError, setBootstrapError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { onReady(!desktop || Boolean(desktopUser) || Boolean(bootstrapError)); }, [desktop, desktopUser, bootstrapError, onReady]);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    setBootstrapError('');

    const loadBootstrap = async () => {
      let lastError: unknown;
      for (const retryDelay of [0, 200, 500, 1000, 2000]) {
        if (retryDelay > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
        }
        if (cancelled) return;
        try {
          const bootstrap = await ApiService.getBootstrap();
          if (!bootstrap) throw new Error(tr("common:app.theDesktopSessionReturnedNoLocalIdentity"));
          if (!cancelled) setDesktopUser(bootstrap.currentUser);
          return;
        } catch (error) {
          lastError = error;
        }
      }

      if (!cancelled) {
        setBootstrapError(
          lastError instanceof Error
            ? lastError.message
            : typeof lastError === 'string'
              ? lastError
              : tr("common:app.couldNotReadTheLocalIdentity"),
        );
      }
    };

    void loadBootstrap();
    return () => {
      cancelled = true;
    };
  }, [attempt, desktop]);

  if (!desktop) return <MainApp initialUser={BROWSER_FALLBACK_USER} />;
  if (desktopUser) return <MainApp initialUser={desktopUser} />;

  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-canvas p-6 text-main"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex max-w-sm flex-col items-center text-center">
        {bootstrapError ? (
          <AlertCircle className="h-8 w-8 text-danger" aria-hidden="true" />
        ) : (
          <LoaderCircle className="h-8 w-8 animate-spin text-info" aria-hidden="true" />
        )}
        <h1 className="mt-3 text-sm font-bold text-main">
          {bootstrapError ? tr("common:app.couldNotLoadTheLocalIdentity") : tr("common:app.loadingLocalIdentity")}
        </h1>
        {bootstrapError && (
          <>
            <p className="mt-2 text-xs leading-5 text-sub">{localizeMessage(bootstrapError)}</p>
            <button
              type="button"
              className="ui-cancel-button mt-4 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
              onClick={() => setAttempt((current) => current + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {tr("common:app.retry")}</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function App({ onStartupReady }: { onStartupReady?: () => void } = {}) {
  useLocale();
  const [lockView, setLockView] = useState<StartupLockView | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  return (
    <ThemeProvider>
      <AppStartupReady lockView={lockView} sessionReady={sessionReady} onReady={onStartupReady} />
      <AppLockGate onReady={setLockView}><SessionGate onReady={setSessionReady} /></AppLockGate>
    </ThemeProvider>
  );
}
