import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bot, CheckSquare2, Command, MessageSquare, Plus, Search, Settings, X } from 'lucide-react';

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
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
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
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/25 px-4 pt-[15vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-edge bg-surface shadow-popover"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-3">
          <Search className="h-4 w-4 text-sub" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search commands"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-main outline-none placeholder:text-quiet"
          />
          <kbd className="hidden items-center gap-1 rounded border border-edge px-1.5 py-0.5 text-[10px] text-sub sm:flex"><Command className="h-3 w-3" />K</kbd>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-sub hover:bg-hover hover:text-main" title="Close command palette" aria-label="Close command palette"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
          {visibleCommands.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-sub">No commands found</p>
          ) : visibleCommands.map((command, index) => {
            const Icon = command.icon;
            return (
              <button
                type="button"
                key={command.id}
                onClick={() => { command.onSelect(); onClose(); }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${index === activeIndex ? 'bg-hover text-main' : 'text-sub hover:bg-hover/70 hover:text-main'}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {command.hint && <span className="hidden text-xs text-quiet sm:block">{command.hint}</span>}
                {index === activeIndex && <ArrowRight className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const defaultCommandIcons = { work: CheckSquare2, ai: Bot, chat: MessageSquare, settings: Settings, add: Plus };
