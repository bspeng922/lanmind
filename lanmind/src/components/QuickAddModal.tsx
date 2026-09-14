/**
 * QuickAddModal — Natural Language Fast Task Creation Modal & Window
 *
 * CALLING SPEC:
 *   <QuickAddModal
 *     isOpen={boolean}
 *     onClose={() => ...}
 *     projects={Project[]}
 *     users={User[]}
 *     currentUser={User}
 *     onTaskCreated={() => ...}
 *     standalone={boolean}
 *   />
 */

import React, { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { Project, User, Priority, QuickParseResult, RecurrenceRule, RecurrenceType } from '../types';
import { ApiService } from '../services/api';
import { calculateReminderTime } from '../utils/taskDateTime';
import {
  alignDueDateToRecurrence,
  formatRecurrenceLabel,
  normalizeRecurrenceRule,
} from '../utils/recurrence';
import { heuristicParseTask } from '../utils/quickParseHeuristic';
import {
  Sparkles,
  X,
  Calendar,
  Clock,
  Flag,
  Folder,
  Zap,
  UserRound,
  Repeat2,
} from 'lucide-react';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  users: User[];
  currentUser: User;
  onTaskCreated: () => void;
  standalone?: boolean;
}

const QUICK_SUGGESTIONS = [
  { label: '⏰ 明天下午3点开会', text: '明天下午3点召开架构评审会议，P1' },
  { label: '🔁 每周一上午9点周报', text: '每周一上午9点提交项目周报' },
  { label: '🚩 P1 生产缺陷修复', text: '紧急排查并修复生产环境同步异常，P1' },
  { label: '📦 本周五完成联调', text: '本周五下午5点前完成局域网联调交付' },
];

