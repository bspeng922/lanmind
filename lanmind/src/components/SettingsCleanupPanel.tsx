/**
 * SettingsCleanupPanel — Dedicated Local Data Cleanup Management Panel.
 *
 * CALLING SPEC:
 *   <SettingsCleanupPanel
 *     currentUserId={string}
 *     onCleanupFinished?: () => Promise<void> | void
 *   />
 *
 * Features:
 * - 4 Category Selection Cards (Tasks, Wiki, Chat, AI Conversation History)
 * - Category toggles with Select All / Deselect All
 * - Scope selection (Current Workspace vs All Local Workspaces)
 * - High-polish Danger Zone card with clear risk indicators
 * - Safety confirmation modal with confirmation keyword input ('CLEAR' or '确认清理')
 * - Automatic cache and localStorage purging for selected categories
 * - Statistics modal showing deleted record counts and option to reload
 */

import React, { useState, useId } from 'react';
import {
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ListTodo,
  BookOpen,
  MessageSquare,
  Bot,
  ShieldAlert,
  Loader2,
  RefreshCw,
  X,
  Check,
  RotateCcw,
  Layers,
} from 'lucide-react';
import { ClearDataOptions, ClearDataResult } from '../types';
import { ApiService } from '../services/api';
import { tr } from '../i18n';

interface SettingsCleanupPanelProps {
  currentUserId: string;
  onCleanupFinished?: () => Promise<void> | void;
}

interface CategoryCardItem {
  id: keyof Omit<ClearDataOptions, 'scope'>;
  title: string;
  description: string;
  tag: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'rose' | 'amber' | 'blue' | 'purple';
}

const CATEGORIES: CategoryCardItem[] = [
  {
    id: 'tasks',
    title: '任务与工作项',
    description: '清理作用域内的所有任务、子任务、关联评论、分配通知与状态进度。',
    tag: '核心业务',
    icon: ListTodo,
    tone: 'rose',
  },
  {
    id: 'wiki',
    title: 'Wiki 知识库文档',
    description: '清理所有 Wiki 知识库页面文档、父子层级关系树及文档视图配置。',
    tag: '知识库',
    icon: BookOpen,
    tone: 'amber',
  },
  {
    id: 'chat',
    title: '聊天消息记录',
    description: '清理所有点对点私聊、群聊历史消息与群公告（保留群组联系人与通道）。',
    tag: '沟通历史',
    icon: MessageSquare,
    tone: 'blue',
  },
  {
    id: 'ai',
    title: 'AI 会话与执行历史',
    description: '清理所有 AI 助手历史会话、多轮交互记录、执行分支与工具调用日志（保留已配置的模型及 API Key）。',
    tag: 'AI 交互',
    icon: Bot,
    tone: 'purple',
  },
];

/**
 * Purge matching localStorage cache entries for selected categories.
 */
function clearMatchingLocalStorage(options: ClearDataOptions) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const storage = window.localStorage;
  const keysToRemove: string[] = [];

  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;

    if (
      options.tasks &&
      (key.includes('task_layout') ||
        key.includes('task_pins') ||
        key.includes('task_attachments') ||
        key.includes('lanmind_sent_task_reminders') ||
        key.includes('lanmind_import_history') ||
        key.includes('lanmind_export_history'))
    ) {
      keysToRemove.push(key);
    }

    if (
      options.wiki &&
      (key.includes('wiki_documents') ||
        key.includes('wikiView') ||
        key.includes('lanmind_wiki'))
    ) {
      keysToRemove.push(key);
    }

    if (
      options.chat &&
      (key.includes('lan_chat_messages') || key.includes('chat_messages'))
    ) {
      keysToRemove.push(key);
    }

    if (
      options.ai &&
      (key.includes('lanmind_ai_conversations') ||
        key.includes('lanmind_ai_messages') ||
        key.includes('ai_conversations') ||
        key.includes('ai_messages') ||
        key.includes('ai_chat'))
    ) {
      keysToRemove.push(key);
    }
  }

  for (const k of keysToRemove) {
    storage.removeItem(k);
  }
}

