import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bot, CheckSquare2, Command, MessageSquare, Plus, Search, Settings, X } from 'lucide-react';
import { isComposingKeyboardEvent } from '../../utils/keyboard';
import { isMacOS } from '../../utils/platform';
import { tr, useLocale } from '../../i18n';

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, commands }) => {
  useLocale();
  const isMac = isMacOS();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const visibleCommands = useMemo(
    () => commands.filter((command) => `${command.label} ${command.hint || ''}`.toLowerCase().includes(query.toLowerCase())),
    [commands, query],
  );

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen, visibleCommands.length]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isComposingKeyboardEvent(event)) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      // Buttons keep their native Enter activation; only the search field drives selection.
      if (!(event.target instanceof HTMLInputElement)) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, Math.max(visibleCommands.length - 1, 0)));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
      }
      if (event.key === 'Enter' && visibleCommands[activeIndex]) {
        event.preventDefault();
        visibleCommands[activeIndex].onSelect();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, isOpen, onClose, visibleCommands]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-overlay backdrop-blur-xs px-4 pt-[14vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('common:commandPalette.title')}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-edge bg-elevated shadow-popover animate-in fade-in zoom-in-95 duration-150"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-subtle px-3.5">
          <Search className="h-4 w-4 shrink-0 text-quiet" aria-hidden="true" />
          <input
            autoFocus
            aria-label={tr('common:commandPalette.searchPlaceholder')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder={tr('common:commandPalette.searchPlaceholder')}
            className="h-12 min-w-0 flex-1 border-0 bg-transparent text-sm text-main shadow-none outline-none placeholder:text-quiet focus:border-0 focus:shadow-none focus:outline-none"
          />
          <kbd className="hidden items-center gap-1 rounded border border-subtle bg-muted px-1.5 py-0.5 font-mono text-[11px] text-sub sm:flex">
            {isMac ? <><Command className="h-3 w-3" />K</> : 'Ctrl K'}
          </kbd>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-sub hover:bg-hover hover:text-main transition-colors"
            title={tr('common:header.close')}
            aria-label={tr('common:header.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[min(56vh,400px)] overflow-y-auto p-1.5">
          {visibleCommands.length === 0 ? (
            <p className="px-3 py-10 text-center text-xs text-quiet">{tr('common:commandPalette.noResults')}</p>
          ) : visibleCommands.map((command, index) => {
            const Icon = command.icon;
            const isSelected = index === activeIndex;
            return (
              <button
                ref={(node) => { itemRefs.current[index] = node; }}
                type="button"
                key={command.id}
                data-active={isSelected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => { command.onSelect(); onClose(); }}
                className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                  isSelected ? 'bg-accent/12 text-main font-medium' : 'text-sub hover:bg-hover/70 hover:text-main'
                }`}
              >
                {isSelected && (
                  <span aria-hidden="true" className="absolute left-0.5 top-2 bottom-2 w-[3px] rounded-full bg-accent" />
                )}
                <Icon className={`h-4 w-4 shrink-0 ${isSelected ? 'text-accent-text' : 'text-quiet'}`} />
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {command.hint && <span className="hidden text-xs text-quiet sm:block">{command.hint}</span>}
                {isSelected && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-accent-text" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-subtle bg-surface/60 px-3.5 py-2 text-[11px] text-quiet">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-subtle bg-muted px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
              {tr('common:commandPalette.navigateHint')}
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-subtle bg-muted px-1 py-0.5 font-mono text-[10px]">↵</kbd>
              {tr('common:commandPalette.selectHint')}
            </span>
          </div>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-subtle bg-muted px-1 py-0.5 font-mono text-[10px]">Esc</kbd>
            {tr('common:commandPalette.closeHint')}
          </span>
        </div>
      </div>
    </div>
  );
};

export const defaultCommandIcons = { work: CheckSquare2, ai: Bot, chat: MessageSquare, settings: Settings, add: Plus };
