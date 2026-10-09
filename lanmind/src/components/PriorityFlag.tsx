import { Flag } from 'lucide-react';
import { Priority } from '../types';

const priorityColors: Record<Priority, string> = {
  P1: 'text-danger',
  P2: 'text-warning',
  P3: 'text-info',
  P4: 'text-sub',
};

export function PriorityFlag({ priority }: { priority: Priority }) {
  return <Flag className={`inline-block h-3 w-3 shrink-0 fill-current ${priorityColors[priority]}`} aria-hidden="true" />;
}
