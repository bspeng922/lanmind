import { isTauri } from '@tauri-apps/api/core';
import { downloadDir, join } from '@tauri-apps/api/path';
import { writeFile } from '@tauri-apps/plugin-fs';
import pptxgenImport from 'pptxgenjs';
import { GeneratedPresentation, PPTTemplate, PresentationSlide, ReportMetrics } from '../types';

// PptxGenJS is published in both ESM and CommonJS shapes; support both so
// desktop/Vite and direct Node-based export validation use the same path.
type PptxGenConstructorType = typeof import('pptxgenjs').default;
const PptxGenConstructor = (
  (pptxgenImport as unknown as { default?: PptxGenConstructorType }).default ??
  (pptxgenImport as unknown as PptxGenConstructorType)
);

const W = 13.333;
const H = 7.5;
const cleanHex = (value: string, fallback: string) => /^[0-9a-f]{6}$/i.test(value.replace('#', '')) ? value.replace('#', '').toUpperCase() : fallback;
const safeFileName = (title: string) => title.replace(/[\\/:*?"<>|]/g, '_').trim() || '汇报PPT';
const displayWidth = (value: string) => Array.from(value).reduce((sum, char) => sum + (/^[\u0000-\u00ff]$/.test(char) ? 0.55 : 1), 0);
const fontSize = (value: string, preferred: number, threshold: number, minimum: number) => Math.max(minimum, preferred - Math.max(0, Math.ceil((displayWidth(value) - threshold) / 10) * 2));

const METRIC_LABELS: Record<keyof ReportMetrics, string> = {
  relevantTasksCount: '相关任务', completedTasksCount: '周期完成', progressedTasksCount: '有效推进',
  pendingTasksCount: '待处理', blockedTasksCount: '阻塞', overdueTasksCount: '逾期', upcomingTasksCount: '后续计划',
};

export async function exportPresentationToPPTX(plan: GeneratedPresentation, template: PPTTemplate) {
  const pptx = new PptxGenConstructor();
  pptx.author = 'LanMind';
  pptx.company = 'LanMind';
  pptx.title = plan.title;
  pptx.subject = plan.keyTakeaway;
  pptx.defineLayout({ name: 'LANMIND_WIDE', width: W, height: H });
  pptx.layout = 'LANMIND_WIDE';
  pptx.theme = { headFontFace: template.fontFamily || 'Microsoft YaHei', bodyFontFace: template.fontFamily || 'Microsoft YaHei' };
  const c = {
    background: cleanHex(template.backgroundColor, 'FFFFFF'), primary: cleanHex(template.primaryColor, '111827'),
    secondary: cleanHex(template.secondaryColor, '64748B'), text: cleanHex(template.textColor, '111827'),
    card: cleanHex(template.cardBgColor, 'F8FAFC'), accent: cleanHex(template.accentColor, 'EA580C'),
    border: 'D8DEE9', green: '059669', blue: '2563EB', amber: 'D97706', rose: 'E11D48', cyan: '0891B2', violet: '7C3AED',
  };
  const face = (template.fontFamily || 'Microsoft YaHei').split(',')[0].replace(/["']/g, '').trim();

  const addText = (slide: pptxgenImport.Slide, value: string, options: Parameters<pptxgenImport.Slide['addText']>[1]) =>
    slide.addText(value, { fontFace: face, color: c.text, margin: 0, breakLine: false, fit: 'shrink', ...options });

  const base = (item: PresentationSlide, index: number) => {
    const slide = pptx.addSlide();
    slide.background = { color: c.background };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: H, fill: { color: c.accent }, line: { color: c.accent, transparency: 100 } });
    addText(slide, item.purpose.toUpperCase(), { x: 0.62, y: 0.26, w: 8.7, h: 0.22, fontSize: 7.5, bold: true, color: c.accent, charSpacing: 1.1 });
    addText(slide, `${plan.period}  |  LanMind`, { x: 0.62, y: 7.13, w: 6, h: 0.18, fontSize: 7.5, color: c.secondary });
    addText(slide, String(index + 1).padStart(2, '0'), { x: 12.1, y: 7.1, w: 0.55, h: 0.2, fontSize: 8, color: c.secondary, align: 'right' });
    slide.addNotes(`${item.relationToPrevious.label}\n\n${item.speakerNotes}`);
    return slide;
  };

  const titleBlock = (slide: pptxgenImport.Slide, item: PresentationSlide) => {
    addText(slide, item.title, { x: 0.62, y: 0.67, w: 11.8, h: 0.62, fontSize: fontSize(item.title, 24, 28, 15), bold: true, color: c.primary });
    addText(slide, item.coreMessage, { x: 0.65, y: 1.43, w: 11.65, h: 0.76, fontSize: fontSize(item.coreMessage, 14, 52, 9), bold: true });
  };

  const pointCards = (slide: pptxgenImport.Slide, item: PresentationSlide, y = 2.55) => {
    const points = item.supportingPoints.slice(0, 4);
    if (!points.length) return;
    const columns = points.length === 1 ? 1 : 2;
    const rows = Math.ceil(points.length / columns);
    const width = columns === 1 ? 11.7 : 5.68;
    const height = Math.min(1.55, 3.85 / rows);
    points.forEach((point, i) => {
      const x = 0.67 + (i % columns) * 6.02;
      const py = y + Math.floor(i / columns) * (height + 0.22);
      slide.addShape(pptx.ShapeType.rect, { x, y: py, w: width, h: height, fill: { color: c.card }, line: { color: c.border, width: 0.8 } });
      slide.addShape(pptx.ShapeType.rect, { x, y: py, w: 0.07, h: height, fill: { color: c.accent }, line: { color: c.accent, transparency: 100 } });
      addText(slide, point.text, { x: x + 0.25, y: py + 0.16, w: width - 0.48, h: height - 0.3, fontSize: fontSize(point.text, 11.5, 52, 8.5), valign: 'middle' });
    });
  };

  const metricKeys = (item: PresentationSlide) => item.visual.metricKeys.slice(0, 4);
  const metrics = (slide: pptxgenImport.Slide, item: PresentationSlide, y = 2.52) => {
    const keys = metricKeys(item);
    keys.forEach((key, index) => {
      const width = 11.7 / Math.max(1, keys.length);
      const x = 0.67 + index * width;
      addText(slide, String(plan.metrics[key]), { x, y, w: width - 0.18, h: 0.65, fontSize: 29, bold: true, color: index % 2 ? c.cyan : c.accent, align: 'center' });
      addText(slide, METRIC_LABELS[key], { x, y: y + 0.72, w: width - 0.18, h: 0.24, fontSize: 9, color: c.secondary, align: 'center' });
    });
  };

  plan.slides.forEach((item, index) => {
    const slide = base(item, index);
    if (item.layout === 'cover') {
      addText(slide, item.title, { x: 0.72, y: 1.3, w: 10.6, h: 1.25, fontSize: fontSize(item.title, 31, 26, 21), bold: true, color: c.primary, valign: 'middle' });
      slide.addShape(pptx.ShapeType.line, { x: 0.72, y: 2.86, w: 2.2, h: 0, line: { color: c.accent, width: 3 } });
      addText(slide, item.coreMessage, { x: 0.72, y: 3.18, w: 9.6, h: 1.45, fontSize: fontSize(item.coreMessage, 16, 46, 10.5), bold: true, valign: 'middle' });
      addText(slide, `推断听众\n${plan.audience}\n\n${plan.period}\n数据截至 ${plan.asOf}`, { x: 10.45, y: 4.86, w: 2.25, h: 1.35, fontSize: 9, color: c.secondary, align: 'right', valign: 'bottom' });
      return;
    }
    titleBlock(slide, item);
    if (item.layout === 'metric-focus') {
      metrics(slide, item, 2.55);
      pointCards(slide, item, 4.1);
    } else if (item.layout === 'comparison') {
      pointCards(slide, item, 2.48);
      const mid = 6.52;
      slide.addShape(pptx.ShapeType.line, { x: mid, y: 2.42, w: 0, h: 3.75, line: { color: c.border, width: 1.2 } });
    } else if (item.layout === 'timeline' || item.layout === 'process' || item.layout === 'closing') {
      const points = item.supportingPoints.slice(0, 4);
      const stepWidth = 11.2 / Math.max(1, points.length);
      slide.addShape(pptx.ShapeType.line, { x: 1, y: 3.12, w: 10.8, h: 0, line: { color: c.border, width: 2 } });
      points.forEach((point, i) => {
        const x = 0.82 + i * stepWidth;
        slide.addShape(pptx.ShapeType.ellipse, { x, y: 2.84, w: 0.56, h: 0.56, fill: { color: c.accent }, line: { color: c.accent } });
        addText(slide, String(i + 1), { x, y: 3.01, w: 0.56, h: 0.13, fontSize: 8, bold: true, color: 'FFFFFF', align: 'center' });
        addText(slide, point.text, { x: x - 0.35, y: 3.62, w: stepWidth - 0.12, h: 1.4, fontSize: fontSize(point.text, 10.5, 34, 8), align: 'center', valign: 'top' });
      });
      if (!points.length) metrics(slide, item, 3.05);
    } else if (item.layout === 'risk-action') {
      if (item.visual.metricKeys.length) metrics(slide, item, 2.4);
      pointCards(slide, item, 3.78);
    } else if (item.visual.kind === 'donut' && metricKeys(item).length > 1) {
      const keys = metricKeys(item);
      slide.addChart(pptx.ChartType.doughnut, [{ name: item.visual.title || '确定性指标', labels: keys.map(key => METRIC_LABELS[key]), values: keys.map(key => plan.metrics[key]) }], {
        x: 0.75, y: 2.35, w: 4.55, h: 3.55, holeSize: 68, showLegend: true, legendPos: 'b', showTitle: false,
        chartColors: [c.green, c.blue, c.rose, c.amber],
      });
      pointCards(slide, { ...item, supportingPoints: item.supportingPoints.slice(0, 2) }, 2.58);
    } else {
      pointCards(slide, item, 2.48);
    }
  });

  const fileName = `${safeFileName(plan.title)}.pptx`;
  if (isTauri()) {
    const data = await pptx.write({ outputType: 'uint8array', compression: true });
    if (!(data instanceof Uint8Array)) throw new Error('PPTX 文件数据生成失败');
    const savedPath = await join(await downloadDir(), fileName);
    await writeFile(savedPath, data);
    return { fileName, slideCount: plan.slides.length, savedPath };
  }
  await pptx.writeFile({ fileName, compression: true });
  return { fileName, slideCount: plan.slides.length, savedPath: null };
}
