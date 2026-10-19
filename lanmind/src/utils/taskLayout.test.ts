import test from 'node:test';
import assert from 'node:assert/strict';
import { Task, WorkItemState } from '../types';
import { compareTasks, countTaskFilters, DEFAULT_PROJECT_LAYOUT, filterTasksByLayout, groupFilterValue, matchesTaskDate, normalizeTaskLayout, ProjectLayout, parseGroupFilterValue } from './taskLayout';
import { BLOCKED_STATE_NAME, isBlocked, resolveTaskGroup } from './workItemState';
import { selectCalendarTasks } from './taskCalendarLayout';

const now = new Date(2026, 8, 14, 12);
const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'a', title: 'Task', description: '', priority: 'P1', status: 'todo', dueDate: '2026-09-14',
  creatorId: 'me', assigneeId: 'me', projectId: 'project-a', isShared: false, sharedWith: [], subtasks: [], tags: ['product'],
  createdAt: '2026-09-01', updatedAt: '2026-09-10', version: 1, ...overrides,
});
const state = (id: string, name: string, group: WorkItemState['group'], sequence = 0): WorkItemState => ({
  id, name, color: '#000000', group, projectId: 'project-a', sequence, isDefault: false,
  createdAt: '2026-09-01', updatedAt: '2026-09-01',
});
const layout = (patch: Partial<ProjectLayout> = {}) => ({ ...DEFAULT_PROJECT_LAYOUT, ...patch });
const ids = (items: Task[]) => items.map((item) => item.id);

test('migrates scalar preferences, keeps view/group/sort, and validates array preferences', () => {
  const migrated = normalizeTaskLayout({ view: 'timeline', groupMode: 'status', sortMode: 'updatedAt', priorityFilter: 'P2', statusFilter: 'completed', dateFilter: 'tomorrow', tagFilter: 'ALL', showCompleted: true });
  assert.equal(migrated.view, 'timeline');
  assert.equal(migrated.groupMode, 'status');
  assert.equal(migrated.sortDirection, 'desc');
  assert.deepEqual(migrated.priorityFilter, ['P2']);
  assert.deepEqual(migrated.statusFilter, ['group:completed']);
  assert.deepEqual(migrated.dateFilter, ['tomorrow']);
  assert.deepEqual(migrated.tagFilter, ['ALL']);
  assert.deepEqual(normalizeTaskLayout({ priorityFilter: 'ALL', dateFilter: 'ALL', tagFilter: null }), DEFAULT_PROJECT_LAYOUT);
  // 状态筛选是唯一不再把 'ALL' 当作「重置」哨兵处理的维度：'ALL' 既不是组令牌，
  // 也不是 LEGACY_STATUS_GROUP 里的键，于是被原样保留，进而在筛选中匹配不到任何工作项。
  // 这里把现状钉住，而不是断言期望行为——一旦 normalizeStatusFilter 恢复对 'ALL' 的重置，
  // 这条断言会变红，提示把筛选语义的变更一并评估（见下方 test 的说明）。
  assert.deepEqual(normalizeTaskLayout({ statusFilter: 'ALL' }).statusFilter, ['ALL']);
  assert.deepEqual(normalizeTaskLayout({ priorityFilter: ['P1', 'P1', 'bad', 5], projectFilter: [null, 'a', null, 5], tagFilter: ['', 'ALL'], sortMode: 'bad' }).priorityFilter, ['P1']);
  assert.deepEqual(normalizeTaskLayout({ projectFilter: [null, 'a', null, 5] }).projectFilter, [null, 'a']);
  assert.deepEqual(normalizeTaskLayout(null), DEFAULT_PROJECT_LAYOUT);
});

