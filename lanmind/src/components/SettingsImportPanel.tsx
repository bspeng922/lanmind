import { scopedStorageKey } from "../utils/workspaceContext";
/**
 * SettingsImportPanel — Dedicated System Settings Import Panel.
 *
 * CALLING SPEC:
 *   <SettingsImportPanel
 *     projects={Project[]}
 *     currentUserId: string
 *     onImportFinished: () => Promise<void> | void
 *   />
 *
 * Provides:
 * - Multi-source card selection (CSV, JSON only)
 * - Native sample template downloads (CSV / JSON)
 * - Dedicated popup wizard modal for importing into target project
 * - Migration logs history table stored in localStorage
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  FileSpreadsheet,
  Upload,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Download,
  RotateCcw,
  Clock,
  Layers,
  ChevronRight,
  Loader2,
  X,
  FileCode,
  Sparkles,
  FolderKanban,
  Check,
} from 'lucide-react';
import { Project, Priority } from '../types';
import { ApiService, TASKS_CHANGED_EVENT } from '../services/api';
import { tr, useLocale } from '../i18n';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import {
  MigrationLog,
  IMPORT_HISTORY_STORAGE_KEY,
  SAMPLE_CSV_CONTENT,
  SAMPLE_JSON_CONTENT,
  parseCSVRows,
} from './settings/importUtils';

export type { MigrationLog };

interface SettingsImportPanelProps {
  projects: Project[];
  currentUserId: string;
  onImportFinished: () => Promise<void> | void;
}

export const SettingsImportPanel: React.FC<SettingsImportPanelProps> = ({
  projects,
  currentUserId,
  onImportFinished,
}) => {
  useLocale();

  // Wizard Modal state
  const [activeImporter, setActiveImporter] = useState<'CSV' | 'JSON' | null>(null);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('personal');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ count: number } | null>(null);

  // Migration History
  const [migrations, setMigrations] = useState<MigrationLog[]>(() => {
    try {
      const stored = localStorage.getItem(scopedStorageKey(IMPORT_HISTORY_STORAGE_KEY));
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const saveMigrationLog = (log: MigrationLog) => {
    setMigrations((prev) => {
      const next = [log, ...prev].slice(0, 50);
      try {
        localStorage.setItem(scopedStorageKey(IMPORT_HISTORY_STORAGE_KEY), JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const projectSelectOptions: ThemeSelectOption[] = useMemo(
    () => [
      {
        value: 'personal',
        label: tr('settings:importSettings.personalTasks') || '👤 个人任务 (无所属项目)',
        tone: 'amber' as const,
      },
      ...projects.map((p) => ({
        value: p.id,
        label: `💼 ${p.name} (${p.identifier || 'PRJ'})`,
        tone: 'blue' as const,
      })),
    ],
    [projects]
  );

  const isPersonal = selectedProjectId === 'personal' || !selectedProjectId;
  const selectedProject = useMemo(
    () => (isPersonal ? null : projects.find((p) => p.id === selectedProjectId)),
    [isPersonal, projects, selectedProjectId]
  );

  const saveFile = async (
    filename: string,
    content: string,
    mimeType: string,
    dialogTitle?: string
  ): Promise<boolean> => {
    if (isTauri()) {
      const ext = filename.split('.').pop() || 'txt';
      const selected = await save({
        title: dialogTitle || tr('settings:importSettings.downloadTemplate'),
        defaultPath: filename,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!selected) {
        return false;
      }
      await ApiService.saveTextFile(selected, content);
      return true;
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  };

  const handleDownloadSample = async (type: 'CSV' | 'JSON') => {
    const filename = type === 'CSV' ? 'lanmind_sample_tasks.csv' : 'lanmind_sample_tasks.json';
    const content = type === 'CSV' ? SAMPLE_CSV_CONTENT : SAMPLE_JSON_CONTENT;
    const mime = type === 'CSV' ? 'text/csv;charset=utf-8;' : 'application/json;charset=utf-8;';
    await saveFile(filename, content, mime, tr('settings:importSettings.downloadTemplate'));
  };

  const handleResetWizard = () => {
    setActiveImporter(null);
    setWizardStep(1);
    setUploadedFile(null);
    setIsImporting(false);
    setImportError(null);
    setImportResult(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedFile(e.target.files[0]);
      setImportError(null);
    }
  };

  const handleExecuteImport = async () => {
    if (!activeImporter || !uploadedFile) {
      setImportError(tr('settings:importSettings.uploadFileFirst'));
      return;
    }

    setIsImporting(true);
    setImportError(null);

    const startTime = new Date().toLocaleString();
    const isPersonal = selectedProjectId === 'personal' || !selectedProjectId;
    const targetProject = isPersonal ? null : projects.find((p) => p.id === selectedProjectId);
    const projectName = isPersonal
      ? tr('settings:importSettings.personalTasks') || '个人任务'
      : (targetProject ? targetProject.name : 'Unknown');

    try {
      const fileText = await uploadedFile.text();
      let parsedTasks: any[] = [];

      if (activeImporter === 'CSV') {
        parsedTasks = parseCSVRows(fileText);
      } else {
        const rawJson = JSON.parse(fileText.replace(/^\uFEFF/, ''));
        if (Array.isArray(rawJson)) {
          parsedTasks = rawJson;
        } else if (rawJson && Array.isArray(rawJson.tasks)) {
          parsedTasks = rawJson.tasks;
        } else if (rawJson && Array.isArray(rawJson.data)) {
          parsedTasks = rawJson.data;
        } else {
          parsedTasks = [];
        }
      }

      if (parsedTasks.length === 0) {
        throw new Error(tr('settings:importSettings.noValidTasksInFile'));
      }

      // Create each task
      for (const item of parsedTasks) {
        await ApiService.createTask(
          {
            title: item.title || 'Untitled imported task',
            description: item.description || '',
            priority: (item.priority as Priority) || 'P2',
            status: item.status || (item.stateGroup === 'completed' ? 'completed' : 'todo'),
            stateGroup: item.stateGroup || 'unstarted',
            dueDate: item.dueDate || undefined,
            projectId: isPersonal ? undefined : selectedProjectId,
            creatorId: currentUserId,
            assigneeId: currentUserId,
            subtasks: item.subtasks || [],
            isShared: !isPersonal,
            sharedWith: [],
            tags: ['Imported', activeImporter],
          },
          currentUserId
        );
      }

      // Dispatch event to refresh views
      window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));

      saveMigrationLog({
        id: `mig-${Date.now()}`,
        projectName,
        fileName: uploadedFile.name,
        format: activeImporter,
        status: 'Finished',
        summary: tr('settings:importSettings.successMsg', { count: parsedTasks.length }),
        importedCount: parsedTasks.length,
        startTime,
      });

      setImportResult({ count: parsedTasks.length });
      if (onImportFinished) {
        await onImportFinished();
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Import failed';
      setImportError(errorMsg);

      saveMigrationLog({
        id: `mig-${Date.now()}`,
        projectName,
        fileName: uploadedFile.name,
        format: activeImporter,
        status: 'Failed',
        summary: errorMsg,
        importedCount: 0,
        startTime,
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-8 w-full animate-in fade-in duration-200">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-main">{tr('settings:importSettings.title')}</h2>
        <p className="text-xs text-sub mt-1">{tr('settings:importSettings.description')}</p>
      </div>

      {/* Cards Grid: CSV and JSON Only */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
        {/* CSV Importer Card */}
        <div className="rounded-2xl border border-edge bg-surface p-5 shadow-soft flex flex-col justify-between hover:border-accent/40 transition-colors">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                CSV
              </span>
            </div>
            <h3 className="font-bold text-sm text-main">CSV</h3>
            <p className="text-xs text-sub mt-1 line-clamp-2">
              {tr('settings:importSettings.csvDescription')}
            </p>
          </div>
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-4 mt-2 border-t border-edge/60">
            <button
              type="button"
              onClick={() => {
                setActiveImporter('CSV');
                setWizardStep(1);
                setImportError(null);
                setImportResult(null);
                setUploadedFile(null);
              }}
              className="flex-1 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-colors text-center shadow-soft"
            >
              {tr('settings:importSettings.importBtn')}
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadSample('CSV')}
              className="flex items-center gap-1 rounded-xl border border-edge bg-canvas px-2.5 py-1.5 text-xs text-sub hover:text-main hover:bg-hover transition-colors"
              title={tr('settings:importSettings.downloadTemplate')}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{tr('settings:importSettings.downloadTemplate')}</span>
            </button>
          </div>
        </div>

        {/* JSON Importer Card */}
        <div className="rounded-2xl border border-edge bg-surface p-5 shadow-soft flex flex-col justify-between hover:border-feature/40 transition-colors">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-feature/10 text-feature">
                <FileCode className="w-5 h-5" />
              </div>
              <span className="rounded-full bg-feature/15 px-2 py-0.5 text-[10px] font-semibold text-feature">
                JSON
              </span>
            </div>
            <h3 className="font-bold text-sm text-main">JSON</h3>
            <p className="text-xs text-sub mt-1 line-clamp-2">
              {tr('settings:importSettings.jsonDescription')}
            </p>
          </div>
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-4 mt-2 border-t border-edge/60">
            <button
              type="button"
              onClick={() => {
                setActiveImporter('JSON');
                setWizardStep(1);
                setImportError(null);
                setImportResult(null);
                setUploadedFile(null);
              }}
              className="flex-1 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-colors text-center shadow-soft"
            >
              {tr('settings:importSettings.importBtn')}
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadSample('JSON')}
              className="flex items-center gap-1 rounded-xl border border-edge bg-canvas px-2.5 py-1.5 text-xs text-sub hover:text-main hover:bg-hover transition-colors"
              title={tr('settings:importSettings.downloadTemplate')}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{tr('settings:importSettings.downloadTemplate')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Migrations Table */}
      <div className="space-y-3 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-main">
              {tr('settings:importSettings.migrationsTitle')}
            </h3>
            <button
              type="button"
              onClick={() => {
                const stored = localStorage.getItem(scopedStorageKey(IMPORT_HISTORY_STORAGE_KEY));
                setMigrations(stored ? JSON.parse(stored) : []);
              }}
              className="text-quiet hover:text-main p-1 transition-colors"
              title={tr('settings:importSettings.refreshHistory')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-edge overflow-x-auto bg-surface shadow-xs">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b border-edge bg-canvas/60 text-quiet font-semibold">
              <tr>
                <th className="py-2.5 px-4 w-12 text-center whitespace-nowrap">#</th>
                <th className="py-2.5 px-4 whitespace-nowrap">{tr('settings:importSettings.project')}</th>
                <th className="py-2.5 px-4 whitespace-nowrap">{tr('settings:importSettings.format')}</th>
                <th className="py-2.5 px-4 whitespace-nowrap">{tr('settings:importSettings.status')}</th>
                <th className="py-2.5 px-4">{tr('settings:importSettings.summary')}</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">{tr('settings:importSettings.time')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {migrations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-quiet italic">
                    {tr('settings:importSettings.noHistory')}
                  </td>
                </tr>
              ) : (
                migrations.map((m, idx) => (
                  <tr key={m.id} className="hover:bg-hover/40 transition-colors">
                    <td className="py-3 px-4 text-quiet font-mono text-center whitespace-nowrap">{idx + 1}</td>
                    <td className="py-3 px-4 font-semibold text-main whitespace-nowrap">💼 {m.projectName}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-mono text-[11px] text-sub">{m.format}</span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          m.status === 'Finished'
                            ? 'bg-success/15 text-success'
                            : 'bg-danger/15 text-danger'
                        }`}
                      >
                        {m.status === 'Finished'
                          ? tr('settings:importSettings.finished')
                          : tr('settings:importSettings.failed')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sub min-w-[160px]">{m.summary}</td>
                    <td className="py-3 px-4 text-quiet text-[11px] font-mono text-right whitespace-nowrap">{m.startTime}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Import Wizard Modal */}
      {activeImporter && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={tr('settings:importSettings.importerTitle', { format: activeImporter })}
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-xs p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="w-full max-w-2xl max-h-[90vh] my-auto rounded-2xl border border-edge bg-surface shadow-popover overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-edge bg-canvas/30">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/20">
                  {activeImporter === 'CSV' ? (
                    <FileSpreadsheet className="w-5 h-5" />
                  ) : (
                    <FileCode className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-main">
                    {tr('settings:importSettings.importerTitle', { format: activeImporter })}
                  </h3>
                  <p className="text-xs text-sub mt-0.5">
                    {activeImporter === 'CSV'
                      ? tr('settings:importSettings.csvDescription')
                      : tr('settings:importSettings.jsonDescription')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleResetWizard}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-sub hover:text-main hover:bg-hover transition-colors"
                title={tr('settings:importSettings.cancel')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Stepper Bar */}
            {!importResult && (
              <div className="flex items-center border-b border-edge bg-canvas/20 px-6 py-2.5 gap-4 text-xs font-semibold">
                <div
                  className={`flex items-center gap-2 cursor-pointer ${
                    wizardStep === 1 ? 'text-accent' : 'text-sub'
                  }`}
                  onClick={() => setWizardStep(1)}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      wizardStep === 1 ? 'bg-accent text-on-accent' : 'bg-edge text-sub'
                    }`}
                  >
                    1
                  </span>
                  <span>{tr('settings:importSettings.stepSelectProject')}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-edge" />
                <div
                  className={`flex items-center gap-2 ${
                    wizardStep === 2 ? 'text-accent' : 'text-quiet'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      wizardStep === 2 ? 'bg-accent text-on-accent' : 'bg-edge text-quiet'
                    }`}
                  >
                    2
                  </span>
                  <span>{tr('settings:importSettings.stepUploadFile', { format: activeImporter })}</span>
                </div>
              </div>
            )}

            {/* Modal Body */}
            <div className="p-6 space-y-5 min-h-[260px] flex flex-col justify-between overflow-y-auto">
              {importResult ? (
                <div className="flex flex-col items-center justify-center py-8 space-y-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
                    <CheckCircle2 className="w-8 h-8 animate-in zoom-in" />
                  </div>
                  <h3 className="text-base font-bold text-main">
                    {tr('settings:importSettings.successTitle')}
                  </h3>
                  <p className="text-xs text-sub text-center max-w-sm">
                    {tr('settings:importSettings.successMsg', { count: importResult.count })}
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleResetWizard}
                      className="rounded-xl bg-accent px-6 py-2 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-colors shadow-soft"
                    >
                      {tr('settings:importSettings.backToList')}
                    </button>
                  </div>
                </div>
              ) : wizardStep === 1 ? (
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-bold text-main">
                      {tr('settings:importSettings.selectProjectTitle')}
                    </h4>
                    <p className="text-xs text-sub mt-1">
                      {tr('settings:importSettings.selectProjectHint')}
                    </p>
                  </div>

                  <div className="w-full pt-1">
                    <label className="mb-2 block text-xs font-semibold text-sub">
                      {tr('settings:importSettings.selectProjectLabel')}
                    </label>
                    <ThemeSelect
                      portal
                      ariaLabel={tr('settings:importSettings.selectProjectLabel')}
                      value={selectedProjectId}
                      options={projectSelectOptions}
                      onChange={(val) => setSelectedProjectId(val)}
                    />
                  </div>

                  {isPersonal ? (
                    <div className="rounded-xl border border-edge bg-canvas/40 p-3.5 flex items-start gap-3 mt-3">
                      <FolderKanban className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-main">{tr('settings:importSettings.personalTasks') || '个人任务'}</span>
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.2 text-[10px] font-mono text-amber-500">
                            PERSONAL
                          </span>
                        </div>
                        <p className="text-[11px] text-quiet mt-1 line-clamp-2">
                          {tr('settings:importSettings.personalTasksDesc')}
                        </p>
                      </div>
                    </div>
                  ) : selectedProject ? (
                    <div className="rounded-xl border border-edge bg-canvas/40 p-3.5 flex items-start gap-3 mt-3">
                      <FolderKanban className="w-5 h-5 text-accent mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-main">{selectedProject.name}</span>
                          <span className="rounded bg-accent/15 px-1.5 py-0.2 text-[10px] font-mono text-accent">
                            {selectedProject.identifier || 'PRJ'}
                          </span>
                        </div>
                        <p className="text-[11px] text-quiet mt-1 line-clamp-2">
                          {selectedProject.description || tr('settings:importSettings.projectTasksDesc')}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-xl border border-edge bg-canvas/30 px-3.5 py-2">
                    <span className="text-xs text-sub">
                      {tr('settings:importSettings.importTarget')}<strong className="text-main font-semibold">{isPersonal ? (tr('settings:importSettings.personalTasks') || '👤 个人任务') : `💼 ${selectedProject?.name}`}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="text-[11px] font-semibold text-accent hover:underline"
                    >
                      {tr('settings:importSettings.changeProject')}
                    </button>
                  </div>

                  {importError && (
                    <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{importError}</span>
                    </div>
                  )}

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-sub">
                      {tr('settings:importSettings.uploadFileLabel', { format: activeImporter })}
                    </label>

                    {uploadedFile ? (
                      <div className="flex items-center justify-between rounded-xl border border-edge bg-canvas/60 p-4">
                        <div className="flex items-center gap-3">
                          <FileText className="w-6 h-6 text-accent" />
                          <div>
                            <div className="text-xs font-bold text-main">{uploadedFile.name}</div>
                            <div className="text-[10px] text-quiet">
                              {(uploadedFile.size / 1024).toFixed(2)} KB
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-semibold text-success">
                            {tr('settings:importSettings.ready')}
                          </span>
                          <button
                            type="button"
                            onClick={() => setUploadedFile(null)}
                            className="text-quiet hover:text-danger p-1"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-edge hover:border-accent bg-canvas/30 hover:bg-canvas/60 p-8 cursor-pointer transition-colors">
                        <Upload className="w-8 h-8 text-accent/60 mb-2" />
                        <span className="text-xs font-semibold text-main">
                          {tr('settings:importSettings.dragDropPrompt')}
                        </span>
                        <span className="text-[11px] text-quiet mt-1">
                          {tr('settings:importSettings.supportedFormats', {
                            format: activeImporter.toLowerCase(),
                          })}
                        </span>
                        <input
                          type="file"
                          accept={activeImporter === 'CSV' ? '.csv' : '.json'}
                          onChange={handleFileSelect}
                          className="sr-only"
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}

              {/* Modal Actions */}
              {!importResult && (
                <div className="flex items-center justify-between pt-4 border-t border-edge mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (wizardStep === 2) setWizardStep(1);
                      else handleResetWizard();
                    }}
                    className="rounded-xl border border-edge bg-surface px-4 py-2 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors"
                  >
                    {wizardStep === 2
                      ? tr('settings:importSettings.back')
                      : tr('settings:importSettings.cancel')}
                  </button>

                  {wizardStep === 1 ? (
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-colors shadow-soft"
                    >
                      {tr('settings:importSettings.next')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isImporting || !uploadedFile}
                      onClick={() => void handleExecuteImport()}
                      className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-on-accent hover:bg-accent/90 disabled:opacity-50 transition-colors shadow-soft"
                    >
                      {isImporting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>
                        {isImporting
                          ? tr('settings:importSettings.importing')
                          : tr('settings:importSettings.confirmImport')}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
