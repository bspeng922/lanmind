import React, { useEffect, useId, useRef, useState } from 'react';
import { ListFilter } from 'lucide-react';
import { Task } from '../types';
import { countTaskLayoutSettings, ProjectLayout } from '../utils/taskLayout';
import { TaskLayoutPanel } from './TaskLayoutPanel';

interface TaskFilterButtonProps {
  tasks: Task[];
  layout: ProjectLayout;
  onLayoutChange: (patch: Partial<ProjectLayout>) => void;
}

export const TaskFilterButton: React.FC<TaskFilterButtonProps> = ({ tasks, layout, onLayoutChange }: TaskFilterButtonProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const activeCount = countTaskLayoutSettings(layout);

  useEffect(() => {
    if (!isOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!rootRef.current?.contains(target) && target.closest('[data-popover-owner]')?.getAttribute('data-popover-owner') !== panelId) setIsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setIsOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [isOpen, panelId]);

  return <div ref={rootRef} className="relative shrink-0">
    <button ref={buttonRef} type="button" className="project-toolbar-icon task-filter-trigger" data-active={isOpen || activeCount > 0}
      title={activeCount ? `排序和过滤 (${activeCount})` : '排序和过滤'} aria-label="排序和过滤" aria-haspopup="dialog"
      aria-expanded={isOpen} aria-controls={isOpen ? panelId : undefined} onClick={() => setIsOpen(!isOpen)}>
      <ListFilter className="h-4 w-4" />
      {activeCount > 0 && <span className="task-filter-indicator" aria-hidden="true" />}
    </button>
    {isOpen && <TaskLayoutPanel id={panelId} tasks={tasks} layout={layout} onLayoutChange={onLayoutChange} />}
  </div>;
};
