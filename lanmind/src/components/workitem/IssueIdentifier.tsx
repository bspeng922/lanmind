import React from 'react';
import { tr, useLocale } from '../../i18n';
import type { Project, Task } from '../../types';

interface IssueIdentifierProps {
  /** 工作项。优先读取它的 identifier 与 sequenceNumber。 */
  task?: Pick<Task, 'id' | 'identifier' | 'sequenceNumber'> | null;
  /** 已解析出的工作项编号，优先级低于 task.identifier。 */
  identifier?: string;
  /**
   * @deprecated 仅用于尚未迁移到 identifier 模型的调用方。
   * 传 task 或 identifier 即可，不要依赖由此派生的占位编号。
   */
  taskId?: string;
  project?: Project;
  className?: string;
  size?: 'xs' | 'sm' | 'md';
};

/**
 * 取工作项编号。
 *
 * 优先用服务端下发的真实 identifier；缺失时用 `<项目编号>-<序号>` 组合；
 * 两者都拿不到才退回派生的占位值。占位值一定带 `#`，且由散列得出，
 * 既不会与真实编号混淆，也不会因项目或任务改名而碰撞到另一个真实编号上。
 */
export const getIssueShortId = (
  task?: Pick<Task, 'id' | 'identifier' | 'sequenceNumber'> | string | null,
  project?: Project,
  identifier?: string,
): string => {
  const record = typeof task === 'string' ? { id: task } : task;
  const real = record?.identifier?.trim() || identifier?.trim();
  if (real) return real;

  const prefix = project?.identifier?.trim().toUpperCase();
  const sequence = record?.sequenceNumber;
  if (prefix && typeof sequence === 'number' && Number.isFinite(sequence)) {
    return `${prefix}-${sequence}`;
  }

  // 最后兜底：保留一个短前缀让人能认出属于哪个项目，其余部分用散列占位
  const fallbackPrefix = prefix || '—';
  const seed = record?.id ?? '';
  if (!seed) return fallbackPrefix;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return `${fallbackPrefix}-#${Math.abs(hash % 1000).toString().padStart(3, '0')}`;
};

export const IssueIdentifier: React.FC<IssueIdentifierProps> = ({
  task,
  identifier,
  taskId,
  project,
  className = '',
  size = 'sm',
}) => {
  useLocale();
  const record = task ?? (taskId ? { id: taskId } : null);
  const shortId = getIssueShortId(record, project, identifier);

  const sizeClasses = {
    xs: 'text-[10px]',
    sm: 'text-[11px]',
    md: 'text-xs font-medium',
  }[size];

  const fullId = record?.identifier?.trim() || identifier?.trim();

  return (
    <span
      className={`font-mono text-quiet hover:text-sub transition-colors select-none ${sizeClasses} ${className}`}
      title={tr('tasks:issueIdentifier.taskId', { value0: fullId || shortId })}
    >
      {shortId}
    </span>
  );
};