test('uses OR within a dimension and AND across priorities, statuses, dates, tags, people and projects', () => {
  const tasks = [task(), task({ id: 'b', priority: 'P2', status: 'in_progress', stateId: 'state-in-progress', dueDate: '2026-09-15', tags: ['delivery'], assigneeId: 'peer', projectId: 'project-b' }),
    task({ id: 'c', priority: 'P3' }), task({ id: 'd', status: 'blocked' }), task({ id: 'e', dueDate: '2026-09-16' }),
    task({ id: 'f', tags: ['other'] }), task({ id: 'g', assigneeId: 'other' }), task({ id: 'h', projectId: null }),
    task({ id: 'child', parentTaskId: 'a' })];
  // 状态维度同时用上两种写法：组令牌命中 todo，具体状态 id 只命中 'b'。
  // 'd' 虽然与 'b' 同组（started），但不带该 stateId，因此被排除。
  const filters = layout({ priorityFilter: ['P1', 'P2'], statusFilter: ['group:unstarted', 'state-in-progress'], dateFilter: ['today', 'tomorrow'], tagFilter: ['product', 'delivery'], assigneeFilter: ['me', 'peer'], projectFilter: ['project-a', 'project-b'] });
  assert.deepEqual(ids(filterTasksByLayout(tasks, filters, '', now)), ['a', 'b']);
  assert.deepEqual(ids(filterTasksByLayout(tasks, filters, 'delivery', now)), ['b']);
  assert.equal(tasks.length, 9);
  assert.deepEqual(ids(filterTasksByLayout([task({ projectId: null, assigneeId: '' })], layout({ projectFilter: [null], assigneeFilter: [''] }), '', now)), ['a']);
});

test('explicit status selections override default completed and abandoned visibility', () => {
  const tasks = [task(), task({ id: 'done', status: 'completed' }), task({ id: 'abandoned', status: 'abandoned' })];
  assert.deepEqual(ids(filterTasksByLayout(tasks, layout(), '', now)), ['a']);
  assert.deepEqual(ids(filterTasksByLayout(tasks, layout({ showCompleted: true }), '', now)), ['a', 'done']);
  // 已完成与已取消都是「显式选中才可见」。旧字面量走回退路径，组令牌走状态模型。
  assert.deepEqual(ids(filterTasksByLayout(tasks, layout({ statusFilter: [groupFilterValue('completed'), groupFilterValue('cancelled')] }), '', now)), ['done', 'abandoned']);
});

test('migrates saved legacy status preferences to group tokens', () => {
  assert.deepEqual(normalizeTaskLayout({ statusFilter: 'in_progress' }).statusFilter, ['group:started']);
  assert.deepEqual(normalizeTaskLayout({ statusFilter: ['abandoned', 'blocked'] }).statusFilter, ['group:cancelled', 'group:started']);
  // 已经是组令牌的取值与具体状态 id 原样保留，且重复项被去掉。
  assert.deepEqual(normalizeTaskLayout({ statusFilter: ['group:started', 'group:started', 'state-abc'] }).statusFilter, ['group:started', 'state-abc']);
  assert.equal(parseGroupFilterValue('group:started'), 'started');
  assert.equal(parseGroupFilterValue('group:nope'), null);
  assert.equal(parseGroupFilterValue('state-abc'), null);
});

test('group tokens match every state in the group, while a state id matches only that state', () => {
  const states = [state('state-in-progress', 'In Progress', 'started'), state('state-review', 'In Review', 'started')];
  // 两个工作项同属 started 组，但状态 id 不同；一个工作项只有旧 status，一个完全没有状态字段。
  const tasks = [
    task({ id: 'explicit', stateId: 'state-in-progress', stateGroup: 'started', stateName: 'In Progress' }),
    task({ id: 'review', stateId: 'state-review', stateGroup: 'started', stateName: 'In Review' }),
    task({ id: 'legacy', status: 'in_progress' }),
  ];
  // 组令牌：三个都命中，与是否带 stateId 无关。
  assert.deepEqual(ids(filterTasksByLayout(tasks, layout({ statusFilter: [groupFilterValue('started')] }), '', now)), ['explicit', 'review', 'legacy']);
  // 具体状态 id：只命中携带该 id 的工作项，同组的另一个不会被带上。
  assert.deepEqual(ids(filterTasksByLayout(tasks, layout({ statusFilter: ['state-in-progress'] }), '', now)), ['explicit']);
  // 显式 stateGroup 优先于旧 status：旧 status 为 todo 的工作项仍按 started 组筛选。
  assert.deepEqual(ids(filterTasksByLayout([task({ id: 'grouped', status: 'todo', stateGroup: 'started' })], layout({ statusFilter: [groupFilterValue('started')] }), '', now)), ['grouped']);
  assert.deepEqual(ids(filterTasksByLayout([task({ id: 'grouped', status: 'todo', stateGroup: 'started' })], layout({ statusFilter: [groupFilterValue('unstarted')] }), '', now)), []);
  assert.equal(states.length, 2);
});

