import { scopedStorageKey } from "../utils/workspaceContext";
import { tr, useLocale } from "../i18n";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFeatures } from '../modules/state';
import { featureForView } from '../modules/registry';
import { Project, Task, User } from '../types';
import {
  CheckSquare,
  CalendarDays,
  Kanban,
  Presentation,
  FolderPlus,
  Users,
  Settings,
  Clock,
  Inbox,
  Activity,
  ChevronRight,
  ShieldAlert,
  Wifi,
  UserCheck,
  UserPlus,
  Palette,
  Keyboard,
  Folder,
  GripVertical,
  GanttChart,
  Plus,
  MessageSquare,
  QrCode,
  Sparkles,
  Bot,
  Archive,
  Trash2,
} from 'lucide-react';
const PROJECT_ORDER_KEY_PREFIX = 'lanmind_sidebar_project_order_v1';

type ProjectDropPosition = 'before' | 'after';

interface ProjectPointerDrag {
  pointerId: number;
  projectId: string;
  startX: number;
  startY: number;
  moved: boolean;
}

const loadProjectOrder = (storageKey: string): string[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(stored) && stored.every((item) => typeof item === 'string') ? stored : [];
  } catch {
    return [];
  }
};

export const reorderProjectIds = (
  currentOrder: string[],
  sourceProjectId: string,
  targetProjectId: string,
  position: ProjectDropPosition,
): string[] => {
  const sourceIndex = currentOrder.indexOf(sourceProjectId);
  const targetIndex = currentOrder.indexOf(targetProjectId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceProjectId === targetProjectId) {
    return currentOrder;
  }

  let insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
  const nextOrder = currentOrder.filter((id) => id !== sourceProjectId);
  if (sourceIndex < insertionIndex) insertionIndex -= 1;
  nextOrder.splice(insertionIndex, 0, sourceProjectId);
  return nextOrder.every((id, index) => id === currentOrder[index]) ? currentOrder : nextOrder;
};

export type MainView =
  | 'inbox'
  | 'today'
  | 'upcoming'
  | 'calendar'
  | 'timeline'
  | 'kanban'
  | 'llm_studio'
  | 'wiki'
  | 'chat'
  | 'optical'
  | 'vault'
  | 'ai'
  | 'settings'
  | 'project'
  | 'sync_logs'
  | 'task_recycle';

