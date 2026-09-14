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
import { ThemeDatePicker } from './ThemeDatePicker';
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
  ChevronDown,
  ChevronUp,
  RotateCcw,
  SlidersHorizontal,
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

// Keep theme selection usable while the desktop database/API is still warming up.
const BUILTIN_PPT_TEMPLATES: PPTTemplate[] = [
  { id: 'tpl-executive', name: '经营汇报', description: '结论先行、数据支撑、风险与动作闭环。', theme: 'business', primaryColor: '#111827', secondaryColor: '#64748b', backgroundColor: '#ffffff', textColor: '#111827', cardBgColor: '#f8fafc', accentColor: '#ea580c', fontFamily: 'Microsoft YaHei', slidesLayout: [{ slideType: 'cover' }, { slideType: 'summary' }, { slideType: 'content' }, { slideType: 'roadmap' }] },
  { id: 'tpl-business', name: '商务蓝', description: '适合周报、月报和管理层汇报。', theme: 'business', primaryColor: '#1d4ed8', secondaryColor: '#334155', backgroundColor: '#f8fafc', textColor: '#0f172a', cardBgColor: '#ffffff', accentColor: '#0ea5e9', fontFamily: 'Aptos', slidesLayout: [{ slideType: 'cover' }, { slideType: 'summary' }, { slideType: 'content' }, { slideType: 'roadmap' }] },
  { id: 'tpl-tech', name: '科技青', description: '适合研发、产品和技术成果展示。', theme: 'tech', primaryColor: '#164e63', secondaryColor: '#0f766e', backgroundColor: '#f0fdfa', textColor: '#164e63', cardBgColor: '#ffffff', accentColor: '#14b8a6', fontFamily: 'Aptos', slidesLayout: [{ slideType: 'cover' }, { slideType: 'summary' }, { slideType: 'content' }, { slideType: 'roadmap' }] },
  { id: 'tpl-minimalist', name: '极简白', description: '高对比黑白排版，留白充足、适合快速阅读。', theme: 'minimalist', primaryColor: '#0f172a', secondaryColor: '#475569', backgroundColor: '#f8fafc', textColor: '#1e293b', cardBgColor: '#ffffff', accentColor: '#2563eb', fontFamily: 'Arial', slidesLayout: [{ slideType: 'cover' }, { slideType: 'summary' }, { slideType: 'content' }, { slideType: 'roadmap' }] },
];

const REPORT_PROMPT_GUIDANCE: Record<ReportType, string> = {
  daily: '围绕今日最重要的 3—5 件工作生成日报。先给一句结论，再写完成、进行中、阻塞和明日动作。每项工作都写清行动、结果、影响；没有证据的效果不要补写。整体控制在 300—500 字。',
  weekly: '围绕本周最重要的结果生成周报。按成果、关键进展、问题与风险、下周优先级组织；标题结论先行，工作事项按主题归并，不要照搬任务清单。整体控制在 500—800 字。',
  monthly: '围绕月度目标和重点项目生成月报。说明已交付成果、里程碑进展、偏差原因和下月重点；用可核验事实说明业务影响，不编造完成率、金额或同比数据。整体控制在 800—1200 字。',
  quarterly: '围绕季度目标达成和重点项目组合生成季报。突出阶段成果、关键偏差、资源与风险复盘、下一季度动作；每个章节只承担一个管理沟通任务。整体控制在 1000—1600 字。',
  semi_annual: '围绕半年阶段成果和能力沉淀生成半年报。说明战略目标进展、机制或方法沉淀、未完成事项及下半年优先级；结论先行，避免空泛表态。整体控制在 1200—1800 字。',
  annual: '围绕年度贡献和下一年度规划生成年报。按年度总览、重大成果、关键项目复盘、经验沉淀、未完成事项和明年计划组织；只使用任务证据，不能虚构经营指标。整体控制在 1500—2200 字。',
};

const DEFAULT_PPT_PROMPT = '生成一套 4—6 页的管理汇报 PPT，采用“核心结论—成果证据—进展与偏差—风险应对—下一阶段行动”的叙事。每页只有一个沟通任务，标题写结论，单页最多 4 个要点；优先使用数据卡、时间线或柱状图表达证据，避免大段文字和任务清单。';

