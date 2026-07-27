import React, { useEffect, useMemo, useState } from 'react';
import {
  GeneratedReport,
  GeneratedPresentation,
  PPTTemplate,
  Project,
  ReportSection,
  ReportSectionKind,
  ReportType,
  User,
} from '../types';
import { ApiService } from '../services/api';
import { exportPresentationToPPTX } from '../services/pptExport';
import { ThemeSelect } from './ThemeSelect';
import {
  Activity,
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  ClipboardCopy,
  CalendarDays,
  Clock3,
  Eye,
  FileText,
  FolderKanban,
  Handshake,
  ListChecks,
  LoaderCircle,
  Presentation,
  Sparkles,
  Trash2,
  Target,
  Upload,
  X,
} from 'lucide-react';

interface LLMReportStudioProps {
  projects: Project[];
  currentUser: User;
}

type StudioTab = 'report' | 'ppt';
type ReportPeriodPreset = 'current' | 'previous';

const REPORT_TYPES: Array<{ id: ReportType; label: string }> = [
  { id: 'daily', label: '日报' }, { id: 'weekly', label: '周报' }, { id: 'monthly', label: '月报' },
  { id: 'quarterly', label: '季报' }, { id: 'semi_annual', label: '半年报' }, { id: 'annual', label: '年报' },
];

const formatDateValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getReportDateRange = (
  type: ReportType,
  referenceDate = new Date(),
  periodPreset: ReportPeriodPreset = 'current',
) => {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const day = referenceDate.getDate();
  const periodOffset = periodPreset === 'previous' ? -1 : 0;
  let start = new Date(year, month, day + periodOffset);
  let end = new Date(year, month, day + periodOffset);

  if (type === 'weekly') {
    const daysSinceMonday = (referenceDate.getDay() + 6) % 7;
    start = new Date(year, month, day - daysSinceMonday + periodOffset * 7);
    end = new Date(year, month, day + 6 - daysSinceMonday + periodOffset * 7);
  } else if (type === 'monthly') {
    start = new Date(year, month + periodOffset, 1);
    end = new Date(year, month + periodOffset + 1, 0);
  } else if (type === 'quarterly') {
    const qStart = Math.floor(month / 3) * 3;
    start = new Date(year, qStart + periodOffset * 3, 1);
    end = new Date(year, qStart + periodOffset * 3 + 3, 0);
  } else if (type === 'semi_annual') {
    const hStart = month < 6 ? 0 : 6;
    start = new Date(year, hStart + periodOffset * 6, 1);
    end = new Date(year, hStart + periodOffset * 6 + 6, 0);
  } else if (type === 'annual') {
    start = new Date(year + periodOffset, 0, 1);
    end = new Date(year + periodOffset, 11, 31);
  }

  return { startDate: formatDateValue(start), endDate: formatDateValue(end) };
};

const SECTION_TONES: Record<ReportSectionKind, { icon: React.ElementType; iconClass: string; borderClass: string }> = {
  achievement: { icon: CheckCircle2, iconClass: 'text-emerald-400', borderClass: 'border-emerald-500/30' },
  progress: { icon: Activity, iconClass: 'text-cyan-400', borderClass: 'border-cyan-500/30' },
  risk: { icon: AlertCircle, iconClass: 'text-amber-400', borderClass: 'border-amber-500/30' },
  plan: { icon: Target, iconClass: 'text-blue-400', borderClass: 'border-blue-500/30' },
  support: { icon: Handshake, iconClass: 'text-fuchsia-400', borderClass: 'border-fuchsia-500/30' },
  custom: { icon: ListChecks, iconClass: 'text-slate-300', borderClass: 'border-slate-700' },
};

const metricCards = (report: GeneratedReport) => [
  { label: '相关任务', value: report.metrics.relevantTasksCount, tone: 'text-slate-100' },
  { label: '周期完成', value: report.metrics.completedTasksCount, tone: 'text-emerald-400' },
  { label: '有效推进', value: report.metrics.progressedTasksCount, tone: 'text-cyan-400' },
  { label: '待处理', value: report.metrics.pendingTasksCount, tone: 'text-blue-400' },
  { label: '阻塞', value: report.metrics.blockedTasksCount, tone: 'text-rose-400' },
  { label: '逾期', value: report.metrics.overdueTasksCount, tone: 'text-amber-400' },
  { label: '后续计划', value: report.metrics.upcomingTasksCount, tone: 'text-violet-400' },
];

