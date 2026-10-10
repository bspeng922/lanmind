import { tr, useLocale } from "../i18n";
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ListFilter } from 'lucide-react';
import { Task } from '../types';
import { countTaskFilters, countTaskLayoutSettings, ProjectLayout } from '../utils/taskLayout';
import { TaskFilterContext, TaskLayoutPanel } from './TaskLayoutPanel';

interface TaskFilterButtonProps extends TaskFilterContext {
  tasks: Task[];
  layout: ProjectLayout;
  onLayoutChange: (patch: Partial<ProjectLayout>) => void;
}

export const TaskFilterButton: React.FC<TaskFilterButtonProps> = ({ tasks, layout, onLayoutChange, ...context }: TaskFilterButtonProps) => {
  useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0, width: 310, maxHeight: 0 });
  const [panelTheme, setPanelTheme] = useState<string | undefined>();
  const panelId = useId();
  const activeCount = countTaskLayoutSettings(layout, context.activeView);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const position = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(310, window.innerWidth - 24);
      const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 52));
      setPanelPosition({
        top,
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        width,
        maxHeight: Math.max(0, window.innerHeight - top - 12),
      });
      setPanelTheme(rootRef.current?.closest<HTMLElement>('[data-theme]')?.dataset.theme);
    };
    position();
    const scroll = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) position();
    };
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', position);
    return () => {
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', position);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)
        && target.closest('[data-popover-owner]')?.getAttribute('data-popover-owner') !== panelId) setIsOpen(false);
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
      title={tr('tasks:taskLayoutPanel.filterCount', { count: countTaskFilters(layout), sort: tr(layout.sortMode === 'manual' ? 'tasks:taskLayoutPanel.defaultOrder' : 'tasks:taskLayoutPanel.sortActive') })} aria-label={tr("tasks:taskFilterButton.sortingAndFilters2")} aria-haspopup="dialog"
      aria-expanded={isOpen} aria-controls={isOpen ? panelId : undefined} onClick={() => setIsOpen(!isOpen)}>
      <ListFilter className="h-4 w-4" />
      {activeCount > 0 && <span className="task-filter-indicator" aria-hidden="true" />}
    </button>
    {isOpen && createPortal(
      <div ref={panelRef} className="task-filter-popover" data-theme={panelTheme} style={panelPosition}>
        <TaskLayoutPanel id={panelId} tasks={tasks} layout={layout} onLayoutChange={onLayoutChange} {...context} />
      </div>,
      document.body,
    )}
  </div>;
};
