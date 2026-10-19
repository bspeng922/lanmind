import React from 'react';
import { tr } from '../../i18n';
import { getWorkspaceContext } from '../../utils/workspaceContext';
import { AssistantMarkdown } from './AssistantMarkdown';

type Data = Record<string, unknown>;
const object = (v: unknown): Data => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : {};
const string = (v: unknown) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const array = (v: unknown): Data[] => Array.isArray(v) ? v.map(object) : [];
export const businessTools = new Set([
  'get_context', 'list_users', 'get_workspace', 'list_workspace_members', 'get_org_directory',
  'list_projects', 'get_project', 'list_project_members', 'get_project_summary', 'list_states',
  'list_tasks', 'get_task', 'list_today_tasks', 'list_risk_warnings', 'create_task', 'update_task',
  'list_task_comments', 'create_task_comment', 'update_task_comment', 'list_task_activity',
  'list_wiki_pages', 'search_wiki', 'get_wiki_page', 'create_wiki_page', 'update_wiki_page',
]);
const reference = (kind: 'task' | 'wiki', id: unknown) => {
  const ws = getWorkspaceContext()?.workspaceId;
  return `lanmind://${kind}/${encodeURIComponent(string(id))}${ws ? `?workspace=${encodeURIComponent(ws)}` : ''}`;
};
const fields = ['title', 'description', 'projectId', 'parentTaskId', 'parentId', 'assigneeId', 'stateName', 'priority', 'startDate', 'dueDate', 'reminderTime', 'progress', 'tags', 'isShared', 'sharedWith', 'subtasks', 'recurrence', 'recurrenceRule', 'content'];
export const BusinessPreview: React.FC<{ value: unknown }> = ({ value }) => {
  const data = object(value), before = object(data.before), after = object(data.after), labels = object(data.labels);
  const display = (field: string, value: unknown) => {
    if (field === 'projectId' && value == null) return tr('ai:business.personal');
    if (field === 'assigneeId' || field === 'projectId') {
      const label = array(field === 'assigneeId' ? labels.users : labels.projects).find(v => v.id === value);
      if (label) return string(label.name);
    }
    if (typeof value === 'boolean') return tr(value ? 'ai:business.yes' : 'ai:business.no');
    if (Array.isArray(value)) return value.map(item => {
      if (field === 'sharedWith') return string(array(labels.users).find(user => user.id === item)?.name) || string(item);
      if (typeof item === 'object') return string(object(item).title || object(item).text) || JSON.stringify(item);
      return string(item);
    }).join(', ') || '—';
    if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
    return string(value) || '—';
  };
  return <dl className="ai-business-preview" aria-label={tr('ai:business.preview')}>
    {fields.filter(field => field in after && (!Object.keys(before).length || JSON.stringify(before[field]) !== JSON.stringify(after[field])))
      .map(field => <div key={field} className="py-2 border-b border-subtle last:border-0">
        <dt className="text-[11px] text-sub">{tr(`ai:business.field_${field}`)}</dt>
        <dd className="mt-1 whitespace-pre-wrap break-words max-h-48 overflow-auto">
          {Object.keys(before).length > 0 && <div className="text-quiet line-through">{display(field, before[field])}</div>}
          <div>{display(field, after[field])}</div>
        </dd>
      </div>)}
  </dl>;
};

