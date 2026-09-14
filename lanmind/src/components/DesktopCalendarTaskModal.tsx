/**
 * DesktopCalendarTaskModal — AI-Assisted Quick Task Creation for Desktop Calendar
 *
 * CALLING SPEC:
 *   <DesktopCalendarTaskModal
 *     isOpen={boolean}
 *     dateStr="YYYY-MM-DD"
 *     currentUser={User}
 *     projects={Project[]}
 *     users={User[]}
 *     onClose={() => ...}
 *     onTaskCreated={(task: Task) => ...}
 *     onOpenFullForm={(dateStr: string) => ...}
 *     showLunar={boolean}
 *   />
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  X,
  Calendar as CalendarIcon,
  Clock,
  Flag,
  Folder,
  Zap,
  Repeat2,
  Check,
  Maximize2,
  Loader2,
  UserRound,
  Tag,
} from 'lucide-react';
import { Priority, Project, QuickParseResult, RecurrenceRule, RecurrenceType, Task, User } from '../types';
import { ApiService } from '../services/api';
import { getLunarDateInfo } from '../utils/lunar';
import { heuristicParseTask } from '../utils/quickParseHeuristic';
import { calculateReminderTime } from '../utils/taskDateTime';
import { alignDueDateToRecurrence, normalizeRecurrenceRule } from '../utils/recurrence';

export interface DesktopCalendarTaskModalProps {
  isOpen: boolean;
  dateStr: string;
  currentUser: User | null;
  projects?: Project[];
  users?: User[];
  onClose: () => void;
  onTaskCreated: (task: Task) => void;
  onOpenFullForm: (dateStr: string) => void;
  showLunar?: boolean;
}

function extractParsedTime(preview: QuickParseResult | null): string | null {
  if (!preview) return null;
  if (preview.reminderTime && preview.reminderTime.includes('T')) {
    const timePart = preview.reminderTime.split('T')[1]?.slice(0, 5);
    if (/^\d{2}:\d{2}$/.test(timePart)) return timePart;
  }
  if (preview.dueDate && preview.dueDate.includes('T')) {
    const timePart = preview.dueDate.split('T')[1]?.slice(0, 5);
    if (/^\d{2}:\d{2}$/.test(timePart)) return timePart;
  }
  if (preview.recurrenceRule?.timeOfDay) {
    const timePart = preview.recurrenceRule.timeOfDay.slice(0, 5);
    if (/^\d{2}:\d{2}$/.test(timePart)) return timePart;
  }
  return null;
}

export const DesktopCalendarTaskModal: React.FC<DesktopCalendarTaskModalProps> = ({
  isOpen,
  dateStr,
  currentUser,
  projects = [],
  users = [],
  onClose,
  onTaskCreated,
  onOpenFullForm,
  showLunar = true,
}) => {
  const [inputText, setInputText] = useState('');
  const [priority, setPriority] = useState<Priority>('P3');
  const [parsing, setParsing] = useState(false);
  const [isAiParsed, setIsAiParsed] = useState(false);
  const [parsedPreview, setParsedPreview] = useState<QuickParseResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Manage native Windows interactive mode & focus
  useEffect(() => {
    if (!isOpen) return;

    // Allow the calendar window to receive keyboard focus while editing
    void ApiService.setDesktopCalendarInteractiveMode(true);

    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 60);

    return () => {
      clearTimeout(timer);
      void ApiService.setDesktopCalendarInteractiveMode(false);
    };
  }, [isOpen]);

  // Reset state whenever opened for a new date
  useEffect(() => {
    if (isOpen) {
      setInputText('');
      setPriority('P3');
      setParsing(false);
      setIsAiParsed(false);
      setParsedPreview(null);
      setIsSaving(false);
    }
  }, [isOpen, dateStr]);

  // AI & Heuristic natural language parsing
  useEffect(() => {
    if (!isOpen || inputText.trim().length <= 2) {
      setParsing(false);
      setParsedPreview(null);
      setIsAiParsed(false);
      return;
    }

    let cancelled = false;
    setParsing(true);

    const timeout = setTimeout(async () => {
      try {
        const result = await ApiService.quickParseTask(inputText.trim());
        if (!cancelled) {
          setParsedPreview(result);
          setIsAiParsed(true);
          if (result.priority) {
            setPriority(result.priority);
          }
        }
      } catch {
        const fallback = heuristicParseTask(inputText.trim(), projects, users);
        if (!cancelled) {
          setParsedPreview(fallback);
          setIsAiParsed(false);
          if (fallback.priority) {
            setPriority(fallback.priority);
          }
        }
      } finally {
        if (!cancelled) setParsing(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [inputText, isOpen, projects, users]);

  // Handle ESC shortcut
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const lunarInfo = showLunar ? getLunarDateInfo(dateStr) : null;

  // Resolve target due date string (YYYY-MM-DDTHH:mm:00)
  const resolveDueDate = (): string => {
    let targetDate = dateStr;
    const parsedTime = extractParsedTime(parsedPreview);
    if (parsedPreview?.dueDate) {
      const datePart = parsedPreview.dueDate.includes('T')
        ? parsedPreview.dueDate.split('T')[0]
        : parsedPreview.dueDate;
      if (/明天|后天|大后天|下周|月|号|日/.test(inputText)) {
        targetDate = datePart;
      }
    }
    const timePart = parsedTime ? `${parsedTime}:00` : '18:00:00';
    return `${targetDate}T${timePart}`;
  };

  const handleSave = async () => {
    if (!inputText.trim() || !currentUser || isSaving) return;

    setIsSaving(true);
    try {
      const preview = parsedPreview || heuristicParseTask(inputText.trim(), projects, users);

      const finalTitle = preview?.title?.trim() || inputText.trim();
      let finalDueDate: string | null = resolveDueDate();
      let finalReminderTime: string | null = null;
      const finalPriority = preview?.priority || priority;
      let finalRecurrence: RecurrenceType = 'none';
      let finalRecurrenceRule: RecurrenceRule | null = null;
      let matchedProjectId: string | null = null;
      let matchedAssigneeId = currentUser.id;
      let finalTags: string[] = ['桌面日历'];

      if (preview) {
        if (preview.reminderTime) {
          finalReminderTime = calculateReminderTime(finalDueDate, 0);
        }
        finalRecurrence =
          preview.recurrence && ['daily', 'weekly', 'monthly', 'yearly'].includes(preview.recurrence)
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
        if (preview.tags?.length) {
          finalTags = Array.from(new Set([...finalTags, ...preview.tags]));
        }
      }

      if (finalRecurrence !== 'none') {
        finalDueDate = alignDueDateToRecurrence(finalDueDate, finalRecurrence, finalRecurrenceRule);
        finalReminderTime = preview?.reminderTime ? calculateReminderTime(finalDueDate, 0) : null;
      }

      const created = await ApiService.createTask(
        {
          title: finalTitle,
          description: `从桌面日历快速创建 (日期: ${dateStr})`,
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

      onTaskCreated(created);
      onClose();
    } catch (err) {
      console.error('Failed to create task from desktop calendar modal', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSave();
    }
  };

  const handleOpenFull = () => {
    onOpenFullForm(dateStr);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-subtle/80 bg-surface/95 p-5 shadow-popover space-y-4 text-main animate-in zoom-in-95 duration-150 backdrop-blur-xl"
        style={{
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-edge pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 shadow-panel shadow-blue-500/20">
              <Zap className="w-3.5 h-3.5 text-main" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold text-main">创建待办任务</h2>
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-info">
                  <CalendarIcon className="w-2.5 h-2.5" />
                  {dateStr}
                  {lunarInfo && <span className="text-sub font-normal ml-0.5">({lunarInfo.fullText})</span>}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {parsing ? (
              <span className="flex items-center gap-1 text-[10px] text-info font-medium animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin" />
                正在智能分析...
              </span>
            ) : isAiParsed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-feature">
                <Sparkles className="w-2.5 h-2.5" />
                AI 智能识别
              </span>
            ) : parsedPreview ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-subtle bg-card px-2 py-0.5 text-[10px] font-medium text-sub">
                ⚡ 规则解析
              </span>
            ) : null}

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-sub hover:text-main hover:bg-hover transition-colors"
              title="退出 (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Input Area */}
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="输入任务内容，例如：下午3点开会，P1，每两周一次..."
            className="w-full resize-none rounded-xl border border-subtle bg-canvas/80 p-3 text-xs text-main placeholder-quiet shadow-inner focus:border-accent/50 focus:outline-none leading-relaxed transition-all"
          />
        </div>

        {/* AI & Heuristic Parsed Preview Card */}
        {parsedPreview && !parsing && (
          <div className="rounded-xl border border-blue-500/30 bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-canvas/40 p-3 space-y-2 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
            <div className="flex items-center justify-between font-semibold text-[11px]">
              <span className="flex items-center gap-1.5 text-sub">
                <Sparkles className="w-3.5 h-3.5 text-warning" />
                <span>智能解析结果</span>
              </span>
              <span className="text-[10px] bg-blue-500/20 text-info border border-blue-500/30 px-2 py-0.5 rounded-full font-medium">
                {isAiParsed ? '✨ AI 语义分析' : '⚡ 规则速记'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {/* Parsed Clean Title */}
              <span className="font-semibold text-main text-xs bg-card/90 px-2 py-0.5 rounded-md border border-subtle/80">
                {parsedPreview.title || inputText.trim()}
              </span>

              {/* Parsed Time */}
              {extractParsedTime(parsedPreview) && (
                <span className="flex items-center gap-1 bg-cyan-500/15 text-info border border-cyan-500/30 px-2 py-0.5 rounded-md text-[11px] font-mono">
                  <Clock className="w-3 h-3" />
                  <span>{extractParsedTime(parsedPreview)}</span>
                </span>
              )}

              {/* Priority */}
              {parsedPreview.priority && (
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
              )}

              {/* Project */}
              {parsedPreview.projectName && (
                <span className="flex items-center gap-1 bg-purple-500/15 text-feature border border-purple-500/30 px-2 py-0.5 rounded-md text-[11px]">
                  <Folder className="w-3 h-3" />
                  <span>{parsedPreview.projectName}</span>
                </span>
              )}

              {/* Assignee */}
              {parsedPreview.assigneeName && (
                <span className="flex items-center gap-1 bg-emerald-500/15 text-success border border-emerald-500/30 px-2 py-0.5 rounded-md text-[11px]">
                  <UserRound className="w-3 h-3" />
                  <span>{parsedPreview.assigneeName}</span>
                </span>
              )}

              {/* Recurrence */}
              {parsedPreview.recurrence && parsedPreview.recurrence !== 'none' && (
                <span className="flex items-center gap-1 bg-indigo-500/15 text-feature border border-indigo-500/30 px-2 py-0.5 rounded-md text-[11px]">
                  <Repeat2 className="w-3 h-3" />
                  <span>
                    {parsedPreview.recurrence === 'daily'
                      ? '每天'
                      : parsedPreview.recurrence === 'weekly'
                      ? '每周'
                      : parsedPreview.recurrence === 'monthly'
                      ? '每月'
                      : '循环'}
                  </span>
                </span>
              )}

              {/* Tags */}
              {parsedPreview.tags?.map((tag) => (
                <span key={tag} className="flex items-center gap-1 bg-card/80 text-sub border border-subtle px-1.5 py-0.5 rounded-md text-[10px]">
                  <Tag className="w-2.5 h-2.5 text-sub" />
                  <span>{tag}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={handleOpenFull}
            className="flex items-center gap-1.5 rounded-xl border border-subtle bg-card/80 px-3 py-1.5 text-xs font-semibold text-main hover:bg-hover hover:text-main transition-all shadow-soft"
          >
            <Maximize2 className="w-3.5 h-3.5 text-info" />
            <span>打开完整创建表单</span>
          </button>

          <div className="flex items-center gap-3">
            <span className="text-[10px] text-quiet hidden sm:block font-mono">
              Enter 保存 · Esc 退出
            </span>

            <button
              type="button"
              onClick={onClose}
              className="ui-cancel-button rounded-xl px-3.5 py-1.5 text-xs font-medium"
            >
              取消
            </button>

            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!inputText.trim() || isSaving}
              className="theme-btn-primary flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold shadow-panel"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>保存待办</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
