/**
 * WorkspaceModal — 工作区管理与组织架构配置独立弹窗。
 *
 * CALLING SPEC:
 *   <WorkspaceModal
 *     isOpen={boolean}
 *     onClose={() => void}
 *     workspace={workspace}
 *     users={users}
 *     currentUser={currentUser}
 *     onWorkspaceUpdated={(ws) => void}
 *     localDirectory={localDirectory}
 *     onLocalDirectoryChange={(dir) => void}
 *   />
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Globe, X } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import type { LocalDirectory, User, Workspace } from '../../types';
import { WorkspaceSettingsPanel } from './WorkspaceSettingsPanel';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace | null;
  users: User[];
  currentUser: User;
  onWorkspaceUpdated?: (next: Workspace) => void;
  localDirectory?: LocalDirectory;
  onLocalDirectoryChange?: (dir: LocalDirectory) => void;
}

export const WorkspaceModal: React.FC<WorkspaceModalProps> = ({
  isOpen,
  onClose,
  workspace,
  users,
  currentUser,
  onWorkspaceUpdated,
  localDirectory,
  onLocalDirectoryChange,
}) => {
  useLocale();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('settings:workspaceSettings.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-xs p-4"
    >
      <div
        className="relative flex h-[82vh] min-h-[560px] max-h-[720px] w-full max-w-4xl flex-col rounded-2xl border border-edge bg-surface shadow-popover animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
      >
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-edge px-5 bg-card/40">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent border border-accent/20">
              {workspace?.logo ? (
                <img src={workspace.logo} alt="" className="h-full w-full object-cover rounded-lg" />
              ) : (
                <Globe className="h-4 w-4" />
              )}
            </span>
            <div>
              <h2 className="text-sm font-bold text-main flex items-center gap-2">
                {workspace?.name || tr('settings:workspaceSettings.title')}
                <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  {tr('settings:workspaceSettings.managementBadge')}
                </span>
              </h2>
              <p className="text-[11px] text-sub">
                {tr('settings:workspaceSettings.managementSubtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors"
            title={tr('common:header.close')}
            aria-label={tr('common:header.closeWindow')}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <main className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          <WorkspaceSettingsPanel
            workspace={workspace}
            users={users}
            currentUser={currentUser}
            onWorkspaceUpdated={onWorkspaceUpdated}
            localDirectory={localDirectory}
            onLocalDirectoryChange={onLocalDirectoryChange}
          />
        </main>
      </div>
    </div>,
    document.body
  );
};
