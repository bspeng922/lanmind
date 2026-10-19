import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { tr, useLocale } from '../i18n';
import {
  AlertCircle,
  Check,
  GripVertical,
  Loader2,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { ApiService } from '../services/api';
import type { StateGroup, User, WorkItemState } from '../types';
import {
  STATE_GROUPS,
  STATE_GROUP_COLORS,
  sortStates,
} from '../utils/workItemState';

/**
 * ProjectStatesPanel — 项目的工作项状态管理。
 *
 * CALLING SPEC:
 *   <ProjectStatesPanel
 *     projectId={project.id}
 *     currentUser={currentUser}
 *     onStatesChanged={(states) => ...}
 *   />
 *
 * 状态分两层：状态组固定为 5 个并决定行为（只有已完成组计入完成与统计，
 * 只有已完成与已取消组可归档）；状态本身由项目自定义，决定名称、颜色与顺序。
 * 每个项目在每个组内至多有一个默认状态，新建工作项时使用。
 */

interface ProjectStatesPanelProps {
  /** 项目 id。传 null 表示个人任务的状态列表。 */
  projectId: string | null;
  currentUser: User;
  onStatesChanged?: (states: WorkItemState[]) => void;
}

const PRESET_STATE_COLORS = ['#3f76ff', '#f59e0b', '#16a34a', '#dc2626', '#d9d9d9', '#8b5cf6', '#0891b2', '#e11d48'];

export const ProjectStatesPanel: React.FC<ProjectStatesPanelProps> = ({
  projectId,
  currentUser,
  onStatesChanged,
}) => {
  useLocale();
  const [states, setStates] = useState<WorkItemState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragStateRef = React.useRef<{ pointerId: number; startY: number; moved: boolean } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await ApiService.getStates(projectId, currentUser.id);
      setStates(sortStates(list));
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, currentUser.id]);

  useEffect(() => { void load(); }, [load]);

  /** 提交后统一回写列表并通知调用方，避免各处重复同步。 */
  const commit = useCallback((next: WorkItemState[]) => {
    const ordered = sortStates(next);
    setStates(ordered);
    onStatesChanged?.(ordered);
  }, [onStatesChanged]);

  const run = async (id: string, action: () => Promise<WorkItemState[] | WorkItemState | boolean>) => {
    setPendingId(id);
    setErrorMsg('');
    try {
      await action();
      const list = await ApiService.getStates(projectId, currentUser.id);
      commit(list);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingId(null);
    }
  };

  const handleAdd = () => {
    // 新建时落在未开始组，序号排在末尾，颜色取该组的基准色。
    const lastSequence = states.reduce((max, state) => Math.max(max, state.sequence), -1);
    void run('new', () => ApiService.createState(
      {
        name: tr('tasks:stateEditor.namePlaceholder'),
        color: STATE_GROUP_COLORS.unstarted,
        group: 'unstarted',
        projectId,
        sequence: lastSequence + 1,
        isDefault: false,
      },
      currentUser.id,
    ));
  };

  const handleRename = (state: WorkItemState, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === state.name) return;
    void run(state.id, () => ApiService.updateState(state.id, { name: trimmed }, currentUser.id));
  };

  const handleColorChange = (state: WorkItemState, color: string) => {
    void run(state.id, () => ApiService.updateState(state.id, { color }, currentUser.id));
  };

  const handleGroupChange = (state: WorkItemState, group: StateGroup) => {
    void run(state.id, () => ApiService.updateState(state.id, { group }, currentUser.id));
  };

  const handleSetDefault = (state: WorkItemState) => {
    void run(state.id, () => ApiService.setDefaultState(state.id, currentUser.id));
  };

  const handleDelete = (state: WorkItemState) => {
    void run(state.id, () => ApiService.deleteState(state.id, currentUser.id));
  };

  /** 按组归集，便于分组展示与「组内至少保留一个状态」的判断。 */
  const grouped = useMemo(
    () => STATE_GROUPS.map((group) => ({
      group,
      states: states.filter((state) => state.group === group),
    })),
    [states],
  );

  /** 解析指针所在的插入位置。 */
  const dropIndexAtPoint = (y: number): number | null => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-state-row]'));
    if (!rows.length) return null;
    for (let index = 0; index < rows.length; index += 1) {
      const rect = rows[index].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) return index;
    }
    return rows.length;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0) return;
    dragStateRef.current = { pointerId: event.pointerId, startY: event.clientY, moved: false };
    setDraggedId(id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.abs(event.clientY - drag.startY) < 5) return;
    drag.moved = true;
    setDropIndex(dropIndexAtPoint(event.clientY));
    event.preventDefault();
  };

  const handlePointerUp = async (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const targetIndex = drag.moved ? dropIndexAtPoint(event.clientY) : null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setDraggedId(null);
    setDropIndex(null);
    if (targetIndex == null || !draggedId) return;

    const ordered = sortStates(states);
    const from = ordered.findIndex((state) => state.id === draggedId);
    if (from < 0) return;
    const moved = [...ordered];
    const [item] = moved.splice(from, 1);
    moved.splice(targetIndex > from ? targetIndex - 1 : targetIndex, 0, item);
    if (moved.every((state, index) => state.id === ordered[index].id)) return;

    // 乐观更新顺序，随后以服务端返回的顺序为准。
    commit(moved.map((state, index) => ({ ...state, sequence: index })));
    setPendingId(item.id);
    try {
      const next = await ApiService.reorderStates(projectId, moved.map((state) => state.id), currentUser.id);
      commit(next);
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
      await load();
    } finally {
      setPendingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-quiet">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {tr('tasks:stateEditor.title')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold text-main">{tr('tasks:stateEditor.title')}</h4>
          <p className="mt-0.5 text-[10px] text-quiet">{tr('tasks:stateEditor.reorderHint')}</p>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={pendingId === 'new'}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-card px-2.5 py-1.5 text-xs font-medium text-main transition-colors hover:bg-hover disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5 text-info" />
          {tr('tasks:stateEditor.addState')}
        </button>
      </div>

      {errorMsg && (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{errorMsg}</span>
        </p>
      )}

      {states.length === 0 ? (
        <p className="text-xs text-quiet">{tr('tasks:stateEditor.empty')}</p>
      ) : (
        <div className="space-y-3">
          {grouped.map(({ group, states: groupStates }) => (
            <section key={group} className="space-y-1">
              <div className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-quiet">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: `var(--state-${group})` }}
                  aria-hidden="true"
                />
                {tr(`tasks:stateGroup.${group}`)}
                <span className="font-mono text-[10px] text-quiet">{groupStates.length}</span>
              </div>

              {groupStates.length === 0 ? (
                <p className="px-1 text-[10px] text-quiet">{tr('tasks:stateEditor.lastInGroup')}</p>
              ) : (
                groupStates.map((state) => {
                  const isPending = pendingId === state.id;
                  const isOnlyInGroup = groupStates.length <= 1;
                  const globalIndex = sortStates(states).findIndex((item) => item.id === state.id);
                  return (
                    <div
                      key={state.id}
                      data-state-row
                      data-dragging={draggedId === state.id}
                      data-drop-position={dropIndex === globalIndex && draggedId !== state.id ? 'before' : undefined}
                      className="group flex items-center gap-2 rounded-lg border border-edge bg-card px-2 py-1.5 transition-colors data-[dragging=true]:opacity-50"
                    >
                      <span
                        role="button"
                        tabIndex={-1}
                        onPointerDown={(event) => handlePointerDown(event, state.id)}
                        onPointerMove={handlePointerMove}
                        onPointerUp={(event) => void handlePointerUp(event)}
                        onPointerCancel={() => { dragStateRef.current = null; setDraggedId(null); setDropIndex(null); }}
                        className="cursor-grab text-quiet opacity-40 transition-opacity hover:opacity-100 active:cursor-grabbing"
                        aria-hidden="true"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </span>

                      {/* 颜色 */}
                      <label className="relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center">
                        <span
                          className="h-3 w-3 rounded-full border border-edge"
                          style={{ backgroundColor: state.color }}
                        />
                        <input
                          type="color"
                          value={state.color}
                          onChange={(event) => handleColorChange(state, event.target.value)}
                          className="absolute inset-0 cursor-pointer opacity-0"
                          aria-label={tr('tasks:stateEditor.stateColor', { value0: state.name })}
                        />
                      </label>

                      {/* 名称 */}
                      <input
                        type="text"
                        defaultValue={state.name}
                        onBlur={(event) => handleRename(state, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') { event.currentTarget.value = state.name; event.currentTarget.blur(); }
                        }}
                        aria-label={tr('tasks:stateEditor.stateName')}
                        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-main outline-none focus:border-accent/50 focus:bg-canvas"
                      />

                      {/* 状态组 */}
                      <select
                        value={state.group}
                        onChange={(event) => handleGroupChange(state, event.target.value as StateGroup)}
                        aria-label={tr('tasks:stateEditor.stateGroup')}
                        className="shrink-0 rounded border border-edge bg-canvas px-1.5 py-0.5 text-[11px] text-sub outline-none focus:border-accent/50"
                      >
                        {STATE_GROUPS.map((option) => (
                          <option key={option} value={option}>{tr(`tasks:stateGroup.${option}`)}</option>
                        ))}
                      </select>

                      {/* 默认状态 */}
                      <button
                        type="button"
                        onClick={() => handleSetDefault(state)}
                        disabled={state.isDefault || isPending}
                        title={state.isDefault ? tr('tasks:stateEditor.defaultState') : tr('tasks:stateEditor.markAsDefault')}
                        aria-label={state.isDefault ? tr('tasks:stateEditor.defaultState') : tr('tasks:stateEditor.markAsDefault')}
                        className={`shrink-0 rounded p-1 transition-colors ${
                          state.isDefault ? 'text-warning' : 'text-quiet hover:bg-hover hover:text-warning'
                        } disabled:cursor-default`}
                      >
                        <Star className={`h-3.5 w-3.5 ${state.isDefault ? 'fill-current' : ''}`} />
                      </button>

                      {/* 删除 */}
                      <button
                        type="button"
                        onClick={() => handleDelete(state)}
                        disabled={isPending || isOnlyInGroup || state.isDefault}
                        title={
                          state.isDefault ? tr('tasks:stateEditor.cannotDeleteDefault')
                            : isOnlyInGroup ? tr('tasks:stateEditor.lastInGroup')
                            : tr('tasks:stateEditor.deleteState')
                        }
                        aria-label={tr('tasks:stateEditor.deleteState')}
                        className="shrink-0 rounded p-1 text-quiet transition-colors hover:bg-hover hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  );
                })
              )}
            </section>
          ))}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[10px] text-quiet">
        <Check className="h-3 w-3 text-success" />
        {tr('tasks:stateEditor.markAsDefault')}
      </p>
    </div>
  );
};
