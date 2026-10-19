import React from 'react';
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import type { StateGroup, TaskStatus, WorkItemState } from '../../types';
import { BLOCKED_STATE_NAME, LEGACY_STATUS_GROUP } from '../../utils/workItemState';

/**
 * 状态组名共用 `stateGroup.*` 这套键：看板列标题与筛选器面板已经在用它，
 * 这里再定义一份只会让同一个状态组出现两种译法。
 * 写成字面量而非模板拼接，`npm run check:i18n` 才能逐个校验键是否存在。
 */
const GROUP_LABEL_KEYS: Record<StateGroup, string> = {
  backlog: 'tasks:stateGroup.backlog',
  unstarted: 'tasks:stateGroup.unstarted',
  started: 'tasks:stateGroup.started',
  completed: 'tasks:stateGroup.completed',
  cancelled: 'tasks:stateGroup.cancelled',
};

/** 阻塞只是 started 组下的一个状态名，不是状态组，因此单独一条键。 */
const BLOCKED_LABEL_KEY = 'tasks:stateGroup.blocked';

interface StatePillProps {
  /** 项目自定义状态。优先使用它的名称与颜色。 */
  state?: WorkItemState | null;
  /** 回退用：状态定义缺失时按状态组渲染。 */
  group?: StateGroup;
  /**
   * @deprecated 状态模型迁移前的硬编码取值，仅为尚未迁移的调用方保留。
   * 新代码请传 `state` 或 `group`。
   */
  status?: TaskStatus;
  showLabel?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * 状态指示器：图标形状表达状态组，颜色与名称由项目自定义状态决定。
 *
 * 阻塞是 started 组下的扩展状态，靠状态名识别，用更深的红和拦截图标与「进行中」区分。
 */
export const StatePill: React.FC<StatePillProps> = ({
  state,
  group,
  status,
  showLabel = true,
  className = '',
  size = 'md',
}) => {
  useLocale();
  const iconSize = size === 'sm' ? 13 : 15;

  const resolvedGroup: StateGroup = state?.group ?? group ?? (status ? LEGACY_STATUS_GROUP[status] : 'backlog');
  const resolvedName = state?.name ?? '';
  const isBlockedState = resolvedName === BLOCKED_STATE_NAME || (!state && status === 'blocked');

  /** 颜色优先取状态自定义色，其次按组取固定的状态色。 */
  const color = state?.color ?? (isBlockedState ? 'var(--state-blocked)' : `var(--state-${resolvedGroup})`);
  const label = resolvedName || tr(isBlockedState ? BLOCKED_LABEL_KEY : GROUP_LABEL_KEYS[resolvedGroup]);

  const renderIcon = () => {
    if (isBlockedState) {
      return <AlertCircle size={iconSize} width={iconSize} height={iconSize} className="shrink-0 stroke-[2]" aria-hidden="true" />;
    }
    switch (resolvedGroup) {
      case 'unstarted':
        return (
          <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none" className="shrink-0" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        );
      case 'started':
        return (
          <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none" className="shrink-0" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" strokeDasharray="39.27" strokeDashoffset="19.6" />
            <path d="M8 8L8 1.75 A6.25 6.25 0 0 1 14.25 8 Z" fill="currentColor" />
          </svg>
        );
      case 'completed':
        return <CheckCircle2 size={iconSize} width={iconSize} height={iconSize} className="shrink-0 stroke-[2]" aria-hidden="true" />;
      case 'cancelled':
        return <XCircle size={iconSize} width={iconSize} height={iconSize} className="shrink-0 stroke-[1.75]" aria-hidden="true" />;
      case 'backlog':
      default:
        return (
          <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none" className="shrink-0" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2.5" />
          </svg>
        );
    }
  };

  return (
    <div
      className={`inline-flex items-center gap-1.5 font-medium select-none text-xs ${className}`}
      style={{ color }}
      title={label}
    >
      {renderIcon()}
      {showLabel && <span className="text-main">{label}</span>}
    </div>
  );
};