interface SidebarProps {
  currentView: MainView;
  setCurrentView: (view: MainView) => void;
  projects: Project[];
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  onOpenCreateProject: () => void;
  onOpenQuickAdd?: () => void;
  onOpenThemeModal?: () => void;
  onOpenShortcutModal?: () => void;
  onOpenProfileModal?: () => void;
  currentUser: User;
  allUsers: User[];
  tasks: Task[];
  unreadMessageTotal?: number;
  onOpenArchivedProjects?: () => void;
  onOpenTaskRecycle?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setCurrentView,
  projects,
  selectedProjectId,
  setSelectedProjectId,
  onOpenCreateProject,
  onOpenQuickAdd,
  onOpenThemeModal,
  onOpenShortcutModal,
  onOpenProfileModal,
  currentUser,
  allUsers,
  tasks,
  unreadMessageTotal = 0,
  onOpenArchivedProjects,
  onOpenTaskRecycle,
}) => {
  useLocale();
  const enabledFeatures = useFeatures();
  const projectOrderStorageKey = scopedStorageKey(`${PROJECT_ORDER_KEY_PREFIX}:${currentUser.deviceId || currentUser.id}`);

  const [projectOrder, setProjectOrder] = useState<string[]>(() =>
    loadProjectOrder(projectOrderStorageKey),
  );
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [projectDropTarget, setProjectDropTarget] = useState<{
    projectId: string;
    position: ProjectDropPosition;
  } | null>(null);
  const suppressProjectClickRef = useRef(false);
  const projectPointerDragRef = useRef<ProjectPointerDrag | null>(null);

  useEffect(() => {
    setProjectOrder(loadProjectOrder(projectOrderStorageKey));
  }, [projectOrderStorageKey]);

  const memberProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          !project.isArchived &&
          (project.membershipStatus === 'member' ||
          project.members.includes(currentUser.id) ||
          project.createdBy === currentUser.id),
      ),
    [currentUser.id, projects],
  );
  const archivedProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          Boolean(project.isArchived) &&
          (project.membershipStatus === 'member' ||
          project.members.includes(currentUser.id) ||
          project.createdBy === currentUser.id),
      ),
    [currentUser.id, projects],
  );
  const myProjects = useMemo(() => {
    const orderById = new Map(projectOrder.map((id, index) => [id, index]));
    const fallbackById = new Map(memberProjects.map((project, index) => [project.id, index]));
    return [...memberProjects].sort((left, right) => {
      const leftOrder = orderById.get(left.id) ?? projectOrder.length + (fallbackById.get(left.id) || 0);
      const rightOrder = orderById.get(right.id) ?? projectOrder.length + (fallbackById.get(right.id) || 0);
      return leftOrder - rightOrder;
    });
  }, [memberProjects, projectOrder]);
  const persistProjectOrder = (nextOrder: string[]) => {
    setProjectOrder(nextOrder);
    localStorage.setItem(projectOrderStorageKey, JSON.stringify(nextOrder));
  };

  const finishProjectDrag = () => {
    projectPointerDragRef.current = null;
    setDraggedProjectId(null);
    setProjectDropTarget(null);
    window.setTimeout(() => {
      suppressProjectClickRef.current = false;
    }, 0);
  };

  const projectDropTargetAtPoint = (x: number, y: number) => {
    const element = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('[data-project-drag-id]');
    const projectId = element?.dataset.projectDragId;
    if (!element || !projectId) return null;

    const bounds = element.getBoundingClientRect();
    const position: ProjectDropPosition =
      y < bounds.top + bounds.height / 2 ? 'before' : 'after';
    return { projectId, position };
  };

  const handleProjectPointerDown = (
    event: React.PointerEvent<HTMLElement>,
    projectId: string,
  ) => {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest('[data-project-drag-ignore]')
    ) {
      return;
    }
    projectPointerDragRef.current = {
      pointerId: event.pointerId,
      projectId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleProjectPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = projectPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.moved && distance < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      suppressProjectClickRef.current = true;
      setDraggedProjectId(drag.projectId);
    }

    const target = projectDropTargetAtPoint(event.clientX, event.clientY);
    setProjectDropTarget(target?.projectId === drag.projectId ? null : target);
    event.preventDefault();
  };

  const handleProjectPointerEnd = (
    event: React.PointerEvent<HTMLElement>,
    cancelled = false,
  ) => {
    const drag = projectPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.moved && !cancelled) {
      const target = projectDropTargetAtPoint(event.clientX, event.clientY);
      if (target && target.projectId !== drag.projectId) {
        const currentOrder = myProjects.map((project) => project.id);
        const nextOrder = reorderProjectIds(
          currentOrder,
          drag.projectId,
          target.projectId,
          target.position,
        );
        if (nextOrder !== currentOrder) persistProjectOrder(nextOrder);
      }
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishProjectDrag();
  };

  const openProject = (projectId: string) => {
    if (suppressProjectClickRef.current) return;
    setSelectedProjectId(projectId);
    setCurrentView('project');
  };

  const onlineUsersCount = allUsers.filter((u) => u.isOnline).length;
  const [showTaskCounts, setShowTaskCounts] = useState(() => localStorage.getItem('lanmind_show_sidebar_task_counts') !== 'false');
  useEffect(() => {
    const update = () => setShowTaskCounts(localStorage.getItem('lanmind_show_sidebar_task_counts') !== 'false');
    window.addEventListener('lanmind-sidebar-counts-change', update);
    return () => window.removeEventListener('lanmind-sidebar-counts-change', update);
  }, []);
  const todayKey = new Date().toISOString().slice(0, 10);
  const archivedProjectIds = useMemo(
    () => new Set(projects.filter((p) => p.isArchived).map((p) => p.id)),
    [projects]
  );
  const incompleteTasks = tasks.filter(
    (task) =>
      !task.parentTaskId &&
      task.status !== 'completed' &&
      task.status !== 'abandoned' &&
      (!task.projectId || !archivedProjectIds.has(task.projectId))
  );
  const navCount = (id: MainView) => {
    if (id === 'inbox') return incompleteTasks.length;
    if (id === 'today') return incompleteTasks.filter((task) => task.dueDate?.slice(0, 10) === todayKey || task.status === 'in_progress').length;
    if (id === 'upcoming') return incompleteTasks.filter((task) => Boolean(task.dueDate && task.dueDate.slice(0, 10) > todayKey)).length;
    return 0;
  };

  const mainNavs = [
    { id: 'inbox', label: tr("common:sidebar.allTasks"), icon: Inbox },
    { id: 'today', label: tr("common:sidebar.todaySSchedule"), icon: CheckSquare },
    { id: 'upcoming', label: tr("common:sidebar.upcomingMilestones"), icon: Clock },
    { id: 'calendar', label: tr("common:sidebar.calendar"), icon: CalendarDays },
    { id: 'timeline', label: tr("common:sidebar.timeline"), icon: GanttChart },
    { id: 'kanban', label: tr("common:sidebar.kanban"), icon: Kanban },
    { id: 'llm_studio', label: tr("common:sidebar.workReports"), icon: Presentation },
  ];

  return (
    <aside className="w-64 flex-shrink-0 bg-surface border-r border-edge text-sub flex flex-col h-full select-none transition-all duration-300">
      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto min-h-0 py-2 px-2 space-y-4">
        {/* Section 1: Work Items */}
        <div>
          <div className="flex items-center justify-between px-3 mb-1.5">
            <span className="text-[11px] font-bold text-quiet uppercase tracking-wider">
              {tr("common:sidebar.workItemsSection")}
            </span>
            {onOpenQuickAdd && (
              <button
                type="button"
                onClick={onOpenQuickAdd}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-sub hover:bg-hover hover:text-main transition-colors"
                title={tr("common:sidebar.newWorkItem")}
                aria-label={tr("common:sidebar.newWorkItem")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <nav className="space-y-0.5">
            {mainNavs.filter(nav => { const owner = featureForView(nav.id); return !owner || enabledFeatures[owner]; }).map((nav) => {
              const Icon = nav.icon;
              const isActive = currentView === nav.id && selectedProjectId === null;
              return (
                <button
                  key={nav.id}
                  data-active={isActive}
                  onClick={() => {
                    setSelectedProjectId(null);
                    setCurrentView(nav.id as MainView);
                  }}
                  className="sidebar-nav-item flex w-full items-center justify-between px-3 py-1.5 text-xs font-medium transition-colors"
                >
                  <div className="flex items-center space-x-2.5">
                    <Icon className="h-4 w-4" />
                    <span>{nav.label}</span>
                  </div>
                  {showTaskCounts && navCount(nav.id as MainView) > 0 && (
                    <span className="min-w-5 rounded-full bg-card px-1.5 py-0.5 text-center text-[10px] font-mono text-sub">
                      {navCount(nav.id as MainView)}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Section 2: Collaborative Projects */}
        <div className="border-t border-edge/60 pt-3">
          <div className="flex items-center justify-between px-3 mb-1.5">
            <span className="text-[11px] font-bold text-quiet uppercase tracking-wider">
              {tr("common:sidebar.projectsSection", { value0: myProjects.length })}
            </span>
            <button
              type="button"
              onClick={onOpenCreateProject}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-info hover:bg-hover/80 transition-colors"
              title={tr("common:sidebar.newSharedProject")}
              aria-label={tr("common:sidebar.newSharedProject")}
            >
              <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-0.5">
            {myProjects.length === 0 ? (
              <p className="px-3 text-xs text-quiet italic py-1">{tr("common:sidebar.noProjectsJoined")}</p>
            ) : (
              myProjects.map((p) => {
                const isSelected = selectedProjectId === p.id;
                const dropPosition = projectDropTarget?.projectId === p.id
                  ? projectDropTarget.position
                  : undefined;
                return (
                  <div key={p.id}>
                    <div
                      data-active={isSelected}
                      data-project-drag-id={p.id}
                      data-dragging={draggedProjectId === p.id}
                      data-drop-position={dropPosition}
                      aria-grabbed={draggedProjectId === p.id}
                      onPointerDown={(event) => handleProjectPointerDown(event, p.id)}
                      onPointerMove={handleProjectPointerMove}
                      onPointerUp={(event) => handleProjectPointerEnd(event)}
                      onPointerCancel={(event) => handleProjectPointerEnd(event, true)}
                      onClick={() => openProject(p.id)}
                      className="sidebar-project-row sidebar-project-drag-item group flex w-full cursor-grab items-center justify-between px-3 py-1.5 text-xs font-medium transition-colors active:cursor-grabbing"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center space-x-2.5 text-left"
                        title={p.name}
                      >
                        <GripVertical
                          className="project-drag-handle h-3.5 w-3.5 flex-shrink-0"
                          aria-hidden="true"
                        />
                        <span
                          className="h-2.5 w-2.5 flex-shrink-0 rounded-full shadow-soft"
                          style={{ backgroundColor: p.color || '#3b82f6' }}
                        />
                        <span className="truncate font-medium" title={p.name}>{p.name}</span>
                      </button>
                      {showTaskCounts && (() => {
                        const count = incompleteTasks.filter((task) => task.projectId === p.id).length;
                        return count > 0 ? (
                          <span className="min-w-5 rounded-full bg-card px-1.5 py-0.5 text-center text-[10px] font-mono text-sub">
                            {count}
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </div>
                );
              })
            )}

            {archivedProjects.length > 0 && onOpenArchivedProjects && (
              <div className="pt-2 border-t border-edge/40 mt-2">
                <button
                  type="button"
                  onClick={onOpenArchivedProjects}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-xs text-quiet hover:bg-hover hover:text-main transition-colors group"
                  title="查看已归档项目"
                >
                  <span className="flex items-center gap-2">
                    <Archive className="h-3.5 w-3.5 text-quiet group-hover:text-warning transition-colors" />
                    <span>已归档项目</span>
                  </span>
                  <span className="rounded-full bg-card px-1.5 py-0.2 text-[10px] font-mono text-quiet border border-edge/60 group-hover:border-warning/30 group-hover:text-warning">
                    {archivedProjects.length}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pinned Footer: Task Recycle Bin */}
      {onOpenTaskRecycle && (
        <div className="shrink-0 border-t border-edge/60 p-2">
          <button
            type="button"
            data-active={currentView === 'task_recycle' && selectedProjectId === null}
            onClick={onOpenTaskRecycle}
            className="sidebar-nav-item group flex w-full items-center justify-between px-3 py-1.5 text-xs font-medium transition-colors"
            title={tr('tasks:recycle.title')}
          >
            <div className="flex items-center space-x-2.5">
              <Trash2 className="h-4 w-4 transition-colors group-hover:text-danger" />
              <span>{tr('tasks:recycle.title')}</span>
            </div>
          </button>
        </div>
      )}
    </aside>
  );
};
