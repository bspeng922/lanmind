import React, { useEffect, useId, useMemo, useRef } from 'react';
import { AlertOctagon, Bell, Calendar, CheckCircle2, CheckSquare, ChevronDown, ChevronUp, Circle, Clock, Folder, Layers3, ListChecks, LockKeyhole, Paperclip, Repeat, Share2, User as UserIcon, X } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import { Project, Task, TaskAttachment, User, WorkItemState } from '../../types';
import { PriorityFlag } from '../PriorityFlag';
import { ThemeCheckbox } from '../ThemeCheckbox';
import { TaskMarkdown } from '../TaskMarkdown';
import { formatTaskDueDate } from '../../utils/taskDateTime';
import { formatTaskDateTime } from '../../utils/timeFormat';
import { formatRecurrenceLabel } from '../../utils/recurrence';
import { markdownWithChecklist, reconcileTaskChecklist } from '../../utils/taskChecklist';
import { formatTaskListDate, isTaskOverdue, taskDescriptionPreview } from '../../utils/taskListPresentation';
import { canWriteTask } from '../../utils/taskPermissions';
import { defaultStateFor, isBlocked, isCancelled, isCompleted, resolveTaskGroup, resolveTaskStateName } from '../../utils/workItemState';
import { downloadFile, formatFileSize } from '../../utils/fileTransfer';

interface TaskListCardProps {
  task: Task;
  project?: Project;
  projects: Project[];
  users: User[];
  currentUser: User;
  states: WorkItemState[];
  childTasks: Task[];
  attachments: TaskAttachment[];
  showProject: boolean;
  canEdit: boolean;
  readOnly: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onAdvanceState: () => void;
  onOpenTask: (task: Task) => void;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onPreviewAttachment: (attachment: TaskAttachment) => void;
  actions: React.ReactNode;
}

function StateIcon({ task, states }: { task: Task; states: WorkItemState[] }) {
  const group = resolveTaskGroup(task, states);
  const Icon = isCompleted(task, states) ? CheckCircle2 : isCancelled(task, states) ? X : isBlocked(task, states) ? AlertOctagon : group === 'started' ? Clock : Circle;
  const color = states.find((state) => state.id === task.stateId)?.color || `var(--state-${group})`;
  return <Icon className="task-card-state-icon" style={{ color }} aria-hidden="true" />;
}

