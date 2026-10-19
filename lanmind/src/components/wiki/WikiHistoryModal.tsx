/**
 * WikiHistoryModal — 页面历史修改记录（参考主流企业 Wiki 规范设计）。
 *
 * CALLING SPEC:
 *   <WikiHistoryModal
 *     doc={selectedDoc}
 *     ancestors={ancestors}
 *     isOpen={isHistoryOpen}
 *     currentUser={currentUser}
 *     workspaceId={workspaceId}
 *     onClose={() => setIsHistoryOpen(false)}
 *     onRestore={(revision) => handleRestoreRevision(revision)}
 *   />
 *
 * TOOL CONTRACT:
 *   - 版本号自动展示（当前 v. N，历史 v. N-1 ...）
 *   - 支持分页展示历史版本（默认 10 条/页）
 *   - 支持版本对比（选中两项后点击“比较选择的版本”）
 *   - 支持单版本快速预览与一键恢复、删除
 *   - 纯受控组件，不污染主编辑画布状态
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  RotateCcw,
  Trash2,
  X,
  GitCompare,
  FileText,
  User as UserIcon,
} from 'lucide-react';
import type { User } from '../../types';
import type { WikiDocument, WikiRevision } from './wikiTypes';
import { loadWikiRevisions, deleteWikiRevision } from './wikiHistoryStore';
import { WikiPagePreview } from './WikiPagePreview';
import { tr, useLocale } from '../../i18n';

export interface WikiHistoryModalProps {
  doc: WikiDocument;
  ancestors: WikiDocument[];
  isOpen: boolean;
  currentUser?: User;
  workspaceId?: string | null;
  onClose: () => void;
  onRestore: (revision: WikiRevision) => void;
}

const PAGE_SIZE = 10;

function formatRevisionDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  if (locale.startsWith('zh')) {
    return `${month}月 ${String(day).padStart(2, '0')}, ${year} ${hours}:${minutes}`;
  }
  return d.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export const WikiHistoryModal: React.FC<WikiHistoryModalProps> = ({
  doc,
  ancestors,
  isOpen,
  currentUser,
  workspaceId,
  onClose,
  onRestore,
}) => {
  const { locale } = useLocale();
  const [revisions, setRevisions] = useState<WikiRevision[]>([]);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewRevision, setPreviewRevision] = useState<WikiRevision | null>(null);
  const [compareRevisions, setCompareRevisions] = useState<[WikiRevision, WikiRevision] | null>(null);
  const [actionConfirm, setActionConfirm] = useState<{
    type: 'restore' | 'delete';
    target: WikiRevision;
  } | null>(null);

  // 加载当前文档历史记录
  useEffect(() => {
    if (!isOpen) return;
    const list = loadWikiRevisions(doc.id, workspaceId);
    setRevisions(list);
    setPage(1);
    setSelectedIds([]);
    setPreviewRevision(null);
    setCompareRevisions(null);
  }, [doc.id, isOpen, workspaceId]);

  if (!isOpen) return null;

  // 将当前活跃文档作为最新版本 (当前 v. X)
  const currentVersionNum = Math.max(
    (doc.version ?? 0) || 1,
    revisions.length > 0 ? revisions[0].version : 1,
  );

  const currentAsRevision: WikiRevision = {
    id: '__current__',
    documentId: doc.id,
    version: currentVersionNum,
    title: doc.title,
    content: doc.content,
    authorId: doc.updatedBy || doc.createdBy || currentUser?.id || 'me',
    authorName: doc.updatedByName || doc.createdByName || currentUser?.nickname || currentUser?.username || '当前用户',
    comment: '当前正文版本',
    createdAt: doc.updatedAt || new Date().toISOString(),
  };

  // 列表合并当前版本（排在最顶端）
  const allHistoryItems: WikiRevision[] = [
    currentAsRevision,
    ...revisions.filter((r) => r.version < currentVersionNum),
  ];

  // 分页计算
  const totalItems = allHistoryItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = allHistoryItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleSelectToggle = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const handleCompareClick = () => {
    if (selectedIds.length !== 2) return;
    const first = allHistoryItems.find((r) => r.id === selectedIds[0]);
    const second = allHistoryItems.find((r) => r.id === selectedIds[1]);
    if (first && second) {
      setCompareRevisions(first.version > second.version ? [first, second] : [second, first]);
    }
  };

  const handleDeleteConfirm = () => {
    if (!actionConfirm || actionConfirm.type !== 'delete') return;
    const remaining = deleteWikiRevision(doc.id, actionConfirm.target.id, workspaceId);
    setRevisions(remaining);
    setActionConfirm(null);
    setSelectedIds((prev) => prev.filter((id) => id !== actionConfirm.target.id));
  };

  const handleRestoreConfirm = () => {
    if (!actionConfirm || actionConfirm.type !== 'restore') return;
    onRestore(actionConfirm.target);
    setActionConfirm(null);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="页面历史记录"
      className="fixed inset-0 z-50 flex flex-col bg-surface overflow-hidden select-text text-main"
    >
      {/* 顶部面包屑与关闭按钮 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-edge px-6 bg-canvas/60">
        <nav className="flex items-center gap-1.5 text-xs text-quiet truncate">
          <span>页面</span>
          <span>/</span>
          {ancestors.length > 0 && (
            <>
              <span className="truncate max-w-28">{ancestors[ancestors.length - 1].title || '父页面'}</span>
              <span>/</span>
            </>
          )}
          <span className="text-main font-medium truncate max-w-48">{doc.title || '未命名文档'}</span>
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-main hover:bg-hover transition-colors shadow-2xs"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>查看页面</span>
          </button>
        </div>
      </div>

      {/* 主栏历史内容 */}
      <div className="flex-1 overflow-auto p-6 md:p-8 max-w-6xl mx-auto w-full">
        {/* 标题与描述 */}
        <div className="mb-6">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-main mb-2">页面历史记录</h1>
          <p className="text-xs text-sub leading-relaxed">
            查看、对比或恢复此页面的旧版本。恢复后旧版本内容将作为当前最新正文，并自动自增版本号。
          </p>
        </div>

        {/* 工具栏（比较版本按钮） */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={selectedIds.length !== 2}
              onClick={handleCompareClick}
              className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-card hover:bg-hover text-main shadow-2xs"
            >
              <GitCompare className="h-3.5 w-3.5 text-accent" />
              <span>比较选择的版本 {selectedIds.length > 0 ? `(${selectedIds.length}/2)` : ''}</span>
            </button>
          </div>
          <div className="text-xs text-quiet font-mono">共 {totalItems} 个版本记录</div>
        </div>

        {/* 历史版本表格（参考截图规范） */}
        <div className="overflow-hidden rounded-xl border border-edge bg-card shadow-soft">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-edge/80 bg-input/40 text-quiet font-medium">
                <th className="w-10 px-3 py-2.5 text-center"></th>
                <th className="w-36 px-4 py-2.5">版本</th>
                <th className="w-48 px-4 py-2.5">发布的</th>
                <th className="w-40 px-4 py-2.5">更改由</th>
                <th className="px-4 py-2.5">注释</th>
                <th className="w-32 px-4 py-2.5 text-right">行动</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/40">
              {pageItems.map((item) => {
                const isCurrent = item.id === '__current__';
                const checked = selectedIds.includes(item.id);
                return (
                  <tr
                    key={item.id}
                    className={`transition-colors hover:bg-hover/60 ${
                      checked ? 'bg-accent/5' : ''
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleSelectToggle(item.id)}
                        aria-label={`选择版本 v.${item.version}`}
                        className="rounded border-edge text-accent focus:ring-accent"
                      />
                    </td>

                    {/* 版本 */}
                    <td className="px-4 py-3 font-medium">
                      <button
                        type="button"
                        onClick={() => setPreviewRevision(item)}
                        className="text-left font-semibold text-accent hover:underline flex items-center gap-1.5"
                      >
                        <span>{isCurrent ? `当前 (v. ${item.version})` : `v. ${item.version}`}</span>
                        <Eye className="h-3 w-3 opacity-60" />
                      </button>
                    </td>

                    {/* 发布的 */}
                    <td className="px-4 py-3 text-sub whitespace-nowrap">
                      {formatRevisionDate(item.createdAt, locale)}
                    </td>

                    {/* 更改由 */}
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-feature hover:underline cursor-pointer">
                      {item.authorName}
                    </td>

                    {/* 注释 */}
                    <td className="px-4 py-3 text-quiet truncate max-w-xs">
                      {item.comment || '-'}
                    </td>

                    {/* 行动 */}
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-3">
                      {!isCurrent && (
                        <>
                          <button
                            type="button"
                            onClick={() => setActionConfirm({ type: 'restore', target: item })}
                            className="text-accent hover:underline font-medium"
                          >
                            恢复
                          </button>
                          <button
                            type="button"
                            onClick={() => setActionConfirm({ type: 'delete', target: item })}
                            className="text-danger hover:underline font-medium"
                          >
                            删除
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 分页控制 */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-edge/60 pt-3 text-xs text-sub">
            <span>
              第 {currentPage} 页 / 共 {totalPages} 页
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex h-7 w-7 items-center justify-center rounded border border-edge bg-card hover:bg-hover disabled:opacity-40"
                aria-label="上一页"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              {Array.from({ length: totalPages }).map((_, index) => {
                const pageNumber = index + 1;
                return (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => setPage(pageNumber)}
                    className={`flex h-7 w-7 items-center justify-center rounded text-xs font-medium transition-colors ${
                      currentPage === pageNumber
                        ? 'bg-accent text-on-accent font-semibold shadow-2xs'
                        : 'border border-edge bg-card hover:bg-hover text-main'
                    }`}
                  >
                    {pageNumber}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex h-7 w-7 items-center justify-center rounded border border-edge bg-card hover:bg-hover disabled:opacity-40"
                aria-label="下一页"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 1. 版本详情预览侧滑抽屉/弹窗 */}
      {previewRevision && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPreviewRevision(null)}
        >
          <div
            className="flex h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-edge bg-surface shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-edge px-5 py-3 bg-canvas/50">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-main text-sm">
                  {previewRevision.id === '__current__'
                    ? `当前版本 (v. ${previewRevision.version})`
                    : `历史版本 v. ${previewRevision.version}`}
                </span>
                <span className="text-xs text-quiet">
                  {formatRevisionDate(previewRevision.createdAt, locale)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {previewRevision.id !== '__current__' && (
                  <button
                    type="button"
                    onClick={() => {
                      setActionConfirm({ type: 'restore', target: previewRevision });
                      setPreviewRevision(null);
                    }}
                    className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-colors shadow-2xs"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>恢复此版本</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewRevision(null)}
                  className="rounded-lg p-1 text-quiet hover:bg-hover hover:text-main"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6 select-text">
              <h2 className="text-xl font-bold text-main mb-4">{previewRevision.title || '未命名文档'}</h2>
              <div className="prose max-w-none">
                <WikiPagePreview content={previewRevision.content} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. 双版本对比弹窗 */}
      {compareRevisions && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setCompareRevisions(null)}
        >
          <div
            className="flex h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-edge bg-surface shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-edge px-5 py-3 bg-canvas/50">
              <div className="flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-accent" />
                <span className="font-semibold text-main text-sm">
                  版本对比: v.{compareRevisions[0].version} 对比 v.{compareRevisions[1].version}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCompareRevisions(null)}
                className="rounded-lg p-1 text-quiet hover:bg-hover hover:text-main"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 divide-x divide-edge flex-1 min-h-0 overflow-hidden">
              <div className="flex flex-col overflow-hidden">
                <div className="border-b border-edge/60 bg-input/40 px-4 py-2 text-xs font-semibold text-main">
                  版本 v.{compareRevisions[0].version} ({formatRevisionDate(compareRevisions[0].createdAt, locale)})
                </div>
                <div className="flex-1 overflow-auto p-4 select-text">
                  <h3 className="font-bold text-base mb-2">{compareRevisions[0].title}</h3>
                  <pre className="font-mono text-xs whitespace-pre-wrap leading-relaxed text-sub">
                    {compareRevisions[0].content}
                  </pre>
                </div>
              </div>

              <div className="flex flex-col overflow-hidden">
                <div className="border-b border-edge/60 bg-input/40 px-4 py-2 text-xs font-semibold text-main">
                  版本 v.{compareRevisions[1].version} ({formatRevisionDate(compareRevisions[1].createdAt, locale)})
                </div>
                <div className="flex-1 overflow-auto p-4 select-text">
                  <h3 className="font-bold text-base mb-2">{compareRevisions[1].title}</h3>
                  <pre className="font-mono text-xs whitespace-pre-wrap leading-relaxed text-sub">
                    {compareRevisions[1].content}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. 操作二次确认弹框 */}
      {actionConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-edge bg-surface p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-main mb-2">
              {actionConfirm.type === 'restore' ? '确认恢复到历史版本？' : '确认删除历史记录？'}
            </h3>
            <p className="text-xs text-sub mb-5 leading-relaxed">
              {actionConfirm.type === 'restore'
                ? `恢复后，当前文档的正文与标题将被版本 v.${actionConfirm.target.version} 的内容替换，并自增新版本。`
                : `版本 v.${actionConfirm.target.version} 的修改记录将被永久移除，此操作无法撤销。`}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setActionConfirm(null)}
                className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-sub hover:bg-hover"
              >
                取消
              </button>
              <button
                type="button"
                onClick={actionConfirm.type === 'restore' ? handleRestoreConfirm : handleDeleteConfirm}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold shadow-2xs ${
                  actionConfirm.type === 'restore'
                    ? 'bg-accent text-on-accent hover:bg-accent/90'
                    : 'bg-danger text-on-danger hover:bg-danger/90'
                }`}
              >
                {actionConfirm.type === 'restore' ? '确认恢复' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
