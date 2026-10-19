/**
 * 工作项状态的唯一真相来源。
 *
 * 状态模型分两层：
 *   - 状态组（StateGroup）：固定的 5 个，决定行为。只有 completed 组计入完成、
 *     周期、模块与统计；只有 completed 与 cancelled 组可被自动归档。
 *   - 状态（WorkItemState）：项目级可自定义，决定展示。名称、颜色、排序都由项目自己决定。
 *
 * 所有按状态判断的逻辑都应先归到状态组，再比较组，而不是比较状态名或旧的字面量。
 */
import type { StateGroup, Task, TaskStatus, WorkItemState } from '../types';

/** 状态组的固定顺序，也是看板与筛选器里的展示顺序。 */
export const STATE_GROUPS: StateGroup[] = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'];

/** 状态组的基准色。与 src/styles/themes/state-tokens.css 中的值保持一致。 */
export const STATE_GROUP_COLORS: Record<StateGroup, string> = {
  backlog: '#d9d9d9',
  unstarted: '#3f76ff',
  started: '#f59e0b',
  completed: '#16a34a',
  cancelled: '#dc2626',
};

/** 状态组的英文名，用于生成默认状态。展示名走 i18n。 */
export const STATE_GROUP_LABELS: Record<StateGroup, string> = {
  backlog: 'Backlog',
  unstarted: 'Unstarted',
  started: 'Started',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** 新建工作项时的默认状态所在组。 */
export const DEFAULT_STATE_GROUP: StateGroup = 'unstarted';

/**
 * 状态模型迁移前的取值到状态组的映射。
 * 迁移与历史同步操作载荷的读取都依赖它。
 */
export const LEGACY_STATUS_GROUP: Record<TaskStatus, StateGroup> = {
  todo: 'unstarted',
  in_progress: 'started',
  blocked: 'started',
  completed: 'completed',
  abandoned: 'cancelled',
};

/**
 * 状态组回写为旧字段时的映射。
 * 仅用于兼容尚未升级的对端节点与历史归档文件。
 * 注意 backlog 与 started 的映射会丢失信息（旧模型没有 Backlog，且无法区分阻塞），
 * 这是可接受的降级：旧节点本来就不认识这两个状态。
 */
export const GROUP_TO_LEGACY_STATUS: Record<StateGroup, TaskStatus> = {
  backlog: 'todo',
  unstarted: 'todo',
  started: 'in_progress',
  completed: 'completed',
  cancelled: 'abandoned',
};

/** 阻塞状态在本产品里是 started 组下的一个独立状态，按名称识别。 */
export const BLOCKED_STATE_NAME = 'Blocked';

/** 默认状态的名称与所在组，用于为新项目与个人任务播种。 */
export const DEFAULT_STATE_SEED: Array<{ name: string; group: StateGroup; isDefault: boolean }> = [
  { name: 'Backlog', group: 'backlog', isDefault: true },
  { name: 'Todo', group: 'unstarted', isDefault: true },
  { name: 'In Progress', group: 'started', isDefault: true },
  { name: 'Blocked', group: 'started', isDefault: false },
  { name: 'Done', group: 'completed', isDefault: true },
  { name: 'Cancelled', group: 'cancelled', isDefault: true },
];

/** 把旧的状态取值归到状态组。无法识别时按未开始处理。 */
export const legacyStatusToGroup = (status: string | null | undefined): StateGroup =>
  LEGACY_STATUS_GROUP[status as TaskStatus] ?? DEFAULT_STATE_GROUP;

/**
 * 解析一个工作项的状态组。
 * 优先使用反规范化的 stateGroup；缺失时回退到 stateId 查询；再回退到旧 status。
 */
export const resolveTaskGroup = (
  task: Pick<Task, 'stateGroup' | 'stateId' | 'status'>,
  states: WorkItemState[] = [],
): StateGroup => {
  if (task.stateGroup) return task.stateGroup;
  if (task.stateId) {
    const state = states.find((item) => item.id === task.stateId);
    if (state) return state.group;
  }
  return legacyStatusToGroup(task.status);
};

/** 解析一个工作项要展示的状态名。找不到状态定义时回退到状态组名。 */
export const resolveTaskStateName = (
  task: Pick<Task, 'stateName' | 'stateId' | 'stateGroup' | 'status'>,
  states: WorkItemState[] = [],
): string => {
  if (task.stateName) return task.stateName;
  if (task.stateId) {
    const state = states.find((item) => item.id === task.stateId);
    if (state) return state.name;
  }
  return STATE_GROUP_LABELS[resolveTaskGroup(task, states)];
};

/** 判断一个工作项是否处于已完成组。 */
export const isCompleted = (task: Parameters<typeof resolveTaskGroup>[0], states?: WorkItemState[]) =>
  resolveTaskGroup(task, states) === 'completed';

/** 判断一个工作项是否已取消。已取消的工作项不进入汇报与统计。 */
export const isCancelled = (task: Parameters<typeof resolveTaskGroup>[0], states?: WorkItemState[]) =>
  resolveTaskGroup(task, states) === 'cancelled';

/** 判断一个工作项是否仍未完成（含已取消之外的未完成状态）。 */
export const isPending = (task: Parameters<typeof resolveTaskGroup>[0], states?: WorkItemState[]) => {
  const group = resolveTaskGroup(task, states);
  return group !== 'completed' && group !== 'cancelled';
};

/** 判断一个工作项是否处于阻塞状态。按名称识别，因为阻塞与进行中同属 started 组。 */
export const isBlocked = (
  task: Pick<Task, 'stateName' | 'stateId' | 'stateGroup' | 'status'>,
  states: WorkItemState[] = [],
) => resolveTaskStateName(task, states) === BLOCKED_STATE_NAME;

/** 状态在项目内的展示排序：先按组，再按组内序号。 */
export const sortStates = (states: WorkItemState[]): WorkItemState[] =>
  [...states].sort((a, b) => {
    const groupDiff = STATE_GROUPS.indexOf(a.group) - STATE_GROUPS.indexOf(b.group);
    return groupDiff !== 0 ? groupDiff : a.sequence - b.sequence;
  });

/** 取某个作用域的默认状态。`projectId` 为空表示个人任务状态列表。 */
export const defaultStateFor = (
  states: WorkItemState[],
  projectId: string | null,
  group: StateGroup = DEFAULT_STATE_GROUP,
): WorkItemState | undefined => {
  const scoped = states.filter((state) => (state.projectId ?? null) === projectId);
  return (
    scoped.find((state) => state.group === group && state.isDefault) ??
    scoped.find((state) => state.group === group) ??
    scoped.find((state) => state.isDefault)
  );
};

/** 按状态组归集工作项数量，用于统计与汇报。 */
export const countByGroup = (
  tasks: Array<Pick<Task, 'stateGroup' | 'stateId' | 'status'>>,
  states: WorkItemState[] = [],
): Record<StateGroup, number> => {
  const counts = STATE_GROUPS.reduce(
    (acc, group) => ({ ...acc, [group]: 0 }),
    {} as Record<StateGroup, number>,
  );
  for (const task of tasks) counts[resolveTaskGroup(task, states)] += 1;
  return counts;
};