export function TaskListCard({ task, project, projects, users, currentUser, states, childTasks, attachments, showProject, canEdit, readOnly, expanded, onToggleExpanded, onAdvanceState, onOpenTask, onUpdateTask, onPreviewAttachment, actions }: TaskListCardProps) {
  useLocale();
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingSection = useRef<string | null>(null);
  const content = useMemo(() => reconcileTaskChecklist(task.description || '', task.subtasks || []), [task.description, task.subtasks]);
  const description = useMemo(() => taskDescriptionPreview(task.description || ''), [task.description]);
  const checklist = content.subtasks;
  const completed = isCompleted(task, states);
  const cancelled = isCancelled(task, states);
  const overdue = !completed && !cancelled && isTaskOverdue(task.dueDate);
  const progress = completed ? 100 : typeof task.progress === 'number' ? Math.max(0, Math.min(100, task.progress)) : null;
  const tags = task.tags || [];
  const userName = (id: string) => id === currentUser.id ? tr('tasks:taskLayoutPanel.me') : users.find((user) => user.id === id)?.nickname || id || tr('tasks:listView.unassigned');
  const body = useMemo(() => expanded ? markdownWithChecklist(content.description, content.subtasks, []).trim() : '', [content, expanded]);
  const hasRecurrence = Boolean(task.recurrence && task.recurrence !== 'none');
  const hasSharing = Boolean(!task.projectId && (task.isShared || task.sharedWith?.length > 0));
  const hasSupplement = Boolean(tags.length || hasRecurrence || task.reminderTime || checklist.length || childTasks.length || attachments.length);
  const scrollToSection = (section: string) => panelRef.current?.querySelector<HTMLElement>(`[data-task-section="${section}"]`)?.scrollIntoView({ block: 'nearest' });
  useEffect(() => {
    if (expanded && pendingSection.current) {
      scrollToSection(pendingSection.current);
      pendingSection.current = null;
    }
  }, [expanded]);
  const openDetails = (section: string) => {
    if (expanded) scrollToSection(section);
    else { pendingSection.current = section; onToggleExpanded(); }
  };
  const detailsToggle = (label: React.ReactNode, Icon: typeof Paperclip, section: string, accessibleLabel?: string) => <button type="button" className="task-card-detail-trigger" onClick={() => openDetails(section)} aria-label={accessibleLabel} title={accessibleLabel} aria-expanded={expanded} aria-controls={panelId}><Icon aria-hidden="true" />{label}</button>;

  return <article className="theme-glow-card task-list-card" data-task-id={task.id} data-completed={completed || undefined} data-cancelled={cancelled || undefined}>
    <header className="task-card-heading">
      <div className="task-card-heading-main">
        <button type="button" className="task-card-state" disabled={!canEdit} onClick={onAdvanceState} title={tr(canEdit ? 'tasks:listView.changeTaskStatus' : 'tasks:listView.readOnlyTask')} aria-label={`${tr(canEdit ? 'tasks:listView.changeTaskStatus' : 'tasks:listView.readOnlyTask')}: ${resolveTaskStateName(task, states)}`}>
          <StateIcon task={task} states={states} /><span>{resolveTaskStateName(task, states)}</span>
        </button>
        {task.identifier && <span className="task-card-identifier">{task.identifier}</span>}
        <button type="button" className="task-card-title" title={task.title} onClick={() => onOpenTask(task)}>{task.title}</button>
      </div>
      <div className="task-card-heading-actions">
        <span className="task-card-priority" data-priority={task.priority}><PriorityFlag priority={task.priority} />{tr(`tasks:listView.${{ P1: 'p1Urgent', P2: 'p2High', P3: 'p3Normal', P4: 'p4Low' }[task.priority]}`)}</span>
        <div className="task-card-actions">{actions}</div>
      </div>
    </header>

    <div className="task-card-preview" data-has-summary={Boolean(description || hasSupplement) || undefined}>
      <div className="task-card-properties">
        {showProject && <span className="task-card-field task-card-project" title={project?.name || task.projectId || tr('tasks:kanbanView.personalTask')}><Folder aria-hidden="true" style={{ color: project?.color }} /><span className="sr-only">{tr('tasks:taskModal.project')}: </span><span>{project?.name || task.projectId || tr('tasks:kanbanView.personalTask')}</span></span>}
        <span className="task-card-field task-card-assignee"><UserIcon aria-hidden="true" /><span className="sr-only">{tr('tasks:taskModal.assignee')}: </span><span>{userName(task.assigneeId)}</span></span>
        <span className="task-card-schedule">
          <Calendar aria-hidden="true" />
          {task.startDate && <span className="task-card-field"><span className="task-card-label">{tr('tasks:taskModal.startDate')}</span><time dateTime={task.startDate} title={formatTaskDueDate(task.startDate)}>{formatTaskListDate(task.startDate)}</time></span>}
          {task.startDate && task.dueDate && <span className="task-card-label" aria-hidden="true">→</span>}
          {task.dueDate ? <span className="task-card-field" data-overdue={overdue || undefined}><span className={task.startDate ? 'sr-only' : 'task-card-label'}>{tr('tasks:taskModal.dueDate')}</span><time dateTime={task.dueDate} title={formatTaskDueDate(task.dueDate)}>{formatTaskListDate(task.dueDate)}</time>{overdue && <strong className="task-card-overdue">{tr('tasks:listView.overdue')}</strong>}</span> : <span className="task-card-label">{task.startDate ? `· ${tr('tasks:listCard.noDueDate')}` : tr('tasks:listView.unscheduled')}</span>}
        </span>
        {hasSharing && <button type="button" className="task-card-detail-trigger task-card-sharing" onClick={() => openDetails('sharing')} aria-expanded={expanded} aria-controls={panelId}><Share2 aria-hidden="true" />{task.sharedWith?.length ? tr('tasks:listCard.sharedCount', { count: task.sharedWith.length }) : tr('tasks:listView.sharedOverLan')}</button>}
        {!canEdit && <span className="task-card-field task-card-readonly"><LockKeyhole aria-hidden="true" />{tr('tasks:listView.readOnly')}</span>}
        <span className="task-card-progress" role={progress === null ? undefined : 'progressbar'} aria-label={tr('tasks:listView.progress', { value0: task.title })} aria-valuemin={progress === null ? undefined : 0} aria-valuemax={progress === null ? undefined : 100} aria-valuenow={progress ?? undefined}>{progress === null ? <span>{tr('tasks:listCard.progressNotSet')}</span> : <><span className="task-progress-track" aria-hidden="true"><span className="task-card-progress-fill" style={{ width: `${progress}%` }} /></span><span>{progress}%</span></>}</span>
      </div>

      {(description || hasSupplement) && <div className="task-card-summary">
        {description && <p className="task-card-description">{description}</p>}
        {hasSupplement && <div className="task-card-supplement">
          {tags.length > 0 && <button type="button" className="task-card-tag task-card-detail-trigger" aria-label={tr('tasks:listCard.showAllTags')} onClick={() => openDetails('tags')} aria-expanded={expanded} aria-controls={panelId}><span>#{tags[0]}</span>{tags.length > 1 && <span>+{tags.length - 1}</span>}</button>}
          {checklist.length > 0 && detailsToggle(tr('tasks:listView.checklist', { value0: checklist.filter((item) => item.completed).length, value1: checklist.length }), CheckSquare, 'checklist')}
          {childTasks.length > 0 && detailsToggle(tr('tasks:listView.childTasks2', { value0: childTasks.filter((child) => isCompleted(child, states)).length, value1: childTasks.length }), Layers3, 'children')}
          {attachments.length > 0 && detailsToggle(tr('tasks:listView.attachments', { value0: attachments.length }), Paperclip, 'attachments')}
          {task.reminderTime && detailsToggle(null, Bell, 'schedule', tr('tasks:listCard.viewReminder'))}
          {hasRecurrence && detailsToggle(null, Repeat, 'schedule', tr('tasks:listCard.viewRecurrence'))}
        </div>}
      </div>}
      <button type="button" className="task-card-expand" onClick={onToggleExpanded} aria-label={tr(expanded ? 'tasks:listCard.closeDetails' : 'tasks:listCard.expandDetails')} aria-expanded={expanded} aria-controls={panelId}>{tr(expanded ? 'tasks:listCard.collapseDetails' : 'tasks:listCard.details')}{expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}</button>
    </div>

    <div id={panelId} ref={panelRef} className="task-card-expanded" hidden={!expanded}>{expanded && <>
      {body && <TaskMarkdown value={body} attachments={attachments} className="task-card-full-description" />}
      {(task.reminderTime || hasRecurrence) && <section className="task-card-detail-properties" data-task-section="schedule">
        {task.reminderTime && <span className="task-card-field"><Bell aria-hidden="true" /><span className="task-card-label">{tr('tasks:taskActivityModal.reminder')}</span><time dateTime={task.reminderTime}>{formatTaskDueDate(task.reminderTime)}</time></span>}
        {hasRecurrence && <span className="task-card-field"><Repeat aria-hidden="true" />{formatRecurrenceLabel(task.recurrence, task.recurrenceRule, task.dueDate)}</span>}
      </section>}
      {tags.length > 0 && <section className="task-card-tags" data-task-section="tags">{tags.map((tag) => <span key={tag} className="task-card-tag">#{tag}</span>)}</section>}
      {hasSharing && <section data-task-section="sharing"><h4><Share2 aria-hidden="true" />{tr('tasks:taskActivityModal.sharing')}</h4><p>{task.sharedWith?.length ? task.sharedWith.map(userName).join(' · ') : tr('tasks:listView.sharedOverLan')}</p></section>}
      {childTasks.length > 0 && <section data-task-section="children" aria-label={tr('tasks:listView.childTask', { value0: task.title })}>
        <h4><Layers3 aria-hidden="true" />{tr('tasks:listView.childTasks2', { value0: childTasks.filter((child) => isCompleted(child, states)).length, value1: childTasks.length })}</h4>
        {childTasks.map((child) => {
          const canEditChild = !readOnly && !project?.isArchived && canWriteTask(child, currentUser.id, projects);
          const target = defaultStateFor(states, child.projectId, isCompleted(child, states) ? 'unstarted' : 'completed');
          return <div key={child.id} className="task-card-child">
            <ThemeCheckbox checked={isCompleted(child, states)} disabled={!canEditChild || !target} size="sm" ariaLabel={tr('tasks:listView.completeChildTask', { value0: child.title })} onChange={(checked) => { if (target) onUpdateTask(child.id, { stateId: target.id, progress: checked ? 100 : 0 }); }} />
            {child.identifier && <span className="task-card-identifier">{child.identifier}</span>}
            <button type="button" className="task-card-child-title" onClick={() => onOpenTask(child)}>{child.title}</button>
            <div className="task-card-child-properties"><span>{resolveTaskStateName(child, states)}</span><span><PriorityFlag priority={child.priority} /> {child.priority}</span><span>{userName(child.assigneeId)}</span><span>{child.dueDate ? formatTaskDueDate(child.dueDate) : tr('tasks:listCard.noDueDate')}</span></div>
          </div>;
        })}
      </section>}
      {checklist.length > 0 && <section data-task-section="checklist" aria-label={tr('tasks:listView.checklistItem', { value0: task.title })}>
        <h4><ListChecks aria-hidden="true" />{tr('tasks:listView.checklist2')}{checklist.filter((item) => item.completed).length}/{checklist.length})</h4>
        {checklist.map((item) => <div key={item.id} className="task-card-child"><ThemeCheckbox checked={item.completed} disabled={!canEdit} size="sm" ariaLabel={tr('tasks:listView.completeChecklistItem', { value0: item.title })} onChange={(checked) => { const next = checklist.map((candidate) => candidate.id === item.id ? { ...candidate, completed: checked } : candidate); onUpdateTask(task.id, { subtasks: next, description: markdownWithChecklist(content.description, checklist, next) }); }} /><span className={item.completed ? 'task-card-check-completed' : ''}>{item.title}</span></div>)}
      </section>}
      {attachments.length > 0 && <section data-task-section="attachments" aria-label={tr('tasks:listView.attachments2', { value0: attachments.length })}>
        <h4><Paperclip aria-hidden="true" />{tr('tasks:listView.attachments2', { value0: attachments.length })}</h4>
        {attachments.map((file) => <div className="task-card-attachment" key={file.id}><button type="button" onClick={() => onPreviewAttachment(file)} title={tr('tasks:listView.preview')}><Paperclip aria-hidden="true" /><span>{file.name}</span></button><span className="task-card-label">{file.name.match(/\.([a-z0-9]{1,12})$/i)?.[1].toUpperCase() || file.type}</span><span>{formatFileSize(file.size)}</span>{file.dataUrl && <button type="button" onClick={() => downloadFile(file.dataUrl, file.name)}>{tr('tasks:listView.download')}</button>}</div>)}
      </section>}
      <footer className="task-card-audit">
        <span><span className="task-card-label">{tr('tasks:taskEditor.createdBy')}</span> {userName(task.creatorId)}{task.createdAt && <> · <time dateTime={task.createdAt}>{formatTaskDateTime(task.createdAt)}</time></>}</span>
        {task.updatedAt && <span><span className="task-card-label">{tr('tasks:taskEditor.updatedAt')}</span> <time dateTime={task.updatedAt}>{formatTaskDateTime(task.updatedAt)}</time></span>}
      </footer>
    </>}</div>
  </article>;
}
