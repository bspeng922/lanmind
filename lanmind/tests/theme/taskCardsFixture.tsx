import React, { useState } from 'react';
import { ListView } from '../../src/components/ListView';
import { ProjectToolbar } from '../../src/components/ProjectToolbar';
import { DEFAULT_PROJECT_LAYOUT, filterTasksByLayout, useTaskToday } from '../../src/utils/taskLayout';
import type { Project, Task, User, WorkItemState } from '../../src/types';

export function TaskCardsFixture({ user, peer, project }: { user: User; peer: User; project: Project }) {
  const readOnly = new URLSearchParams(window.location.search).has('read-only');
  const timestamp = '2026-10-21T09:30:00Z';
  const states: WorkItemState[] = [project.id, null].flatMap((projectId) => (['unstarted', 'started', 'completed', 'cancelled'] as const).map((group, index) => ({
    id: `${projectId || 'personal'}-${group}`, name: ['待处理', '待验收', '已完成', '已取消'][index], group, projectId,
    color: ['#737373', '#a16207', '#15803d', '#b91c1c'][index], sequence: index, isDefault: true, createdAt: timestamp, updatedAt: timestamp,
  })));
  const base: Task = { id: 'full', identifier: 'LAN-12', title: '发布前检查', description: '核对 **安装** 与 [升级说明](https://example.com/release)。\n\n- [ ] 核对安装\n- [x] 验证更新', priority: 'P2', status: 'todo', stateId: `${project.id}-started`, stateGroup: 'started', stateName: '待验收', progress: 0, startDate: '2026-10-20', dueDate: '2026-10-21T18:00', reminderTime: '2026-10-21T17:30', recurrence: 'weekly', recurrenceRule: { interval: 1, daysOfWeek: [3], timeOfDay: '18:00' }, creatorId: peer.id, assigneeId: user.id, projectId: project.id, isShared: true, sharedWith: [], tags: ['发布', '验收', '桌面端'], subtasks: [], attachments: [], createdAt: timestamp, updatedAt: timestamp, version: 1 };
  const [tasks, setTasks] = useState<Task[]>(() => [
    base,
    { ...base, id: 'files-only', identifier: 'LAN-13', title: '只有附件的任务', description: '', recurrence: 'none', reminderTime: null, stateId: `${project.id}-unstarted`, stateGroup: 'unstarted', stateName: '待处理', startDate: null, dueDate: null, assigneeId: '', progress: undefined, tags: [], attachments: [{ id: 'attachment', name: '发布说明.txt', size: 128, type: 'text/plain', dataUrl: 'data:text/plain;base64,cmVsZWFzZQ==', addedAt: timestamp }] },
    { ...base, id: 'child', identifier: 'LAN-14', title: '独立子任务', parentTaskId: base.id, description: '', dueDate: '2026-10-21T17:00', tags: [], assigneeId: peer.id, priority: 'P1' },
    { ...base, id: 'shared-personal', identifier: undefined, title: '共享个人任务', projectId: null, description: '共享范围应可查看', stateId: 'personal-unstarted', stateGroup: 'unstarted', stateName: '待处理', recurrence: 'none', startDate: '2026-10-23', dueDate: null, reminderTime: null, sharedWith: [peer.id], tags: [] },
    { ...base, id: 'plain', identifier: 'LAN-15', title: '整理验收结论', description: '', stateId: `${project.id}-unstarted`, stateGroup: 'unstarted', stateName: '待处理', startDate: null, dueDate: null, reminderTime: null, recurrence: 'none', tags: [], isShared: false },
    { ...base, id: 'done', identifier: 'LAN-16', title: '已验收的自定义完成状态', description: '', stateId: `${project.id}-completed`, stateGroup: 'completed', stateName: '已完成', startDate: null, dueDate: null, reminderTime: null, recurrence: 'none', tags: [] },
  ]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState(DEFAULT_PROJECT_LAYOUT);
  const [openedTask, setOpenedTask] = useState<Task | null>(null);
  const today = useTaskToday();
  const scopedTasks = tasks.filter((task) => !selectedProjectId || task.projectId === selectedProjectId);
  const updateTask = (id: string, updates: Partial<Task>) => setTasks((current) => current.map((task) => {
    if (task.id !== id) return task;
    const state = updates.stateId ? states.find((item) => item.id === updates.stateId) : undefined;
    return { ...task, ...updates, ...(state ? { stateName: state.name, stateGroup: state.group } : {}) };
  }));
  return <div className="flex h-screen min-w-0 flex-col bg-canvas font-sans text-main">
    <nav className="flex shrink-0 gap-3 border-b border-edge p-2"><button onClick={() => { setSelectedProjectId(null); setSearch(''); }}>我的任务</button><button onClick={() => { setSelectedProjectId(project.id); setSearch(''); }}>协作项目</button></nav>
    {selectedProjectId && <ProjectToolbar project={project} users={[user, peer]} currentUser={user} tasks={scopedTasks} states={states} taskCount={filterTasksByLayout(scopedTasks, layout, search, new Date(today + 'T12:00:00')).length} onOpenCreateTask={() => {}} layout={layout} onLayoutChange={(patch) => setLayout((current) => ({ ...current, ...patch }))} onOpenFiles={() => {}} onProjectAction={() => {}} searchQuery={search} onSearchChange={setSearch} />}
    <ListView tasks={scopedTasks} allTasks={tasks} projects={[project]} users={[user, peer]} currentUser={user} states={states} selectedProjectId={selectedProjectId} projectLayout={selectedProjectId ? layout : undefined} onLayoutChange={(patch) => setLayout((current) => ({ ...current, ...patch }))} searchQuery={search} onSearchChange={setSearch} onUpdateTask={updateTask} onDeleteTask={(id) => setTasks((current) => current.filter((task) => task.id !== id))} onOpenCreateTask={() => {}} onOpenEditTask={setOpenedTask} readOnly={readOnly} />
    {openedTask && <div role="dialog" aria-label="任务详情"><button onClick={() => setOpenedTask(null)}>关闭详情</button>{openedTask.title}</div>}
  </div>;
}
