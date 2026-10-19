import { tr, useLocale } from "../../i18n";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Globe, Settings2 } from 'lucide-react';
import type { Workspace, WorkspaceMember } from '../../types';
import { ApiService } from '../../services/api';

/**
 * WorkspaceSwitcher — 顶栏的工作区切换器。
 *
 * CALLING SPEC:
 *   <WorkspaceSwitcher
 *     workspace={workspace}
 *     members={members}
 *     currentUserId={currentUser.id}
 *     onOpenWorkspaceSettings={() => ...}
 *   />
 */
interface WorkspaceSwitcherProps {
  workspace: Workspace | null;
  members?: WorkspaceMember[];
  currentUserId?: string;
  onOpenWorkspaceSettings: () => void;
  className?: string;
}

const ROLE_LABEL_KEYS: Record<WorkspaceMember['role'], string> = {
  owner: 'settings:workspaceSettings.role.owner',
  admin: 'settings:workspaceSettings.role.admin',
  member: 'settings:workspaceSettings.role.member',
  guest: 'settings:workspaceSettings.role.guest',
};

export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
  workspace,
  members = [],
  currentUserId,
  onOpenWorkspaceSettings,
  className = '',
}) => {
  useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [menuTheme, setMenuTheme] = useState<string | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadWorkspaces = useCallback(async () => {
    try {
      const list = await ApiService.getWorkspaces();
      if (list && list.length > 0) {
        setWorkspaces(list);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadWorkspaces();
    }
  }, [isOpen, loadWorkspaces]);

  const calcMenuPosition = useCallback(() => {
    if (!buttonRef.current) return null;
    const rect = buttonRef.current.getBoundingClientRect();
    return {
      top: rect.bottom + 6,
      left: Math.max(10, Math.min(rect.left, window.innerWidth - 260)),
    };
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const pos = calcMenuPosition();
      if (pos) setMenuPosition(pos);
      setMenuTheme(rootRef.current?.closest<HTMLElement>('[data-theme]')?.dataset.theme);
    };
    update();
    const handleScroll = () => update();
    const handleResize = () => update();
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, calcMenuPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const outside = (event: PointerEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [isOpen]);

  const name = workspace?.name || tr('settings:workspaceSettings.title');
  const currentMember = currentUserId
    ? members.find((member) => member.userId === currentUserId)
    : undefined;

  const handleSwitch = async (targetId: string) => {
    if (targetId === workspace?.id || !currentUserId) return;
    try {
      await ApiService.switchWorkspace(targetId, currentUserId);
      setIsOpen(false);
      window.location.reload();
    } catch (e) {
      console.error('Failed to switch workspace:', e);
    }
  };

  const handleToggle = () => {
    if (isOpen) {
      setIsOpen(false);
    } else {
      const pos = calcMenuPosition();
      if (pos) setMenuPosition(pos);
      setMenuTheme(rootRef.current?.closest<HTMLElement>('[data-theme]')?.dataset.theme);
      setIsOpen(true);
    }
  };

  const menu = isOpen && menuPosition ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label={tr('settings:workspaceSettings.title')}
      data-theme={menuTheme}
      style={{
        position: 'fixed',
        top: menuPosition.top,
        left: menuPosition.left,
        zIndex: 99999,
      }}
      className="min-w-64 rounded-xl border border-edge bg-surface/95 p-1.5 shadow-popover backdrop-blur-md animate-in fade-in duration-100 select-none origin-top-left"
    >
      <div className="px-2.5 py-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-quiet">
          {tr('settings:workspaceSettings.workspaces')}
        </div>
      </div>

      <div className="space-y-0.5 max-h-48 overflow-y-auto">
        {(workspaces.length > 0 ? workspaces : (workspace ? [workspace] : [])).map((ws) => {
          const isCurrent = ws.id === workspace?.id;
          return (
            <button
              key={ws.id}
              type="button"
              onClick={() => void handleSwitch(ws.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                isCurrent
                  ? 'bg-info/10 text-info font-bold'
                  : 'text-main hover:bg-hover'
              }`}
            >
              <div className="min-w-0 flex-1 truncate">
                <span className="block truncate">{ws.name}</span>
                <span className="block truncate font-mono text-[9px] text-quiet">{ws.slug}</span>
              </div>
              {isCurrent && <Check className="h-3.5 w-3.5 text-info shrink-0" />}
            </button>
          );
        })}
      </div>

      <div className="my-1 border-t border-edge" />

      <div className="flex items-center justify-between px-2.5 py-1 text-[11px] text-sub">
        <span>{tr('settings:workspaceSettings.members')}</span>
        <span className="font-mono text-quiet">{members.length}</span>
      </div>
      {currentMember && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-sub">
          <Check className="h-3 w-3 text-success" />
          <span>{tr(ROLE_LABEL_KEYS[currentMember.role])}</span>
        </div>
      )}

      <div className="my-1 border-t border-edge" />

      <button
        type="button"
        role="menuitem"
        onClick={() => { setIsOpen(false); onOpenWorkspaceSettings(); }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main transition-colors hover:bg-hover focus:bg-hover focus:outline-none"
      >
        <Settings2 className="h-3.5 w-3.5 text-sub" />
        {tr('settings:workspaceSettings.workspaceSettings')}
      </button>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        data-no-drag
        onClick={handleToggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={tr('settings:workspaceSettings.title')}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-hover"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-accent/15 text-accent border border-accent/20 text-[10px] font-bold">
          {workspace?.logo
            ? <img src={workspace.logo} alt="" className="h-full w-full object-cover" />
            : <Globe className="h-3 w-3" />}
        </span>
        <span className="max-w-[140px] truncate text-xs font-semibold text-main">{name}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-sub" />
      </button>

      {typeof document !== 'undefined' && isOpen && menuPosition && menu ? createPortal(menu, document.body) : null}
    </div>
  );
};