export const BusinessToolResult: React.FC<{ name: string; value: unknown; labels?: unknown }> = ({ name, value, labels: previewLabels }) => {
  const data = object(value);
  const labels = object(previewLabels ?? data.labels);
  const userName = (id: unknown) => string(array(labels.users).find(u => u.id === id)?.name) || string(id);
  if (data.error) return <p role="alert" className="ai-v2-error">{string(object(data.error).message) || string(data.error)}</p>;
  const items = Array.isArray(value) ? array(value) : array(data.items);
  const page = object(data.page);
  const task = object(data.task);
  const comment = object(data.comment);
  if (name.includes('wiki')) {
    const pages = Object.keys(page).length ? [page] : name === 'get_wiki_page' ? [data] : items;
    return <div className="space-y-2">{pages.map((p, i) => <div key={string(p.id) || i} className="ai-business-card">
      <a href={reference('wiki', p.id)} className="font-medium underline">{string(p.title) || tr('ai:business.untitled')}</a>
      {p.snippet != null && <p className="mt-1 text-sub whitespace-pre-wrap">{string(p.snippet)}</p>}
      {p.content != null && <AssistantMarkdown value={string(p.content)} />}
      {typeof p.nextOffset === 'number' && <p className="text-quiet">{tr('ai:business.moreContent')}</p>}
    </div>)}{pages.length === 0 && <Empty />}{typeof data.total === 'number' && <Count shown={pages.length} total={data.total} />}</div>;
  }
  if (['create_task', 'update_task', 'get_task', 'list_tasks', 'list_today_tasks'].includes(name)) {
    const tasks = Object.keys(task).length ? [task] : name === 'get_task' ? [data] : items;
    return <div className="space-y-2">{tasks.map((t, i) => <div key={string(t.id) || i} className="ai-business-card">
      <a href={reference('task', t.id)} className="font-medium underline">{string(t.identifier)} {string(t.title)}</a>
      <p className="mt-1 text-sub">{[t.stateName || t.status, t.priority, t.dueDate, userName(t.assigneeId)].map(string).filter(Boolean).join(' · ')}</p>
    </div>)}{tasks.length === 0 && <Empty />}{typeof data.total === 'number' && <Count shown={tasks.length} total={data.total} />}
      {Object.keys(object(data.nextTask)).length > 0 && <p className="text-sub">{tr('ai:business.nextTaskCreated')}</p>}
    </div>;
  }
  if (name.includes('comment') || name === 'list_task_activity') {
    const rows = Object.keys(comment).length ? [comment] : items;
    return <div className="space-y-2">{rows.map((c, i) => <div className="ai-business-card" key={string(c.id) || i}>
      <p className="text-quiet">{userName(c.authorId || c.actorId)} · {string(c.createdAt || c.timestamp)}</p>
      {c.content ? <AssistantMarkdown value={string(c.content)} /> : <p>{['create', 'update', 'delete'].includes(string(c.action)) ? tr(`tasks:taskActivityModal.${c.action}`) : string(c.action)}</p>}
    </div>)}{rows.length === 0 && <Empty />}{typeof data.total === 'number' && <Count shown={rows.length} total={data.total} />}</div>;
  }
  if (['list_users', 'list_workspace_members', 'list_project_members'].includes(name)) {
    return <div className="space-y-2">{items.map((row, i) => {
      const user = Object.keys(object(row.user)).length ? object(row.user) : row;
      return <div className="ai-business-card flex items-center justify-between gap-3" key={string(row.userId || user.id) || i}>
        <span>{string(user.nickname || user.name || row.userId || user.id)}</span>
        <span className="text-quiet">{[row.role ? tr(`ai:business.role_${row.role}`) : '', row.isLead ? tr('ai:business.lead') : ''].filter(Boolean).join(' · ')}</span>
      </div>;
    })}{items.length === 0 && <Empty />}{typeof data.total === 'number' && <Count shown={items.length} total={data.total} />}</div>;
  }
  if (name === 'get_project_summary') {
    return <div className="ai-business-card"><strong>{string(object(data.project).name)}</strong>
      <p className="mt-2 text-sub">{tr('ai:business.projectStats', { total: data.total, completed: data.completed, overdue: data.overdue, risks: data.riskCount })}</p>
      <p className="mt-1">{tr('ai:business.completion', { value: Math.round(Number(data.completionRate || 0) * 100) })}</p>
      <p className="mt-1 text-quiet">{tr('ai:business.visibleTasks')}</p></div>;
  }
  if (name === 'get_org_directory') {
    return <div className="ai-business-card"><p className="text-quiet">{tr('ai:business.localDirectory')}</p>{array(data.units).map(unit => <div key={string(unit.id)} className="mt-2"><strong>{string(unit.name)}</strong>{array(data.members).filter(member => member.orgUnitId === unit.id).map(member => <p className="mt-1 text-sub" key={string(member.userId)}>{string(object(member.user).nickname || member.userId)}</p>)}</div>)}{!array(data.units).length && <Empty />}</div>;
  }
  const rows = Array.isArray(value) || Array.isArray(data.items) ? items : [name === 'get_context' ? { name: data.workspaceName, description: [object(data.currentUser).nickname, data.localDateTime, data.timezoneOffset].map(string).filter(Boolean).join(' · ') } : data];
  return <div className="space-y-2">{rows.filter(r => Object.keys(r).length).map((r, i) => <div key={string(r.id) || i} className="ai-business-card">
    <strong>{string(r.name || r.title)}</strong>{r.description != null && <p className="mt-1 text-sub">{string(r.description)}</p>}
  </div>)}{rows.length === 0 && <Empty />}</div>;
};
const Empty = () => <p className="py-2 text-quiet">{tr('ai:business.empty')}</p>;
const Count: React.FC<{ shown: number; total: number }> = ({ shown, total }) => <p className="text-[11px] text-quiet">{tr('ai:business.count', { shown, total })}</p>;
