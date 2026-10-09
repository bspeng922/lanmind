import { tr, useLocale } from "../i18n";
import React, { useEffect, useRef, useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import { TaskTagUsage } from '../utils/taskTags';

export const TaskTagsEditor: React.FC<{ value: string[]; onChange: (tags: string[]) => void; suggestions: TaskTagUsage[] }> = ({ value, onChange, suggestions }) => {
  useLocale();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const formRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancel = () => { setCreating(false); setDraft(''); };
  useEffect(() => {
    if (!creating) return;
    inputRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!formRef.current?.contains(event.target as Node)) cancel();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [creating]);
  const add = (tag: string) => {
    const name = tag.trim();
    if (!name) return;
    if (!value.includes(name)) onChange([...value, name]);
    cancel();
  };
  const available = suggestions.filter(({ tag }) => !value.includes(tag)).slice(0, 12);
  return <section aria-label={tr("tasks:taskTagsEditor.taskTags")} className="space-y-3">
    <h4 className="flex items-center gap-1 text-xs font-semibold text-sub"><Tag className="h-3.5 w-3.5 text-warning" />{tr("tasks:taskTagsEditor.tags")}</h4>
    <div aria-label={tr("tasks:taskTagsEditor.selectedTags")} className="space-y-2">
      <p className="text-[10px] text-quiet">{tr("tasks:taskTagsEditor.selectedTags")}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((tag) => <span key={tag} className="inline-flex max-w-full items-center gap-1 rounded-md border border-info/20 bg-info/10 py-1 pl-2 pr-1 text-[11px] text-info">
          <span className="min-w-0 truncate" title={tag}>#{tag}</span>
          <button type="button" aria-label={tr("tasks:taskTagsEditor.removeTag", { value0: tag })} title={tr("tasks:taskTagsEditor.removeTag2")} onClick={() => onChange(value.filter((name) => name !== tag))} className="flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-hover hover:text-danger"><X className="h-3 w-3" /></button>
        </span>)}
        {creating ? <div ref={formRef} className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border border-info/40 bg-input pl-2 pr-1" style={{ minWidth: 120 }}>
          <input ref={inputRef} aria-label={tr("tasks:taskTagsEditor.newTagName")} placeholder={tr("tasks:taskTagsEditor.typeATagAndPressEnter")} value={draft} maxLength={64} onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); add(draft); }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
            }} className="min-w-0 flex-1 border-0 bg-transparent text-[11px] text-main" />
          <button type="button" aria-label={tr("tasks:taskTagsEditor.cancelNewTag")} title={tr("tasks:taskTagsEditor.cancel")} onClick={cancel} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-sub hover:bg-hover hover:text-main"><X className="h-3 w-3" /></button>
        </div> : <button type="button" aria-label={tr("tasks:taskTagsEditor.createTag")} title={tr("tasks:taskTagsEditor.createTag")} onClick={() => setCreating(true)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-subtle text-sub hover:border-info hover:bg-hover hover:text-info"><Plus className="h-3.5 w-3.5" /></button>}
      </div>
    </div>
    <div aria-label={tr("tasks:taskTagsEditor.availableTags")} className="space-y-2 border-t border-edge pt-2">
      <p className="text-[10px] text-quiet">{tr("tasks:taskTagsEditor.availableTags")}</p>
      {available.length ? <div className="flex flex-wrap gap-1.5">{available.map(({ tag, count }) => <button key={tag} type="button" aria-label={tr("tasks:taskTagsEditor.selectTag", { value0: tag })} title={tr("tasks:taskTagsEditor.usedTimes", { value0: count })} onClick={() => add(tag)} className="max-w-full truncate rounded-md border border-subtle bg-canvas px-2 py-1 text-[11px] text-sub hover:border-info/40 hover:bg-hover hover:text-main">#{tag}</button>)}</div>
        : <p className="text-[11px] text-quiet">{tr("tasks:taskTagsEditor.noOtherTagsUseToCreateOne")}</p>}
    </div>
  </section>;
};