test('in progress and blocked share the started group but stay distinguishable by name', () => {
  const states = [state('state-in-progress', 'In Progress', 'started'), state('state-blocked', BLOCKED_STATE_NAME, 'started')];
  const running = task({ id: 'running', stateId: 'state-in-progress', stateGroup: 'started', stateName: 'In Progress' });
  const blocked = task({ id: 'blocked', stateId: 'state-blocked', stateGroup: 'started', stateName: BLOCKED_STATE_NAME });
  const namedBlocked = task({ id: 'named-blocked', stateName: BLOCKED_STATE_NAME });
  const legacyLiterals = task({ id: 'legacy-literals', status: 'blocked' });
  // 组无法区分两者——这正是不能用组来判断阻塞的原因。
  assert.equal(resolveTaskGroup(running, states), 'started');
  assert.equal(resolveTaskGroup(blocked, states), 'started');
  assert.equal(resolveTaskGroup(legacyLiterals, states), 'started');
  // 名称可以：isBlocked 按状态名识别，进行中的工作项不会被误判为阻塞。
  assert.equal(isBlocked(running, states), false);
  assert.equal(isBlocked(blocked, states), true);
  assert.equal(isBlocked(namedBlocked, states), true);
  // 两个方向的已知代价，记录以免日后当成新 bug：
  // 只有 stateName 而没有 stateGroup/stateId 的工作项，isBlocked 认得出、resolveTaskGroup 认不出，
  // 组解析会落到旧 status（这里沿用了 fixture 的 todo，因而归入 unstarted）。
  assert.equal(resolveTaskGroup(namedBlocked, states), 'unstarted');
  // 只有旧 status 字面量的工作项则相反：组认得，名称拿不回「Blocked」而是组名。
  assert.equal(isBlocked(legacyLiterals, states), false);
  // 同一组筛选项把进行中与阻塞一并纳入，说明「阻塞」不是筛选维度而是独立的展示状态。
  assert.deepEqual(ids(filterTasksByLayout([running, blocked], layout({ statusFilter: [groupFilterValue('started')] }), '', now)), ['running', 'blocked']);
  // 按具体状态 id 筛选时两者才分得开：group 是筛选维度，name 不是。
  assert.deepEqual(ids(filterTasksByLayout([running, blocked], layout({ statusFilter: ['state-blocked'] }), '', now)), ['blocked']);
});

test('a non-group, non-state status value is preserved but matches nothing', () => {
  // normalizeStatusFilter 对认不出的取值采取「原样保留」策略，好处是自定义状态 id 不会被丢弃。
  // 代价是任何历史遗留的哨兵值都会变成一个永远匹配不到工作项的筛选项：
  // matchesTaskFields 只在取值等于 task.stateId 时命中，而 'ALL' 不会是任何状态 id。
  const tasks = [task({ id: 'a', status: 'todo' }), task({ id: 'b', status: 'in_progress', stateId: 'state-in-progress' })];
  assert.deepEqual(ids(filterTasksByLayout(tasks, layout({ statusFilter: ['ALL'] }), '', now)), []);
  // 未携带 stateId 与携带 stateId 的工作项同样都不命中，说明这不是回退路径的问题。
  assert.deepEqual(ids(filterTasksByLayout(tasks, layout({ statusFilter: ['state-in-progress'] }), '', now)), ['b']);
  // 过滤项本身仍被计入「已启用筛选」，界面因此会显示筛选标记却列出空列表。
  assert.equal(countTaskFilters(layout({ statusFilter: ['ALL'] })), 1);
  // 只有空数组才是「重置」；调用方必须显式传 []。
  assert.equal(countTaskFilters(layout({ statusFilter: [] })), 0);
});

