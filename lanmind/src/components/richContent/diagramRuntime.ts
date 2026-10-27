import { tr } from '../../i18n';
import { drawDiagram, type DiagramDrawing } from './engines';

interface State { key: string; ready: Promise<void>; dispose(): void }
export interface RichContentSession { update(): Promise<void>; dispose(): void }
export function isDarkTheme(): boolean { return document.documentElement.classList.contains('dark'); }

/** Reuse closed diagram nodes while the surrounding streamed Markdown changes. */
export function reconcileRichMarkup(root: HTMLElement, html: string): void {
  const existing = new Map<string, HTMLElement[]>();
  const key = (node: Element) => JSON.stringify([node.getAttribute('data-rich-kind'), node.querySelector('code')?.textContent]);
  root.querySelectorAll<HTMLElement>('.rich-diagram').forEach(node => {
    const value = key(node); const list = existing.get(value) || []; list.push(node); existing.set(value, list);
  });
  const template = document.createElement('template'); template.innerHTML = html;
  template.content.querySelectorAll('.rich-diagram').forEach(node => {
    const keep = existing.get(key(node))?.shift(); if (keep) node.replaceWith(keep);
  });
  root.replaceChildren(template.content);
}

/** A self-contained SVG snapshot, including text from interactive Markmap labels. */
export function snapshotSvg(element: HTMLElement): string {
  const original = element.querySelector('svg');
  if (!original) throw new Error('No SVG to export');
  const svg = original.cloneNode(true) as SVGSVGElement;
  const bounds = original.getBoundingClientRect();
  const width = Math.max(1, bounds.width || Number.parseFloat(original.getAttribute('width') || '') || 800);
  const height = Math.max(1, bounds.height || Number.parseFloat(original.getAttribute('height') || '') || 400);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.maxWidth = 'none'; svg.style.width = `${width}px`; svg.style.height = `${height}px`;
  svg.querySelectorAll('foreignObject').forEach(node => {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', node.getAttribute('x') || '0');
    text.setAttribute('y', String(Number(node.getAttribute('y') || 0) + 16));
    text.setAttribute('font-family', 'sans-serif'); text.setAttribute('font-size', '14');
    text.setAttribute('fill', getComputedStyle(element).color); text.textContent = node.textContent; node.replaceWith(text);
  });
  return new XMLSerializer().serializeToString(svg);
}

async function downloadDrawing(preview: HTMLElement, name: string) {
  const canvas = preview.querySelector('canvas');
  const blob = canvas ? await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image export failed'))))
    : new Blob([snapshotSvg(preview)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `${name}.${canvas ? 'png' : 'svg'}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function mount(figure: HTMLElement, dark: boolean, exportMode: boolean, key: string): State {
  const abort = new AbortController();
  const source = figure.querySelector<HTMLElement>('.rich-diagram-source')!;
  const text = source.querySelector('code')?.textContent || '';
  const kind = figure.dataset.richKind || '';
  let drawing: DiagramDrawing | undefined;
  let resize: ResizeObserver | undefined;
  figure.querySelectorAll(':scope > :not(.rich-diagram-source)').forEach(node => node.remove());
  const preview = document.createElement('div'); preview.className = 'rich-diagram-preview';
  const status = document.createElement('div'); status.className = 'rich-diagram-status'; status.setAttribute('role', 'status');
  status.textContent = tr('common:richContent.loading'); figure.append(status, preview);
  source.hidden = true; figure.dataset.richState = 'loading';
  if (!exportMode) {
    const toolbar = document.createElement('div'); toolbar.className = 'rich-diagram-toolbar';
    const title = document.createElement('strong'); title.textContent = kind; toolbar.append(title);
    const button = (label: string, action: () => void | Promise<void>) => {
      const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
      node.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        void Promise.resolve().then(action).catch(() => { status.hidden = false; status.textContent = tr('common:richContent.actionFailed'); });
      }); toolbar.append(node); return node;
    };
    const toggle = button(tr('common:richContent.source'), () => {
      source.hidden = !source.hidden; preview.hidden = !source.hidden;
      toggle.textContent = tr(source.hidden ? 'common:richContent.source' : 'common:richContent.preview');
      drawing?.resize?.();
    });
    button(tr('common:richContent.copy'), async () => { await navigator.clipboard.writeText(text); });
    button(tr('common:richContent.expand'), async () => {
      if (figure.requestFullscreen) { await figure.requestFullscreen(); drawing?.resize?.(); }
      else {
        const dialog = document.createElement('dialog'); dialog.className = 'rich-diagram-dialog';
        const close = document.createElement('button'); close.textContent = tr('common:richContent.close'); close.onclick = () => dialog.close();
        const image = document.createElement('img'); const canvas = preview.querySelector('canvas');
        const url = canvas ? canvas.toDataURL('image/png') : URL.createObjectURL(new Blob([snapshotSvg(preview)], { type: 'image/svg+xml' }));
        image.src = url; dialog.append(close, image); document.body.append(dialog);
        dialog.onclose = () => { if (!canvas) URL.revokeObjectURL(url); dialog.remove(); }; dialog.showModal();
      }
    });
    button(tr('common:richContent.download'), () => downloadDrawing(preview, kind));
    figure.prepend(toolbar);
  }
  const ready = drawDiagram(kind, text, preview, dark, abort.signal).then(result => {
    if (abort.signal.aborted) { result.dispose(); return; }
    drawing = result; status.hidden = true; figure.dataset.richState = 'ready';
    resize = new ResizeObserver(() => drawing?.resize?.()); resize.observe(preview);
  }).catch(error => {
    if (abort.signal.aborted) return;
    preview.replaceChildren(); source.hidden = false; status.dataset.error = 'true';
    status.textContent = `${tr('common:richContent.renderFailed')} ${error instanceof Error ? error.message : String(error)}`;
    figure.dataset.richState = 'error';
  });
  return { key, ready, dispose() { abort.abort(); resize?.disconnect(); drawing?.dispose(); } };
}

export function createRichContentSession(root: HTMLElement, options: { dark?: boolean; exportMode?: boolean } = {}): RichContentSession {
  const states = new Map<HTMLElement, State>();
  let disposed = false;
  const session: RichContentSession = {
    update() {
      if (disposed) return Promise.resolve();
      const nodes = new Set(root.querySelectorAll<HTMLElement>('.rich-diagram'));
      states.forEach((state, node) => { if (!nodes.has(node)) { state.dispose(); states.delete(node); } });
      const dark = options.dark ?? isDarkTheme();
      nodes.forEach(node => {
        const key = JSON.stringify([node.dataset.richKind, node.querySelector('code')?.textContent, dark, document.documentElement.lang]);
        const previous = states.get(node); if (previous?.key === key) return;
        previous?.dispose(); states.set(node, mount(node, dark, Boolean(options.exportMode), key));
      });
      return Promise.all([...states.values()].map(state => state.ready)).then(() => {});
    },
    dispose() { disposed = true; themeObserver.disconnect(); states.forEach(state => state.dispose()); states.clear(); },
  };
  const themeObserver = new MutationObserver(() => { void session.update(); });
  if (options.dark === undefined) themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'lang'] });
  return session;
}
