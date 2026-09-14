import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Project, User } from '../types';
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
  UserCog,
  Palette,
  Keyboard,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Folder,
  GripVertical,
} from 'lucide-react';

const SIDEBAR_COLLAPSED_KEY = 'lanmind_left_sidebar_collapsed';
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
  | 'kanban'
  | 'llm_studio'
  | 'project'
  | 'sync_logs';

interface SidebarProps {
  currentView: MainView;
  setCurrentView: (view: MainView) => void;
  projects: Project[];
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  onOpenCreateProject: () => void;
  onOpenManageProject: (project: Project) => void;
  onOpenThemeModal?: () => void;
  onOpenShortcutModal?: () => void;
  onOpenProfileModal?: () => void;
  currentUser: User;
  allUsers: User[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setCurrentView,
  projects,
  selectedProjectId,
  setSelectedProjectId,
  onOpenCreateProject,
  onOpenManageProject,
  onOpenThemeModal,
  onOpenShortcutModal,
  onOpenProfileModal,
  currentUser,
  allUsers,
}) => {
  const projectOrderStorageKey = `${PROJECT_ORDER_KEY_PREFIX}:${currentUser.deviceId || currentUser.id}`;
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true',
  );
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

  const toggleCollapsed = () => {
    setIsCollapsed((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  };
  const isSelfImg = currentUser.avatar && (currentUser.avatar.startsWith('data:image') || currentUser.avatar.startsWith('http'));
  const memberProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          project.membershipStatus === 'member' ||
          project.members.includes(currentUser.id) ||
          project.createdBy === currentUser.id,
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

  const mainNavs = [
    { id: 'inbox', label: '全部任务', icon: Inbox },
    { id: 'today', label: '今日安排', icon: CheckSquare },
    { id: 'upcoming', label: '近期节点', icon: Clock },
    { id: 'calendar', label: '日历视图', icon: CalendarDays },
    { id: 'kanban', label: '看板视图', icon: Kanban },
    { id: 'llm_studio', label: '工作汇报', icon: Presentation },
  ];

  if (isCollapsed) {
    return (
      <aside className="z-20 flex h-full w-14 flex-shrink-0 select-none flex-col border-r border-edge bg-surface text-sub shadow-popover transition-all duration-300">
        <nav className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
          {mainNavs.map((nav) => {
            const Icon = nav.icon;
            const isActive = currentView === nav.id && selectedProjectId === null;
            return (
              <button
                key={nav.id}
                type="button"
                data-active={isActive}
                onClick={() => {
                  setSelectedProjectId(null);
                  setCurrentView(nav.id as MainView);
                }}
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-info'
                    : 'text-sub hover:bg-hover hover:text-main'
                }`}
                title={nav.label}
                aria-label={nav.label}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}

          <div className="my-2 h-px w-8 flex-shrink-0 bg-card" />
          <button
            type="button"
            onClick={onOpenCreateProject}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-info transition-colors hover:bg-hover hover:text-info"
            title="新建协作项目"
            aria-label="新建协作项目"
          >
            <FolderPlus className="h-4 w-4" />
          </button>

          {myProjects.map((project) => {
            const isSelected = selectedProjectId === project.id;
            const dropPosition = projectDropTarget?.projectId === project.id
              ? projectDropTarget.position
              : undefined;
            return (
              <button
                key={project.id}
                type="button"
                aria-grabbed={draggedProjectId === project.id}
                data-project-drag-id={project.id}
                data-dragging={draggedProjectId === project.id}
                data-drop-position={dropPosition}
                onPointerDown={(event) => handleProjectPointerDown(event, project.id)}
                onPointerMove={handleProjectPointerMove}
                onPointerUp={(event) => handleProjectPointerEnd(event)}
                onPointerCancel={(event) => handleProjectPointerEnd(event, true)}
                onClick={() => openProject(project.id)}
                className={`sidebar-project-drag-item relative flex h-9 w-9 cursor-grab items-center justify-center rounded-lg transition-colors active:cursor-grabbing ${
                  isSelected
                    ? 'bg-card text-main'
                    : 'text-sub hover:bg-hover hover:text-main'
                }`}
                title={project.name}
                aria-label={`打开项目 ${project.name}`}
              >
                <Folder className="h-4 w-4" style={{ color: project.color || '#3b82f6' }} />
                {isSelected && (
                  <span className="absolute -right-0.5 h-4 w-0.5 rounded-full bg-blue-400" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex flex-col items-center justify-center gap-1 border-t border-edge py-2">
          <button
            type="button"
            onClick={onOpenProfileModal}
            className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-subtle bg-card text-xs font-bold text-info transition-colors hover:border-blue-500"
            title={`个人资料：${currentUser.nickname}`}
          >
            {isSelfImg ? (
              <img src={currentUser.avatar} alt={currentUser.nickname} className="h-full w-full object-cover" />
            ) : (
              currentUser.avatar || currentUser.nickname.charAt(0)
            )}
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main"
            title="展开左侧导航"
            aria-label="展开左侧导航"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 flex-shrink-0 bg-surface border-r border-edge text-sub flex flex-col h-full select-none transition-all duration-300">
      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-5">
        {/* Main Views */}
        <div>
          <div className="px-3 text-[11px] font-bold text-quiet uppercase tracking-wider mb-2">
            我的任务
          </div>
          <nav className="space-y-1">
            {mainNavs.map((nav) => {
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
                  className="sidebar-nav-item flex w-full items-center justify-between px-3 py-2 text-xs font-medium transition-colors"
                >
                  <div className="flex items-center space-x-2.5">
                    <Icon className="h-4 w-4" />
                    <span>{nav.label}</span>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Projects Section */}
        <div>
          <div className="flex items-center justify-between px-3 mb-2">
            <span className="text-[11px] font-bold text-quiet uppercase tracking-wider">
              协作项目 ({myProjects.length})
            </span>
            <button
              onClick={onOpenCreateProject}
              className="text-info hover:text-info p-1 rounded-md hover:bg-hover/80 transition-colors flex items-center gap-1 text-[11px] font-medium"
              title="新建局域网共享项目"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>新建</span>
            </button>
          </div>

          <div className="space-y-1">
            {myProjects.length === 0 ? (
              <p className="px-3 text-xs text-quiet italic py-1">暂无参加的项目</p>
            ) : (
              myProjects.map((p) => {
                const isSelected = selectedProjectId === p.id;
                const isProjectAdmin = p.admins.includes(currentUser.id) || p.createdBy === currentUser.id;
                const dropPosition = projectDropTarget?.projectId === p.id
                  ? projectDropTarget.position
                  : undefined;
                return (
                  <div key={p.id} className="space-y-1">
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
                      className="sidebar-project-row sidebar-project-drag-item group flex w-full cursor-grab items-center justify-between px-3 py-2 text-xs font-medium transition-colors active:cursor-grabbing"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center space-x-2.5 text-left"
                      >
                        <GripVertical
                          className="project-drag-handle h-3.5 w-3.5 flex-shrink-0"
                          aria-hidden="true"
                        />
                        <span
                          className="h-2.5 w-2.5 flex-shrink-0 rounded-full shadow-soft"
                          style={{ backgroundColor: p.color || '#3b82f6' }}
                        />
                        <span className="truncate font-medium">{p.name}</span>
                      </button>

                      {isProjectAdmin && (
                        <button
                          data-project-drag-ignore
                          onClick={(event) => {
                            event.stopPropagation();
                            if (suppressProjectClickRef.current) return;
                            onOpenManageProject(p);
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded text-sub transition-colors hover:text-[var(--accent)] hover:bg-[var(--bg-hover)]"
                          title="项目权限与属性管理"
                          aria-label={`项目权限与属性管理: ${p.name}`}
                        >
                          <UserCog className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {isSelected && (
                      <div className="ml-3 grid grid-cols-3 gap-1 rounded-lg bg-canvas/40 p-1 border border-edge/60">
                        {[
                          { id: 'project' as const, label: '列表', icon: ListTodo },
                          { id: 'kanban' as const, label: '看板', icon: Kanban },
                          { id: 'calendar' as const, label: '日历', icon: CalendarDays },
                        ].map((view) => {
                          const ViewIcon = view.icon;
                          const isViewActive = currentView === view.id;
                          return (
                            <button
                              key={view.id}
                              data-active={isViewActive}
                              onClick={() => setCurrentView(view.id)}
                              className="sidebar-project-view flex min-w-0 items-center justify-center gap-1 py-1 rounded text-[11px] font-medium transition-colors"
                              aria-pressed={isViewActive}
                            >
                              <ViewIcon className="h-3 w-3 flex-shrink-0" />
                              <span>{view.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

        </div>
      </div>

      {/* User Info Footer */}
      <div className="flex items-center gap-2 border-t border-edge/80 bg-surface/80 p-2.5 text-xs text-sub">
        <button
          onClick={onOpenProfileModal}
          className="group flex min-w-0 flex-1 cursor-pointer items-center space-x-2.5 rounded-xl p-1.5 text-left transition-colors hover:bg-hover/80"
          title="点击修改个人头像与名称"
        >
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-card border border-subtle/80 flex items-center justify-center text-info font-bold text-xs overflow-hidden flex-shrink-0 group-hover:border-blue-500 transition-colors shadow-soft">
              {isSelfImg ? (
                <img src={currentUser.avatar} alt={currentUser.nickname} className="w-full h-full object-cover" />
              ) : (
                currentUser.avatar || currentUser.nickname.charAt(0)
              )}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-edge" />
          </div>
          <div className="truncate min-w-0 flex-1">
            <div className="font-semibold text-main truncate text-xs group-hover:text-info transition-colors">
              {currentUser.nickname}
            </div>
            <div className="text-[10px] text-sub truncate flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              <span>本机在线</span>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main"
          title="收起左侧导航"
          aria-label="收起左侧导航"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
};