const reportPromptFor = (type: ReportType) => `你是严谨的工作汇报策划助手。\n${REPORT_PROMPT_GUIDANCE[type]}\n使用金字塔结构：先给听众最需要记住的一句话，再用成果、进展、风险和计划支撑它。每条事实尽量写出“行动—结果—影响—下一动作”，未来事项只能放在计划中。风险按严重程度排序，写清影响和应对。没有证据的人员、金额、比例、完成率、同比环比不得推算。输出中文，表达专业、具体、克制。`;

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
  achievement: { icon: CheckCircle2, iconClass: 'text-success', borderClass: 'border-emerald-500/30' },
  progress: { icon: Activity, iconClass: 'text-info', borderClass: 'border-cyan-500/30' },
  risk: { icon: AlertCircle, iconClass: 'text-warning', borderClass: 'border-amber-500/30' },
  plan: { icon: Target, iconClass: 'text-info', borderClass: 'border-blue-500/30' },
  support: { icon: Handshake, iconClass: 'text-feature', borderClass: 'border-fuchsia-500/30' },
  custom: { icon: ListChecks, iconClass: 'text-sub', borderClass: 'border-subtle' },
};

const metricCards = (report: GeneratedReport) => [
  { label: '相关任务', value: report.metrics.relevantTasksCount, tone: 'text-main' },
  { label: '周期完成', value: report.metrics.completedTasksCount, tone: 'text-success' },
  { label: '有效推进', value: report.metrics.progressedTasksCount, tone: 'text-info' },
  { label: '待处理', value: report.metrics.pendingTasksCount, tone: 'text-info' },
  { label: '阻塞', value: report.metrics.blockedTasksCount, tone: 'text-danger' },
  { label: '逾期', value: report.metrics.overdueTasksCount, tone: 'text-warning' },
  { label: '后续计划', value: report.metrics.upcomingTasksCount, tone: 'text-feature' },
];

