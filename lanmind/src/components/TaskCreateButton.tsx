import React from 'react';
import { Plus } from 'lucide-react';

export const TaskCreateButton: React.FC<{ onClick: () => void; className?: string }> = ({ onClick, className = '' }) => (
  <button type="button" onClick={onClick} title="新建任务" aria-label="新建任务"
    className={`task-create-button theme-btn-primary h-8 w-8 shrink-0 p-0 ${className}`}>
    <Plus className="h-4 w-4" aria-hidden="true" />
  </button>
);
