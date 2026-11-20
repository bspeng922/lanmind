import { isComposingKeyboardEvent } from '../utils/keyboard';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { tr, useLocale } from '../i18n';
import {
  AlertCircle,
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
import { ThemeSelect, type ThemeSelectOption } from './ThemeSelect';

const STATE_GROUP_TONES: Record<StateGroup, NonNullable<ThemeSelectOption['tone']>> = {
  backlog: 'slate',
  unstarted: 'blue',
  started: 'amber',
  completed: 'emerald',
  cancelled: 'rose',
};

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

  const handleAdd = (group: StateGroup = 'unstarted') => {
    const lastSequence = states.reduce((max, state) => Math.max(max, state.sequence), -1);
    void run(`new:${group}`, () => ApiService.createState(
      {
        name: tr('tasks:stateEditor.namePlaceholder'),
        color: STATE_GROUP_COLORS[group],
        group,
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

  const stateGroupOptions: ThemeSelectOption[] = STATE_GROUPS.map((option) => ({
    value: option,
    label: tr(`tasks:stateGroup.${option}`),
    tone: STATE_GROUP_TONES[option],
  }));

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
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
        {tr('tasks:stateEditor.title')}
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-main">{tr('tasks:stateEditor.title')}</h4>
          <p className="mt-0.5 text-xs text-sub">{tr('tasks:stateEditor.reorderHint')}</p>
        </div>
        <button
          type="button"
          onClick={() => handleAdd('unstarted')}
          disabled={Boolean(pendingId?.startsWith('new:'))}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent shadow-soft transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          {tr('tasks:stateEditor.addState')}
        </button>
      </div>

      {errorMsg && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{errorMsg}</span>
        </p>
      )}

      {states.length === 0 ? (
        <div className="rounded-xl border border-edge bg-card px-4 py-8 text-center text-xs text-quiet">
          {tr('tasks:stateEditor.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(({ group, states: groupStates }) => (
            <section
              key={group}
              className="overflow-hidden rounded-xl border border-edge bg-card shadow-soft"
            >
              <div className="flex items-center justify-between gap-3 border-b border-subtle bg-surface/80 px-3.5 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: STATE_GROUP_COLORS[group] }}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-semibold text-main">
                    {tr(`tasks:stateGroup.${group}`)}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-sub">
                    {groupStates.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleAdd(group)}
                  disabled={pendingId === `new:${group}`}
                  title={tr('tasks:stateEditor.addState')}
                  aria-label={`${tr('tasks:stateEditor.addState')} · ${tr(`tasks:stateGroup.${group}`)}`}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sub transition-colors hover:bg-hover hover:text-main disabled:opacity-40"
                >
                  {pendingId === `new:${group}` ? (
                    <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              {groupStates.length === 0 ? (
                <p className="px-3.5 py-3 text-xs text-quiet">{tr('tasks:stateEditor.lastInGroup')}</p>
              ) : (
                <div className="divide-y divide-subtle">
                  {groupStates.map((state) => {
                    const isPending = pendingId === state.id;
                    const isOnlyInGroup = groupStates.length <= 1;
                    const globalIndex = sortStates(states).findIndex((item) => item.id === state.id);
                    return (
                      <div
                        key={state.id}
                        data-state-row
                        data-dragging={draggedId === state.id}
                        data-drop-position={dropIndex === globalIndex && draggedId !== state.id ? 'before' : undefined}
                        className="group flex items-center gap-2.5 px-3.5 py-2 transition-colors hover:bg-hover/40 data-[dragging=true]:opacity-50"
                      >
                        <span
                          role="button"
                          tabIndex={-1}
                          onPointerDown={(event) => handlePointerDown(event, state.id)}
                          onPointerMove={handlePointerMove}
                          onPointerUp={(event) => void handlePointerUp(event)}
                          onPointerCancel={() => { dragStateRef.current = null; setDraggedId(null); setDropIndex(null); }}
                          className="cursor-grab text-quiet opacity-40 transition-opacity group-hover:opacity-100 active:cursor-grabbing shrink-0"
                          aria-hidden="true"
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </span>

                        {/* 颜色 */}
                        <label
                          className="relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-subtle bg-surface/70 px-2 transition-colors hover:border-edge-strong hover:bg-hover"
                          title={tr('tasks:stateEditor.stateColor', { value0: state.name })}
                        >
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border border-black/10"
                            style={{ backgroundColor: state.color }}
                          />
                          <span className="hidden sm:inline font-mono text-[11px] uppercase tabular-nums text-sub">
                            {state.color}
                          </span>
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
                          key={`${state.id}:${state.name}`}
                          type="text"
                          defaultValue={state.name}
                          onBlur={(event) => handleRename(state, event.target.value)}
                          onKeyDown={(event) => {
                            if (isComposingKeyboardEvent(event.nativeEvent)) return;
                            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                            if (event.key === 'Escape') { event.currentTarget.value = state.name; event.currentTarget.blur(); }
                          }}
                          aria-label={tr('tasks:stateEditor.stateName')}
                          className="min-w-0 flex-1 h-8 rounded-lg border border-transparent bg-transparent px-2 text-[13px] font-medium text-main outline-none transition-colors hover:border-edge/70 hover:bg-surface/60 focus:border-accent focus:bg-input"
                        />

                        {/* 默认状态 */}
                        <button
                          type="button"
                          onClick={() => handleSetDefault(state)}
                          disabled={state.isDefault || isPending}
                          title={state.isDefault ? tr('tasks:stateEditor.defaultState') : tr('tasks:stateEditor.markAsDefault')}
                          aria-label={state.isDefault ? tr('tasks:stateEditor.defaultState') : tr('tasks:stateEditor.markAsDefault')}
                          className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors ${
                            state.isDefault
                              ? 'border border-warning/30 bg-warning/10 text-warning cursor-default'
                              : 'border border-transparent text-sub hover:border-edge hover:bg-hover hover:text-main'
                          }`}
                        >
                          <Star className={`h-3.5 w-3.5 shrink-0 ${state.isDefault ? 'fill-current' : ''}`} />
                          <span className="hidden sm:inline whitespace-nowrap">
                            {state.isDefault ? tr('tasks:stateEditor.defaultState') : tr('tasks:stateEditor.markAsDefault')}
                          </span>
                        </button>

                        {/* 状态组 */}
                        <div className="w-[128px] shrink-0">
                          <ThemeSelect
                            portal
                            value={state.group}
                            options={stateGroupOptions}
                            disabled={isPending}
                            onChange={(val) => handleGroupChange(state, val as StateGroup)}
                            ariaLabel={tr('tasks:stateEditor.stateGroup')}
                          />
                        </div>

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
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-quiet transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-quiet"
                        >
                          {isPending ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
