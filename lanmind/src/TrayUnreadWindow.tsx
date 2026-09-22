import React, { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { MessageSquare, X } from 'lucide-react';

interface TrayUnreadItem {
  key: string;
  name: string;
  count: number;
  conversation: { kind: 'broadcast' | 'user' | 'group'; targetId?: string };
  iconRgba?: number[];
}

export const TrayUnreadWindow: React.FC = () => {
  const [items, setItems] = useState<TrayUnreadItem[]>([]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    listen<TrayUnreadItem[]>('tray://unread_updated', (event) => setItems(event.payload || []))
      .then((unlisten) => { dispose = unlisten; });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void invoke('hide_tray_unread_popup');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      dispose?.();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div
      className="h-full w-full p-2"
      onMouseEnter={() => void invoke('keep_tray_unread_popup_open')}
      onMouseLeave={() => void invoke('hide_tray_unread_popup')}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-edge bg-surface/95 shadow-popover backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-main">
            <MessageSquare className="h-4 w-4 text-info" />
            未读消息
          </div>
          <button type="button" onClick={() => void invoke('hide_tray_unread_popup')} className="rounded-md p-1 text-sub hover:bg-hover hover:text-main" aria-label="关闭">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {items.map((item) => (
            <button
              type="button"
              key={item.key}
              onClick={() => void invoke('open_tray_unread_conversation', { conversation: item.conversation })}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover"
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-subtle bg-card text-base">
                {item.conversation.kind === 'broadcast' ? '📣' : item.conversation.kind === 'group' ? '👥' : item.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-main">{item.name}</div>
                <div className="text-[10px] text-sub">{item.count > 99 ? '99+' : item.count} 条未读消息</div>
              </div>
              <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-on-solid">{item.count > 99 ? '99+' : item.count}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
