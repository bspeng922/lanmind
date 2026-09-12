import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { AlertCircle, LoaderCircle, RefreshCw } from 'lucide-react';
import {
  User,
  Project,
  Task,
  TaskStatus,
  LanChatMessage,
  TaskAssignmentNotification,
} from './types';
import { calculateNextDueDate } from './utils/recurrence';
import {
  calculateReminderTime,
  formatLocalTaskDateTime,
  formatTaskDueDate,
  inferReminderMinutes,
  parseTaskDateTime,
} from './utils/taskDateTime';
import { ApiService, NetworkPeer, NetworkStatus } from './services/api';
import { Header } from './components/Header';
import { Sidebar, MainView } from './components/Sidebar';
import { ListView } from './components/ListView';
import { CalendarView } from './components/CalendarView';
import { KanbanView } from './components/KanbanView';
import { LLMReportStudio } from './components/LLMReportStudio';
import { QuickAddModal } from './components/QuickAddModal';
import { TaskModal } from './components/TaskModal';
import { ProjectModal } from './components/ProjectModal';
import { RiskAlertsModal } from './components/RiskAlertsModal';
import { SyncMonitorModal } from './components/SyncMonitorModal';
import { LLMConfigModal } from './components/LLMConfigModal';
import { LANNodesRightPanel } from './components/LANNodesRightPanel';
import { UserProfileModal } from './components/UserProfileModal';
import { LanChatModal } from './components/LanChatModal';
import { ThemeModal } from './components/ThemeModal';
import { ShortcutModal, ShortcutItem, DEFAULT_SHORTCUTS } from './components/ShortcutModal';
import { SettingsModal, SettingsTab } from './components/SettingsModal';
import { AppContextMenu, AppContextMenuItem } from './components/AppContextMenu';
import { ThemeProvider, useTheme } from './context/ThemeContext';

