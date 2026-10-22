import React from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { TaskAttachment } from '../../types';
import { tr, useLocale } from '../../i18n';
import { formatFileSize } from '../../utils/fileTransfer';

interface TaskAttachmentsSectionProps {
  attachments: TaskAttachment[];
  onPick: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void;
  onPreview: (file: TaskAttachment) => void;
}

export function TaskAttachmentsSection({ attachments, onPick, onRemove, onPreview }: TaskAttachmentsSectionProps) {
  useLocale();
  return <section className="task-attachments" aria-label={tr('tasks:taskModal.taskAttachments')}>
    <label className="task-attachment-add">
      <Paperclip className="h-3.5 w-3.5" />
      <span>{tr('tasks:taskEditor.addAttachment')}</span>
      <input type="file" multiple className="sr-only" aria-label={tr('tasks:taskModal.addTaskAttachments')} onChange={onPick} />
    </label>
    {attachments.length > 0 && <div className="task-attachment-list">
      {attachments.map((file) => <div key={file.id} className="task-attachment-item">
        <button type="button" className="task-attachment-preview" onClick={() => onPreview(file)} title={file.name} aria-label={tr('tasks:taskModal.preview', { value0: file.name })}>
          <FileText className="h-4 w-4 shrink-0" /><span className="min-w-0 truncate">{file.name}</span><span className="task-attachment-size">{formatFileSize(file.size)}</span>
        </button>
        <button type="button" className="task-icon-button" onClick={() => onRemove(file.id)} aria-label={tr('tasks:taskModal.remove', { value0: file.name })}><X className="h-3.5 w-3.5" /></button>
      </div>)}
    </div>}
  </section>;
}
