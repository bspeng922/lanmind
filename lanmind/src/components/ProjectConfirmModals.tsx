/**
 * ProjectConfirmModals — Modals for project transfer and project deletion.
 *
 * CALLING SPEC:
 *   <ProjectTransferDialog
 *     isOpen={boolean}
 *     onClose={() => void}
 *     project={Project}
 *     transferCandidates={User[]}
 *     members={string[]}
 *     transferTargetId={string}
 *     onTransferTargetChange={(id: string) => void}
 *     onConfirmTransfer={() => Promise<void> | void}
 *     isTransferring={boolean}
 *     errorMsg={string}
 *   />
 *
 *   <ProjectDeleteDialog
 *     isOpen={boolean}
 *     onClose={() => void}
 *     project={Project}
 *     deleteConfirmationName={string}
 *     onDeleteConfirmationNameChange={(val: string) => void}
 *     onConfirmDelete={() => Promise<void> | void}
 *     isDeleting={boolean}
 *     errorMsg={string}
 *     isCopiedName={boolean}
 *     onCopyProjectName={() => void}
 *   />
 */

import React, { useEffect } from 'react';
import { ArrowRightLeft, Check, Copy, Trash2, X } from 'lucide-react';
import { Project, User } from '../types';
import { ThemeSelect } from './ThemeSelect';

function useDialogEscape(isOpen: boolean, busy: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !busy) onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [isOpen, busy, onClose]);
}

interface ProjectTransferDialogProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  transferCandidates: User[];
  members: string[];
  transferTargetId: string;
  onTransferTargetChange: (id: string) => void;
  onConfirmTransfer: () => void | Promise<void>;
  isTransferring: boolean;
  errorMsg: string;
}

export const ProjectTransferDialog: React.FC<ProjectTransferDialogProps> = ({
  isOpen,
  onClose,
  project,
  transferCandidates,
  members,
  transferTargetId,
  onTransferTargetChange,
  onConfirmTransfer,
  isTransferring,
  errorMsg,
}) => {
  useDialogEscape(isOpen, isTransferring, onClose);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="transfer-project-title">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (transferTargetId && !isTransferring) void onConfirmTransfer();
        }}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-edge bg-surface text-main shadow-popover"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-5 py-4">
          <div className="min-w-0"><h3 id="transfer-project-title" className="flex items-center gap-2 text-sm font-semibold"><ArrowRightLeft className="h-4 w-4 text-warning" />转让项目</h3><p className="mt-1 truncate text-xs text-sub" title={project.name}>{project.name}</p></div>
          <button type="button" onClick={onClose} disabled={isTransferring} className="ui-modal-close-btn" aria-label="关闭转让项目" title="关闭转让项目"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
        <p className="text-xs leading-5 text-sub">转让后，选中的成员将成为项目创建者，你将保留普通成员身份。此操作不可撤销。</p>
        {transferCandidates.length === 0 ? (
          <div className="mt-4 rounded-md border border-edge bg-canvas p-3 text-xs leading-5 text-sub">
            <p className="font-semibold">当前局域网内暂未发现其他成员</p>
            <p className="mt-1 text-[11px] text-sub">请确保其他成员已启动并连接至同一局域网下的 LanMind，发现节点后即可选择转让。</p>
          </div>
        ) : (
          <>
            <p className="mt-4 text-xs font-medium text-sub">新的项目创建者</p>
            <div className="mt-1.5">
              <ThemeSelect
                portal
                ariaLabel="选择新项目创建者"
                value={transferTargetId}
                options={[
                  { value: '', label: '请选择新项目创建者', tone: 'slate' },
                  ...transferCandidates.map((user) => {
                    const isAlreadyMember = members.includes(user.id) || project.members.includes(user.id);
                    return {
                      value: user.id,
                      label: `${user.nickname} (${user.id})${isAlreadyMember ? ' [现有成员]' : ''}`,
                      tone: isAlreadyMember ? ('emerald' as const) : ('amber' as const),
                    };
                  }),
                ]}
                onChange={onTransferTargetChange}
                disabled={isTransferring}
              />
            </div>
          </>
        )}
        {errorMsg && <p role="alert" className="mt-3 text-xs text-danger">{errorMsg}</p>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-3">
          <button type="button" onClick={onClose} disabled={isTransferring} className="ui-cancel-button rounded-md px-4 py-2 text-xs font-semibold disabled:opacity-50">取消</button>
          <button
            type="submit"
            disabled={!transferTargetId || isTransferring}
            className="project-transfer-confirm flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-semibold"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            <span>{isTransferring ? '正在转让...' : '确认转让'}</span>
          </button>
        </footer>
      </form>
    </div>
  );
};

interface ProjectDeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  deleteConfirmationName: string;
  onDeleteConfirmationNameChange: (val: string) => void;
  onConfirmDelete: () => void | Promise<void>;
  isDeleting: boolean;
  errorMsg: string;
  isCopiedName: boolean;
  onCopyProjectName: () => void;
}

export const ProjectDeleteDialog: React.FC<ProjectDeleteDialogProps> = ({
  isOpen,
  onClose,
  project,
  deleteConfirmationName,
  onDeleteConfirmationNameChange,
  onConfirmDelete,
  isDeleting,
  errorMsg,
  isCopiedName,
  onCopyProjectName,
}) => {
  useDialogEscape(isOpen, isDeleting, onClose);
  if (!isOpen) return null;
  const canConfirmDelete = deleteConfirmationName.trim() === project.name.trim();

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-project-title"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canConfirmDelete && !isDeleting) void onConfirmDelete();
        }}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-edge bg-surface text-main shadow-popover"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              <h3 id="delete-project-title" className="flex items-center gap-2 text-sm font-semibold">
                <Trash2 className="h-4 w-4 text-danger" />删除项目确认
              </h3>
              <p className="mt-1 truncate text-xs text-sub" title={project.name}>{project.name}</p>
            </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="ui-modal-close-btn disabled:opacity-50"
            aria-label="关闭删除确认"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-xs leading-5 text-sub">删除后，所有成员将无法再访问此项目及其关联任务。此操作不可撤销。</p>
          <label className="block text-xs font-medium text-sub" htmlFor="delete-project-name">
            请输入项目名称以确认删除：
          </label>
          <div className="project-delete-name-box">
            <span className="project-delete-name-text select-all">{project.name}</span>
            <button
              type="button"
              onClick={onCopyProjectName}
              className="project-delete-copy-btn"
              title="复制项目名称"
            >
              {isCopiedName ? (
                <>
                  <Check className="h-3 w-3 text-success" />
                  <span className="text-success">已复制</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>点击复制</span>
                </>
              )}
            </button>
          </div>
          <input
            id="delete-project-name"
            type="text"
            autoFocus
            autoComplete="off"
            placeholder={`输入 "${project.name}" 确认`}
            value={deleteConfirmationName}
            onChange={(event) => onDeleteConfirmationNameChange(event.target.value)}
            disabled={isDeleting}
            className="project-delete-input mt-2.5 w-full rounded-md border border-subtle bg-input px-3 py-2 text-xs text-main placeholder-quiet outline-none transition-colors disabled:opacity-60"
          />

        {errorMsg && (
          <p role="alert" className="mt-3 text-xs text-danger">{errorMsg}</p>
        )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-edge px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="ui-cancel-button rounded-md px-4 py-2 text-xs font-semibold disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!canConfirmDelete || isDeleting}
            className="project-delete-confirm flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-semibold"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{isDeleting ? '正在删除...' : '确认删除'}</span>
          </button>
        </footer>
      </form>
    </div>
  );
};
