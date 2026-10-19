import React, { useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import { tr, useLocale } from '../../i18n';

interface WikiPageTagsProps {
  tags?: string[];
  isLocked?: boolean;
  onChange: (tags: string[]) => void;
}

export const WikiPageTags: React.FC<WikiPageTagsProps> = ({ tags = [], isLocked = false, onChange }) => {
  useLocale();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const addTag = () => {
    const tag = draft.trim();
    if (!isLocked && tag && !tags.includes(tag)) onChange([...tags, tag]);
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={tr('wiki:wikiEditor.tags')}>
      {tags.map(tag => (
        <span key={tag} className="inline-flex max-w-full items-center gap-1 rounded-md border border-accent/20 bg-accent/10 px-2 py-1 text-xs text-main">
          <Tag className="h-3 w-3 shrink-0 text-quiet" aria-hidden="true" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{tag}</span>
          {!isLocked && (
            <button
              type="button"
              onClick={() => onChange(tags.filter(value => value !== tag))}
              aria-label={tr('wiki:wikiEditor.removeTag', { value0: tag })}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-quiet transition-colors hover:bg-hover hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {!isLocked && (adding ? (
        <input
          autoFocus
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onBlur={() => { addTag(); setAdding(false); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              addTag();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft('');
              setAdding(false);
            }
          }}
          aria-label={tr('wiki:wikiEditor.tagLabel')}
          placeholder={tr('wiki:wikiEditor.tagPlaceholder')}
          className="h-7 w-40 max-w-full rounded-md border border-accent bg-input px-2 text-xs text-main outline-none placeholder:text-placeholder"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-quiet transition-colors hover:bg-hover hover:text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          {tr('wiki:wikiEditor.addTag')}
        </button>
      ))}
    </div>
  );
};
