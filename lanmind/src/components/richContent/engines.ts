import { sanitizeRichHtml } from './sanitize';

export interface DiagramDrawing { dispose(): void; resize?(): void }
const empty = (): DiagramDrawing => ({ dispose() {} });
let serial = 0;
let svgQueue: Promise<unknown> = Promise.resolve();
const svgCache = new Map<string, string>();

function queued<T>(work: () => Promise<T>): Promise<T> {
  const result = svgQueue.then(work, work);
  svgQueue = result.catch(() => {});
  return result;
}

let graphWorker: Worker | undefined;
let graphIdle: ReturnType<typeof setTimeout> | undefined;
const graphJobs = new Map<number, { resolve(svg: string): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
function graphviz(source: string): Promise<string> {
  clearTimeout(graphIdle);
  if (!graphWorker) {
    graphWorker = new Worker(new URL('./graphviz.worker.ts', import.meta.url), { type: 'module' });
    graphWorker.onmessage = event => {
      const job = graphJobs.get(event.data.id); if (!job) return;
      graphJobs.delete(event.data.id); clearTimeout(job.timer);
      if (event.data.error) job.reject(new Error(event.data.error)); else job.resolve(event.data.svg);
      if (!graphJobs.size) graphIdle = setTimeout(() => { graphWorker?.terminate(); graphWorker = undefined; }, 1000);
    };
    graphWorker.onerror = () => resetGraphWorker('Graphviz worker failed');
  }
  return new Promise((resolve, reject) => {
    const id = ++serial;
    graphJobs.set(id, { resolve, reject, timer: setTimeout(() => resetGraphWorker('Graphviz rendering timed out'), 15_000) });
    graphWorker!.postMessage({ id, source });
  });
}
function resetGraphWorker(message: string) {
  clearTimeout(graphIdle);
  graphWorker?.terminate(); graphWorker = undefined;
  graphJobs.forEach(job => { clearTimeout(job.timer); job.reject(new Error(message)); }); graphJobs.clear();
}

/** JSON is data only: never run generated callbacks or load image/URL resources. */
export function diagramJson(source: string): any {
  const value = JSON.parse(source);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  const visit = (item: unknown, depth = 0) => {
    if (depth > 40) throw new Error('Diagram data is nested too deeply');
    if (typeof item === 'string' && /^\s*(?:https?:\/\/|\/\/|javascript:|data:|blob:|image:\/\/)/i.test(item)) throw new Error('External diagram resources are not supported');
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid diagram property');
      if (key === 'image' && child) throw new Error('Diagram image resources are not supported');
      visit(child, depth + 1);
    }
  };
  visit(value); return value;
}

async function svgDrawing(kind: string, source: string, dark: boolean): Promise<string> {
  const key = JSON.stringify([kind, source, dark]);
  const cached = svgCache.get(key); if (cached) return cached;
  let svg: string;
  if (kind === 'graphviz' || kind === 'dot') svg = await graphviz(source);
  else if (kind === 'plantuml' || kind === 'puml') {
    if (/!include\b|!includeurl\b|!import\b|<img\b|%load_json\b|%load_yaml\b/i.test(source)) throw new Error('PlantUML external includes and images are not supported');
    svg = await queued(async () => {
      const [engine, viz] = await Promise.all([import('@plantuml/core'), import('@viz-js/viz'), import('@plantuml/core/themes.js')]);
      (globalThis as any).PLANTUML_VIZ = viz;
      (globalThis as any).PLANTUML_FILE_LOADER = (_path: string, _context: unknown, _ok: unknown, fail: (message: string) => void) => { fail('External includes are disabled'); return true; };
      (globalThis as any).PLANTUML_STDLIB_LOADER = (_path: string, _ok: unknown, fail: (message: string) => void) => { fail('Additional PlantUML libraries are not bundled'); return true; };
      return new Promise<string>((resolve, reject) => engine.renderToString(source.split('\n'), resolve, (message: string) => reject(new Error(message)), { dark, maxSvgSize: 8192 }));
    });
  } else {
    svg = await queued(async () => {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'neutral',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
        htmlLabels: false,
        flowchart: {
          htmlLabels: false,
          minNodeWidth: 0,
          wrappingWidth: 350,
        },
        suppressErrorRendering: true,
        maxTextSize: 100_000,
        maxEdges: 1000,
      });
      return (await mermaid.render(`rich-mermaid-${++serial}`, source)).svg;
    });
  }
  if (svgCache.size >= 48) svgCache.delete(svgCache.keys().next().value!);
  svgCache.set(key, svg); return svg;
}

