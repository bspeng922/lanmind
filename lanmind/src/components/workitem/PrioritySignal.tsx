import React from 'react';
import { Flame } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import type { Priority } from '../../types';

interface PrioritySignalProps {
  priority: Priority;
  showLabel?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * 优先级到配色与文案的映射。
 *
 * 颜色走 --priority-* 变量，与主题无关：优先级承担语义识别职责，
 * 换主题不应把它读成另一种含义。文案复用 listView 下已有的四档名称。
 */
const PRIORITY_META: Record<Priority, { color: string; labelKey: string; titleKey: string }> = {
  P1: { color: 'var(--priority-urgent)', labelKey: 'tasks:listView.urgent', titleKey: 'tasks:listView.p1Urgent' },
  P2: { color: 'var(--priority-high)', labelKey: 'tasks:listView.high', titleKey: 'tasks:listView.p2High' },
  P3: { color: 'var(--priority-medium)', labelKey: 'tasks:listView.normal', titleKey: 'tasks:listView.p3Normal' },
  P4: { color: 'var(--priority-low)', labelKey: 'tasks:listView.low', titleKey: 'tasks:listView.p4Low' },
};

export const PrioritySignal: React.FC<PrioritySignalProps> = ({
  priority,
  showLabel = false,
  className = '',
  size = 'md',
}) => {
  useLocale();
  const meta = PRIORITY_META[priority] ?? PRIORITY_META.P4;
  const title = tr(meta.titleKey);
  const dimension = size === 'sm' ? 12 : 14;

  const renderIcon = () => {
    // 紧急是唯一的红色火苗，其余三档用柱状条数量表达，与列表视图的排序语义一致
    if (priority === 'P1') {
      return <Flame className={`${size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} stroke-[2.2] shrink-0`} aria-hidden="true" />;
    }
    // 柱状条：P2 三根全亮，P3 亮两根，P4（及未知取值）只亮最短一根
    const dimmed =
      priority === 'P2' ? [false, false, false] : priority === 'P3' ? [false, false, true] : [false, true, true];
    return (
      <svg width={dimension} height={dimension} viewBox="0 0 16 16" className="shrink-0" aria-hidden="true">
        <rect x="2" y="10" width="3" height="4" rx="0.75" fill="currentColor" className={dimmed[0] ? 'opacity-25' : ''} />
        <rect x="6.5" y="6" width="3" height="8" rx="0.75" fill="currentColor" className={dimmed[1] ? 'opacity-25' : ''} />
        <rect x="11" y="2" width="3" height="12" rx="0.75" fill="currentColor" className={dimmed[2] ? 'opacity-25' : ''} />
      </svg>
    );
  };

  const label = tr(meta.labelKey);

  return (
    <div
      className={`inline-flex items-center gap-1.5 select-none ${className}`}
      style={{ color: meta.color }}
      title={title}
      aria-label={title}
    >
      {renderIcon()}
      {showLabel && <span className="text-xs font-medium">{label}</span>}
    </div>
  );
};
