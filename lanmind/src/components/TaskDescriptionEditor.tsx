import { tr, useLocale } from "../i18n";
import React, { useRef, useState } from 'react';
import { Code2, Eye, ImagePlus } from 'lucide-react';
import { TaskAttachment } from '../types';
import { TaskMarkdown } from './TaskMarkdown';
import { taskReferenceFromPaste } from '../utils/taskLinks';

interface TaskDescriptionEditorProps {
  value: string;
  onChange: (value: string) => void;
  attachments?: TaskAttachment[];
}

export const TaskDescriptionEditor: React.FC<TaskDescriptionEditorProps> = ({ value, onChange, attachments = [] }: TaskDescriptionEditorProps) => {
  useLocale();
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [showImages, setShowImages] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageFiles = attachments.filter((file) => file.type.startsWith('image/') && file.dataUrl);
  const insertImage = (file: TaskAttachment) => {
    const field = textareaRef.current;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? value.length;
    const alt = file.name.replace(/[\[\]\\\r\n]/g, '');
    const image = `\n![${alt}](lanmind-attachment:${encodeURIComponent(file.id)})\n`;
    onChange(value.slice(0, start) + image + value.slice(end));
    setMode('edit');
    setShowImages(false);
    window.requestAnimationFrame(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(start + image.length, start + image.length); });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-subtle bg-canvas">
      <div className="flex h-9 items-center justify-between border-b border-edge bg-surface/70 px-2">
        <div className="flex items-center gap-1" role="tablist" aria-label={tr("tasks:taskDescriptionEditor.taskDescriptionView")}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'edit'}
            onClick={() => setMode('edit')}
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium ${
              mode === 'edit' ? 'bg-card text-main' : 'text-sub hover:bg-hover hover:text-main'
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            {tr("tasks:taskDescriptionEditor.edit")}</button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            onClick={() => setMode('preview')}
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium ${
              mode === 'preview' ? 'bg-card text-main' : 'text-sub hover:bg-hover hover:text-main'
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            {tr("tasks:taskDescriptionEditor.preview")}</button>
        </div>
        <button type="button" onClick={() => setShowImages(!showImages)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-main" title={tr("tasks:taskDescriptionEditor.insertAttachedImage")} aria-label={tr("tasks:taskDescriptionEditor.insertAttachedImage")}><ImagePlus className="h-4 w-4" /></button>
      </div>

      {showImages && <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto border-b border-edge p-2">
        {imageFiles.map((file) => <button key={file.id} type="button" onClick={() => insertImage(file)} title={file.name} className="flex w-24 flex-col items-center gap-1 rounded-md border border-edge p-1.5 text-[10px] text-sub hover:bg-hover"><img src={file.dataUrl} alt="" className="h-12 w-full object-contain" /><span className="w-full truncate">{file.name}</span></button>)}
        {!imageFiles.length && <p className="py-2 text-xs text-quiet">{tr("tasks:taskDescriptionEditor.noImageAttachments")}</p>}
      </div>}

      {mode === 'edit' ? (
        <textarea
          ref={textareaRef}
          aria-label={tr("tasks:taskDescriptionEditor.taskMarkdown")}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPaste={(event) => {
            const reference = taskReferenceFromPaste(event.clipboardData);
            if (!reference) return;
            event.preventDefault();
            const field = event.currentTarget;
            onChange(value.slice(0, field.selectionStart) + reference + value.slice(field.selectionEnd));
          }}
          placeholder={tr("tasks:taskDescriptionEditor.describeTheTaskMarkdownSupported")}
          className="h-44 w-full resize-none bg-transparent p-3 text-xs leading-6 text-main outline-none"
        />
      ) : (
        <TaskMarkdown value={value} attachments={attachments} className="min-h-44 max-h-96 overflow-y-auto p-3" />
      )}
    </div>
  );
};
