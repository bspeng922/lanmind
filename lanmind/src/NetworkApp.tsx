import { scopedStorageKey, setWorkspaceContext, sameWorkspace, type WorkspaceContext } from "./utils/workspaceContext";
import { localizeMessage, localizedError } from './i18n/messages';
import { tr, useLocale } from "./i18n";
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LanguageSelect } from './components/LanguageSelect';
import { ThemeQuickSwitcher } from './components/ThemeQuickSwitcher';
import { CalendarDays, Folder, ListFilter, ListTodo, LoaderCircle, LogOut, Menu, RefreshCw, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { LanMindLogo } from './components/LanMindLogo';
import { ApiService } from './services/api';
import { Project, Task, User } from './types';
import { ListView } from './components/ListView';
import { TaskModal } from './components/TaskModal';
import { TaskCreateButton } from './components/TaskCreateButton';
import { TaskInfoModal } from './components/TaskInfoModal';
import { TaskActivityModal } from './components/TaskActivityModal';
import { PROJECT_VIEWS, TaskLayoutPanel } from './components/TaskLayoutPanel';
import { countTaskLayoutSettings, filterTasksByLayout, useTaskLayout, useTaskToday, parseGroupFilterValue } from './utils/taskLayout';
import { canWriteTask } from './utils/taskPermissions';
import { taskIdFromLink } from './utils/taskLinks';
import { buildTaskDuplicate } from './utils/taskDuplicate';
import { KanbanView } from './components/KanbanView';
import { TimelineView } from './components/TimelineView';
import { NetworkLogin } from './components/NetworkLogin';
import { aiConversationIdFromLink } from './components/ai/aiLinks';
import { wikiIdFromLink } from './components/wiki/wikiLinks';
import { useTaskDeletion } from './hooks/useTaskDeletion';
import { isCompleted, GROUP_TO_LEGACY_STATUS } from './utils/workItemState';
import { TaskRecycleBin } from './components/TaskRecycleBin';

const CalendarView = React.lazy(() => import('./components/CalendarView').then(({ CalendarView }) => ({ default: CalendarView })));
const WikiPublicView = React.lazy(() => import('./components/wiki/WikiPublicView').then(({ WikiPublicView }) => ({ default: WikiPublicView })));
const AIPublicView = React.lazy(() => import('./components/ai/AIPublicView').then(({ AIPublicView }) => ({ default: AIPublicView })));
const loadingView = <div className="grid flex-1 place-items-center p-8"><LoaderCircle className="h-5 w-5 motion-safe:animate-spin" /></div>;

interface NetworkSession { workspaceContext?: WorkspaceContext; currentUser: User; users: User[]; projects: Project[]; readOnly: boolean }

export const NetworkApp: React.FC = () => {
  useLocale();
  const [session, setSession] = useState<NetworkSession | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('all');
  const [taskRecycleProject, setTaskRecycleProject] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectPanel, setProjectPanel] = useState<'layout' | 'filters' | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [edit, setEdit] = useState<{ task?: Task; date?: string; status?: Task['status'] } | null>(null);
  const [infoId, setInfoId] = useState<string | null>(() => taskIdFromLink(location.href));
  const [sharedWikiId, setSharedWikiId] = useState<string | null>(() => wikiIdFromLink(window.location.href));
  const [sharedAIId, setSharedAIId] = useState<string | null>(() => aiConversationIdFromLink(window.location.href, false));
  const [activity, setActivity] = useState<Task | null>(null);
  const { layout, updateLayout } = useTaskLayout(session?.currentUser.id || 'network', projectId);
  const taskToday = useTaskToday();
  const requestRef = useRef(0);
  const resetSession = useCallback(() => {
    requestRef.current += 1;
    setWorkspaceContext(null); setSession(null); setTasks([]);
    setEdit(null); setInfoId(null); setActivity(null); setProjectId(null); setQuery('');
  }, []);
  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    const response = await fetch('/api/bootstrap');
    if (request !== requestRef.current) return;
    if (response.status === 401) { resetSession(); return; }
    const bootstrap = await response.json();
    if (!response.ok) throw localizedError(bootstrap.error ? bootstrap : tr("network:networkApp.couldNotLoadTasks"));
    if (request !== requestRef.current) return;
    const context: WorkspaceContext | null = bootstrap.workspaceContext || (bootstrap.workspaceId ? { workspaceId: bootstrap.workspaceId, userId: bootstrap.currentUser.id, revision: 0 } : null);
    if (context && !sameWorkspace(context)) {
      setTasks([]); setEdit(null); setActivity(null); setProjectId(null); setQuery('');
      setWorkspaceContext(context);
      setInfoId(taskIdFromLink(location.href));
    }
    const nextTasks = await ApiService.getTasks();
    if (request !== requestRef.current || context && !sameWorkspace(context)) return;
    setSession(bootstrap);
    setTasks(nextTasks);
  }, [resetSession]);
  useEffect(() => { void refresh().catch((reason) => setError(String(reason))).finally(() => setBusy(false)); }, [refresh]);
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => void refresh().catch(() => {}), 20_000);
    return () => window.clearInterval(timer);
  }, [Boolean(session), refresh]);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.('a[href]');
      const href = anchor?.getAttribute('href') || '';
      const wikiId = anchor && wikiIdFromLink(href);
      if (wikiId) {
        event.preventDefault();
        event.stopPropagation();
        setSharedWikiId(wikiId);
        const url = new URL(window.location.href);
        url.searchParams.set('wiki', wikiId);
        url.hash = `#/wiki/${encodeURIComponent(wikiId)}`;
        window.history.pushState(null, '', url.toString());
        return;
      }
      const aiId = anchor && aiConversationIdFromLink(href, false);
      if (aiId) {
        event.preventDefault();
        event.stopPropagation();
        setSharedAIId(aiId);
        const url = new URL(window.location.href);
        url.searchParams.set('ai', aiId);
        url.hash = `#/ai/${encodeURIComponent(aiId)}`;
        window.history.pushState(null, '', url.toString());
        return;
      }
      const id = anchor && taskIdFromLink(href);
      if (id) { event.preventDefault(); event.stopPropagation(); setInfoId(id); }
    };
    const hash = () => {
      setInfoId(taskIdFromLink(location.href));
      setSharedWikiId(wikiIdFromLink(window.location.href));
      setSharedAIId(aiConversationIdFromLink(window.location.href, false));
    };
    document.addEventListener('click', click, true);
    window.addEventListener('hashchange', hash);
    window.addEventListener('popstate', hash);
    return () => {
      document.removeEventListener('click', click, true);
      window.removeEventListener('hashchange', hash);
      window.removeEventListener('popstate', hash);
    };
  }, []);
  useEffect(() => {
    if (!projectPanel) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!layoutRef.current?.contains(target) && target.closest('[data-popover-owner]')?.getAttribute('data-popover-owner') !== panelId) setProjectPanel(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setProjectPanel(null);
      layoutRef.current?.querySelector<HTMLButtonElement>(`[aria-label="${projectPanel === 'layout' ? tr("network:networkApp.projectLayout") : tr("network:networkApp.projectSortingAndFilters")}"]`)?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  }, [projectPanel, panelId]);

  const { requestDelete: remove, confirmation: taskDeleteConfirmation } = useTaskDeletion({ tasks, projects: session?.projects || [], userId: session?.currentUser.id, readOnly: session?.readOnly ?? true, setTasks, refresh, onOpenRecycle: () => { setTaskRecycleProject(null); setProjectId(null); setView('task_recycle'); setMenuOpen(false); } });

  if (sharedAIId) return <React.Suspense fallback={loadingView}><AIPublicView conversationId={sharedAIId} /></React.Suspense>;

  if (sharedWikiId) {
    return (
      <React.Suspense fallback={loadingView}>
      <WikiPublicView
        docId={sharedWikiId}
        onSelectDoc={(nextId) => {
          setSharedWikiId(nextId);
          const url = new URL(window.location.href);
          url.searchParams.set('wiki', nextId);
          url.hash = `#/wiki/${encodeURIComponent(nextId)}`;
          window.history.pushState(null, '', url.toString());
        }}
        onEnterTaskApp={() => {
          setSharedWikiId(null);
          const url = new URL(window.location.href);
          url.searchParams.delete('wiki');
          url.searchParams.delete('doc');
          url.hash = '';
          window.history.pushState(null, '', url.toString());
        }}
      />
      </React.Suspense>
    );
  }

  if (!session) return <NetworkLogin password={password} onPasswordChange={setPassword} busy={busy} error={error} onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError('');
      try {
        const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
        const data = await response.json();
        if (!response.ok) throw localizedError(data.error ? data : tr("network:networkApp.signInFailed"));
        setPassword(''); await refresh();
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { setBusy(false); }
    }} />;

  const { currentUser, projects, users, readOnly } = session;
  const selectedProject = projects.find((project) => project.id === projectId);
  const CurrentViewIcon = PROJECT_VIEWS.find((item) => item.value === layout.view)?.icon || ListTodo;
  const activeCount = countTaskLayoutSettings(layout);
  const writable = (task: Task) => !readOnly && canWriteTask(task, currentUser.id, projects);
  const today = taskToday;
  const baseTasks = tasks.filter((task) => projectId ? task.projectId === projectId : view === 'today' ? task.dueDate?.slice(0, 10) === today || task.status === 'in_progress' : view === 'upcoming' ? task.dueDate && task.dueDate > today : true);
  const shown = filterTasksByLayout(baseTasks, layout, query, new Date(today + 'T12:00:00'));
  const open = (task: Task) => { if (writable(task)) setEdit({ task }); else setInfoId(task.id); };
  const update = async (id: string, updates: Partial<Task>) => {
    try { await ApiService.updateTask(id, updates, currentUser.id); await refresh(); } catch (reason) { setError(String(reason)); }
  };
  const create = (date?: string, status?: Task['status']) => { if (!readOnly) setEdit({ date, status }); };
  const nav = (label: string, id: string, project = false, count?: number) => {
    const isActive = project ? projectId === id : !projectId && view === id;
    const projectColor = project ? projects.find((item) => item.id === id)?.color : undefined;
    return (
      <button
        key={id}
        type="button"
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => { setProjectId(project ? id : null); setView(project ? 'project' : id); setMenuOpen(false); setProjectPanel(null); }}
        className={`relative flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
          isActive
            ? 'bg-accent/12 font-semibold text-accent-text'
            : 'text-sub hover:bg-hover hover:text-main'
        }`}
      >
        {isActive && (
          <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-accent" />
        )}
        {project ? (
          <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: projectColor }} />
        ) : id === 'all' ? (
          <ListTodo className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {typeof count === 'number' && count > 0 && (
          <span
            aria-hidden="true"
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums ${
              isActive ? 'bg-accent/15 text-accent-text' : 'bg-muted text-sub'
            }`}
          >
            {count}
          </span>
        )}
      </button>
    );
  };

  const countActiveTopLevel = (items: Task[]) => items.filter((task) => !task.parentTaskId && !isCompleted(task)).length;
  const allOpenCount = countActiveTopLevel(tasks);
  const todayOpenCount = countActiveTopLevel(tasks.filter((task) => task.dueDate?.slice(0, 10) === today || task.status === 'in_progress'));
  const upcomingOpenCount = countActiveTopLevel(tasks.filter((task) => Boolean(task.dueDate && task.dueDate > today)));
  const statusPill = (displayClass = 'inline-flex') => (
    <span
      className={`${displayClass} items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border whitespace-nowrap shrink-0 ${
        readOnly
          ? 'border-warning/30 bg-warning/10 text-warning'
          : 'border-success/30 bg-success/10 text-success'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${readOnly ? 'bg-warning' : 'bg-success'}`} />
      <span>{readOnly ? tr("network:networkApp.readOnly") : tr("network:networkApp.editable")}</span>
    </span>
  );

  return <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-main">
    <header className="network-header flex min-h-12 flex-wrap md:flex-nowrap shrink-0 items-center justify-between gap-x-2.5 gap-y-2 border-b border-edge bg-surface/95 backdrop-blur-sm px-3 md:px-4 py-1.5 select-none">
      {/* 左侧：移动端抽屉开关 + 品牌标识 */}
      <div className="order-1 flex items-center gap-2 shrink-0 min-w-0">
        <button
          type="button"
          aria-label={tr("network:networkApp.projectNavigation")}
          title={tr("network:networkApp.projectNavigation")}
          onClick={() => setMenuOpen(!menuOpen)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors md:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <LanMindLogo size="sm" showText={false} />
          <span className="hidden min-[360px]:inline text-sm font-bold tracking-tight text-main whitespace-nowrap">LanMind</span>
          <span className="hidden sm:inline-flex items-center rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent-text border border-accent/20 whitespace-nowrap">
            {tr("network:networkApp.webPortal")}
          </span>
        </div>
      </div>

      {/* 中部：桌面端居中搜索栏，移动端自动独占第二行 */}
      <div className="order-3 basis-full md:order-2 md:basis-auto relative md:mx-auto md:flex-1 md:max-w-sm min-w-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-quiet pointer-events-none" />
        <input
          aria-label={tr("network:networkApp.searchTasks")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr("network:networkApp.searchTasks")}
          className="h-8 w-full rounded-lg border border-edge bg-canvas/90 pl-8 pr-7 text-xs text-main placeholder:text-quiet hover:border-edge-strong focus:border-accent focus:bg-card focus:outline-none transition-colors"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-quiet hover:text-main rounded-md hover:bg-hover transition-colors"
            title={tr('common:header.clearSearch')}
            aria-label={tr('common:header.clearSearch')}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* 右侧：状态指示、主题切换、语言切换、刷新、登出（强制同行不换行） */}
      <div className="network-header-actions order-2 md:order-3 ml-auto gap-1 sm:gap-1.5">
        {statusPill('hidden lg:inline-flex')}
        <ThemeQuickSwitcher />
        <LanguageSelect />
        <span aria-hidden="true" className="hidden sm:block h-4 w-px bg-edge mx-0.5 shrink-0" />
        <div className="flex items-center gap-1 shrink-0 flex-nowrap">
          <button
            type="button"
            title={tr("network:networkApp.refreshTasks")}
            aria-label={tr("network:networkApp.refreshTasks")}
            onClick={() => void refresh().catch((reason) => setError(String(reason)))}
            className="project-toolbar-icon shrink-0"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={tr("network:networkApp.signOut")}
            aria-label={tr("network:networkApp.signOut")}
            onClick={async () => {
              resetSession();
              await fetch('/api/session/logout', { method: 'POST' });
            }}
            className="project-toolbar-icon shrink-0 hover:text-danger hover:bg-danger/10"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
    {error && <div role="alert" className="flex items-center justify-between gap-2 border-b border-danger/25 bg-danger/8 px-4 py-2 text-xs text-danger"><span>{localizeMessage(error)}</span><button type="button" className="rounded p-0.5 hover:bg-danger/15 transition-colors" title={tr("network:networkApp.dismiss")} aria-label={tr("network:networkApp.dismiss")} onClick={() => setError('')}><X className="h-3.5 w-3.5" /></button></div>}
    <div className="flex min-h-0 flex-1">
      {menuOpen && <button type="button" aria-label={tr("network:networkApp.closeProjectNavigation")} className="fixed inset-0 z-20 bg-overlay backdrop-blur-xs md:hidden" onClick={() => setMenuOpen(false)} />}
      <aside className={`${menuOpen ? 'fixed inset-y-0 left-0 z-30 flex shadow-popover' : 'hidden'} sidebar-scroll-region w-60 shrink-0 flex-col border-r border-edge bg-surface md:static md:flex md:w-56 md:shadow-none`}>
        <div className="flex items-center justify-between gap-2 border-b border-subtle px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-xs font-semibold text-accent-text">
              {(currentUser.nickname || 'U').slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-main">{currentUser.nickname}</div>
              <div className="mt-0.5 lg:hidden">{statusPill()}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            aria-label={tr("network:networkApp.closeProjectNavigation")}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sidebar-scroll flex-1 overflow-y-auto min-h-0 p-2.5 flex flex-col gap-0.5">
          {nav(tr("network:networkApp.allTasks"), 'all', false, allOpenCount)}
          {nav(tr("network:networkApp.todaySSchedule"), 'today', false, todayOpenCount)}
          {nav(tr("network:networkApp.upcomingMilestones"), 'upcoming', false, upcomingOpenCount)}
          <h2 className="mt-4 mb-1 px-2.5 text-[11px] font-semibold tracking-wider text-quiet">{tr("network:networkApp.sharedProject")}</h2>
          {projects.map((project) => nav(project.name, project.id, true, countActiveTopLevel(tasks.filter((task) => task.projectId === project.id))))}
        </div>
        <div className="shrink-0 border-t border-subtle p-2.5">
          <button
            type="button"
            aria-current={view === 'task_recycle' ? 'page' : undefined}
            className={`group relative flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${view === 'task_recycle' ? 'bg-accent/12 font-semibold text-accent-text' : 'text-sub hover:bg-hover hover:text-main'}`}
            onClick={() => { setProjectId(null); setTaskRecycleProject(null); setView('task_recycle'); setMenuOpen(false); }}
          >
            {view === 'task_recycle' && (
              <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-accent" />
            )}
            <Trash2 className="h-3.5 w-3.5 shrink-0 transition-colors group-hover:text-danger" />
            <span>{tr('tasks:recycle.title')}</span>
          </button>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {selectedProject && <header className="project-toolbar flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-edge bg-surface/95 px-4 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-main">{selectedProject.name}</h2>
            <div className="project-task-count flex shrink-0 flex-wrap items-center gap-1.5 text-xs text-sub tabular-nums">
              <span>{shown.length !== baseTasks.filter((task) => !task.parentTaskId).length ? tr('tasks:listCard.visibleCount', { count: shown.length, total: baseTasks.filter((task) => !task.parentTaskId).length }) : tr("network:networkApp.total", { value0: shown.length })}</span>
              <span className="text-quiet">·</span>
              <span className="project-completed-count text-success font-medium">{tr("network:networkApp.completed", { value0: baseTasks.filter((task) => !task.parentTaskId && isCompleted(task)).length })}</span>
            </div>
          </div>
          <div ref={layoutRef} className="relative flex shrink-0 items-center gap-1">
            <button type="button" className="project-toolbar-icon" title={tr('tasks:recycle.title')} aria-label={tr('tasks:recycle.title')} onClick={() => { setTaskRecycleProject(projectId); setProjectId(null); setView('task_recycle'); }}><RotateCcw className="h-4 w-4" /></button>
            {!readOnly && <TaskCreateButton onClick={() => { setProjectPanel(null); create(); }} className="mr-1" />}
            <button type="button" aria-label={tr("network:networkApp.projectLayout")} title={tr("network:networkApp.projectLayout")} className="project-toolbar-icon" data-active={projectPanel === 'layout'}
              aria-haspopup="dialog" aria-expanded={projectPanel === 'layout'} aria-controls={projectPanel === 'layout' ? panelId : undefined}
              onClick={() => setProjectPanel(projectPanel === 'layout' ? null : 'layout')}><CurrentViewIcon className="h-4 w-4" /></button>
            <button type="button" aria-label={tr("network:networkApp.projectSortingAndFilters")} title={tr("network:networkApp.sortingAndFilters")} className="project-toolbar-icon task-filter-trigger" data-active={projectPanel === 'filters' || activeCount > 0}
              aria-haspopup="dialog" aria-expanded={projectPanel === 'filters'} aria-controls={projectPanel === 'filters' ? panelId : undefined}
              onClick={() => setProjectPanel(projectPanel === 'filters' ? null : 'filters')}><ListFilter className="h-4 w-4" />{activeCount > 0 && <span className="task-filter-indicator" aria-hidden="true" />}</button>
            {projectPanel && <TaskLayoutPanel id={panelId} tasks={baseTasks} layout={layout} onLayoutChange={updateLayout} mode={projectPanel} scope="project" projects={projects} users={users} currentUserId={currentUser.id} projectId={projectId} />}
          </div>
        </header>}
        {view === 'task_recycle' ? <TaskRecycleBin key={`${currentUser.id}:${taskRecycleProject}`} currentUser={currentUser} users={users} projects={projects} initialProjectId={taskRecycleProject} readOnly={readOnly} onChanged={refresh} /> : selectedProject && layout.view === 'kanban' ? <div className="flex min-h-0 flex-1"><KanbanView tasks={baseTasks} layout={layout} onLayoutChange={updateLayout} scope="project" searchQuery={query} users={users} currentUserId={currentUser.id} projects={projects} readOnly={readOnly} canEditTask={writable} onOpenEditTask={open} onUpdateTaskState={(id, stateId) => { const group=(parseGroupFilterValue(stateId) || 'unstarted'); void update(id, { stateId: null, stateGroup: group, status: GROUP_TO_LEGACY_STATUS[group] }); }} onOpenCreateTaskWithState={(stateId) => create(undefined, GROUP_TO_LEGACY_STATUS[parseGroupFilterValue(stateId) || 'unstarted'])} /></div>
          : selectedProject && layout.view === 'calendar' ? <div className="flex min-h-0 flex-1"><React.Suspense fallback={loadingView}><CalendarView compact tasks={baseTasks} layout={layout} onLayoutChange={updateLayout} scope="project" searchQuery={query} users={users} currentUserId={currentUser.id} projects={projects} readOnly={readOnly} canEditTask={writable} onOpenEditTask={open} onUpdateTask={(id, updates) => void update(id, updates)} onOpenCreateTaskWithDate={(date) => create(date)} /></React.Suspense></div>
            : selectedProject && layout.view === 'timeline' ? <TimelineView tasks={baseTasks} layout={layout} onLayoutChange={updateLayout} scope="project" searchQuery={query} currentUserId={currentUser.id} projects={projects} users={users} canEditTask={() => true} onOpenEditTask={open} />
              : <ListView tasks={baseTasks} allTasks={tasks} projects={projects} users={users} currentUser={currentUser} readOnly={readOnly} onUpdateTask={(id, updates) => void update(id, updates)} onDeleteTask={remove} onOpenCreateTask={() => create()} onOpenEditTask={open} searchQuery={query} selectedProjectId={projectId} projectLayout={projectId ? layout : undefined} onLayoutChange={updateLayout} viewTitle={view === 'today' ? tr("network:networkApp.todaySSchedule") : view === 'upcoming' ? tr("network:networkApp.upcomingMilestones") : tr("network:networkApp.allTasks")} onOpenTaskActivity={setActivity} onDuplicateTask={async (task) => {
                const copy = buildTaskDuplicate(task, tasks, currentUser.id);
                try { await ApiService.saveTaskWithChildren(null, copy.task, copy.childTasks, [], currentUser.id); await refresh(); } catch (reason) { setError(String(reason)); }
              }} />}
      </main>
    </div>
    {taskDeleteConfirmation}
    <TaskModal
      isOpen={Boolean(edit)}
      onClose={() => setEdit(null)}
      taskToEdit={edit?.task}
      tasks={tasks}
      visibleTasks={shown}
      projects={projects}
      users={users}
      currentUser={currentUser}
      canEditTask={writable}
      initialProjectId={projectId || undefined}
      initialDate={edit?.date}
      initialStatus={edit?.status}
      onNavigateTask={(task) => setEdit((prev) => (prev ? { ...prev, task } : { task }))}
      onDeleteTask={remove}
      onDuplicateTask={async (task) => {
        const copy = buildTaskDuplicate(task, tasks, currentUser.id);
        try {
          await ApiService.saveTaskWithChildren(null, copy.task, copy.childTasks, [], currentUser.id);
          await refresh();
        } catch (reason) {
          setError(String(reason));
        }
      }}
      onOpenTaskActivity={setActivity}
      onSaveTask={async (data) => {
        const { childTasks = [], detachedChildIds = [], ...payload } = data;
        await ApiService.saveTaskWithChildren(edit?.task?.id || null, payload, childTasks, detachedChildIds, currentUser.id, edit?.task?.version);
        await refresh();
        if (edit?.task) localStorage.removeItem(scopedStorageKey(`lanmind_task_attachments:${edit.task.id}`));
      }}
    />
    {infoId && <TaskInfoModal currentUserId={currentUser.id} task={tasks.find((task) => task.id === infoId) || null} tasks={tasks} projects={projects} users={users} canEdit={Boolean(tasks.find((task) => task.id === infoId && writable(task)))} onClose={() => setInfoId(null)} onOpen={(task) => setInfoId(task.id)} onEdit={(task) => { setInfoId(null); setEdit({ task }); }} />}
    {activity && <TaskActivityModal task={activity} currentUser={currentUser} users={users} onClose={() => setActivity(null)} />}
  </div>;
};
