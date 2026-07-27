/**
 * EmojiPicker — Modern categorized emoji selector with dismiss and hover preview.
 *
 * CALLING SPEC:
 *   <EmojiPicker
 *     isOpen={boolean}
 *     onClose={() => void}
 *     onSelect={(emoji: string) => void}
 *     triggerRef?: React.RefObject<HTMLElement>
 *   />
 *
 * SIDE EFFECTS:
 *   - Auto-dismisses on click outside or Escape key press.
 *   - Does not steal focus from message textarea.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Smile, ThumbsUp, Briefcase, Rocket, Heart, X } from 'lucide-react';

interface EmojiCategory {
  id: string;
  name: string;
  icon: typeof Smile;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    name: '表情',
    icon: Smile,
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋',
      '😛', '😜', '🤪', '😝', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨',
      '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔',
      '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵',
      '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😮',
    ],
  },
  {
    id: 'gestures',
    name: '手势',
    icon: ThumbsUp,
    emojis: [
      '👍', '👎', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✌️', '🤞',
      '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚',
      '🖐️', '🖖', '👋', '💪', '🦾', '👂', '👀', '🧠', '🙋‍♂️', '🙋‍♀️',
      '🙇‍♂️', '🙇‍♀️', '🤦‍♂️', '🤦‍♀️', '🤷‍♂️', '🤷‍♀️', '🎉', '🎊', '✨', '🔥',
    ],
  },
  {
    id: 'work',
    name: '办公',
    icon: Briefcase,
    emojis: [
      '💼', '💻', '🖥️', '📱', '⌨️', '🖱️', '📊', '📈', '📉', '📋',
      '📁', '📂', '📄', '📑', '📌', '📎', '📏', '📐', '✏️', '📝',
      '🖊️', '🗓️', '📅', '⏰', '⏱️', '⌛', '📢', '📣', '🔔', '🔕',
      '🎯', '💡', '🔍', '🔎', '🔒', '🔓', '☕', '🍵', '🏆', '🥇',
    ],
  },
  {
    id: 'tech',
    name: '极客',
    icon: Rocket,
    emojis: [
      '🚀', '⚡', '🤖', '👾', '🔥', '✨', '💎', '🛡️', '⚙️', '🛠️',
      '🔧', '🔩', '📦', '🏷️', '🪄', '🔮', '📡', '🔋', '🔌', '🧪',
      '🧬', '🔬', '🪐', '🌟', '⭐', '☀️', '🌙', '☁️', '🌧️', '❄️',
      '🌐', '🕹️', '💾', '💿', '📀', '🧲', '🧭', '🛸', '🛰️', '🪐',
    ],
  },
  {
    id: 'hearts',
    name: '符号',
    icon: Heart,
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💯',
      '💢', '💥', '💫', '💬', '🗨️', '🗯️', '💭', '💤', '⚠️', '🚫',
      '⛔', '✅', '❌', '❓', '❗', '⭕', '➕', '➖', '✖️', '➗',
    ],
  },
];

interface EmojiPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  isOpen,
  onClose,
  onSelect,
  triggerRef,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('smileys');
  const [hoveredEmoji, setHoveredEmoji] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const container = containerRef.current;
      const trigger = triggerRef?.current;
      const target = event.target as Node | null;

      if (!target) return;
      if (container?.contains(target)) return;
      if (trigger?.contains(target)) return;

      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  const currentCategory =
    EMOJI_CATEGORIES.find((cat) => cat.id === activeCategory) || EMOJI_CATEGORIES[0];

  return (
    <div
      ref={containerRef}
      className="absolute bottom-16 left-3 z-40 w-72 rounded-2xl border border-slate-700/80 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
      style={{
        boxShadow: '0 20px 40px -10px rgba(0,0,0,0.7), 0 0 0 1px var(--border-subtle)',
      }}
    >
      {/* Header with Title and Close Button */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-200">选择表情</span>
          <span className="text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.2 rounded">
            {currentCategory.name}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          title="关闭表情选择器 (Esc)"
          aria-label="关闭表情选择器"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Category Tabs */}
      <div className="grid grid-cols-5 gap-1 pb-2 border-b border-slate-800/70 mb-2">
        {EMOJI_CATEGORIES.map((category) => {
          const Icon = category.icon;
          const isActive = activeCategory === category.id;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategory(category.id)}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1 transition-all text-[10px] ${
                isActive
                  ? 'bg-blue-600/20 text-blue-300 font-semibold border border-blue-500/30'
                  : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{category.name}</span>
            </button>
          );
        })}
      </div>

      {/* Emojis Grid Area (Fixed height and stable scrollbar to completely prevent jitter) */}
      <div
        className="grid h-48 max-h-48 grid-cols-8 gap-1 overflow-y-auto pr-1 select-none custom-scrollbar"
        style={{ scrollbarGutter: 'stable' }}
      >
        {currentCategory.emojis.map((emoji, index) => (
          <button
            key={`${categoryKey(currentCategory.id, index)}`}
            type="button"
            onClick={() => {
              onSelect(emoji);
            }}
            onMouseEnter={() => setHoveredEmoji(emoji)}
            onMouseLeave={() => setHoveredEmoji(null)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-lg transition-colors hover:bg-slate-700/80 active:scale-95 cursor-pointer"
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Footer Preview Bar - Pixel-locked fixed height to prevent ANY layout shifts */}
      <div className="mt-2 flex h-6 items-center justify-between border-t border-slate-800/80 pt-1.5 text-[11px] text-slate-400 overflow-hidden">
        <div className="flex items-center gap-1.5 h-full">
          {hoveredEmoji ? (
            <>
              <span className="text-sm leading-none inline-block">{hoveredEmoji}</span>
              <span className="text-[10px] text-slate-300 leading-none">点击立即插入</span>
            </>
          ) : (
            <span className="text-[10px] text-slate-500 leading-none">点击表情即可插入到消息框</span>
          )}
        </div>
        <kbd className="text-[9px] font-mono bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 leading-none shrink-0">
          Esc 关闭
        </kbd>
      </div>
    </div>
  );
};

function categoryKey(categoryId: string, index: number): string {
  return `${categoryId}-${index}`;
}
