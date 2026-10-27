/**
 * ProjectArchiveModal — 协作项目归档二次确认弹窗。
 *
 * CALLING SPEC:
 *   <ProjectArchiveModal
 *     isOpen={boolean}
 *     onClose={() => void}
 *     project={Project}
 *     onConfirm={() => Promise<void>}
 *   />
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, AlertTriangle, Loader2, X } from 'lucide-react';
import { tr, useLocale } from '../i18n';
import type { Project } from '../types';

export interface ProjectArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  onConfirm: (project: Project) => Promise<void>;
}

export const ProjectArchiveModal: React.FC<ProjectArchiveModalProps> = ({
  isOpen,
  onClose,
  project,
  onConfirm,
}) => {
  useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !project) return null;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm(project);
      onClose();
    } catch (err: any) {
      setError(err?.message || tr('projects:projectArchive.failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-overlay backdrop-blur-sm p-4 animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-edge bg-surface p-5 shadow-popover space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-edge pb-2.5">
          <div className="flex items-center gap-2 text-sm font-bold text-main">
            <Archive className="h-4 w-4 text-warning" />
            <span>{tr('projects:projectArchive.title')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-quiet hover:text-main transition-colors disabled:opacity-50"
            title={tr('common:header.close') || '关闭'}
            aria-label={tr('common:header.close') || '关闭'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-main">
                {tr('projects:projectArchive.confirmTitle', { name: project.name })}
              </div>
              <p className="text-[11px] text-sub leading-relaxed">
                {tr('projects:projectArchive.confirmDescription')}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-canvas/40 p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: project.color }}
              />
              <span className="font-semibold text-main">{project.name}</span>
              {project.identifier && (
                <span className="font-mono text-[10px] text-quiet">({project.identifier})</span>
              )}
            </div>
            {project.description && (
              <p className="text-[11px] text-quiet line-clamp-2">{project.description}</p>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-edge pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl border border-edge bg-surface px-4 py-1.5 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-50"
          >
            {tr('projects:projectSettings.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 rounded-xl bg-warning px-4 py-1.5 text-xs font-semibold text-on-warning hover:bg-warning/90 transition-colors disabled:opacity-50 shadow-soft"
          >
            {isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
            <span>{tr('projects:projectArchive.confirmArchive')}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
