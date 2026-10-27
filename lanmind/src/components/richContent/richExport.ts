import { createRichContentSession, snapshotSvg } from './diagramRuntime';
import 'katex/dist/katex.min.css';
import './rich-content.css';

async function svgPng(svg: string): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const factor = Math.min(2, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(image.naturalWidth * factor)); canvas.height = Math.max(1, Math.ceil(image.naturalHeight * factor));
    const context = canvas.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height); return canvas.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

/** Materialize diagrams before either Office serialization or PDF pagination. */
export async function prepareRichContentForExport(body: HTMLElement): Promise<void> {
  if (!body.querySelector('.rich-diagram, [data-math-source]')) return;
  const host = document.createElement('div'); host.className = 'rich-content';
  host.style.cssText = 'position:fixed;left:0;top:0;width:760px;z-index:-10000;pointer-events:none;background:#fff;color:#171717;font:15px/1.8 sans-serif;--bg-surface:#fff;--bg-canvas:#fff;--text-main:#171717;--text-sub:#555;--border-main:#ddd;';
  body.classList.add('rich-content'); host.append(body); document.body.append(host);
  const session = createRichContentSession(body, { dark: false, exportMode: true });
  try {
    await session.update(); await document.fonts.ready;
    const failed = body.querySelector<HTMLElement>('[data-rich-state="error"]');
    if (failed) throw new Error(failed.querySelector('.rich-diagram-status')?.textContent || 'Diagram export failed');
    for (const figure of Array.from(body.querySelectorAll<HTMLElement>('.rich-diagram'))) {
      const preview = figure.querySelector<HTMLElement>('.rich-diagram-preview')!;
      const canvas = preview.querySelector('canvas');
      const bounds = preview.getBoundingClientRect();
      const image = new Image(); image.className = 'rich-export-image'; image.alt = figure.dataset.richKind || 'Diagram';
      image.src = canvas ? canvas.toDataURL('image/png') : await svgPng(snapshotSvg(preview));
      image.style.width = `${Math.min(720, bounds.width)}px`; image.style.maxHeight = '900px'; image.style.objectFit = 'contain';
      await image.decode(); figure.replaceWith(image);
    }
    const { default: capture } = await import('html2canvas-pro');
    for (const formula of Array.from(body.querySelectorAll<HTMLElement>('.rich-math-display, .rich-math-inline, p > .rich-math-block'))) {
      const text = formula.dataset.mathSource || formula.querySelector<HTMLElement>('[data-math-source]')?.dataset.mathSource || '';
      formula.querySelectorAll('.katex-mathml').forEach(node => node.remove());
      formula.style.cssText = 'display:inline-block;max-width:none;width:max-content;overflow:visible;padding:6px;background:#fff;color:#171717;';
      const bounds = formula.getBoundingClientRect();
      const canvas = await capture(formula, { backgroundColor: '#ffffff', scale: Math.min(2, 4096 / Math.max(1, bounds.width, bounds.height)), logging: false });
      const image = new Image(); image.alt = text; image.className = 'rich-export-image';
      image.src = canvas.toDataURL('image/png'); image.style.width = `${Math.min(720, bounds.width)}px`;
      image.style.verticalAlign = 'middle'; image.style.maxHeight = '900px'; image.style.objectFit = 'contain';
      await image.decode(); formula.replaceWith(image); canvas.width = canvas.height = 0;
    }
  } finally { session.dispose(); body.remove(); host.remove(); }
}
