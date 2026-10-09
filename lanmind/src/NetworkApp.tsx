import { localizeMessage, localizedError } from './i18n/messages';
import { tr, useLocale } from "./i18n";
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LanguageSelect } from './components/LanguageSelect';
import { CalendarDays, CheckSquare, Folder, ListFilter, ListTodo, LogOut, Menu, RefreshCw, Search, X } from 'lucide-react';
import { ApiService } from './services/api';
import { Project, Task, User } from './types';
import { ListView } from './components/ListView';
import { TaskModal } from './components/TaskModal';
import { TaskCreateButton } from './components/TaskCreateButton';
import { TaskInfoModal } from './components/TaskInfoModal';
import { TaskActivityModal } from './components/TaskActivityModal';
import { PROJECT_VIEWS, TaskLayoutPanel } from './components/TaskLayoutPanel';
import { countTaskLayoutSettings, filterTasksByLayout, useTaskLayout } from './utils/taskLayout';
import { canWriteTask } from './utils/taskPermissions';
import { taskIdFromLink } from './utils/taskLinks';
import { buildTaskDuplicate } from './utils/taskDuplicate';
import { formatLocalTaskDateTime } from './utils/taskDateTime';
import { KanbanView } from './components/KanbanView';
import { CalendarView } from './components/CalendarView';
import { TimelineView } from './components/TimelineView';
import { NetworkLogin } from './components/NetworkLogin';

interface NetworkSession { currentUser: User; users: User[]; projects: Project[]; readOnly: boolean }