test('normalizeStatusFilter never emits a prototype-derived or non-string group token', () => {
  // `value in LEGACY_STATUS_GROUP` 会沿原型链查找，Object.prototype 上的键会被当成旧状态值，
  // 从而生成 'group:function toString() { [native code] }' 这类永远匹配不到的筛选项。
  // 本测试不依赖该判定的实现细节，只断言输出始终是可识别的组令牌或普通的状态 id。
  for (const value of ['ALL', 'toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
    const [only] = normalizeTaskLayout({ statusFilter: value }).statusFilter;
    assert.equal(typeof only, 'string');
    assert.ok(
      parseGroupFilterValue(only) !== null || !only.startsWith('group:'),
      `状态筛选项 ${JSON.stringify(only)} 被当成了组令牌却解析不出组名`,
    );
  }
});

test('relative dates use local day boundaries, exclude terminal tasks from overdue, and distinguish start-only tasks', () => {
  const boundary = new Date(2026, 11, 31, 23, 59);
  assert.equal(matchesTaskDate(task({ dueDate: '2027-01-01T08:00' }), ['tomorrow'], boundary), true);
  assert.equal(matchesTaskDate(task({ dueDate: '2026-09-13', status: 'completed' }), ['overdue'], now), false);
  assert.equal(matchesTaskDate(task({ dueDate: null, startDate: '2026-09-14' }), ['unscheduled'], now), false);
  assert.equal(matchesTaskDate(task({ dueDate: null }), ['unscheduled'], now), true);
  assert.equal(matchesTaskDate(task({ dueDate: '2026-09-15' }), ['upcoming'], now), true);
});

test('sorting supports both directions, stable ties, missing dates last, and default input order', () => {
  const tasks = [task({ id: 'z', dueDate: null }), task({ id: 'b', dueDate: '2026-09-15' }), task({ id: 'a' }), task({ id: 'c' })];
  assert.deepEqual(ids([...tasks].sort((a, b) => compareTasks(a, b, layout({ sortMode: 'dueDate' })))), ['a', 'c', 'b', 'z']);
  assert.deepEqual(ids([...tasks].sort((a, b) => compareTasks(a, b, layout({ sortMode: 'dueDate', sortDirection: 'desc' })))), ['b', 'a', 'c', 'z']);
  assert.deepEqual(ids(filterTasksByLayout(tasks, layout(), '', now)), ['z', 'b', 'a', 'c']);
  assert.deepEqual(ids(filterTasksByLayout([task({ id: 'later', startDate: '2026-09-15' }), task({ id: 'earlier', startDate: '2026-09-13' })], layout({ sortMode: 'startDate' }), '', now)), ['earlier', 'later']);
});

test('calendar filters actual recurring occurrences rather than the old anchor date', () => {
  const repeating = task({ id: 'repeat', recurrence: 'daily', dueDate: '2026-09-01T09:00' });
  const result = selectCalendarTasks([repeating, task({ id: 'once' })], layout({ dateFilter: ['today', 'tomorrow'], sortMode: 'dueDate' }), '', '2026-09-01', '2026-09-30', now);
  assert.deepEqual([...result.tasksByDate.keys()].sort(), ['2026-09-14', '2026-09-15']);
  assert.deepEqual(result.tasksByDate.get('2026-09-14')!.map((item) => item.task.id), ['once', 'repeat']);
  assert.equal(result.tasksByDate.get('2026-09-15')![0].dueDate, '2026-09-15T09:00');
  assert.equal(selectCalendarTasks([repeating], layout({ dateFilter: ['today'] }), '', '2026-10-01', '2026-10-31', now).tasksByDate.size, 0);
});

test('calendar includes undated and start-only tasks, but unscheduled filters only fully undated tasks', () => {
  const tasks = [task({ id: 'undated', dueDate: null }), task({ id: 'start-only', dueDate: null, startDate: '2026-09-14' })];
  assert.deepEqual(ids(selectCalendarTasks(tasks, layout(), '', '2026-09-01', '2026-09-30', now).undated), ['undated', 'start-only']);
  assert.deepEqual(ids(selectCalendarTasks(tasks, layout({ dateFilter: ['unscheduled'] }), '', '2026-09-01', '2026-09-30', now).undated), ['undated']);
});
