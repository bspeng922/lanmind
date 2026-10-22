/**
 * ProviderDeleteModal — 模型供应商删除确认弹窗。
 *
 * CALLING SPEC:
 *   <ProviderDeleteModal
 *     isOpen={boolean}
 *     connection={Connection | null}
 *     busy={boolean}
 *     onClose={() => void}
 *     onConfirm={() => Promise<void> | void}
 *   />
 */

import React from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { tr, useLocale } from "../../i18n";
import type { Connection } from "./aiClient";

export interface ProviderDeleteModalProps {
  isOpen: boolean;
  connection: Connection | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}

export const ProviderDeleteModal: React.FC<ProviderDeleteModalProps> = ({
  isOpen,
  connection,
  busy,
  onClose,
  onConfirm,
}) => {
  useLocale();

  if (!isOpen || !connection) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-provider-modal-title"
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl border border-edge bg-surface p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
        {/* 顶部标题栏 */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 text-danger">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 border border-danger/20 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 id="delete-provider-modal-title" className="text-base font-bold text-main">
                {tr("ai:v2.deleteProviderModalTitle")}
              </h3>
              <p className="text-xs text-sub mt-0.5 font-medium">{connection.name}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg p-1 text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-40"
            title={tr("ai:v2.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 警告提示文案 */}
        <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 text-xs leading-relaxed text-sub">
          {tr("ai:v2.deleteProviderModalDesc", {
            name: connection.name,
            count: connection.models?.length || 0,
          })}
        </div>

        {/* 操作按钮组 */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-edge bg-surface px-4 py-2 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-40"
          >
            {tr("ai:v2.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex items-center gap-2 rounded-xl bg-danger px-5 py-2 text-xs font-semibold text-white shadow-soft hover:bg-danger/90 disabled:opacity-50 transition-colors"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{tr("ai:v2.working")}</span>
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" />
                <span>{tr("ai:v2.confirmDelete")}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