function mindmapOption(tree: object, dark: boolean) {
  return { tooltip: { renderMode: 'richText' }, series: [{ type: 'tree', data: [tree], initialTreeDepth: -1,
    roam: true, expandAndCollapse: true, label: { position: 'left', color: dark ? '#ededed' : '#171717' },
    leaves: { label: { position: 'right' } }, lineStyle: { color: dark ? '#777' : '#aaa' } }] };
}

export async function drawDiagram(kind: string, source: string, container: HTMLElement, dark: boolean, signal: AbortSignal): Promise<DiagramDrawing> {
  if (source.length > 100_000) throw new Error('Diagram source exceeds 100 KB');
  const active = () => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };
  active();
  if (kind === 'mindmap' && /^\s*mindmap\b/.test(source)) kind = 'mermaid';
  if (kind === 'mindmap' && !/^\s*\{/.test(source)) kind = 'markmap';
  if (kind === 'chart' && /"series"\s*:/.test(source)) kind = 'echarts';
  if (['echarts', 'chart', 'chartjs', 'mindmap'].includes(kind)) {
    const option = diagramJson(source);
    const host = document.createElement('div'); host.className = 'rich-chart';
    if (kind === 'chart' || kind === 'chartjs') {
      const { Chart, registerables } = await import('chart.js'); active();
      Chart.register(...registerables); container.append(host);
      const canvas = document.createElement('canvas'); host.append(canvas);
      const chart = new Chart(canvas, { ...option, options: { ...option.options, responsive: true, maintainAspectRatio: false,
        animation: false, color: dark ? '#ededed' : '#171717' } });
      return { dispose: () => chart.destroy(), resize: () => chart.resize() };
    }
    const echarts = await import('echarts'); active(); container.append(host);
    const chart = echarts.init(host, dark ? 'dark' : undefined, { renderer: 'svg' });
    try { chart.setOption(kind === 'mindmap' ? mindmapOption(option, dark) : { ...option, animation: false, backgroundColor: 'transparent', tooltip: { ...option.tooltip, renderMode: 'richText' } }); }
    catch (error) { chart.dispose(); throw error; }
    return { dispose: () => chart.dispose(), resize: () => chart.resize() };
  }
  if (kind === 'markmap') {
    const [{ Transformer }, { Markmap }] = await Promise.all([import('markmap-lib/no-plugins'), import('markmap-view')]); active();
    const { root } = new Transformer().transform(source);
    const clean = (node: typeof root) => {
      const content = document.createElement('template'); content.innerHTML = sanitizeRichHtml(node.content);
      content.content.querySelectorAll('img,svg,math').forEach(element => element.replaceWith(document.createTextNode(element.getAttribute('alt') || '')));
      node.content = content.innerHTML; node.children?.forEach(clean);
    }; clean(root);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'rich-chart'); svg.style.height = '360px'; svg.style.width = '100%'; container.append(svg);
    svg.style.setProperty('--markmap-text-color', dark ? '#ededed' : '#171717');
    svg.style.setProperty('--markmap-circle-open-bg', dark ? '#333' : '#fff');
    svg.style.setProperty('--markmap-code-bg', dark ? '#333' : '#f0f0f0');
    svg.style.setProperty('--markmap-code-color', dark ? '#ededed' : '#333');
    const map = Markmap.create(svg, { autoFit: true, duration: 0, embedGlobalCSS: true }, root);
    await map.fit();
    return { dispose: () => map.destroy(), resize: () => { void map.fit(); } };
  }
  if (kind === 'flowchart') {
    const module = await import('flowchart.js'); active();
    const chart = module.default.parse(source);
    chart.drawSVG(container, { 'font-color': dark ? '#ededed' : '#171717', 'line-color': dark ? '#aaa' : '#555',
      'element-color': dark ? '#aaa' : '#555', fill: dark ? '#222' : '#fff', 'font-size': 14 });
    const svg = container.querySelector('svg')?.outerHTML || '';
    chart.clean();
    const { sanitizeDiagramSvg } = await import('./sanitize');
    container.innerHTML = sanitizeDiagramSvg(svg, `rich-flow-${++serial}`);
    return empty();
  }
  const svg = await svgDrawing(kind, source, dark); active();
  const { sanitizeDiagramSvg } = await import('./sanitize');
  container.innerHTML = sanitizeDiagramSvg(svg, `rich-svg-${++serial}`);
  if (!container.querySelector('svg')) throw new Error('Diagram did not produce an SVG');
  return empty();
}