export const NetworkApp: React.FC = () => {
  useLocale();
  const [session, setSession] = useState<NetworkSession | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('all');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectPanel, setProjectPanel] = useState<'layout' | 'filters' | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [edit, setEdit] = useState<{ task?: Task; date?: string; status?: Task['status'] } | null>(null);
  const [infoId, setInfoId] = useState<string | null>(() => taskIdFromLink(location.href));
  const [activity, setActivity] = useState<Task | null>(null);
  const { layout, updateLayout } = useTaskLayout(session?.currentUser.id || 'network', projectId);
  const refresh = useCallback(async () => {
    const response = await fetch('/api/bootstrap');
    if (response.status === 401) { setSession(null); return; }
    const bootstrap = await response.json();
    if (!response.ok) throw localizedError(bootstrap.error ? bootstrap : tr("network:networkApp.couldNotLoadTasks"));
    const nextTasks = await ApiService.getTasks();
    setSession(bootstrap);
    setTasks(nextTasks);
  }, []);
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
    const hash = () => setInfoId(taskIdFromLink(location.href));
    document.addEventListener('click', click, true);
    window.addEventListener('hashchange', hash);
    return () => { document.removeEventListener('click', click, true); window.removeEventListener('hashchange', hash); };
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
  const today = formatLocalTaskDateTime(new Date(), false);
  const baseTasks = tasks.filter((task) => projectId ? task.projectId === projectId : view === 'today' ? task.dueDate?.slice(0, 10) === today || task.status === 'in_progress' : view === 'upcoming' ? task.dueDate && task.dueDate > today : true);
  const shown = selectedProject ? filterTasksByLayout(baseTasks, layout, query) : baseTasks.filter((task) => !task.parentTaskId);
  const open = (task: Task) => { if (writable(task)) setEdit({ task }); else setInfoId(task.id); };
  const update = async (id: string, updates: Partial<Task>) => {
    try { await ApiService.updateTask(id, updates, currentUser.id); await refresh(); } catch (reason) { setError(String(reason)); }
  };
  const create = (date?: string, status?: Task['status']) => { if (!readOnly) setEdit({ date, status }); };
  const remove = async (id: string) => {
    if (!window.confirm(tr("network:networkApp.deleteThisTaskChildTasksWillBe"))) return;
    try { await ApiService.deleteTask(id, currentUser.id); await refresh(); } catch (reason) { setError(String(reason)); }
  };
  const nav = (label: string, id: string, project = false) => <button key={id} type="button" onClick={() => { setProjectId(project ? id : null); setView(project ? 'project' : id); setMenuOpen(false); setProjectPanel(null); }} className={`flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs ${(project ? projectId === id : !projectId && view === id) ? 'bg-hover font-semibold text-info' : 'text-sub hover:bg-hover'}`}>{project ? <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: projects.find((item) => item.id === id)?.color }} /> : id === 'all' ? <ListTodo className="h-3.5 w-3.5 shrink-0" /> : <CalendarDays className="h-3.5 w-3.5 shrink-0" />}<span className="min-w-0 truncate">{label}</span></button>;
  return <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-main">
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-edge bg-surface px-4 py-2">
      <LanguageSelect />
      <button type="button" aria-label={tr("network:networkApp.projectNavigation")} title={tr("network:networkApp.projectNavigation")} onClick={() => setMenuOpen(!menuOpen)} className="project-toolbar-icon md:hidden"><Menu className="h-4 w-4" /></button>
      <span className="flex items-center gap-2 text-sm font-semibold"><CheckSquare className="h-4 w-4 text-info" />LanMind</span>
      <div className="relative ml-auto min-w-0 max-w-sm flex-1"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-quiet" /><input aria-label={tr("network:networkApp.searchTasks")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr("network:networkApp.searchTasks")} className="h-8 w-full rounded-md border border-subtle bg-canvas pl-8 pr-3 text-xs" /></div>
      <span className="hidden shrink-0 text-[11px] text-sub sm:inline">{readOnly ? tr("network:networkApp.readOnly") : tr("network:networkApp.editable")}</span>
      <button type="button" title={tr("network:networkApp.refreshTasks")} aria-label={tr("network:networkApp.refreshTasks")} onClick={() => void refresh().catch((reason) => setError(String(reason)))} className="project-toolbar-icon"><RefreshCw className="h-4 w-4" /></button>
      <button type="button" title={tr("network:networkApp.signOut")} aria-label={tr("network:networkApp.signOut")} onClick={async () => { await fetch('/api/session/logout', { method: 'POST' }); setSession(null); setEdit(null); setInfoId(null); }} className="project-toolbar-icon"><LogOut className="h-4 w-4" /></button>
    </header>
    {error && <div role="alert" className="flex items-center justify-between gap-2 border-b border-edge px-4 py-2 text-xs text-danger">{localizeMessage(error)}<button type="button" title={tr("network:networkApp.dismiss")} onClick={() => setError('')}><X className="h-3.5 w-3.5" /></button></div>}
    <div className="flex min-h-0 flex-1">
      {menuOpen && <button aria-label={tr("network:networkApp.closeProjectNavigation")} className="fixed inset-0 z-20 bg-overlay md:hidden" onClick={() => setMenuOpen(false)} />}
      <aside className={`${menuOpen ? 'fixed inset-y-12 left-0 z-30 flex' : 'hidden'} w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-edge bg-surface p-3 md:static md:flex`}>
        <div className="mb-2 truncate px-3 py-2 text-xs font-semibold text-sub">{currentUser.nickname}</div>
        {nav(tr("network:networkApp.allTasks"), 'all')}{nav(tr("network:networkApp.todaySSchedule"), 'today')}{nav(tr("network:networkApp.upcomingMilestones"), 'upcoming')}
        <h2 className="mt-4 px-3 py-2 text-[11px] font-semibold text-quiet">{tr("network:networkApp.sharedProject")}</h2>{projects.map((project) => nav(project.name, project.id, true))}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {selectedProject && <header className="project-toolbar flex shrink-0 items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <h2 className="min-w-0 truncate text-base font-semibold">{selectedProject.name}</h2>
            <div className="project-task-count flex shrink-0 flex-wrap items-center gap-1.5 text-xs text-sub">
              <span>{tr("network:networkApp.total", { value0: shown.length })}</span>
              <span className="text-quiet">·</span>
              <span className="project-completed-count text-success">{tr("network:networkApp.completed", { value0: baseTasks.filter((task) => !task.parentTaskId && task.status === 'completed').length })}</span>
            </div>
          </div>
          <div ref={layoutRef} className="relative flex shrink-0 items-center gap-1">
            {!readOnly && <TaskCreateButton onClick={() => { setProjectPanel(null); create(); }} className="mr-1" />}
            <button type="button" aria-label={tr("network:networkApp.projectLayout")} title={tr("network:networkApp.projectLayout")} className="project-toolbar-icon" data-active={projectPanel === 'layout'}
              aria-haspopup="dialog" aria-expanded={projectPanel === 'layout'} aria-controls={projectPanel === 'layout' ? panelId : undefined}
              onClick={() => setProjectPanel(projectPanel === 'layout' ? null : 'layout')}><CurrentViewIcon className="h-4 w-4" /></button>
            <button type="button" aria-label={tr("network:networkApp.projectSortingAndFilters")} title={tr("network:networkApp.sortingAndFilters")} className="project-toolbar-icon task-filter-trigger" data-active={projectPanel === 'filters' || activeCount > 0}
              aria-haspopup="dialog" aria-expanded={projectPanel === 'filters'} aria-controls={projectPanel === 'filters' ? panelId : undefined}
              onClick={() => setProjectPanel(projectPanel === 'filters' ? null : 'filters')}><ListFilter className="h-4 w-4" />{activeCount > 0 && <span className="task-filter-indicator" aria-hidden="true" />}</button>
            {projectPanel && <TaskLayoutPanel id={panelId} tasks={baseTasks} layout={layout} onLayoutChange={updateLayout} mode={projectPanel} scope="project" />}
          </div>
        </header>}
        {selectedProject && layout.view === 'kanban' ? <div className="flex min-h-0 flex-1"><KanbanView tasks={shown} projects={projects} readOnly={readOnly} canEditTask={writable} onOpenEditTask={open} onUpdateTaskStatus={(id, status) => void update(id, { status })} onOpenCreateTaskWithStatus={(status) => create(undefined, status)} /></div>
          : selectedProject && layout.view === 'calendar' ? <div className="flex min-h-0 flex-1"><CalendarView compact tasks={shown} projects={projects} readOnly={readOnly} canEditTask={writable} onOpenEditTask={open} onUpdateTask={(id, updates) => void update(id, updates)} onOpenCreateTaskWithDate={(date) => create(date)} /></div>
            : selectedProject && layout.view === 'timeline' ? <TimelineView tasks={shown} projects={projects} users={users} canEditTask={() => true} onOpenEditTask={open} />
              : <ListView tasks={shown} allTasks={tasks} projects={projects} users={users} currentUser={currentUser} readOnly={readOnly} onUpdateTask={(id, updates) => void update(id, updates)} onDeleteTask={(id) => void remove(id)} onOpenCreateTask={() => create()} onOpenEditTask={open} searchQuery={query} selectedProjectId={projectId} projectLayout={projectId ? layout : undefined} viewTitle={view === 'today' ? tr("network:networkApp.todaySSchedule") : view === 'upcoming' ? tr("network:networkApp.upcomingMilestones") : tr("network:networkApp.allTasks")} onOpenTaskActivity={setActivity} onDuplicateTask={async (task) => {
                const copy = buildTaskDuplicate(task, tasks, currentUser.id);
                try { await ApiService.saveTaskWithChildren(null, copy.task, copy.childTasks, [], currentUser.id); await refresh(); } catch (reason) { setError(String(reason)); }
              }} />}
      </main>
    </div>
    <TaskModal isOpen={Boolean(edit)} onClose={() => setEdit(null)} taskToEdit={edit?.task} tasks={tasks} projects={projects} users={users} currentUser={currentUser} canEditTask={writable} initialProjectId={projectId || undefined} initialDate={edit?.date} initialStatus={edit?.status} onSaveTask={async (data) => {
      const { childTasks = [], detachedChildIds = [], ...payload } = data;
      await ApiService.saveTaskWithChildren(edit?.task?.id || null, payload, childTasks, detachedChildIds, currentUser.id, edit?.task?.version); await refresh();
      if (edit?.task) localStorage.removeItem(`lanmind_task_attachments:${edit.task.id}`);
    }} />
    {infoId && <TaskInfoModal currentUserId={currentUser.id} task={tasks.find((task) => task.id === infoId) || null} tasks={tasks} projects={projects} users={users} canEdit={Boolean(tasks.find((task) => task.id === infoId && writable(task)))} onClose={() => setInfoId(null)} onOpen={(task) => setInfoId(task.id)} onEdit={(task) => { setInfoId(null); setEdit({ task }); }} />}
    {activity && <TaskActivityModal task={activity} currentUser={currentUser} users={users} onClose={() => setActivity(null)} />}
  </div>;
};