const ReportSectionView: React.FC<{ section: ReportSection }> = ({ section }) => {
  const tone = SECTION_TONES[section.kind] || SECTION_TONES.custom;
  const Icon = tone.icon;

  return (
    <section className={`flex min-h-[160px] flex-col border-t p-4 first:border-t-0 xl:border-t ${tone.borderClass}`}>
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${tone.iconClass}`} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-main">{section.title}</h3>
          {section.purpose && <p className="mt-0.5 text-[10px] text-quiet">本节任务：{section.purpose}</p>}
          {(section.conclusion || section.summary) && <p className="mt-1 text-xs font-medium leading-5 text-sub">{section.conclusion || section.summary}</p>}
        </div>
      </div>

      <div className="mt-3 flex-1">
        {section.items.length === 0 ? (
          <p className="text-xs text-quiet">暂无符合当前统计口径的记录</p>
        ) : (
          <ul className="divide-y divide-edge/80">
            {section.items.map((item, index) => (
              <li key={`${section.id}-${index}`} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-5 text-main">{item.headline}</p>
                    {item.detail && <p className="mt-0.5 text-xs leading-5 text-sub">{item.detail}</p>}
                    {item.impact && <p className="mt-1 text-xs leading-5 text-info/80">影响：{item.impact}</p>}
                    {item.nextAction && <p className="mt-1 text-xs leading-5 text-info/80">下一动作：{item.nextAction}</p>}
                  </div>
                  {item.severity && (
                    <span
                      className={`mt-0.5 flex-shrink-0 text-[10px] font-semibold uppercase ${
                        item.severity === 'high'
                          ? 'text-danger'
                          : item.severity === 'medium'
                            ? 'text-warning'
                            : 'text-sub'
                      }`}
                    >
                      {item.severity}
                    </span>
                  )}
                </div>
                {(item.dueDate || item.taskIds.length > 0) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-quiet">
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
  const [reportPrompt, setReportPrompt] = useState(() => reportPromptFor('daily'));
  const [pptPrompt, setPptPrompt] = useState(DEFAULT_PPT_PROMPT);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
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

  const activePrompt = activeTab === 'report' ? reportPrompt : pptPrompt;
  const setActivePrompt = (value: string) => activeTab === 'report' ? setReportPrompt(value) : setPptPrompt(value);
  const resetActivePrompt = () => setActivePrompt(activeTab === 'report' ? reportPromptFor(reportType) : DEFAULT_PPT_PROMPT);

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
      // Keep the selected theme in the generation request so the model can
      // adapt density, chart usage and visual language before export.
      pptTemplateId: selectedTemplateId || undefined,
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
          <p className="report-studio-desc mt-1 line-clamp-1 max-w-2xl text-xs">把任务事实变成能推动决策的汇报。先编辑提示词，再选择周期、主题和证据范围，模型只基于周期任务生成内容。</p>
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
                <p className="report-prompt-desc mt-1 text-[10px] leading-4">模型会自动追加任务事实、指标和 JSON 格式约束；这里控制表达、结构和视觉叙事。</p>
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
                  <span className="report-prompt-meta text-[10px] tabular-nums">{activePrompt.length}/12000 · 可直接修改后生成</span>
                  <button type="button" onClick={resetActivePrompt} className="report-prompt-reset flex items-center gap-1 text-[10px] transition-colors">
                    <RotateCcw className="h-3 w-3" />恢复推荐提示词
                  </button>
                </div>
                <details className="report-prompt-details mt-3 rounded-xl border px-3 py-2">
                  <summary className="cursor-pointer text-[10px] font-medium">查看发送时自动追加的固定上下文</summary>
                  <p className="mt-2 text-[10px] leading-4">系统会把汇报周期、项目范围、任务状态事件、确定性指标、数据截止日期、权限边界和 JSON 输出协议自动附在提示词后面。它们用于防止模型脱离真实任务编造内容，不是另一段需要维护的用户指令。</p>
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

        <main className="report-studio-canvas flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-edge/80 bg-canvas lg:min-h-0">
          {activeTab === 'report' && generatedReport ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-shrink-0 flex-col gap-3 border-b border-edge px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold leading-7 text-main">{generatedReport.title}</h2>
                    {generatedReport.generationMode === 'fallback' && (
                      <span className="border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-warning">事实模式</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-quiet">
                    {generatedReport.period} · 数据截至 {generatedReport.asOf}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
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
                    title="清空当前生成的工作汇报"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    清空内容
                  </button>
                </div>
              </div>

              <div className="report-studio-summary flex-shrink-0 border-b border-edge px-5 py-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="report-studio-accent mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div>
                    <p className="text-[11px] font-semibold text-quiet">推断听众 · {generatedReport.audience}</p>
                    <p className="mt-1 max-w-5xl text-sm font-semibold leading-6 text-main">{generatedReport.keyTakeaway}</p>
                    <p className="mt-1 max-w-5xl text-xs leading-5 text-sub">{generatedReport.executiveSummary}</p>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-visible lg:overflow-y-auto">
                <div className="grid min-h-full grid-cols-1 content-stretch xl:grid-cols-2 xl:auto-rows-fr">
                  {generatedReport.sections.map((section) => (
                    <ReportSectionView key={section.id} section={section} />
                  ))}
                </div>
                <details className="border-t border-edge px-5 py-4">
                  <summary className="cursor-pointer text-xs font-semibold text-sub">数据依据</summary>
                  <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden border border-edge bg-card sm:grid-cols-4 xl:grid-cols-7">
                    {metricCards(generatedReport).map((metric) => (
                      <div key={metric.label} className="bg-canvas px-3 py-3">
                        <p className={`text-lg font-semibold tabular-nums ${metric.tone}`}>{metric.value}</p>
                        <p className="mt-0.5 text-[10px] text-quiet">{metric.label}</p>
                      </div>
                    ))}
                  </div>
                </details>
                {generatedReport.dataNotes.length > 0 && (
                  <div className="border-t border-edge px-5 py-3 text-[10px] leading-5 text-quiet">
                    {generatedReport.dataNotes.join(' ')}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'ppt' && presentationPlan ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-shrink-0 flex-col gap-3 border-b border-edge px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-main">{presentationPlan.title}</h2>
                    {presentationPlan.generationMode === 'fallback' && <span className="border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-warning">事实模式</span>}
                  </div>
                  <p className="mt-1 text-xs text-quiet">听众：{presentationPlan.audience}</p>
                  <p className="mt-1 max-w-4xl text-sm font-semibold leading-6 text-main">{presentationPlan.keyTakeaway}</p>
                </div>
                <button type="button" onClick={handleExportPPT} disabled={loading || !selectedTemplate} className="report-studio-primary flex h-9 flex-shrink-0 items-center gap-2 rounded px-4 text-xs font-semibold disabled:opacity-50">
                  <Presentation className="h-4 w-4" />
                  导出当前方案
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="mx-auto max-w-5xl space-y-3">
                  {presentationPlan.slides.map((slide, index) => (
                    <article key={slide.id} className="border border-edge bg-surface/50 p-4">
                      <div className="flex items-start gap-3">
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center bg-purple-500/15 text-xs font-semibold text-feature">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-main">{slide.title}</h3>
                            <span className="border border-subtle px-1.5 py-0.5 text-[10px] text-sub">{slide.layout}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-feature">本页任务：{slide.purpose}</p>
                          <p className="mt-2 text-sm leading-6 text-sub">{slide.coreMessage}</p>
                          <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                            <div className="border-l-2 border-cyan-500/50 pl-3 text-sub"><span className="text-quiet">页面承接：</span>{slide.relationToPrevious.label}</div>
                            <div className="border-l-2 border-amber-500/50 pl-3 text-sub"><span className="text-quiet">建议图表：</span>{slide.visual.title || '无'} · {slide.visual.kind}</div>
                          </div>
                          {slide.supportingPoints.length > 0 && <ul className="mt-3 grid gap-2 text-xs text-sub md:grid-cols-2">{slide.supportingPoints.map((point, pointIndex) => <li key={pointIndex} className="bg-canvas/70 p-2">{point.text}</li>)}</ul>}
                          <p className="mt-3 border-t border-edge pt-3 text-xs leading-5 text-quiet"><span className="text-sub">口播重点：</span>{slide.speakerNotes}</p>
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
                  <FileText className="mx-auto h-10 w-10 text-sub" />
                ) : (
                  <Presentation className="mx-auto h-10 w-10 text-sub" />
                )}
                <h2 className="mt-4 text-sm font-medium text-sub">
                  {activeTab === 'report' ? '等待生成工作汇报' : '等待生成汇报 PPT'}
                </h2>
              </div>
            </div>
          )}
        </main>
      </div>

      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={() => setPreviewTemplate(null)}>
          <div className="w-full max-w-3xl rounded-md border border-subtle bg-surface p-5 shadow-popover" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-main">{previewTemplate.name}</h3>
                <p className="mt-0.5 text-xs text-quiet">{previewTemplate.description}</p>
              </div>
              <button type="button" title="关闭预览" onClick={() => setPreviewTemplate(null)} className="p-1 text-sub hover:text-main">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={() => setShowUploadModal(false)}>
          <div className="w-full max-w-xl rounded-md border border-subtle bg-surface p-5 shadow-popover" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-main">
                <Upload className="report-studio-accent h-4 w-4" />
                导入自定义 PPT 主题
              </h3>
              <button type="button" title="关闭" onClick={() => setShowUploadModal(false)} className="p-1 text-sub hover:text-main">
                <X className="h-5 w-5" />
              </button>
            </div>
            <textarea
              value={customJsonInput}
              onChange={(event) => setCustomJsonInput(event.target.value)}
              placeholder={'{"id":"company-theme","name":"公司主题","primaryColor":"#111827","accentColor":"#ea580c","slidesLayout":[{"slideType":"cover"},{"slideType":"summary"},{"slideType":"content"},{"slideType":"roadmap"}]}' }
              className="report-studio-field mt-4 h-56 w-full resize-none rounded border border-subtle bg-canvas p-3 font-mono text-xs leading-5 text-main outline-none"
            />
            {uploadError && <p className="mt-2 text-xs text-danger">{uploadError}</p>}
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