const BROADCAST_UNREAD_KEY = '__broadcast__';
const BROWSER_FALLBACK_USER: User = {
  id: 'local-user@desktop',
  username: 'local-user',
  deviceId: 'desktop',
  nickname: '本机用户',
  role: 'admin',
  ip: '127.0.0.1',
  isOnline: true,
  lastActive: new Date().toISOString(),
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

const SENT_REMINDERS_KEY = 'lanmind_sent_task_reminders_v1';

function MainApp({ initialUser }: { initialUser: User }) {
  const { currentTheme, themePreference } = useTheme();

  // State
  const [users, setUsers] = useState<User[]>([]);
  const [networkPeers, setNetworkPeers] = useState<NetworkPeer[]>([]);
  const [currentUser, setCurrentUser] = useState<User>(initialUser);

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
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

  // Active View State
  const [currentView, setCurrentView] = useState<MainView>(() => {
    const hash = window.location.hash.replace('#', '').split('?')[0];
    if (hash === 'report') return 'llm_studio';
    if (['inbox', 'today', 'upcoming', 'calendar', 'kanban', 'llm_studio'].includes(hash)) {
      return hash as MainView;
    }
    return 'inbox';
  });
  const [taskListDateFilter, setTaskListDateFilter] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals Visibility
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState<Task | null>(null);
  const [initialTaskDate, setInitialTaskDate] = useState<string | undefined>(undefined);
  const [initialTaskStatus, setInitialTaskStatus] = useState<TaskStatus | undefined>(undefined);
  const [initialTaskProjectId, setInitialTaskProjectId] = useState<string | undefined>(undefined);

  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);

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
  const [unreadMessagesByUser, setUnreadMessagesByUser] = useState<Record<string, number>>({});
  const unreadMessageTotal = Object.values(unreadMessagesByUser).reduce<number>(
    (total, count) => total + Number(count),
    0,
  );

  const clearUnreadMessages = useCallback((userId?: string) => {
    if (!userId) {
      setUnreadMessagesByUser({});
      return;
    }
    setUnreadMessagesByUser((previous) => {
      if (!previous[userId]) return previous;
      const next = { ...previous };
      delete next[userId];
      return next;
    });
  }, []);

  const handleOpenLanChat = (targetUser?: User) => {
    setLanChatTarget(targetUser || null);
    clearUnreadMessages(targetUser?.id);
    setIsLanChatOpen(true);
  };

  // Settings Modal State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(() => {
    return window.location.hash.includes('settings') || window.location.hash.includes('llm');
  });
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<SettingsTab>(() => {
    if (window.location.hash.includes('llm')) return 'llm';
    return 'basic';
  });

  const handleOpenSettingsModal = (tab: SettingsTab = 'basic') => {
    setSettingsDefaultTab(tab);
    setIsSettingsModalOpen(true);
  };

  const closeContextMenu = useCallback(() => setContextMenuPosition(null), []);
  const contextMenuItems = useMemo<AppContextMenuItem[]>(
    () => [
      {
        id: 'refresh',
        label: '刷新',
        icon: RefreshCw,
        onSelect: () => window.location.reload(),
      },
    ],
    [],
  );

  // Custom Keyboard Shortcuts State
  const [shortcuts, setShortcuts] = useState<ShortcutItem[]>(loadSavedShortcuts);

  const handleSaveShortcuts = async (newShortcuts: ShortcutItem[]) => {
    await ApiService.setGlobalShortcuts(shortcutBindings(newShortcuts));
    setShortcuts(newShortcuts);
    localStorage.setItem('p2p_studio_shortcuts', JSON.stringify(newShortcuts));
  };

  // Right LAN Nodes Panel State
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  // Load Data
  const refreshAllData = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    try {
      const [uList, pList, tList, syncData, risks, assignmentNotices] = await Promise.all([
        ApiService.getUsers(),
        ApiService.getProjects(currentUser.id),
        ApiService.getTasks(currentUser.id),
        ApiService.getSyncLogs(0),
        ApiService.getRiskWarnings(currentUser.id),
        ApiService.getTaskAssignmentNotifications(currentUser.id),
      ]);

      if (requestId !== refreshRequestId.current) return;
      setUsers(uList);
      setProjects(pList);
      setTasks(tList);
      setSyncVersion(syncData.latestVersion);
      setRiskCount(risks.length);
      setAssignmentNotifications(assignmentNotices);

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
    await invoke('show_notification_window', {
      notification: {
        id: `${kind}:${crypto.randomUUID()}`,
        kind,
        title,
        body,
        createdAt: new Date().toISOString(),
        themeId: currentTheme.id,
        themePreference,
      },
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
            `${notification.assignerName} 指派了新任务`,
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
    let unlisten: (() => void) | undefined;
    listen('sync://operation', () => refreshAllData()).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, [refreshAllData]);

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
      setInitialTaskStatus(undefined);
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
    let unlisten: (() => void) | undefined;
    let disposed = false;

    listen<LanChatMessage>('chat://message', (event) => {
      if (disposed) return;
      const message = event.payload;
      if (message.senderId === currentUser.id) return;
      const unreadKey = !message.groupId && !message.receiverId
        ? BROADCAST_UNREAD_KEY
        : message.senderId;
      setUnreadMessagesByUser((previous) => ({
        ...previous,
        [unreadKey]: (previous[unreadKey] || 0) + 1,
      }));
      const body = message.type === 'text'
        ? message.content
        : message.fileName || '收到一个文件';
      void showDesktopNotification(
        `${message.senderName} 发来新消息`,
        body,
        'message',
      ).catch((error) => console.error('Failed to send chat notification', error));
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [currentUser.id, showDesktopNotification]);

  // Synchronize LAN chat unread state with desktop tray icon blinking & tooltips
  useEffect(() => {
    if (!isTauri()) return;

    const unreadUsers = Object.entries(unreadMessagesByUser)
      .filter(([_, count]) => Number(count) > 0)
      .map(([userId, count]) => {
        const numCount = Number(count);
        if (userId === BROADCAST_UNREAD_KEY) {
          return { name: '全员广播', count: numCount };
        }
        const sender = users.find((u) => u.id === userId);
        return {
          name: sender?.nickname || sender?.username || '局域网好友',
          count: numCount,
        };
      });

    invoke('update_tray_unread_status', { unreadUsers }).catch((err) =>
      console.warn('Failed to update tray unread status', err),
    );
  }, [unreadMessagesByUser, users]);

  useEffect(() => {
    if (!isTauri()) return;
    ApiService.setGlobalShortcuts(shortcutBindings(shortcuts)).catch((error) =>
      console.error('Failed to register global shortcuts', error)
    );
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    listen<string>('shortcut://action', (event) => {
      if (event.payload === 'quickAdd') setIsQuickAddOpen(true);
      if (event.payload === 'toggleRightPanel') setIsRightPanelOpen((prev) => !prev);
      if (event.payload === 'toggleRiskScanner') setIsRiskScannerOpen((prev) => !prev);
      if (event.payload === 'toggleTheme') handleOpenSettingsModal('theme');
      if (event.payload === 'openReportStudio') setCurrentView('llm_studio');
      if (event.payload === 'openToday') setCurrentView('today');
      if (event.payload === 'openInbox') setCurrentView('inbox');
      if (event.payload === 'openCalendar') setCurrentView('calendar');
      if (event.payload === 'openSettings') handleOpenSettingsModal('basic');
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
        const saved = JSON.parse(localStorage.getItem(SENT_REMINDERS_KEY) || '[]');
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
        if (dueAt && now.getTime() > dueAt.getTime() + 5 * 60_000) return false;
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
        const title = isDueNow ? '任务到期提醒' : '任务即将到期';
        const body = `${task.title}\n到期时间：${formatTaskDueDate(task.dueDate)}`;
        try {
          if (await showDesktopNotification(title, body, 'reminder')) sent.add(key);
        } catch (error) {
          console.error('Failed to send task reminder', error);
        }
      }
      if (!cancelled) {
        localStorage.setItem(SENT_REMINDERS_KEY, JSON.stringify(Array.from(sent).slice(-500)));
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
      await ApiService.deleteTask(id, currentUser.id);
      setTasks((previous) => previous.filter((task) => task.id !== id));
      void refreshAllData();
    } catch (e) {
      console.error('Failed to delete task', e);
    }
  };

  const handleSaveTask = async (taskData: any) => {
    try {
      if (taskToEdit) {
        if (!canWriteTask(taskToEdit, currentUser.id, projects)) return;
        await handleUpdateTask(taskToEdit.id, taskData);
      } else {
        const createdTask = await ApiService.createTask(taskData, currentUser.id);
        setTasks((previous) => [
          createdTask,
          ...previous.filter((task) => task.id !== createdTask.id),
        ]);
      }
      void refreshAllData();
    } catch (e) {
      console.error('Failed to save task', e);
      throw e;
    }
  };

  // Filter Tasks by Main View
  const getDisplayTasks = () => {
    const todayStr = formatLocalTaskDateTime(new Date(), false);

    return tasks.filter((t) => {
      // If a specific project is clicked in sidebar
      if (selectedProjectId) {
        return t.projectId === selectedProjectId;
      }

      // Filter views
      if (currentView === 'today') {
        return t.dueDate?.slice(0, 10) === todayStr || t.status === 'in_progress';
      } else if (currentView === 'upcoming') {
        return t.dueDate && t.dueDate > todayStr && t.status !== 'completed';
      }

      // Default Inbox / All
      return true;
    });
  };

  return (
    <div
      className="flex h-screen w-screen select-none flex-col overflow-hidden bg-slate-950 font-sans text-slate-100"
      data-context-menu-scope="app"
      onContextMenu={(event) => {
        event.preventDefault();
        setContextMenuPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {/* Top Header */}
      <Header
        onOpenQuickAdd={() => setIsQuickAddOpen(true)}
        onOpenLLMConfig={() => handleOpenSettingsModal('llm')}
        onOpenRiskScanner={() => setIsRiskScannerOpen(true)}
        onOpenSyncMonitor={() => setIsSyncMonitorOpen(true)}
        onOpenProfileModal={() => setIsProfileModalOpen(true)}
        onOpenThemeModal={() => handleOpenSettingsModal('theme')}
        onOpenShortcutModal={() => handleOpenSettingsModal('shortcuts')}
        onOpenSettingsModal={handleOpenSettingsModal}
        riskCount={riskCount}
        syncVersion={syncVersion}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Navigation Sidebar */}
        <Sidebar
          currentView={currentView}
          setCurrentView={(v) => {
            if (v === 'sync_logs') {
              setIsSyncMonitorOpen(true);
            } else {
              setTaskListDateFilter(null);
              setCurrentView(v);
            }
          }}
          projects={projects}
          selectedProjectId={selectedProjectId}
          setSelectedProjectId={setSelectedProjectId}
          onOpenCreateProject={() => {
            setProjectToEdit(null);
            setIsProjectModalOpen(true);
          }}
          onOpenManageProject={(p) => {
            setProjectToEdit(p);
            setIsProjectModalOpen(true);
          }}
          onOpenThemeModal={() => setIsThemeModalOpen(true)}
          onOpenShortcutModal={() => setIsShortcutModalOpen(true)}
          onOpenProfileModal={() => setIsProfileModalOpen(true)}
          currentUser={currentUser}
          allUsers={lanUsers}
        />

        {/* Center Main View Area */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-950">
          <div className={currentView === 'llm_studio' ? 'flex min-h-0 flex-1' : 'hidden'}>
            <LLMReportStudio projects={projects} currentUser={currentUser} />
          </div>
          {currentView !== 'llm_studio' && (
            currentView === 'calendar' ? (
              <CalendarView
                tasks={getDisplayTasks()}
                projects={projects}
                canEditTask={(task) => canWriteTask(task, currentUser.id, projects)}
                onUpdateTask={handleUpdateTask}
                onOpenCreateTaskWithDate={(dStr) => {
                  setTaskToEdit(null);
                  setInitialTaskDate(dStr);
                  setInitialTaskStatus(undefined);
                  setInitialTaskProjectId(selectedProjectId || undefined);
                  setIsTaskModalOpen(true);
                }}
                onOpenEditTask={(t) => {
                  if (!canWriteTask(t, currentUser.id, projects)) return;
                  setTaskToEdit(t);
                  setIsTaskModalOpen(true);
                }}
              />
            ) : currentView === 'kanban' ? (
              <KanbanView
                tasks={getDisplayTasks()}
                projects={projects}
                canEditTask={(task) => canWriteTask(task, currentUser.id, projects)}
                onUpdateTaskStatus={(taskId, newStatus) => handleUpdateTask(taskId, { status: newStatus })}
                onOpenCreateTaskWithStatus={(st) => {
                  setTaskToEdit(null);
                  setInitialTaskStatus(st);
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
                projects={projects}
                users={lanUsers}
                currentUser={currentUser}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={handleDeleteTask}
                onOpenCreateTask={() => {
                  setTaskToEdit(null);
                  setInitialTaskDate(undefined);
                  setInitialTaskStatus(undefined);
                  setInitialTaskProjectId(selectedProjectId || undefined);
                  setIsTaskModalOpen(true);
                }}
                onOpenEditTask={(t) => {
                  if (!canWriteTask(t, currentUser.id, projects)) return;
                  setTaskToEdit(t);
                  setIsTaskModalOpen(true);
                }}
                searchQuery={searchQuery}
                selectedProjectId={selectedProjectId}
                dateFilter={taskListDateFilter}
                onClearDateFilter={() => setTaskListDateFilter(null)}
                onOpenManageProject={(p) => {
                  setProjectToEdit(p);
                  setIsProjectModalOpen(true);
                }}
              />
            )
          )}
        </main>

        {/* Right Collapsible LAN Online Nodes Panel */}
        <LANNodesRightPanel
          isExpanded={isRightPanelOpen}
          onToggleExpand={() => setIsRightPanelOpen((prev) => !prev)}
          users={lanUsers}
          currentUser={currentUser}
          unreadMessagesByUser={unreadMessagesByUser}
          unreadMessageTotal={unreadMessageTotal}
          onOpenProfileModal={() => setIsProfileModalOpen(true)}
          onOpenLanChat={handleOpenLanChat}
        />
      </div>

      {/* Modals & Dialog Overlays */}
      <LanChatModal
        isOpen={isLanChatOpen}
        onClose={() => setIsLanChatOpen(false)}
        currentUser={currentUser}
        users={lanUsers}
        projects={projects}
        targetUser={lanChatTarget}
        onConversationRead={clearUnreadMessages}
      />
      <QuickAddModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        projects={projects}
        users={lanUsers}
        currentUser={currentUser}
        onTaskCreated={refreshAllData}
      />

      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        taskToEdit={taskToEdit}
        projects={projects}
        users={lanUsers}
        currentUser={currentUser}
        onSaveTask={handleSaveTask}
        initialDate={initialTaskDate}
        initialStatus={initialTaskStatus}
        initialProjectId={initialTaskProjectId}
      />

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        projectToEdit={projectToEdit}
        users={lanUsers}
        currentUser={currentUser}
        onProjectSaved={refreshAllData}
        onProjectDeleted={async (projectId) => {
          if (selectedProjectId === projectId) {
            setSelectedProjectId(null);
            setCurrentView('inbox');
          }
          await refreshAllData();
        }}
      />

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

function SessionGate() {
  const desktop = isTauri();
  const [desktopUser, setDesktopUser] = useState<User | null>(null);
  const [bootstrapError, setBootstrapError] = useState('');
  const [attempt, setAttempt] = useState(0);

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
          if (!bootstrap) throw new Error('桌面会话没有返回本机身份');
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
              : '无法读取本机身份',
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
      className="flex h-screen w-screen items-center justify-center bg-slate-950 p-6 text-slate-100"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex max-w-sm flex-col items-center text-center">
        {bootstrapError ? (
          <AlertCircle className="h-8 w-8 text-rose-400" aria-hidden="true" />
        ) : (
          <LoaderCircle className="h-8 w-8 animate-spin text-blue-400" aria-hidden="true" />
        )}
        <h1 className="mt-3 text-sm font-bold text-white">
          {bootstrapError ? '本机身份加载失败' : '正在读取本机身份'}
        </h1>
        {bootstrapError && (
          <>
            <p className="mt-2 text-xs leading-5 text-slate-400">{bootstrapError}</p>
            <button
              type="button"
              className="ui-cancel-button mt-4 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
              onClick={() => setAttempt((current) => current + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              重试
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <SessionGate />
    </ThemeProvider>
  );
}
