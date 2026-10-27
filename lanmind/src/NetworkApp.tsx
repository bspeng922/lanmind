import { scopedStorageKey, setWorkspaceContext, sameWorkspace, type WorkspaceContext } from "./utils/workspaceContext";
import { localizeMessage, localizedError } from './i18n/messages';
import { tr, useLocale } from "./i18n";
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LanguageSelect } from './components/LanguageSelect';
import { ThemeQuickSwitcher } from './components/ThemeQuickSwitcher';
import { CalendarDays, CheckSquare, Folder, ListFilter, ListTodo, LogOut, Menu, RefreshCw, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { ApiService } from './services/api';
import { Project, Task, User } from './types';
import { ListView } from './components/ListView';
import { TaskModal } from './components/TaskModal';
import { TaskCreateButton } from './components/TaskCreateButton';
import { TaskInfoModal } from './components/TaskInfoModal';
import { TaskActivityModal } from './components/TaskActivityModal';
import { PROJECT_VIEWS, TaskLayoutPanel } from './components/TaskLayoutPanel';
import { countTaskLayoutSettings, filterTasksByLayout, useTaskLayout, useTaskToday } from './utils/taskLayout';
import { canWriteTask } from './utils/taskPermissions';
import { taskIdFromLink } from './utils/taskLinks';
import { buildTaskDuplicate } from './utils/taskDuplicate';
import { KanbanView } from './components/KanbanView';
import { CalendarView } from './components/CalendarView';
import { TimelineView } from './components/TimelineView';
import { NetworkLogin } from './components/NetworkLogin';
import { WikiPublicView } from './components/wiki/WikiPublicView';
import { AIPublicView } from './components/ai/AIPublicView';
import { aiConversationIdFromLink } from './components/ai/aiLinks';
import { wikiIdFromLink } from './components/wiki/wikiLinks';
import { useTaskDeletion } from './hooks/useTaskDeletion';
import { isCompleted } from './utils/workItemState';
import { TaskRecycleBin } from './components/TaskRecycleBin';

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
      const id = anchor && taskIdFromLink(anchor.getAttribute('href') || '');
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

  if (sharedAIId) return <AIPublicView conversationId={sharedAIId} />;

  if (sharedWikiId) {
    return (
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
  const nav = (label: string, id: string, project = false) => <button key={id} type="button" onClick={() => { setProjectId(project ? id : null); setView(project ? 'project' : id); setMenuOpen(false); setProjectPanel(null); }} className={`flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs ${(project ? projectId === id : !projectId && view === id) ? 'bg-hover font-semibold text-info' : 'text-sub hover:bg-hover'}`}>{project ? <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: projects.find((item) => item.id === id)?.color }} /> : id === 'all' ? <ListTodo className="h-3.5 w-3.5 shrink-0" /> : <CalendarDays className="h-3.5 w-3.5 shrink-0" />}<span className="min-w-0 truncate">{label}</span></button>;
  return <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-main">
    <header className="flex h-13 shrink-0 items-center justify-between border-b border-edge bg-surface px-4 py-2 gap-3 select-none">
      {/* 左侧：移动端抽屉开关 + 品牌标识 */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          aria-label={tr("network:networkApp.projectNavigation")}
          title={tr("network:networkApp.projectNavigation")}
          onClick={() => setMenuOpen(!menuOpen)}
          className="project-toolbar-icon md:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent shadow-2xs border border-accent/20">
            <CheckSquare className="h-4 w-4" />
          </div>
          <span className="text-sm font-bold tracking-tight text-main">LanMind</span>
          <span className="hidden sm:inline-flex items-center rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent border border-accent/20">
            {tr("network:networkApp.webPortal")}
          </span>
        </div>
      </div>

      {/* 中部：居中搜索栏 */}
      <div className="relative mx-auto flex-1 max-w-sm min-w-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-quiet pointer-events-none" />
        <input
          aria-label={tr("network:networkApp.searchTasks")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr("network:networkApp.searchTasks")}
          className="h-8 w-full rounded-lg border border-subtle bg-canvas pl-8 pr-7 text-xs text-main placeholder-quiet focus:border-accent/60 focus:bg-surface focus:outline-none transition-colors"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-quiet hover:text-main rounded"
            title={tr('common:header.clearSearch')}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* 右侧：状态指示、主题切换、语言切换、刷新、登出 */}
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`hidden md:inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium border whitespace-nowrap shrink-0 ${
            readOnly
              ? "border-warning/30 bg-warning/10 text-warning"
              : "border-success/30 bg-success/10 text-success"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${readOnly ? "bg-warning" : "bg-success"}`} />
          <span>{readOnly ? tr("network:networkApp.readOnly") : tr("network:networkApp.editable")}</span>
        </span>
        <ThemeQuickSwitcher />
        <LanguageSelect />
        <button
          type="button"
          title={tr("network:networkApp.refreshTasks")}
          aria-label={tr("network:networkApp.refreshTasks")}
          onClick={() => void refresh().catch((reason) => setError(String(reason)))}
          className="project-toolbar-icon"
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
          className="project-toolbar-icon hover:text-danger hover:border-danger/30 hover:bg-danger/10"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
    {error && <div role="alert" className="flex items-center justify-between gap-2 border-b border-edge px-4 py-2 text-xs text-danger">{localizeMessage(error)}<button type="button" title={tr("network:networkApp.dismiss")} onClick={() => setError('')}><X className="h-3.5 w-3.5" /></button></div>}
    <div className="flex min-h-0 flex-1">
      {menuOpen && <button aria-label={tr("network:networkApp.closeProjectNavigation")} className="fixed inset-0 z-20 bg-overlay md:hidden" onClick={() => setMenuOpen(false)} />}
      <aside className={`${menuOpen ? 'fixed inset-y-12 left-0 z-30 flex' : 'hidden'} w-56 shrink-0 flex-col border-r border-edge bg-surface md:static md:flex`}>
        <div className="flex-1 overflow-y-auto min-h-0 p-3 flex flex-col gap-1">
          <div className="mb-2 truncate px-3 py-2 text-xs font-semibold text-sub">{currentUser.nickname}</div>
          {nav(tr("network:networkApp.allTasks"), 'all')}{nav(tr("network:networkApp.todaySSchedule"), 'today')}{nav(tr("network:networkApp.upcomingMilestones"), 'upcoming')}
          <h2 className="mt-4 px-3 py-2 text-[11px] font-semibold text-quiet">{tr("network:networkApp.sharedProject")}</h2>{projects.map((project) => nav(project.name, project.id, true))}
        </div>
        <div className="shrink-0 border-t border-edge/60 p-2">
          <button
            type="button"
            className={`group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors ${view === 'task_recycle' ? 'bg-hover font-semibold text-info' : 'text-sub hover:bg-hover hover:text-main'}`}
            onClick={() => { setProjectId(null); setTaskRecycleProject(null); setView('task_recycle'); setMenuOpen(false); }}
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0 transition-colors group-hover:text-danger" />
            <span>{tr('tasks:recycle.title')}</span>
          </button>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {selectedProject && <header className="project-toolbar flex shrink-0 items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <h2 className="min-w-0 truncate text-base font-semibold">{selectedProject.name}</h2>
            <div className="project-task-count flex shrink-0 flex-wrap items-center gap-1.5 text-xs text-sub">
              <span>{shown.length !== baseTasks.filter((task) => !task.parentTaskId).length ? tr('tasks:listCard.visibleCount', { count: shown.length, total: baseTasks.filter((task) => !task.parentTaskId).length }) : tr("network:networkApp.total", { value0: shown.length })}</span>
              <span className="text-quiet">·</span>
              <span className="project-completed-count text-success">{tr("network:networkApp.completed", { value0: baseTasks.filter((task) => !task.parentTaskId && isCompleted(task)).length })}</span>
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
        {view === 'task_recycle' ? <TaskRecycleBin key={`${currentUser.id}:${taskRecycleProject}`} currentUser={currentUser} users={users} projects={projects} initialProjectId={taskRecycleProject} readOnly={readOnly} onChanged={refresh} /> : selectedProject && layout.view === 'kanban' ? <div className="flex min-h-0 flex-1"><KanbanView tasks={baseTasks} layout={layout} onLayoutChange={updateLayout} scope="project" searchQuery={query} users={users} currentUserId={currentUser.id} projects={projects} readOnly={readOnly} canEditTask={writable} onOpenEditTask={open} onUpdateTaskStatus={(id, status) => void update(id, { status })} onOpenCreateTaskWithStatus={(status) => create(undefined, status)} /></div>
          : selectedProject && layout.view === 'calendar' ? <div className="flex min-h-0 flex-1"><CalendarView compact tasks={baseTasks} layout={layout} onLayoutChange={updateLayout} scope="project" searchQuery={query} users={users} currentUserId={currentUser.id} projects={projects} readOnly={readOnly} canEditTask={writable} onOpenEditTask={open} onUpdateTask={(id, updates) => void update(id, updates)} onOpenCreateTaskWithDate={(date) => create(date)} /></div>
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