export const SettingsCleanupPanel: React.FC<SettingsCleanupPanelProps> = ({
  currentUserId,
  onCleanupFinished,
}) => {
  const [selectedCategories, setSelectedCategories] = useState<{
    tasks: boolean;
    wiki: boolean;
    chat: boolean;
    ai: boolean;
  }>({
    tasks: true,
    wiki: true,
    chat: true,
    ai: true,
  });

  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmKeyword, setConfirmKeyword] = useState('');
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [cleanupResult, setCleanupResult] = useState<ClearDataResult | null>(null);

  const confirmInputId = useId();

  const selectedCount = Object.values(selectedCategories).filter(Boolean).length;
  const isAllSelected = selectedCount === CATEGORIES.length;

  const handleToggleCategory = (id: keyof typeof selectedCategories) => {
    setSelectedCategories((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleSelectAll = () => {
    setSelectedCategories({
      tasks: true,
      wiki: true,
      chat: true,
      ai: true,
    });
  };

  const handleDeselectAll = () => {
    setSelectedCategories({
      tasks: false,
      wiki: false,
      chat: false,
      ai: false,
    });
  };

  const handleOpenConfirm = () => {
    if (selectedCount === 0) return;
    setConfirmKeyword('');
    setCleanError(null);
    setIsConfirmModalOpen(true);
  };

  const isKeywordValid =
    confirmKeyword.trim().toUpperCase() === 'CLEAR' ||
    confirmKeyword.trim() === '确认清理';

  const executeCleanup = async () => {
    if (!isKeywordValid || isCleaning) return;
    setIsCleaning(true);
    setCleanError(null);

    const options: ClearDataOptions = {
      ...selectedCategories,
      scope,
    };

    try {
      const result = await ApiService.clearLocalData(options, currentUserId);
      clearMatchingLocalStorage(options);

      // Notify caller (e.g. task list reload)
      if (onCleanupFinished) {
        try {
          await onCleanupFinished();
        } catch {
          // ignore error in background callback
        }
      }

      window.dispatchEvent(
        new CustomEvent('lanmind:data_cleared', { detail: options })
      );

      setCleanupResult(result);
      setIsConfirmModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCleanError(msg || '清理数据失败，请重试');
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl pb-10">
      {/* Overview Header Card */}
      <div className="relative overflow-hidden rounded-2xl border border-edge/80 bg-gradient-to-br from-surface to-canvas p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-danger/10 text-danger flex items-center justify-center border border-danger/20 shadow-inner">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-main tracking-tight flex items-center gap-2">
                本地数据清理
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-danger/10 text-danger border border-danger/25">
                  危险操作
                </span>
              </h2>
              <p className="text-xs text-sub mt-0.5">
                安全清理本地数据库与缓存中的历史数据，释放存储空间并保障隐私。
              </p>
            </div>
          </div>

          {/* Scope Selector */}
          <div className="flex items-center bg-canvas/80 border border-edge/80 p-1 rounded-xl text-xs font-medium self-stretch sm:self-auto">
            <button
              type="button"
              onClick={() => setScope('current')}
              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg transition-all ${
                scope === 'current'
                  ? 'bg-feature text-white shadow-sm font-semibold'
                  : 'text-sub hover:text-main'
              }`}
            >
              当前工作区
            </button>
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg transition-all ${
                scope === 'all'
                  ? 'bg-danger text-white shadow-sm font-semibold'
                  : 'text-sub hover:text-main'
              }`}
            >
              所有本地数据
            </button>
          </div>
        </div>

        {scope === 'all' && (
          <div className="mt-4 flex items-center gap-2 text-xs text-danger bg-danger/10 border border-danger/20 px-3.5 py-2 rounded-xl">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              已选择「所有本地数据」模式，清理将跨越本机所有工作区生效，请格外谨慎！
            </span>
          </div>
        )}
      </div>

      {/* Result Banner if already cleaned */}
      {cleanupResult && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold">本地数据清理已完成</h3>
                <p className="text-xs text-sub mt-1 leading-relaxed">
                  {cleanupResult.message}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2 text-[11px]">
                  {cleanupResult.tasksDeleted > 0 && (
                    <span className="px-2 py-0.5 bg-canvas/80 border border-edge rounded-md">
                      任务: {cleanupResult.tasksDeleted} 条
                    </span>
                  )}
                  {cleanupResult.wikiDocumentsDeleted > 0 && (
                    <span className="px-2 py-0.5 bg-canvas/80 border border-edge rounded-md">
                      Wiki: {cleanupResult.wikiDocumentsDeleted} 篇
                    </span>
                  )}
                  {cleanupResult.chatMessagesDeleted > 0 && (
                    <span className="px-2 py-0.5 bg-canvas/80 border border-edge rounded-md">
                      聊天消息: {cleanupResult.chatMessagesDeleted} 条
                    </span>
                  )}
                  {cleanupResult.aiConversationsDeleted > 0 && (
                    <span className="px-2 py-0.5 bg-canvas/80 border border-edge rounded-md">
                      AI会话: {cleanupResult.aiConversationsDeleted} 条 (消息 {cleanupResult.aiMessagesDeleted} 条)
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCleanupResult(null)}
              className="text-sub hover:text-main p-1 rounded-lg hover:bg-canvas/50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Category Selection Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-sub" />
            <h3 className="text-sm font-semibold text-main">清理分类选择</h3>
            <span className="text-[11px] text-sub">
              (已选择 {selectedCount} / {CATEGORIES.length} 项)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={isAllSelected}
              className="text-xs px-2.5 py-1 rounded-lg border border-edge/80 bg-surface hover:bg-canvas text-sub hover:text-main disabled:opacity-40 transition-colors"
            >
              全选
            </button>
            <button
              type="button"
              onClick={handleDeselectAll}
              disabled={selectedCount === 0}
              className="text-xs px-2.5 py-1 rounded-lg border border-edge/80 bg-surface hover:bg-canvas text-sub hover:text-main disabled:opacity-40 transition-colors"
            >
              清空
            </button>
          </div>
        </div>

        {/* 4 Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {CATEGORIES.map((item) => {
            const isChecked = selectedCategories[item.id];
            const IconComponent = item.icon;

            return (
              <div
                key={item.id}
                role="checkbox"
                aria-checked={isChecked}
                tabIndex={0}
                onClick={() => handleToggleCategory(item.id)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    handleToggleCategory(item.id);
                  }
                }}
                className={`group relative flex flex-col justify-between p-4 rounded-xl border text-left cursor-pointer transition-all ${
                  isChecked
                    ? 'border-feature/60 bg-feature/5 shadow-sm ring-1 ring-feature/30'
                    : 'border-edge/70 bg-surface hover:border-edge hover:bg-canvas/50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                          isChecked
                            ? 'bg-feature text-white'
                            : 'bg-canvas text-sub group-hover:text-main'
                        }`}
                      >
                        <IconComponent className="w-4 h-4" />
                      </div>
                      <span className="text-sm font-semibold text-main">
                        {item.title}
                      </span>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                        isChecked
                          ? 'border-feature bg-feature text-white'
                          : 'border-edge/80 bg-canvas'
                      }`}
                    >
                      {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>

                  <p className="text-xs text-sub leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <div className="mt-3.5 flex items-center justify-between pt-2.5 border-t border-edge/40">
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-canvas border border-edge/60 text-sub">
                    {item.tag}
                  </span>
                  <span className="text-[11px] text-sub">
                    {isChecked ? '已勾选' : '未选择'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Danger Zone Execution Card */}
      <div className="rounded-2xl border border-danger/30 bg-danger/5 p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-danger/15 text-danger flex items-center justify-center shrink-0 border border-danger/25">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-danger">
                执行本地数据抹除
              </h3>
              <p className="text-xs text-sub mt-0.5 leading-relaxed">
                数据清理为不可逆破坏性操作，将永久清除本地 SQLite 数据库及缓存中对应的记录。用户账号、工作区结构及 AI 密钥配置将妥善保留。
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenConfirm}
            disabled={selectedCount === 0}
            className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-danger hover:bg-danger/90 text-white font-semibold text-xs shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-md"
          >
            <Trash2 className="w-4 h-4" />
            <span>清理选中的数据 ({selectedCount})</span>
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-md rounded-2xl border border-edge bg-surface shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3 text-danger">
                <div className="w-10 h-10 rounded-xl bg-danger/10 border border-danger/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-main">
                    二次安全确认
                  </h3>
                  <p className="text-xs text-sub mt-0.5">
                    请谨慎核对将要清理的本地数据
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isCleaning}
                className="text-sub hover:text-main p-1 rounded-lg hover:bg-canvas/60"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selected items summary */}
            <div className="space-y-2 rounded-xl bg-canvas/80 border border-edge p-3.5 text-xs">
              <div className="flex items-center justify-between text-sub border-b border-edge/60 pb-2">
                <span>清理作用域</span>
                <span className="font-semibold text-main">
                  {scope === 'all' ? '所有本地工作区' : '当前工作区'}
                </span>
              </div>
              <div className="text-sub pt-1">
                <span className="block mb-1.5 font-medium text-main">即将清理的项目：</span>
                <ul className="space-y-1 pl-4 list-disc text-danger">
                  {selectedCategories.tasks && <li>任务、子任务、评论及分配通知</li>}
                  {selectedCategories.wiki && <li>Wiki 知识库文档与结构树</li>}
                  {selectedCategories.chat && <li>单聊与群聊所有聊天消息记录</li>}
                  {selectedCategories.ai && <li>AI 历史会话记录与执行日志</li>}
                </ul>
              </div>
            </div>

            {/* Error prompt if any */}
            {cleanError && (
              <div className="p-3 rounded-xl bg-danger/10 border border-danger/25 text-danger text-xs">
                {cleanError}
              </div>
            )}

            {/* Confirmation Input */}
            <div className="space-y-2">
              <label
                htmlFor={confirmInputId}
                className="block text-xs font-medium text-main"
              >
                请输入口令 <span className="font-mono font-bold text-danger">CLEAR</span> 或 <span className="font-bold text-danger">确认清理</span> 以解锁清理按钮：
              </label>
              <input
                id={confirmInputId}
                type="text"
                value={confirmKeyword}
                onChange={(e) => setConfirmKeyword(e.target.value)}
                placeholder="在此输入 CLEAR 或 确认清理"
                disabled={isCleaning}
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-xl border border-edge bg-canvas text-main text-xs focus:outline-hidden focus:ring-2 focus:ring-danger/50 focus:border-danger font-mono transition-all"
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isCleaning}
                className="px-4 py-2 rounded-xl border border-edge bg-surface hover:bg-canvas text-sub hover:text-main text-xs font-medium transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={executeCleanup}
                disabled={!isKeywordValid || isCleaning}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-danger hover:bg-danger/90 text-white text-xs font-bold shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isCleaning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>正在清理中...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>确认抹除并清理</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
