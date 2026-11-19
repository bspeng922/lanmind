import { getWorkspaceContext, sameWorkspace } from '../utils/workspaceContext';
/**
 * SettingsExportPanel — Dedicated System Settings Export Panel.
 *
 * CALLING SPEC:
 *   <SettingsExportPanel
 *     projects={Project[]}
 *     users={User[]}
 *     currentUserId: string
 *     currentUser: User | null
 *   />
 *
 * Provides:
 * - Project scope dropdown ('All projects' or specific project)
 * - Format selector ('CSV' / 'JSON')
 * - Filter chips (Assignee, Priority, State) with 'Clear all'
 * - Export trigger generating CSV / JSON file download
 * - Recent export metadata stored in the desktop database
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  RotateCcw,
  Filter,
  FileSpreadsheet,
  FileCode,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  Calendar,
} from 'lucide-react';
import { Project, User, Priority, Task } from '../types';
import { ApiService, type TaskExportHistoryEntry, type TaskExportScope } from '../services/api';
import { localizedError, tr, useLocale } from '../i18n';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

interface SettingsExportPanelProps {
  projects: Project[];
  users: User[];
  currentUserId: string;
}

export const SettingsExportPanel: React.FC<SettingsExportPanelProps> = ({
  projects,
  users,
  currentUserId,
}) => {
  const { locale } = useLocale();

  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [selectedFormat, setSelectedFormat] = useState<'CSV' | 'JSON'>('CSV');

  // Filters
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterState, setFilterState] = useState<string>('all');

  const [isExporting, setIsExporting] = useState(false);
  const exporting = useRef(false);
  const [exportMessage, setExportMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);

  const [exportHistory, setExportHistory] = useState<TaskExportHistoryEntry[]>([]);
  const historyRequest = useRef(0);
  const loadHistory = useCallback(async () => {
    const scope = getWorkspaceContext();
    if (!isTauri() || !scope || scope.userId !== currentUserId) return;
    const request = ++historyRequest.current;
    try {
      const entries = await ApiService.listTaskExportHistory(scope);
      if (request !== historyRequest.current || !sameWorkspace(scope)) return;
      setExportHistory(entries);
      setHistoryWarning(null);
    } catch {
      if (request !== historyRequest.current || !sameWorkspace(scope)) return;
      setHistoryWarning(tr('settings:exportSettings.historyReadFailed'));
    }
  }, [currentUserId]);
  useEffect(() => {
    setExportHistory([]);
    setHistoryWarning(null);
    void loadHistory();
    return () => { historyRequest.current++; };
  }, [loadHistory]);

  const clearFilters = () => {
    setFilterAssignee('all');
    setFilterPriority('all');
    setFilterState('all');
  };

  const hasActiveFilters =
    filterAssignee !== 'all' || filterPriority !== 'all' || filterState !== 'all';

  // Dropdown options
  const projectOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: 'all', label: tr('settings:exportSettings.allProjects') },
      { value: 'personal', label: tr('settings:exportSettings.personalTasks') || '👤 个人任务 (无所属项目)', tone: 'amber' as const },
      ...projects.map((p) => ({
        value: p.id,
        label: `💼 ${p.name} (${p.identifier || 'PRJ'})`,
        tone: 'blue' as const,
      })),
    ],
    [projects]
  );

  const formatOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: 'CSV', label: tr('settings:exportSettings.formatCsv') },
      { value: 'JSON', label: tr('settings:exportSettings.formatJson') },
    ],
    []
  );

  const assigneeOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: 'all', label: tr('settings:exportSettings.all') },
      ...users.map((u) => ({
        value: u.id,
        label: u.nickname || u.username,
      })),
    ],
    [users]
  );

  const priorityOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: 'all', label: tr('settings:exportSettings.all') },
      { value: 'P1', label: tr('settings:exportSettings.priorityUrgent') },
      { value: 'P2', label: tr('settings:exportSettings.priorityHigh') },
      { value: 'P3', label: tr('settings:exportSettings.priorityMedium') },
      { value: 'P4', label: tr('settings:exportSettings.priorityLow') },
    ],
    []
  );

  const stateOptions: ThemeSelectOption[] = useMemo(
    () => [
      { value: 'all', label: tr('settings:exportSettings.all') },
      { value: 'uncompleted', label: tr('settings:exportSettings.stateUncompleted') },
      { value: 'completed', label: tr('settings:exportSettings.stateCompleted') },
    ],
    []
  );

  const handleExport = async () => {
    if (exporting.current) return;
    const workspace = getWorkspaceContext();
    if (!workspace || !isTauri() || workspace.userId !== currentUserId) {
      setExportMessage({ text: tr('common:api.taskExportIsOnlyAvailableInThe'), type: 'error' });
      return;
    }
    exporting.current = true;
    setIsExporting(true);
    setExportMessage(null);

    try {
      const allTasks: Task[] = await ApiService.getTasks(currentUserId);
      if (!sameWorkspace(workspace)) return;

      // Filter tasks
      const matchingTasks = allTasks.filter((t) => {
        if (selectedProjectId === 'personal') {
          if (t.projectId) return false;
        } else if (selectedProjectId !== 'all' && t.projectId !== selectedProjectId) {
          return false;
        }
        if (filterAssignee !== 'all' && t.assigneeId !== filterAssignee) return false;
        if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
        const isDone = t.status === 'completed' || t.stateGroup === 'completed';
        if (filterState !== 'all') {
          if (filterState === 'completed' && !isDone) return false;
          if (filterState === 'uncompleted' && isDone) return false;
        }
        return true;
      });

      const projectName =
        selectedProjectId === 'all'
          ? tr('settings:exportSettings.allProjects')
          : selectedProjectId === 'personal'
            ? tr('settings:exportSettings.personalTasks') || '个人任务'
            : projects.find((p) => p.id === selectedProjectId)?.name || 'Project';

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      let fileContent = '';
      const extension = selectedFormat.toLowerCase();
      if (selectedFormat === 'CSV') {
        const headers = ['ID', 'Title', 'Description', 'Priority', 'DueDate', 'StateGroup', 'Status', 'AssigneeId', 'ProjectId'];
        const csvRows = matchingTasks.map((t) => [
          `"${t.id}"`,
          `"${(t.title || '').replace(/"/g, '""')}"`,
          `"${(t.description || '').replace(/"/g, '""')}"`,
          `"${t.priority}"`,
          `"${t.dueDate || ''}"`,
          `"${t.stateGroup || ''}"`,
          `"${t.status || ''}"`,
          `"${t.assigneeId}"`,
          `"${t.projectId || ''}"`,
        ]);
        fileContent = [headers.join(','), ...csvRows.map((r) => r.join(','))].join('\n');
      } else {
        fileContent = JSON.stringify(
          {
            version: '2.0',
            exportedAt: new Date().toISOString(),
            projectName,
            tasks: matchingTasks,
          },
          null,
          2
        );
      }

      const path = await save({
        title: tr('settings:exportSettings.title'),
        defaultPath: `lanmind_export_${timestamp}.${extension}`,
        filters: [{ name: selectedFormat, extensions: [extension] }],
      });
      if (!path || !sameWorkspace(workspace)) return;
      const scope: TaskExportScope = selectedProjectId === 'all' || selectedProjectId === 'personal'
        ? { kind: selectedProjectId }
        : { kind: 'project', id: selectedProjectId };
      const history = await ApiService.saveTaskExport(workspace, path, fileContent, scope, selectedFormat, matchingTasks.length);
      if (!sameWorkspace(workspace)) return;
      historyRequest.current++;
      if (history) setExportHistory(history);
      setHistoryWarning(history ? null : tr('settings:exportSettings.historyWriteFailed'));
      setExportMessage({
        text: tr('settings:exportSettings.exportSuccess', {
          count: matchingTasks.length,
          format: selectedFormat,
        }),
        type: 'success',
      });
    } catch (error) {
      if (sameWorkspace(workspace)) setExportMessage({
        text: localizedError(error).message || tr('settings:exportSettings.exportFailed'),
        type: 'error',
      });
    } finally {
      exporting.current = false;
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-7 w-full animate-in fade-in duration-200">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-main">{tr('settings:exportSettings.title')}</h2>
        <p className="text-xs text-sub mt-1">{tr('settings:exportSettings.description')}</p>
      </div>

      {exportMessage && (
        <div
          role={exportMessage.type === 'error' ? 'alert' : 'status'}
          className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${
            exportMessage.type === 'success'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-danger/30 bg-danger/10 text-danger'
          }`}
        >
          {exportMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{exportMessage.text}</span>
        </div>
      )}

      {/* Export Configuration Form Card */}
      <div className="rounded-2xl border border-edge bg-surface p-6 shadow-soft space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Exporting Project Dropdown */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-sub">
              {tr('settings:exportSettings.exportingProject')}
            </label>
            <ThemeSelect
              portal
              ariaLabel={tr('settings:exportSettings.exportingProject')}
              value={selectedProjectId}
              options={projectOptions}
              onChange={(val) => setSelectedProjectId(val)}
            />
          </div>

          {/* Format Selector Dropdown */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-sub">
              {tr('settings:exportSettings.format')}
            </label>
            <ThemeSelect
              portal
              ariaLabel={tr('settings:exportSettings.format')}
              value={selectedFormat}
              options={formatOptions}
              onChange={(val) => setSelectedFormat(val as 'CSV' | 'JSON')}
            />
          </div>
        </div>

        {/* Filters Row */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-sub flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-accent" />
              <span>{tr('settings:exportSettings.filters')}</span>
            </label>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[11px] text-accent hover:underline flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                <span>{tr('settings:exportSettings.clearAll')}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Assignee Filter */}
            <div>
              <label className="mb-1 block text-[11px] text-quiet">
                {tr('settings:exportSettings.filterAssignee')}
              </label>
              <ThemeSelect
                portal
                ariaLabel={tr('settings:exportSettings.filterAssignee')}
                value={filterAssignee}
                options={assigneeOptions}
                onChange={(val) => setFilterAssignee(val)}
              />
            </div>

            {/* Priority Filter */}
            <div>
              <label className="mb-1 block text-[11px] text-quiet">
                {tr('settings:exportSettings.filterPriority')}
              </label>
              <ThemeSelect
                portal
                ariaLabel={tr('settings:exportSettings.filterPriority')}
                value={filterPriority}
                options={priorityOptions}
                onChange={(val) => setFilterPriority(val)}
              />
            </div>

            {/* State Filter */}
            <div>
              <label className="mb-1 block text-[11px] text-quiet">
                {tr('settings:exportSettings.filterState')}
              </label>
              <ThemeSelect
                portal
                ariaLabel={tr('settings:exportSettings.filterState')}
                value={filterState}
                options={stateOptions}
                onChange={(val) => setFilterState(val)}
              />
            </div>
          </div>
        </div>

        {/* Action Button Row */}
        <div className="pt-3 border-t border-edge flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
          <button
            type="button"
            disabled={isExporting}
            onClick={handleExport}
            className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-on-accent hover:bg-accent/90 disabled:opacity-50 transition-colors shadow-soft"
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 motion-safe:animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>
              {isExporting
                ? tr('settings:exportSettings.exporting')
                : tr('settings:exportSettings.exportBtn')}
            </span>
          </button>
        </div>
      </div>

      {/* Audit Logs Table */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-main">
              {tr('settings:exportSettings.historyTitle')}
            </h3>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="text-quiet hover:text-main p-1 transition-colors"
              title={tr('settings:exportSettings.refreshHistory')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div role="status" className={historyWarning ? 'text-xs text-danger' : undefined}>{historyWarning}</div>
        <div className="rounded-2xl border border-edge overflow-x-auto bg-surface">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="border-b border-edge bg-canvas/60 text-quiet font-semibold">
              <tr>
                <th className="py-2.5 px-4 whitespace-nowrap">{tr('settings:exportSettings.exportedBy')}</th>
                <th className="py-2.5 px-4 whitespace-nowrap">{tr('settings:exportSettings.exportedOn')}</th>
                <th className="py-2.5 px-4 whitespace-nowrap">{tr('settings:exportSettings.project')}</th>
                <th className="py-2.5 px-4 whitespace-nowrap">{tr('settings:exportSettings.format')}</th>
                <th className="py-2.5 px-4 whitespace-nowrap">{tr('settings:exportSettings.taskCount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {exportHistory.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-quiet italic">
                    {tr('settings:exportSettings.noHistory')}
                  </td>
                </tr>
              ) : (
                exportHistory.map((item) => (
                  <tr key={item.id} className="hover:bg-hover/40 transition-colors">
                    <td className="py-3 px-4 font-semibold text-main whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">
                          {item.exportedBy.slice(0, 1).toUpperCase()}
                        </div>
                        <span>{item.exportedBy}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-quiet text-[11px] font-mono whitespace-nowrap">{new Date(item.exportedOn).toLocaleString(locale)}</td>
                    <td className="py-3 px-4 text-sub whitespace-nowrap">
                      {item.scope.kind === 'project' ? item.projectName : item.scope.kind === 'personal'
                        ? tr('settings:exportSettings.personalTasks') : tr('settings:exportSettings.allProjects')}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-mono text-[11px] text-sub">{item.format}</span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap tabular-nums">{item.taskCount.toLocaleString(locale)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
