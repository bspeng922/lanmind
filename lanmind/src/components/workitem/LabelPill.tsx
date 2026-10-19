import React from 'react';

interface LabelPillProps {
  label: string;
  className?: string;
  size?: 'xs' | 'sm';
}

/**
 * 生成稳定可复现的标签配色：同一标签在同一主题下始终得到同一颜色。
 *
 * 颜色取自语义变量而非固定色阶，这样标签在亮暗主题下都会跟着走，
 * 也避免新增主题时这里成为唯一漏掉的硬编码色。
 * 关键字命中时用该含义对应的语义色（缺陷→危险、特性→特性色等），
 * 未命中时按名称散列到一组语义色，保证相邻标签可区分。
 */
const getTagDotColor = (label: string): string => {
  const lower = label.toLowerCase();
  if (lower.includes('bug') || lower.includes('defect')) return 'var(--danger)';
  if (lower.includes('enhancement') || lower.includes('feature')) return 'var(--feature)';
  if (lower.includes('product') || lower.includes('mobile')) return 'var(--info)';
  if (lower.includes('eng') || lower.includes('tech')) return 'var(--warning)';
  if (lower.includes('doc') || lower.includes('wiki')) return 'var(--success)';
  if (lower.includes('auth') || lower.includes('security')) return 'var(--accent)';

  const palette = [
    'var(--accent)',
    'var(--success)',
    'var(--feature)',
    'var(--warning)',
    'var(--danger)',
    'var(--info)',
  ];
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash << 5) - hash + label.charCodeAt(i);
  }
  return palette[Math.abs(hash) % palette.length];
};

export const LabelPill: React.FC<LabelPillProps> = ({
  label,
  className = '',
  size = 'sm',
}) => {
  const dotColor = getTagDotColor(label);
  const sizeClasses = size === 'xs' ? 'text-[10px] py-0 px-1.5' : 'text-[11px] py-0.5 px-2';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-edge/80 bg-muted/60 font-medium text-sub select-none ${sizeClasses} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
      <span className="truncate max-w-[120px]">{label}</span>
    </span>
  );
};
