import { tr, useLocale } from "../i18n";
import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowRightLeft, Folder, FolderOpen, ListFilter, ListTodo, MoreHorizontal, UserCog, Trash2 } from 'lucide-react';
import { Project, Task, User } from '../types';
import { countTaskLayoutSettings, ProjectLayout } from '../utils/taskLayout';
import { PROJECT_VIEWS, TaskLayoutPanel } from './TaskLayoutPanel';
import { TaskCreateButton } from './TaskCreateButton';

interface ProjectToolbarProps {
  project: Project;
  users: User[];
  currentUser: User;
  tasks: Task[];
  taskCount: number;
  onOpenCreateTask: () => void;
  layout: ProjectLayout;
  onLayoutChange: (patch: Partial<ProjectLayout>) => void;
  onOpenFiles: () => void;
  onProjectAction: (action: 'manage' | 'delete' | 'transfer') => void;
}

export const ProjectToolbar: React.FC<ProjectToolbarProps> = ({ project, users, currentUser, tasks, taskCount, onOpenCreateTask, layout, onLayoutChange, onOpenFiles, onProjectAction }: ProjectToolbarProps) => {
  useLocale();
  const [panel, setPanel] = useState<'layout' | 'filters' | 'more' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const isCreator = project.createdBy === currentUser.id;
  const isAdmin = isCreator || project.admins.includes(currentUser.id);
  const CurrentIcon = PROJECT_VIEWS.find((view) => view.value === layout.view)?.icon || ListTodo;
  const activeCount = countTaskLayoutSettings(layout);

  useEffect(() => {
    if (!panel) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!rootRef.current?.contains(target) && target.closest('[data-popover-owner]')?.getAttribute('data-popover-owner') !== panelId) setPanel(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setPanel(null);
      rootRef.current?.querySelector<HTMLButtonElement>(`[aria-label="${panel === 'layout' ? tr("projects:projectToolbar.projectLayout") : panel === 'filters' ? tr("projects:projectToolbar.projectSortingAndFilters") : tr("projects:projectToolbar.moreProjectActions")}"]`)?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [panel, panelId]);

  const action = (value: 'manage' | 'delete' | 'transfer') => { setPanel(null); onProjectAction(value); };

  return (
    <header className="project-toolbar flex shrink-0 items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Folder className="h-5 w-5 shrink-0" style={{ color: project.color || 'var(--accent)' }} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="truncate text-base font-semibold text-main" title={project.name}>{project.name}</h2>
            <div className="project-task-count flex shrink-0 flex-wrap items-center gap-1.5 text-xs text-sub">
              <span>{tr("projects:projectToolbar.total", { value0: taskCount })}</span>
              <span className="text-quiet">·</span>
              <span className="project-completed-count text-success">{tr("projects:projectToolbar.completed", { value0: tasks.filter((task) => !task.parentTaskId && task.status === 'completed').length })}</span>
            </div>
          </div>
          {project.description && <p className="mt-0.5 truncate text-xs text-sub" title={project.description}>{project.description}</p>}
        </div>
      </div>
      <div className="hidden items-center -space-x-1.5 lg:flex" aria-label={tr("projects:projectToolbar.projectMembers")}>
        {project.members.slice(0, 4).map((id) => {
          const user = users.find((item) => item.id === id);
          return <span key={id} title={user?.nickname || id} className="project-member-avatar flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-edge text-[10px] font-semibold">
            {user?.avatar?.startsWith('data:image') || user?.avatar?.startsWith('http')
              ? <img src={user.avatar} alt="" className="h-full w-full object-cover" /> : user?.avatar || user?.nickname?.charAt(0) || 'U'}
          </span>;
        })}
        {project.members.length > 4 && <span className="project-member-avatar flex h-6 w-6 items-center justify-center rounded-full border border-edge text-[9px]">+{project.members.length - 4}</span>}
      </div>
      <div ref={rootRef} className="relative flex shrink-0 items-center gap-1" onKeyDown={(event) => {
        if (panel !== 'more' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = Array.from(rootRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || []) as HTMLButtonElement[];
        if (!items.length) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowDown' ? (current + 1) % items.length : (current <= 0 ? items.length : current) - 1;
        items[next].focus();
      }}>
        <TaskCreateButton onClick={() => { setPanel(null); onOpenCreateTask(); }} className="mr-1" />
        <button type="button" className="project-toolbar-icon" data-active={panel === 'layout'}
          aria-label={tr("projects:projectToolbar.projectLayout")} aria-haspopup="dialog" aria-expanded={panel === 'layout'} aria-controls={panel === 'layout' ? panelId : undefined}
          title={tr("projects:projectToolbar.projectLayout")} onClick={() => setPanel(panel === 'layout' ? null : 'layout')}>
          <CurrentIcon className="h-4 w-4" />
        </button>
        <button type="button" className="project-toolbar-icon task-filter-trigger" data-active={panel === 'filters' || activeCount > 0}
          aria-label={tr("projects:projectToolbar.projectSortingAndFilters")} title={activeCount ? tr("projects:projectToolbar.sortingAndFilters", { value0: activeCount }) : tr("projects:projectToolbar.sortingAndFilters2")} aria-haspopup="dialog"
          aria-expanded={panel === 'filters'} aria-controls={panel === 'filters' ? panelId : undefined} onClick={() => setPanel(panel === 'filters' ? null : 'filters')}>
          <ListFilter className="h-4 w-4" />{activeCount > 0 && <span className="task-filter-indicator" aria-hidden="true" />}
        </button>
        <button type="button" className="project-toolbar-icon" title={tr("projects:projectToolbar.projectFiles")} aria-label={tr("projects:projectToolbar.projectFiles")} onClick={() => { setPanel(null); onOpenFiles(); }}><FolderOpen className="h-4 w-4" /></button>
        <button type="button" className="project-toolbar-icon" data-active={panel === 'more'} title={tr("projects:projectToolbar.moreProjectActions")} aria-label={tr("projects:projectToolbar.moreProjectActions")}
          aria-haspopup="menu" aria-expanded={panel === 'more'} onClick={() => setPanel(panel === 'more' ? null : 'more')}><MoreHorizontal className="h-5 w-5" /></button>

        {(panel === 'layout' || panel === 'filters') && <TaskLayoutPanel id={panelId} tasks={tasks} layout={layout} onLayoutChange={onLayoutChange} mode={panel === 'layout' ? 'layout' : 'filters'} scope="project" />}

        {panel === 'more' && <div role="menu" aria-label={tr("projects:projectToolbar.projectActions")} className="project-more-menu">
          <button type="button" role="menuitem" disabled={!isAdmin} title={isAdmin ? undefined : tr("projects:projectToolbar.onlyProjectAdministratorsCanManageThisProject")} onClick={() => action('manage')}><UserCog className="h-4 w-4" />{tr("projects:projectToolbar.projectSettings")}</button>
          <button type="button" role="menuitem" disabled={!isCreator} title={isCreator ? undefined : tr("projects:projectToolbar.onlyTheProjectCreatorCanTransferIt")} onClick={() => action('transfer')}><ArrowRightLeft className="h-4 w-4" />{tr("projects:projectToolbar.transferProject")}</button>
          <div className="my-1 border-t border-edge" />
          <button type="button" role="menuitem" disabled={!isCreator} title={isCreator ? undefined : tr("projects:projectToolbar.onlyTheProjectCreatorCanDeleteIt")} className="text-danger" onClick={() => action('delete')}><Trash2 className="h-4 w-4" />{tr("projects:projectToolbar.deleteProject")}</button>
        </div>}
      </div>
    </header>
  );
};