const ReportSectionView: React.FC<{ section: ReportSection }> = ({ section }) => {
  const tone = SECTION_TONES[section.kind] || SECTION_TONES.custom;
  const Icon = tone.icon;

  return (
    <section className={`flex min-h-[160px] flex-col border-t p-4 first:border-t-0 xl:border-t ${tone.borderClass}`}>
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${tone.iconClass}`} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100">{section.title}</h3>
          {section.purpose && <p className="mt-0.5 text-[10px] text-slate-500">本节任务：{section.purpose}</p>}
          {(section.conclusion || section.summary) && <p className="mt-1 text-xs font-medium leading-5 text-slate-300">{section.conclusion || section.summary}</p>}
        </div>
      </div>

      <div className="mt-3 flex-1">
        {section.items.length === 0 ? (
          <p className="text-xs text-slate-500">暂无符合当前统计口径的记录</p>
        ) : (
          <ul className="divide-y divide-slate-800/80">
            {section.items.map((item, index) => (
              <li key={`${section.id}-${index}`} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-5 text-slate-200">{item.headline}</p>
                    {item.detail && <p className="mt-0.5 text-xs leading-5 text-slate-400">{item.detail}</p>}
                    {item.impact && <p className="mt-1 text-xs leading-5 text-cyan-300/80">影响：{item.impact}</p>}
                    {item.nextAction && <p className="mt-1 text-xs leading-5 text-blue-300/80">下一动作：{item.nextAction}</p>}
                  </div>
                  {item.severity && (
                    <span
                      className={`mt-0.5 flex-shrink-0 text-[10px] font-semibold uppercase ${
                        item.severity === 'high'
                          ? 'text-rose-400'
                          : item.severity === 'medium'
                            ? 'text-amber-400'
                            : 'text-slate-400'
                      }`}
                    >
                      {item.severity}
                    </span>
                  )}
                </div>
                {(item.dueDate || item.taskIds.length > 0) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                    {item.dueDate && (
                      <span className="flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />
                        {item.dueDate.slice(0, 10)}
                      </span>
                    )}
                    {item.taskIds.length > 0 && <span>关联 {item.taskIds.length} 项任务</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

const initialReportRange = getReportDateRange('daily');

export const LLMReportStudio: React.FC<LLMReportStudioProps> = ({ projects, currentUser }) => {
  const [activeTab, setActiveTab] = useState<StudioTab>('report');
  const [reportType, setReportType] = useState<ReportType>('daily');
  const [periodPreset, setPeriodPreset] = useState<ReportPeriodPreset | null>('current');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [startDate, setStartDate] = useState(initialReportRange.startDate);
  const [endDate, setEndDate] = useState(initialReportRange.endDate);
  const [customNotes, setCustomNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<GeneratedReport | null>(null);
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

  useEffect(() => {
    ApiService.getPPTTemplates()
      .then((templates) => {
        setPptTemplates(templates);
        if (!templates.some((template) => template.id === selectedTemplateId) && templates[0]) {
          setSelectedTemplateId(templates[0].id);
        }
      })
      .catch((error) => console.error('Failed to load PPT templates', error));
  }, []);

  const selectedTemplate = useMemo(
    () => pptTemplates.find((template) => template.id === selectedTemplateId) || pptTemplates[0],
    [pptTemplates, selectedTemplateId],
  );

  const requestReport = () =>
    ApiService.generateReport({
      type: reportType,
      projectId: selectedProjectId || undefined,
      dateRange: { startDate, endDate },
      customNotes: customNotes.trim() || undefined,
      currentUserId: currentUser.id,
    });

  const requestPresentationPlan = () =>
    ApiService.generatePresentationPlan({
      type: reportType,
      projectId: selectedProjectId || undefined,
      dateRange: { startDate, endDate },
      customNotes: customNotes.trim() || undefined,
      currentUserId: currentUser.id,
    });

  const handleGenerateReport = async () => {
    setLoading(true);
    setReportError('');
    setCopiedSuccess(false);
    try {
      setGeneratedReport(await requestReport());
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
      <header className="report-studio-header flex flex-shrink-0 flex-col gap-3 border-b px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="report-studio-accent h-4 w-4" />
            <h1 className="report-studio-title truncate text-base font-semibold">AI 工作汇报</h1>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{currentUser.nickname} · 创建、负责及直接共享任务</p>
        </div>
        <div className="report-studio-tabs flex h-9 items-center rounded-md p-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab('report');
              setReportError('');
            }}
            data-active={activeTab === 'report'}
            className="report-studio-tab flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            工作汇报
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('ppt');
              setReportError('');
            }}
            data-active={activeTab === 'ppt'}
            className="report-studio-tab flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors"
          >
            <Presentation className="h-3.5 w-3.5" />
            汇报 PPT
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 bg-slate-800 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-px lg:overflow-hidden">
        <aside className="space-y-5 bg-slate-950 p-5 lg:min-h-0 lg:overflow-y-auto">
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
              <Clock3 className="h-3.5 w-3.5 text-cyan-400" />
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
              <label className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                <Activity className="h-3.5 w-3.5 text-blue-400" />
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
            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
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
            <label className="text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5 text-blue-400" />
                <span>开始日期</span>
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setPeriodPreset(null);
                  setGeneratedReport(null);
                  setPresentationPlan(null);
                  setPptDownloadSuccess('');
                }}
                className="report-studio-field mt-1 h-8 w-full rounded border border-slate-800 bg-slate-900 px-2 text-xs text-slate-200 outline-none"
              />
            </label>
            <label className="text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5 text-blue-400" />
                <span>结束日期</span>
              </span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setPeriodPreset(null);
                  setGeneratedReport(null);
                  setPresentationPlan(null);
                  setPptDownloadSuccess('');
                }}
                className="report-studio-field mt-1 h-8 w-full rounded border border-slate-800 bg-slate-900 px-2 text-xs text-slate-200 outline-none"
              />
            </label>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                <ClipboardCopy className="h-3.5 w-3.5 text-amber-400" />
                <span>自定义汇报指令</span>
              </label>
              <span className="text-[10px] text-slate-600">{customNotes.length}/2000</span>
            </div>
            <textarea
              value={customNotes}
              maxLength={2000}
              onChange={(event) => {
                setCustomNotes(event.target.value);
                setGeneratedReport(null);
                setPresentationPlan(null);
                setPptDownloadSuccess('');
              }}
              placeholder="例如：突出交付价值，风险按严重程度排序，整体控制在 500 字内。"
              className="report-studio-field h-24 w-full resize-none rounded border border-slate-800 bg-slate-900 p-2.5 text-xs leading-5 text-slate-200 outline-none placeholder:text-slate-600"
            />
          </div>

          {activeTab === 'ppt' && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                  <Presentation className="h-3.5 w-3.5 text-purple-400" />
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
                    onClick={() => setSelectedTemplateId(template.id)}
                    data-active={selectedTemplateId === template.id}
                    className="report-studio-template flex w-full items-center gap-3 rounded border border-slate-800 bg-slate-900 px-2.5 py-2 text-left transition-colors hover:border-slate-700"
                  >
                    <span className="flex flex-shrink-0 items-center gap-1">
                      {[template.primaryColor, template.accentColor, template.backgroundColor].map((color) => (
                        <span key={color} className="h-3 w-3 border border-white/15" style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{template.name}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      title="预览主题"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPreviewTemplate(template);
                      }}
                      className="p-1 text-slate-500 hover:text-white"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={activeTab === 'report' ? handleGenerateReport : handleGeneratePPT}
            disabled={loading}
            className="report-studio-primary flex h-10 w-full items-center justify-center gap-2 rounded px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : activeTab === 'report' ? (
              <Bot className="h-4 w-4" />
            ) : (
              <Presentation className="h-4 w-4" />
            )}
            {loading ? '正在整理任务事实...' : activeTab === 'report' ? '生成工作汇报' : '生成逐页方案'}
          </button>

          {reportError && (
            <div className="flex items-start gap-2 border-l-2 border-rose-500 bg-rose-950/20 p-2.5 text-xs leading-5 text-rose-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{reportError}</span>
            </div>
          )}
          {pptDownloadSuccess && (
            <div className="flex items-start gap-2 border-l-2 border-emerald-500 bg-emerald-950/20 p-2.5 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="break-all">{pptDownloadSuccess}</span>
            </div>
          )}
        </aside>

        <main className="flex min-h-[560px] flex-col bg-slate-950 lg:min-h-0 lg:overflow-hidden">
          {activeTab === 'report' && generatedReport ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-shrink-0 flex-col gap-3 border-b border-slate-800 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold leading-7 text-white">{generatedReport.title}</h2>
                    {generatedReport.generationMode === 'fallback' && (
                      <span className="border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-400">事实模式</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {generatedReport.period} · 数据截至 {generatedReport.asOf}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyReportText}
                    className="flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-3 text-xs text-slate-300 transition-colors hover:bg-slate-800"
                  >
                    {copiedSuccess ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                    {copiedSuccess ? '已复制' : '复制 Markdown'}
                  </button>
                  <button
                    type="button"
                    onClick={handleClearGeneratedReport}
                    className="flex h-8 items-center justify-center gap-1.5 rounded border border-rose-500/30 bg-rose-500/10 px-3 text-xs text-rose-300 transition-colors hover:border-rose-400/60 hover:bg-rose-500/20"
                    title="清空当前生成的工作汇报"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    清空内容
                  </button>
                </div>
              </div>

              <div className="report-studio-summary flex-shrink-0 border-b border-slate-800 px-5 py-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="report-studio-accent mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div>
                    <p className="text-[11px] font-semibold text-slate-500">推断听众 · {generatedReport.audience}</p>
                    <p className="mt-1 max-w-5xl text-sm font-semibold leading-6 text-slate-100">{generatedReport.keyTakeaway}</p>
                    <p className="mt-1 max-w-5xl text-xs leading-5 text-slate-400">{generatedReport.executiveSummary}</p>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-visible lg:overflow-y-auto">
                <div className="grid min-h-full grid-cols-1 content-stretch xl:grid-cols-2 xl:auto-rows-fr">
                  {generatedReport.sections.map((section) => (
                    <ReportSectionView key={section.id} section={section} />
                  ))}
                </div>
                <details className="border-t border-slate-800 px-5 py-4">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-400">数据依据</summary>
                  <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden border border-slate-800 bg-slate-800 sm:grid-cols-4 xl:grid-cols-7">
                    {metricCards(generatedReport).map((metric) => (
                      <div key={metric.label} className="bg-slate-950 px-3 py-3">
                        <p className={`text-lg font-semibold tabular-nums ${metric.tone}`}>{metric.value}</p>
                        <p className="mt-0.5 text-[10px] text-slate-500">{metric.label}</p>
                      </div>
                    ))}
                  </div>
                </details>
                {generatedReport.dataNotes.length > 0 && (
                  <div className="border-t border-slate-800 px-5 py-3 text-[10px] leading-5 text-slate-600">
                    {generatedReport.dataNotes.join(' ')}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'ppt' && presentationPlan ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-shrink-0 flex-col gap-3 border-b border-slate-800 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-white">{presentationPlan.title}</h2>
                    {presentationPlan.generationMode === 'fallback' && <span className="border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-400">事实模式</span>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">听众：{presentationPlan.audience}</p>
                  <p className="mt-1 max-w-4xl text-sm font-semibold leading-6 text-slate-200">{presentationPlan.keyTakeaway}</p>
                </div>
                <button type="button" onClick={handleExportPPT} disabled={loading || !selectedTemplate} className="report-studio-primary flex h-9 flex-shrink-0 items-center gap-2 rounded px-4 text-xs font-semibold disabled:opacity-50">
                  <Presentation className="h-4 w-4" />
                  导出当前方案
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="mx-auto max-w-5xl space-y-3">
                  {presentationPlan.slides.map((slide, index) => (
                    <article key={slide.id} className="border border-slate-800 bg-slate-900/50 p-4">
                      <div className="flex items-start gap-3">
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center bg-purple-500/15 text-xs font-semibold text-purple-300">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-slate-100">{slide.title}</h3>
                            <span className="border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">{slide.layout}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-purple-300">本页任务：{slide.purpose}</p>
                          <p className="mt-2 text-sm leading-6 text-slate-300">{slide.coreMessage}</p>
                          <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                            <div className="border-l-2 border-cyan-500/50 pl-3 text-slate-400"><span className="text-slate-500">页面承接：</span>{slide.relationToPrevious.label}</div>
                            <div className="border-l-2 border-amber-500/50 pl-3 text-slate-400"><span className="text-slate-500">建议图表：</span>{slide.visual.title || '无'} · {slide.visual.kind}</div>
                          </div>
                          {slide.supportingPoints.length > 0 && <ul className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2">{slide.supportingPoints.map((point, pointIndex) => <li key={pointIndex} className="bg-slate-950/70 p-2">{point.text}</li>)}</ul>}
                          <p className="mt-3 border-t border-slate-800 pt-3 text-xs leading-5 text-slate-500"><span className="text-slate-400">口播重点：</span>{slide.speakerNotes}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[520px] flex-1 items-center justify-center p-8">
              <div className="max-w-sm text-center">
                {activeTab === 'report' ? (
                  <FileText className="mx-auto h-10 w-10 text-slate-700" />
                ) : (
                  <Presentation className="mx-auto h-10 w-10 text-slate-700" />
                )}
                <h2 className="mt-4 text-sm font-medium text-slate-400">
                  {activeTab === 'report' ? '等待生成工作汇报' : '等待生成汇报 PPT'}
                </h2>
              </div>
            </div>
          )}
        </main>
      </div>

      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreviewTemplate(null)}>
          <div className="w-full max-w-3xl rounded-md border border-slate-700 bg-slate-900 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">{previewTemplate.name}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{previewTemplate.description}</p>
              </div>
              <button type="button" title="关闭预览" onClick={() => setPreviewTemplate(null)} className="p-1 text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div
              className="aspect-video border p-[6%]"
              style={{ backgroundColor: previewTemplate.backgroundColor, color: previewTemplate.textColor, borderColor: previewTemplate.secondaryColor }}
            >
              <div className="flex h-full flex-col">
                <div className="h-1 w-16" style={{ backgroundColor: previewTemplate.accentColor }} />
                <p className="mt-[8%] text-[clamp(12px,2.3vw,28px)] font-semibold" style={{ color: previewTemplate.primaryColor }}>
                  阶段工作经营汇报
                </p>
                <p className="mt-2 text-[clamp(8px,1vw,13px)]" style={{ color: previewTemplate.secondaryColor }}>
                  结论先行 · 数据支撑 · 动作闭环
                </p>
                <div className="mt-auto grid grid-cols-3 gap-3 border-t pt-4" style={{ borderColor: `${previewTemplate.secondaryColor}40` }}>
                  {['周期完成', '关键进展', '风险闭环'].map((label, index) => (
                    <div key={label}>
                      <p className="text-[clamp(12px,2vw,24px)] font-semibold" style={{ color: index === 2 ? previewTemplate.accentColor : previewTemplate.primaryColor }}>
                        {index === 0 ? '12' : index === 1 ? '8' : '2'}
                      </p>
                      <p className="text-[clamp(7px,.8vw,11px)]" style={{ color: previewTemplate.secondaryColor }}>{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setShowUploadModal(false)}>
          <div className="w-full max-w-xl rounded-md border border-slate-700 bg-slate-900 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Upload className="report-studio-accent h-4 w-4" />
                导入自定义 PPT 主题
              </h3>
              <button type="button" title="关闭" onClick={() => setShowUploadModal(false)} className="p-1 text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <textarea
              value={customJsonInput}
              onChange={(event) => setCustomJsonInput(event.target.value)}
              placeholder={'{"id":"company-theme","name":"公司主题","primaryColor":"#111827","accentColor":"#ea580c","slidesLayout":[{"slideType":"cover"},{"slideType":"summary"},{"slideType":"content"},{"slideType":"roadmap"}]}' }
              className="report-studio-field mt-4 h-56 w-full resize-none rounded border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-200 outline-none"
            />
            {uploadError && <p className="mt-2 text-xs text-rose-400">{uploadError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowUploadModal(false)} className="ui-cancel-button h-8 rounded px-3 text-xs">
                取消
              </button>
              <button type="button" onClick={handleUploadCustomTemplate} className="report-studio-primary h-8 rounded px-4 text-xs font-semibold">
                保存主题
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