export const QuickAddModal: React.FC<QuickAddModalProps> = ({
  isOpen,
  onClose,
  projects,
  users,
  currentUser,
  onTaskCreated,
  standalone = false,
}) => {
  const [inputText, setInputText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [isAiParsed, setIsAiParsed] = useState(false);
  const [parsedPreview, setParsedPreview] = useState<QuickParseResult | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // Preload quick add window position for instant zero-latency drag start
  useEffect(() => {
    if (standalone && isTauri()) {
      ApiService.getQuickAddPosition()
        .then((pos) => {
          if (pos) lastPosRef.current = pos;
        })
        .catch(() => {});
    }
  }, [standalone]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || inputText.trim().length <= 2) {
      setParsing(false);
      setParsedPreview(null);
      return;
    }

    let cancelled = false;
    setParsing(true);

    const timeout = window.setTimeout(async () => {
      try {
        const result = await ApiService.quickParseTask(inputText.trim());
        if (!cancelled) {
          setParsedPreview(result);
          setIsAiParsed(true);
        }
      } catch {
        // Smooth heuristic fallback without jarring red error
        const fallback = heuristicParseTask(inputText.trim(), projects, users);
        if (!cancelled) {
          setParsedPreview(fallback);
          setIsAiParsed(false);
        }
      } finally {
        if (!cancelled) setParsing(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [inputText, isOpen, projects, users]);

  useEffect(() => {
    const content = contentRef.current;
    if (!standalone || !isOpen || !isTauri() || !content) return;

    const appWindow = getCurrentWindow();
    let lastHeight = 0;
    const resizeToContent = () => {
      const naturalHeight = content.scrollHeight;
      // Add safe buffer of 20px for outer margins/padding to prevent any button clipping
      const height = Math.min(560, Math.max(220, Math.ceil(naturalHeight) + 20));
      if (Math.abs(height - lastHeight) < 4) return;
      lastHeight = height;

      appWindow
        .setSize(new LogicalSize(700, height))
        .catch((error) => console.error('Failed to resize quick add window', error));
    };

    const observer = new ResizeObserver(resizeToContent);
    observer.observe(content);
    resizeToContent();
    return () => observer.disconnect();
  }, [standalone, isOpen, parsing, parsedPreview]);

  if (!isOpen) return null;

  const handleDragPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!standalone || event.button !== 0 || !isTauri()) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a, [data-no-drag]')) return;

    event.preventDefault();
    const currentTarget = event.currentTarget;
    const pointerId = event.pointerId;

    try {
      currentTarget.setPointerCapture(pointerId);
    } catch {
      // ignore
    }

    const startScreenX = event.screenX;
    const startScreenY = event.screenY;

    const startDragWithPos = (startPos: { x: number; y: number }) => {
      let rafId: number | null = null;
      let pendingPos: { x: number; y: number } | null = null;

      const onPointerMove = (moveEvt: PointerEvent) => {
        const dx = (moveEvt.screenX - startScreenX) * window.devicePixelRatio;
        const dy = (moveEvt.screenY - startScreenY) * window.devicePixelRatio;
        const nextX = Math.round(startPos.x + dx);
        const nextY = Math.round(startPos.y + dy);
        pendingPos = { x: nextX, y: nextY };
        lastPosRef.current = pendingPos;

        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            rafId = null;
            if (pendingPos) {
              void ApiService.setQuickAddPosition(pendingPos.x, pendingPos.y);
            }
          });
        }
      };

      const cleanup = () => {
        currentTarget.removeEventListener('pointermove', onPointerMove);
        currentTarget.removeEventListener('pointerup', onPointerUp);
        currentTarget.removeEventListener('pointercancel', onPointerUp);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        try {
          if (currentTarget.hasPointerCapture(pointerId)) {
            currentTarget.releasePointerCapture(pointerId);
          }
        } catch {
          // ignore
        }

        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (pendingPos) {
          void ApiService.setQuickAddPosition(pendingPos.x, pendingPos.y);
        }
      };

      const onPointerUp = () => {
        cleanup();
      };

      currentTarget.addEventListener('pointermove', onPointerMove);
      currentTarget.addEventListener('pointerup', onPointerUp);
      currentTarget.addEventListener('pointercancel', onPointerUp);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };

    if (lastPosRef.current) {
      startDragWithPos(lastPosRef.current);
    } else {
      void ApiService.getQuickAddPosition().then((pos) => {
        if (pos) {
          lastPosRef.current = pos;
          startDragWithPos(pos);
        }
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    let finalTitle = inputText;
    let finalDueDate: string | null = null;
    let finalReminderTime: string | null = null;
    let finalPriority: Priority = 'P3';
    let finalRecurrence: RecurrenceType = 'none';
    let finalRecurrenceRule: RecurrenceRule | null = null;
    let matchedProjectId: string | null = null;
    let matchedAssigneeId = currentUser.id;
    let finalTags: string[] = ['快捷录入'];

    const preview = parsedPreview || heuristicParseTask(inputText.trim(), projects, users);

    if (preview) {
      finalTitle = preview.title || inputText;
      finalDueDate = preview.dueDate;
      if (preview.reminderTime) {
        finalDueDate = preview.reminderTime;
        finalReminderTime = calculateReminderTime(finalDueDate, 0);
      }
      finalPriority = preview.priority;
      finalRecurrence = preview.recurrence &&
        ['daily', 'weekly', 'monthly', 'yearly'].includes(preview.recurrence)
        ? preview.recurrence
        : 'none';
      finalRecurrenceRule = normalizeRecurrenceRule(
        finalRecurrence,
        preview.recurrenceRule,
        finalDueDate
      );
      if (preview.projectName) {
        const pName = preview.projectName.trim().toLowerCase();
        const pMatch = projects.find((p) => {
          const candidate = p.name.toLowerCase();
          return candidate === pName || candidate.includes(pName) || pName.includes(candidate);
        });
        if (pMatch) matchedProjectId = pMatch.id;
      }
      if (preview.assigneeName) {
        const aName = preview.assigneeName.trim().toLowerCase();
        const uMatch = users.find((u) =>
          [u.nickname, u.username, u.id].some((v) => {
            const candidate = v.toLowerCase();
            return candidate === aName || candidate.includes(aName) || aName.includes(candidate);
          })
        );
        if (uMatch) matchedAssigneeId = uMatch.id;
      }
      if (preview.tags?.length) finalTags = preview.tags;
    }

    if (finalRecurrence !== 'none') {
      finalDueDate = alignDueDateToRecurrence(finalDueDate, finalRecurrence, finalRecurrenceRule);
      finalReminderTime = preview?.reminderTime
        ? calculateReminderTime(finalDueDate, 0)
        : null;
    }

    try {
      await ApiService.createTask(
        {
          title: finalTitle,
          description: `自然语言快速创建 (原始输入: "${inputText}")`,
          priority: finalPriority,
          status: 'todo',
          dueDate: finalDueDate,
          reminderTime: finalReminderTime,
          recurrence: finalRecurrence,
          recurrenceRule: finalRecurrenceRule,
          creatorId: currentUser.id,
          assigneeId: matchedAssigneeId,
          projectId: matchedProjectId,
          isShared: !!matchedProjectId,
          sharedWith: [],
          subtasks: [],
          tags: finalTags,
        },
        currentUser.id
      );

      onTaskCreated();
      setInputText('');
      setParsedPreview(null);
      onClose();
    } catch (err) {
      console.error('Failed to quick add task', err);
    }
  };

  return (
    <div
      className={`select-none ${
        standalone
          ? 'fixed inset-0 flex flex-col justify-start bg-transparent p-2'
          : 'fixed inset-0 z-50 flex items-start justify-center bg-canvas/75 p-4 pt-16 sm:pt-24 backdrop-blur-md'
      }`}
    >
      <div
        ref={contentRef}
        className={`w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150 rounded-2xl border ${
          standalone
            ? 'max-w-none shadow-none'
            : 'max-w-xl shadow-popover'
        }`}
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-main)',
          color: 'var(--text-main)',
          boxShadow: standalone
            ? 'none'
            : '0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px var(--border-subtle)',
        }}
      >
        {/* Header Bar */}
        <div
          onPointerDown={handleDragPointerDown}
          className="flex cursor-move items-center justify-between border-b pb-3 select-none"
          style={{ borderColor: 'var(--border-main)' }}
        >
          <div className="flex items-center space-x-2.5 pointer-events-none">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shadow-panel transition-transform"
              style={{
                background: 'var(--accent-gradient)',
                boxShadow: '0 2px 10px var(--accent-glow)',
              }}
            >
              <Zap className="w-3.5 h-3.5 text-main" />
            </div>
            <div>
              <h2
                className="text-xs font-bold flex items-center gap-1.5"
                style={{ color: 'var(--text-main)' }}
              >
                快捷创建任务
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.2 text-[10px] font-medium"
                  style={{
                    backgroundColor: 'var(--accent-subtle)',
                    borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
                    color: 'var(--accent)',
                  }}
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  自然语言速记
                </span>
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!standalone && (
              <kbd className="hidden sm:inline text-[9px] font-mono bg-card/80 text-sub px-1.5 py-0.5 rounded border border-subtle/60">
                Esc
              </kbd>
            )}
            <button
              type="button"
              data-no-drag
              onClick={onClose}
              className="p-1 rounded-lg transition-colors hover:bg-hover"
              style={{ color: 'var(--text-sub)' }}
              title="关闭窗口"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Input & Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="relative group">
            <textarea
              ref={textareaRef}
              autoFocus
              rows={2}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="如：明天下午3点和李四讨论项目架构，P1 紧急"
              className="quick-add-textarea w-full rounded-xl px-4 py-3 text-sm resize-none shadow-inner transition-all focus:outline-none"
            />
            {inputText && (
              <button
                type="button"
                onClick={() => {
                  setInputText('');
                  setParsedPreview(null);
                  textareaRef.current?.focus();
                }}
                className="absolute right-3 top-3 p-1 rounded-md transition-colors hover:opacity-80"
                style={{ color: 'var(--text-sub)' }}
                title="清空输入"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Suggestions (Shown only when input is empty and NOT standalone) */}
          {!standalone && !inputText && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium flex items-center gap-1" style={{ color: 'var(--text-sub)' }}>
                <Sparkles className="w-3 h-3 text-warning" />
                <span>快捷灵感模版（点击自动填入）：</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_SUGGESTIONS.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setInputText(s.text)}
                    className="text-[11px] bg-card/80 hover:bg-hover text-sub hover:text-main px-2.5 py-1 rounded-lg border border-subtle/60 hover:border-subtle transition-all active:scale-95 text-left"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Parsing Spinner */}
          {parsing && (
            <div className="text-xs text-sub flex items-center space-x-2 animate-pulse py-0.5">
              <Sparkles className="w-3.5 h-3.5 text-warning" />
              <span>正在智能提取任务时间、责任人与优先级...</span>
            </div>
          )}

          {/* Parsed Preview Card */}
          {parsedPreview && !parsing && (
            <div className="theme-glow-card rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between font-semibold text-[11px]">
                <span className="flex items-center gap-1.5 text-sub">
                  <Sparkles className="w-3.5 h-3.5 text-warning" />
                  <span>智能解析预判</span>
                </span>
                <span className="text-[10px] bg-blue-500/15 text-info border border-blue-500/25 px-2 py-0.5 rounded-full font-medium">
                  {isAiParsed ? '✨ AI 语义分析' : '⚡ 智能规则速记'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-main pt-0.5">
                <span className="font-semibold text-main text-xs bg-card/80 px-2 py-0.5 rounded-md border border-subtle/60">
                  {parsedPreview.title || '（未命名任务）'}
                </span>

                {parsedPreview.dueDate && (
                  <span className="flex items-center gap-1 bg-blue-500/10 text-info border border-blue-500/20 px-2 py-0.5 rounded-md text-[11px] font-mono">
                    <Calendar className="w-3 h-3" />
                    <span>{parsedPreview.dueDate}</span>
                  </span>
                )}

                {parsedPreview.reminderTime && (
                  <span className="flex items-center gap-1 bg-cyan-500/10 text-info border border-cyan-500/20 px-2 py-0.5 rounded-md text-[11px] font-mono">
                    <Clock className="w-3 h-3" />
                    <span>{parsedPreview.reminderTime}</span>
                  </span>
                )}

                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                    parsedPreview.priority === 'P1'
                      ? 'bg-rose-500/15 text-danger border-rose-500/30'
                      : parsedPreview.priority === 'P2'
                      ? 'bg-amber-500/15 text-warning border-amber-500/30'
                      : parsedPreview.priority === 'P4'
                      ? 'bg-card text-sub border-subtle/70'
                      : 'bg-blue-500/15 text-info border-blue-500/30'
                  }`}
                >
                  <Flag className="w-3 h-3 inline mr-1" />
                  {parsedPreview.priority}
                </span>

                {parsedPreview.projectName && (
                  <span className="flex items-center gap-1 bg-purple-500/10 text-feature border border-purple-500/20 px-2 py-0.5 rounded-md text-[11px]">
                    <Folder className="w-3 h-3" />
                    <span>{parsedPreview.projectName}</span>
                  </span>
                )}

                {parsedPreview.assigneeName && (
                  <span className="flex items-center gap-1 bg-emerald-500/10 text-success border border-emerald-500/20 px-2 py-0.5 rounded-md text-[11px]">
                    <UserRound className="w-3 h-3" />
                    <span>{parsedPreview.assigneeName}</span>
                  </span>
                )}

                {parsedPreview.recurrence && parsedPreview.recurrence !== 'none' && (
                  <span className="flex items-center gap-1 bg-amber-500/10 text-warning border border-amber-500/20 px-2 py-0.5 rounded-md text-[11px]">
                    <Repeat2 className="w-3 h-3" />
                    <span>
                      {formatRecurrenceLabel(
                        parsedPreview.recurrence,
                        parsedPreview.recurrenceRule,
                        parsedPreview.reminderTime || parsedPreview.dueDate
                      )}
                    </span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons Footer */}
          <div
            className="flex items-center justify-between pt-2.5 border-t"
            style={{ borderColor: 'var(--border-main)' }}
          >
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-sub)' }}>
              <kbd
                className="font-mono text-[10px] px-1.5 py-0.5 rounded border"
                style={{
                  backgroundColor: 'var(--bg-hover)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-main)',
                }}
              >
                Enter ↵
              </kbd>
              <span>立即创建</span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="ui-cancel-button px-3.5 py-1.5 text-xs rounded-lg font-medium"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="theme-btn-primary px-4 py-1.5 text-xs font-bold"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>创建任务</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
