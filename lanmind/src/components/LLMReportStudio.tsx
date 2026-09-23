/**
 * LLMReportStudio — AI-assisted report generation and PPT plan studio.
 *
 * CALLING SPEC:
 *   <LLMReportStudio
 *     projects={projects}
 *     currentUser={currentUser}
 *     allTasks={tasks} // optional; falls back to ApiService.getTasks(currentUser.id)
 *   />
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  GeneratedPresentation,
  GeneratedReport,
  PPTTemplate,
  Project,
  ReportType,
  Task,
  User,
} from '../types';
import { ApiService } from '../services/api';
import { exportPresentationToPPTX } from '../services/pptExport';
import { ThemeSelect } from './ThemeSelect';
import { ThemeDatePicker } from './ThemeDatePicker';
import { ReportTaskList } from './ReportTaskList';
import { PPTPresentationView } from './PPTPresentationView';
import { PPTPreviewModal, PPTUploadModal } from './PPTTemplateModals';
import {
  BUILTIN_PPT_TEMPLATES,
  DEFAULT_PPT_PROMPT,
  filterTasksForPeriod,
  getReportDateRange,
  renderReportMarkdown,
  REPORT_TYPES,
  ReportPeriodPreset,
  reportPromptFor,
} from '../utils/reportDateRange';
import {
  Activity,
  AlertCircle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Clock3,
  Eye,
  FileText,
  FolderKanban,
  ListChecks,
  LoaderCircle,
  Presentation,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';

export { getReportDateRange };

export interface LLMReportStudioProps {
  projects: Project[];
  currentUser: User;
  allTasks?: Task[];
}

type StudioTab = 'report' | 'ppt';
type ReportResultView = 'markdown' | 'tasks';

const initialReportRange = getReportDateRange('daily');

export const LLMReportStudio: React.FC<LLMReportStudioProps> = ({
  projects,
  currentUser,
  allTasks,
}) => {
  const [internalTasks, setInternalTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<StudioTab>('report');
  const [reportType, setReportType] = useState<ReportType>('daily');
  const [periodPreset, setPeriodPreset] = useState<ReportPeriodPreset | null>('current');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [startDate, setStartDate] = useState(initialReportRange.startDate);
  const [endDate, setEndDate] = useState(initialReportRange.endDate);
  const [reportPrompt, setReportPrompt] = useState(() => reportPromptFor('daily'));
  const [pptPrompt, setPptPrompt] = useState(DEFAULT_PPT_PROMPT);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<GeneratedReport | null>(null);
  const [reportResultView, setReportResultView] = useState<ReportResultView>('markdown');
  const [presentationPlan, setPresentationPlan] = useState<GeneratedPresentation | null>(null);
  const [reportError, setReportError] = useState('');
  const [copiedSuccess, setCopiedSuccess] = useState(false);
  const [pptDownloadSuccess, setPptDownloadSuccess] = useState('');

  const [pptTemplates, setPptTemplates] = useState<PPTTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('tpl-executive');
  const [previewTemplate, setPreviewTemplate] = useState<PPTTemplate | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [customJsonInput, setCustomJsonInput] = useState('');
  const [uploadError, setUploadError] = useState('');

  // Fallback to ApiService.getTasks if allTasks is not provided
  useEffect(() => {
    if (allTasks) return;
    ApiService.getTasks(currentUser.id)
      .then((tasks) => setInternalTasks(tasks))
      .catch((err) => console.error('Failed to load tasks for report studio', err));
  }, [allTasks, currentUser.id]);

  const activeTasks = allTasks || internalTasks;

  // Real-time matched tasks for the selected period and project scope
  const periodTasks = useMemo(() => {
    return filterTasksForPeriod(activeTasks, {
      currentUserId: currentUser.id,
      startDate,
      endDate,
      selectedProjectId: selectedProjectId || undefined,
    });
  }, [activeTasks, currentUser.id, startDate, endDate, selectedProjectId]);

  useEffect(() => {
    ApiService.getPPTTemplates()
      .then((templates) => {
        const availableTemplates = templates.length ? templates : BUILTIN_PPT_TEMPLATES;
        setPptTemplates(availableTemplates);
        if (!availableTemplates.some((template) => template.id === selectedTemplateId) && availableTemplates[0]) {
          setSelectedTemplateId(availableTemplates[0].id);
        }
      })
      .catch((error) => {
        console.error('Failed to load PPT templates', error);
        setPptTemplates(BUILTIN_PPT_TEMPLATES);
      });
  }, []);

  const selectedTemplate = useMemo(
    () => pptTemplates.find((template) => template.id === selectedTemplateId) || pptTemplates[0],
    [pptTemplates, selectedTemplateId],
  );

  const reportMarkdownHtml = useMemo(
    () => renderReportMarkdown(generatedReport?.rawMarkdown || ''),
    [generatedReport?.rawMarkdown],
  );

  const activePrompt = activeTab === 'report' ? reportPrompt : pptPrompt;
  const setActivePrompt = (value: string) =>
    activeTab === 'report' ? setReportPrompt(value) : setPptPrompt(value);

  const resetActivePrompt = () =>
    setActivePrompt(activeTab === 'report' ? reportPromptFor(reportType) : DEFAULT_PPT_PROMPT);

  const requestReport = () =>
    ApiService.generateReport({
      type: reportType,
      projectId: selectedProjectId || undefined,
      dateRange: { startDate, endDate },
      promptOverride: reportPrompt.trim() || undefined,
      currentUserId: currentUser.id,
    });

  const requestPresentationPlan = () =>
    ApiService.generatePresentationPlan({
      type: reportType,
      projectId: selectedProjectId || undefined,
      dateRange: { startDate, endDate },
      promptOverride: pptPrompt.trim() || undefined,
      currentUserId: currentUser.id,
      pptTemplateId: selectedTemplateId || undefined,
    });

  const handleGenerateReport = async () => {
    setLoading(true);
    setReportError('');
    setCopiedSuccess(false);
    try {
      const report = await requestReport();
      setGeneratedReport(report);
      setReportResultView('markdown');
    } catch (error) {
      console.error('Error generating report', error);
      setReportError(error instanceof Error ? error.message : '生成工作汇报失败，请检查模型配置后重试。');
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePPT = async () => {
    setLoading(true);
    setReportError('');
    setPptDownloadSuccess('');
    try {
      setPresentationPlan(await requestPresentationPlan());
    } catch (error) {
      console.error('Failed to generate presentation plan', error);
      setReportError(error instanceof Error ? error.message : '生成汇报 PPT 方案失败，请重试。');
    } finally {
      setLoading(false);
    }
  };

  const handleExportPPT = async () => {
    if (!selectedTemplate || !presentationPlan) return;
    setLoading(true);
    setReportError('');
    setPptDownloadSuccess('');
    try {
      const result = await exportPresentationToPPTX(presentationPlan, selectedTemplate);
      setPptDownloadSuccess(result.savedPath ? `PPTX 已保存到 ${result.savedPath}` : 'PPTX 已生成并开始下载');
    } catch (error) {
      console.error('Failed to export PPTX file', error);
      setReportError(error instanceof Error ? error.message : 'PPTX 导出失败，请重试。');
    } finally {
      setLoading(false);
    }
  };

  const handleClearGeneratedReport = () => {
    setGeneratedReport(null);
    setPresentationPlan(null);
    setReportResultView('markdown');
    setCopiedSuccess(false);
    setPptDownloadSuccess('');
    setReportError('');
  };

  const handleCopyReportText = async () => {
    if (!generatedReport) return;
    try {
      await navigator.clipboard.writeText(generatedReport.rawMarkdown);
      setCopiedSuccess(true);
      window.setTimeout(() => setCopiedSuccess(false), 2200);
    } catch {
      setReportError('复制失败，请检查系统剪贴板权限。');
    }
  };

  const handleUploadCustomTemplate = async () => {
    setUploadError('');
    try {
      const parsed = JSON.parse(customJsonInput);
      if (!parsed.id || !parsed.name || !Array.isArray(parsed.slidesLayout)) {
        throw new Error('主题缺少 id、name 或 slidesLayout 字段');
      }
      const newTemplate: PPTTemplate = {
        id: parsed.id,
        name: parsed.name,
        description: parsed.description || '用户导入的自定义 PPT 主题',
        theme: 'custom',
        primaryColor: parsed.primaryColor || '#111827',
        secondaryColor: parsed.secondaryColor || '#475569',
        backgroundColor: parsed.backgroundColor || '#ffffff',
        textColor: parsed.textColor || '#111827',
        cardBgColor: parsed.cardBgColor || '#f8fafc',
        accentColor: parsed.accentColor || '#ea580c',
        fontFamily: parsed.fontFamily || 'Microsoft YaHei',
        slidesLayout: parsed.slidesLayout,
        isCustom: true,
      };
      await ApiService.addPPTTemplate(newTemplate);
      const templates = await ApiService.getPPTTemplates();
      setPptTemplates(templates);
      setSelectedTemplateId(newTemplate.id);
      setShowUploadModal(false);
      setCustomJsonInput('');
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'JSON 格式无效');
    }
  };

  const changeReportType = (nextType: ReportType) => {
    const nextPreset = periodPreset || 'current';
    const nextRange = getReportDateRange(nextType, new Date(), nextPreset);
    setReportType(nextType);
    setReportPrompt(reportPromptFor(nextType));
    setPeriodPreset(nextPreset);
    setStartDate(nextRange.startDate);
    setEndDate(nextRange.endDate);
    setGeneratedReport(null);
    setPresentationPlan(null);
    setReportError('');
    setPptDownloadSuccess('');
  };

  const changePeriodPreset = (nextPreset: ReportPeriodPreset) => {
    const nextRange = getReportDateRange(reportType, new Date(), nextPreset);
    setPeriodPreset(nextPreset);
    setStartDate(nextRange.startDate);
    setEndDate(nextRange.endDate);
    setGeneratedReport(null);
    setPresentationPlan(null);
    setReportError('');
    setPptDownloadSuccess('');
  };

  return (
    <div className="report-studio flex h-full min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="report-studio-hero flex flex-shrink-0 flex-row items-center justify-between gap-4 border-b px-5 py-4 lg:px-8">
        <div className="min-w-0 flex-1">
          <div className="report-studio-eyebrow mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">AI Report Studio · Evidence to Narrative</span>
          </div>
          <h1 className="report-studio-title text-xl font-semibold tracking-tight sm:text-2xl">工作汇报</h1>
          <p className="report-studio-desc mt-1 line-clamp-1 max-w-2xl text-xs">
            选择周期与项目即可即时浏览周期任务；确认无误后点击生成，由 AI 基于真实任务事实生成结构化报告。
          </p>
        </div>
        <div className="report-studio-tabs flex h-9 shrink-0 items-center rounded-md p-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => {
              setActiveTab('report');
              setReportError('');
            }}
            data-active={activeTab === 'report'}
            className="report-studio-tab flex h-7 shrink-0 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors whitespace-nowrap"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0 whitespace-nowrap">工作汇报</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('ppt');
              setReportError('');
            }}
            data-active={activeTab === 'ppt'}
            className="report-studio-tab flex h-7 shrink-0 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors whitespace-nowrap"
          >
            <Presentation className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0 whitespace-nowrap">汇报 PPT</span>
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 bg-surface/70 lg:grid-cols-[390px_minmax(0,1fr)] lg:gap-4 lg:overflow-hidden lg:p-4">
        {/* Left Controls Aside */}
        <aside className="report-studio-controls space-y-5 rounded-2xl border border-edge/80 bg-canvas/90 p-5 lg:min-h-0 lg:overflow-y-auto">
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-sub">
              <Clock3 className="h-3.5 w-3.5 text-info" />
              <span>汇报周期</span>
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {REPORT_TYPES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => changeReportType(item.id)}
                  data-active={reportType === item.id}
                  className="report-studio-period h-8 rounded text-xs font-medium transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <label className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-sub">
                <Activity className="h-3.5 w-3.5 text-info" />
                <span>统计周期</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { id: 'current', label: '当前周期' },
                  { id: 'previous', label: '上一个周期' },
                ] as const).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => changePeriodPreset(item.id)}
                    data-active={periodPreset === item.id}
                    className="report-studio-period h-8 rounded text-xs font-medium transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-sub">
              <FolderKanban className="h-3.5 w-3.5" />
              项目范围
            </label>
            <ThemeSelect
              ariaLabel="按项目筛选工作汇报任务"
              value={selectedProjectId}
              onChange={(value) => {
                setSelectedProjectId(value);
                setGeneratedReport(null);
                setPresentationPlan(null);
                setPptDownloadSuccess('');
              }}
              options={[
                { value: '', label: '全部个人相关任务' },
                ...projects.map((project) => ({ value: project.id, label: project.name, tone: 'blue' as const })),
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 flex items-center gap-1 text-[11px] text-quiet">
                <CalendarDays className="h-3.5 w-3.5 text-info" />
                <span>开始日期</span>
              </label>
              <ThemeDatePicker
                ariaLabel="选择开始日期"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event);
                  setPeriodPreset(null);
                  setGeneratedReport(null);
                  setPresentationPlan(null);
                  setPptDownloadSuccess('');
                }}
                placeholder="开始日期"
              />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1 text-[11px] text-quiet">
                <CalendarDays className="h-3.5 w-3.5 text-info" />
                <span>结束日期</span>
              </label>
              <ThemeDatePicker
                ariaLabel="选择结束日期"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event);
                  setPeriodPreset(null);
                  setGeneratedReport(null);
                  setPresentationPlan(null);
                  setPptDownloadSuccess('');
                }}
                placeholder="结束日期"
              />
            </div>
          </div>

          <section className="report-prompt-panel rounded-xl border p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="report-prompt-title flex items-center gap-2 text-xs font-semibold">
                  <SlidersHorizontal className="report-prompt-icon h-3.5 w-3.5" />
                  <span>{activeTab === 'report' ? '汇报生成提示词' : 'PPT 生成提示词'}</span>
                </div>
                <p className="report-prompt-desc mt-1 text-[10px] leading-4">
                  模型会自动追加任务事实、指标和 JSON 格式约束；这里控制表达、结构和视觉叙事。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPromptEditor((value) => !value)}
                className="report-prompt-toggle rounded-md p-1 transition-colors"
                title={showPromptEditor ? '收起提示词' : '展开提示词'}
                aria-label={showPromptEditor ? '收起提示词' : '展开提示词'}
              >
                {showPromptEditor ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>
            {showPromptEditor && (
              <>
                <textarea
                  value={activePrompt}
                  maxLength={12000}
                  onChange={(event) => {
                    setActivePrompt(event.target.value);
                    setGeneratedReport(null);
                    setPresentationPlan(null);
                  }}
                  className="report-prompt-editor mt-3 h-44 w-full resize-y rounded-xl p-3 font-mono text-[11px] leading-5 outline-none transition-colors"
                  aria-label="可编辑的大模型生成提示词"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="report-prompt-meta text-[10px] tabular-nums">
                    {activePrompt.length}/12000 · 可直接修改后生成
                  </span>
                  <button
                    type="button"
                    onClick={resetActivePrompt}
                    className="report-prompt-reset flex items-center gap-1 text-[10px] transition-colors"
                  >
                    <RotateCcw className="h-3 w-3" />恢复推荐提示词
                  </button>
                </div>
                <details className="report-prompt-details mt-3 rounded-xl border px-3 py-2">
                  <summary className="cursor-pointer text-[10px] font-medium">查看发送时自动追加的固定上下文</summary>
                  <p className="mt-2 text-[10px] leading-4">
                    系统会把汇报周期、项目范围、任务状态事件、确定性指标、数据截止日期、权限边界和 JSON 输出协议自动附在提示词后面。它们用于防止模型脱离真实任务编造内容，不是另一段需要维护的用户指令。
                  </p>
                </details>
              </>
            )}
          </section>

          {activeTab === 'ppt' && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-sub">
                  <Presentation className="h-3.5 w-3.5 text-feature" />
                  <span>PPT 主题</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowUploadModal(true)}
                  className="report-studio-accent-action flex items-center gap-1 text-[10px]"
                >
                  <Upload className="h-3 w-3" />
                  导入
                </button>
              </div>
              <div className="space-y-1.5">
                {pptTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => {
                      setSelectedTemplateId(template.id);
                      setPresentationPlan(null);
                      setPptDownloadSuccess('');
                    }}
                    data-active={selectedTemplateId === template.id}
                    className="report-studio-template flex w-full items-center gap-3 rounded border border-edge bg-surface px-2.5 py-2 text-left transition-colors hover:border-subtle"
                  >
                    <span className="flex flex-shrink-0 items-center gap-1">
                      {[template.primaryColor, template.accentColor, template.backgroundColor].map((color) => (
                        <span key={color} className="h-3 w-3 border border-white/15" style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-sub">{template.name}</span>
                    {selectedTemplateId === template.id && <Check className="h-3.5 w-3.5 flex-shrink-0 text-info" />}
                    <span
                      role="button"
                      tabIndex={0}
                      title="预览主题"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPreviewTemplate(template);
                      }}
                      className="p-1 text-quiet hover:text-main"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {reportError && (
            <div className="flex items-start gap-2 border-l-2 border-rose-500 bg-danger/10 p-2.5 text-xs leading-5 text-danger">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{reportError}</span>
            </div>
          )}
          {pptDownloadSuccess && (
            <div className="flex items-start gap-2 border-l-2 border-emerald-500 bg-success/10 p-2.5 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="break-all">{pptDownloadSuccess}</span>
            </div>
          )}
        </aside>

        {/* Right Canvas Main */}
        <main className="report-studio-canvas flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-edge/80 bg-canvas lg:min-h-0">
          {reportError && (
            <div className="flex items-start gap-2 border-b border-rose-500/30 bg-danger/10 px-5 py-2.5 text-xs leading-5 text-danger">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{reportError}</span>
            </div>
          )}
          {pptDownloadSuccess && (
            <div className="flex items-start gap-2 border-b border-emerald-500/30 bg-success/10 px-5 py-2.5 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="break-all">{pptDownloadSuccess}</span>
            </div>
          )}
          {activeTab === 'report' ? (
            generatedReport ? (
              /* Report has been generated: Show Markdown & Raw tasks tabs */
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3 sm:px-5">
                  <div className="report-studio-tabs flex h-9 items-center rounded-md p-1" role="tablist" aria-label="切换工作汇报展示内容">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={reportResultView === 'markdown'}
                      data-active={reportResultView === 'markdown'}
                      onClick={() => setReportResultView('markdown')}
                      className="report-studio-tab flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      汇报内容
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={reportResultView === 'tasks'}
                      data-active={reportResultView === 'tasks'}
                      onClick={() => setReportResultView('tasks')}
                      className="report-studio-tab flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors"
                    >
                      <ListChecks className="h-3.5 w-3.5" />
                      原始任务 ({generatedReport.sourceTasks?.length || periodTasks.length})
                    </button>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {generatedReport.generationMode === 'fallback' && (
                      <span className="border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-warning">事实模式</span>
                    )}
                    <button
                      type="button"
                      onClick={handleGenerateReport}
                      disabled={loading}
                      className="flex h-8 items-center justify-center gap-1.5 rounded border border-subtle bg-surface px-3 text-xs text-sub transition-colors hover:bg-hover disabled:opacity-50"
                      title="基于当前周期任务重新生成工作汇报"
                    >
                      {loading ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5 text-info" />
                      )}
                      <span>{loading ? '生成中...' : '重新生成'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyReportText}
                      className="flex h-8 items-center justify-center gap-1.5 rounded border border-subtle bg-surface px-3 text-xs text-sub transition-colors hover:bg-hover"
                    >
                      {copiedSuccess ? <Check className="h-3.5 w-3.5 text-success" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                      {copiedSuccess ? '已复制' : '复制 Markdown'}
                    </button>
                    <button
                      type="button"
                      onClick={handleClearGeneratedReport}
                      className="flex h-8 items-center justify-center gap-1.5 rounded border border-rose-500/30 bg-rose-500/10 px-3 text-xs text-danger transition-colors hover:border-rose-400/60 hover:bg-rose-500/20"
                      title="清空当前生成的工作汇报，返回周期任务预览"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      清空内容
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-visible bg-surface/40 lg:overflow-y-auto">
                  {reportResultView === 'markdown' ? (
                    <article
                      className="report-markdown markdown-body mx-auto max-w-4xl px-6 py-7 text-sm leading-7 text-sub sm:px-10 sm:py-9 [&_h1]:mb-5 [&_h1]:border-b [&_h1]:border-edge [&_h1]:pb-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-main [&_h2]:mb-2 [&_h2]:mt-7 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-main [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-main [&_p]:my-2 [&_strong]:font-semibold [&_strong]:text-main [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-sky-500/50 [&_blockquote]:pl-4 [&_blockquote]:text-quiet [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_a]:text-info [&_a]:underline [&_a]:underline-offset-2"
                      dangerouslySetInnerHTML={{ __html: reportMarkdownHtml }}
                    />
                  ) : (
                    <ReportTaskList
                      tasks={generatedReport.sourceTasks?.length ? generatedReport.sourceTasks : periodTasks}
                      projects={projects}
                      currentUser={currentUser}
                      title="本次汇报依据的原始任务"
                      dateRangeLabel={`${startDate} ~ ${endDate}`}
                    />
                  )}
                </div>
              </div>
            ) : (
              /* Report not yet generated: Directly show real-time period task preview */
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 items-center gap-1.5 rounded-md bg-info/10 px-2 text-xs font-semibold text-info">
                      <ListChecks className="h-3.5 w-3.5" />
                      周期任务预览
                    </span>
                    <span className="text-xs text-quiet">
                      已匹配 <strong className="font-semibold text-main">{periodTasks.length}</strong> 项任务
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleGenerateReport}
                    disabled={loading || periodTasks.length === 0}
                    className="report-studio-primary flex h-8 items-center gap-1.5 rounded px-3.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    <span>{loading ? '正在分析生成...' : 'AI 分析并生成汇报'}</span>
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-visible bg-surface/40 lg:overflow-y-auto">
                  <ReportTaskList
                    tasks={periodTasks}
                    projects={projects}
                    currentUser={currentUser}
                    title="当前周期内任务清单"
                    dateRangeLabel={`${startDate} ~ ${endDate}`}
                    emptyMessage="当前周期内暂无任务记录"
                    emptyHint="直接读取本地任务库未发现匹配任务。请调整左侧汇报周期、起止日期或项目范围，或先在日程/看板中创建任务后再进行 AI 分析总结。"
                  />
                </div>
              </div>
            )
          ) : presentationPlan ? (
            /* PPT presentation plan generated */
            <PPTPresentationView
              presentationPlan={presentationPlan}
              loading={loading}
              hasSelectedTemplate={Boolean(selectedTemplate)}
              onBackToTasks={() => setPresentationPlan(null)}
              onExportPPT={handleExportPPT}
            />
          ) : (
            /* PPT not yet generated: Show evidence tasks preview directly */
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 items-center gap-1.5 rounded-md bg-purple-500/10 px-2 text-xs font-semibold text-feature">
                    <Presentation className="h-3.5 w-3.5" />
                    PPT 证据任务预览
                  </span>
                  <span className="text-xs text-quiet">
                    已匹配 <strong className="font-semibold text-main">{periodTasks.length}</strong> 项任务
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleGeneratePPT}
                  disabled={loading || periodTasks.length === 0}
                  className="report-studio-primary flex h-8 items-center gap-1.5 rounded px-3.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Presentation className="h-3.5 w-3.5" />
                  )}
                  <span>{loading ? '正在组织方案...' : 'AI 生成逐页方案'}</span>
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-visible bg-surface/40 lg:overflow-y-auto">
                <ReportTaskList
                  tasks={periodTasks}
                  projects={projects}
                  currentUser={currentUser}
                  title="PPT 汇报论据任务"
                  dateRangeLabel={`${startDate} ~ ${endDate}`}
                  emptyMessage="当前周期内暂无任务记录"
                  emptyHint="请调整左侧周期、起止日期或项目范围，以便模型提取汇报论据并组织幻灯片结构。"
                />
              </div>
            </div>
          )}
        </main>
      </div>

      <PPTPreviewModal
        template={previewTemplate}
        onClose={() => setPreviewTemplate(null)}
      />

      <PPTUploadModal
        isOpen={showUploadModal}
        customJsonInput={customJsonInput}
        uploadError={uploadError}
        onJsonChange={setCustomJsonInput}
        onClose={() => setShowUploadModal(false)}
        onSubmit={handleUploadCustomTemplate}
      />
    </div>
  );
};
