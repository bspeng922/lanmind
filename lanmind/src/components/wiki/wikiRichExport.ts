import { renderWikiMarkdown } from './wikiMarkdown';
import { getWikiAssetBlob } from './wikiAssetStore';
import type { WikiDocument } from './wikiTypes';
import { prepareRichContentForExport } from '../richContent/richExport';

async function exportBody(doc: WikiDocument): Promise<HTMLDivElement> {
  const body = document.createElement('div');
  body.innerHTML = renderWikiMarkdown(doc.content);
  await Promise.all(Array.from(body.querySelectorAll<HTMLImageElement>('img')).map(async image => {
    const src = image.getAttribute('src') || '';
    const blob = /^(?:\.\.?\/)*assets\//.test(src)
      ? await getWikiAssetBlob(src)
      : await fetch(src).then(response => {
        if (!response.ok) throw new Error(`无法读取图片：${image.alt || src}`);
        return response.blob();
      });
    if (!blob) throw new Error(`无法读取图片：${image.alt || src}`);
    image.src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }));
  await prepareRichContentForExport(body);
  return body;
}

function metadata(doc: WikiDocument, projectName?: string): string {
  return [doc.updatedAt && `更新时间：${new Date(doc.updatedAt).toLocaleString()}`,
    doc.createdByName && `创建者：${doc.createdByName}`, projectName && `关联项目：${projectName}`].filter(Boolean).join(' · ');
}

async function loadImage(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = source;
  await image.decode();
  return image;
}

/** Real Office Open XML, with editable paragraphs/tables and embedded pictures. */
export async function buildWikiDocx(doc: WikiDocument, projectName?: string): Promise<Uint8Array> {
  const d = await import('docx');
  const body = await exportBody(doc);
  type Inline = InstanceType<typeof d.TextRun> | InstanceType<typeof d.ImageRun> | InstanceType<typeof d.ExternalHyperlink>;
  type Block = InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>;
  type Style = { bold?: boolean; italics?: boolean; strike?: boolean; underline?: { type: typeof d.UnderlineType.SINGLE }; font?: string; highlight?: 'yellow' };
  async function inline(node: Node, style: Style = {}): Promise<Inline[]> {
    if (node.nodeType === Node.TEXT_NODE) return [new d.TextRun({ text: node.textContent || '', ...style })];
    if (!(node instanceof HTMLElement)) return [];
    if (node.tagName === 'BR') return [new d.TextRun({ break: 1 })];
    if (node instanceof HTMLInputElement) return [new d.TextRun(node.checked ? '☑ ' : '☐ ')];
    if (node instanceof HTMLImageElement) {
      const image = await loadImage(node.src);
      // Rich snapshots carry extra pixels for sharpness; retain their CSS display size.
      const displayWidth = node.classList.contains('rich-export-image')
        ? Number.parseFloat(node.style.width) || image.naturalWidth : image.naturalWidth;
      const displayHeight = image.naturalHeight * displayWidth / image.naturalWidth;
      const scale = Math.min(1, 600 / displayWidth, 800 / displayHeight);
      const width = Math.max(1, Math.round(displayWidth * scale));
      const height = Math.max(1, Math.round(displayHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(image.naturalWidth, 1600);
      canvas.height = Math.max(1, Math.round(image.naturalHeight * canvas.width / image.naturalWidth));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = new Uint8Array(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer());
      return [new d.ImageRun({ type: 'png', data, transformation: { width, height },
        altText: { title: node.alt, description: node.alt, name: node.alt || 'image' } })];
    }
    const next: Style = { ...style };
    if (['B', 'STRONG', 'TH'].includes(node.tagName)) next.bold = true;
    if (['I', 'EM'].includes(node.tagName)) next.italics = true;
    if (['S', 'DEL'].includes(node.tagName)) next.strike = true;
    if (node.tagName === 'U') next.underline = { type: d.UnderlineType.SINGLE };
    if (node.tagName === 'CODE') next.font = 'Consolas';
    if (node.tagName === 'MARK') next.highlight = 'yellow';
    const runs = (await Promise.all(Array.from(node.childNodes).map(child => inline(child, next)))).flat();
    const href = node.getAttribute('href') || '';
    if (node.tagName === 'A' && /^(https?:|mailto:)/i.test(href)) {
      return [new d.ExternalHyperlink({ link: href, children: runs.filter(run => !(run instanceof d.ExternalHyperlink)) })];
    }
    return runs;
  }
  async function blocks(parent: HTMLElement, level = 0): Promise<Block[]> {
    const output: Block[] = [];
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent?.trim()) output.push(new d.Paragraph({ children: await inline(node) }));
        continue;
      }
      if (!(node instanceof HTMLElement)) continue;
      if (node instanceof HTMLTableElement) {
        output.push(new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows: await Promise.all(Array.from(node.rows).map(async row => new d.TableRow({
          tableHeader: row.parentElement?.tagName === 'THEAD',
          children: await Promise.all(Array.from(row.cells).map(async cell => new d.TableCell({
            children: [new d.Paragraph({ children: await inline(cell) })],
            shading: cell.tagName === 'TH' ? { fill: 'F1F5F9' } : undefined,
          }))),
        }))) }));
      } else if (node.tagName === 'UL' || node.tagName === 'OL') {
        let index = Number(node.getAttribute('start') || 1);
        for (const item of Array.from(node.children)) {
          const content = item.cloneNode(true) as HTMLElement;
          content.querySelectorAll('ul,ol').forEach(list => list.remove());
          output.push(new d.Paragraph({
            children: [new d.TextRun(node.tagName === 'OL' ? `${index++}. ` : '• '), ...await inline(content)],
            indent: { left: 360 * (level + 1), hanging: 240 }, spacing: { after: 100 },
          }));
          for (const list of Array.from(item.children).filter(child => ['UL', 'OL'].includes(child.tagName))) {
            const wrapper = document.createElement('div'); wrapper.append(list.cloneNode(true));
            output.push(...await blocks(wrapper, level + 1));
          }
        }
      } else if (['DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE'].includes(node.tagName)) {
        output.push(...await blocks(node, level));
      } else if (node.tagName === 'PRE') {
        for (const line of (node.textContent || '').split('\n')) output.push(new d.Paragraph({
          children: [new d.TextRun({ text: line, font: 'Consolas', size: 19 })],
          shading: { fill: 'F1F5F9' }, spacing: { after: 0, line: 260 },
        }));
      } else if (node.tagName === 'HR') {
        output.push(new d.Paragraph({ border: { bottom: { color: 'CBD5E1', size: 4, style: d.BorderStyle.SINGLE } } }));
      } else {
        const heading = /^H([1-6])$/.exec(node.tagName);
        output.push(new d.Paragraph({ children: await inline(node),
          heading: heading ? `Heading${heading[1]}` as typeof d.HeadingLevel.HEADING_1 : undefined,
          spacing: { after: 160 }, keepNext: Boolean(heading),
        }));
      }
    }
    return output;
  }
  const file = new d.Document({ title: doc.title, creator: doc.createdByName || 'LanMind',
    styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 }, paragraph: { spacing: { line: 320 } } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 850, right: 850 } } },
      children: [new d.Paragraph({ text: doc.title.trim() || '未命名文档', heading: d.HeadingLevel.TITLE }),
        new d.Paragraph({ children: [new d.TextRun({ text: metadata(doc, projectName), color: '64748B', size: 18 })], spacing: { after: 300 } }),
        ...await blocks(body)],
    }],
  });
  return new Uint8Array(await d.Packer.toArrayBuffer(file));
}

const pdfStyles = `
  :host { all: initial; color-scheme: light; }
  .page { display: flow-root; box-sizing: border-box; width: 794px; background: #fff; color: #18181b; font: 15px/1.7 'Microsoft YaHei', 'PingFang SC', sans-serif; overflow-wrap: anywhere; }
  h1 { font-size: 28px; } h2 { font-size: 23px; } h3 { font-size: 19px; }
  h1,h2,h3,h4,h5,h6 { line-height: 1.4; margin: 20px 0 12px; }
  p { margin: 10px 0; } .meta { color: #64748b; font-size: 12px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; } th,td { border: 1px solid #cbd5e1; padding: 7px 10px; } th { background: #f1f5f9; }
  pre { white-space: pre-wrap; background: #f1f5f9; padding: 12px; } code { font-family: Consolas, monospace; font-size: 13px; }
  blockquote { margin-left: 0; border-left: 3px solid #94a3b8; padding-left: 14px; color: #475569; }
  img { max-width: 100%; max-height: 1000px; object-fit: contain; height: auto; } a { color: #2563eb; } mark { background: #fef08a; }
`;

/** Generate PDF bytes locally. Page-sized captures avoid browser canvas limits on long documents. */
export async function buildWikiPdf(doc: WikiDocument, projectName?: string): Promise<Uint8Array> {
  const [{ jsPDF }, { default: capture }] = await Promise.all([import('jspdf'), import('html2canvas-pro')]);
  const content = await exportBody(doc);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:794px;z-index:-10000;pointer-events:none;';
  // Isolate export layout from app theme and global editor styles.
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = pdfStyles; shadow.append(style);
  const source = document.createElement('div'); source.className = 'page';
  const title = document.createElement('h1'); title.textContent = doc.title.trim() || '未命名文档';
  const meta = document.createElement('p'); meta.className = 'meta'; meta.textContent = metadata(doc, projectName);
  source.append(title, meta, content); shadow.append(source); document.body.append(host);
  try {
    await document.fonts.ready;
    await Promise.all(Array.from(source.querySelectorAll('img')).map(image => image.decode()));
    const origin = source.getBoundingClientRect().top;
    const spans: { top: number; bottom: number }[] = [];
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      for (const rect of Array.from(range.getClientRects())) spans.push({ top: rect.top - origin, bottom: rect.bottom - origin });
    }
    source.querySelectorAll('img,tr,h1,h2,h3,h4,h5,h6').forEach(element => {
      const rect = element.getBoundingClientRect(); spans.push({ top: rect.top - origin, bottom: rect.bottom - origin });
    });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    pdf.setProperties({ title: doc.title, creator: 'LanMind' });
    const pageHeight = Math.floor(794 * 257 / 180);
    const totalHeight = Math.ceil(source.getBoundingClientRect().height);
    let start = 0;
    while (start < totalHeight) {
      let end = Math.min(start + pageHeight, totalHeight);
      // Avoid cutting a text line, table row, heading or picture across pages.
      for (let attempt = 0; attempt < spans.length; attempt++) {
        const crossing = spans.filter(span => span.top > start && span.top < end && span.bottom > end && span.bottom - span.top < pageHeight);
        if (!crossing.length) break;
        end = Math.floor(Math.min(...crossing.map(span => span.top)));
      }
      if (end <= start) end = Math.min(start + pageHeight, totalHeight);
      const viewport = document.createElement('div');
      viewport.style.cssText = `width:794px;height:${end - start}px;overflow:hidden;background:#fff;position:relative;`;
      const clone = source.cloneNode(true) as HTMLElement;
      clone.style.transform = `translateY(-${start}px)`;
      viewport.append(clone); shadow.append(viewport);
      source.style.display = 'none';
      // html2canvas works on a regular DOM tree; copy the isolated export styles into its container.
      const captureHost = document.createElement('div');
      captureHost.style.cssText = 'position:fixed;left:0;top:0;z-index:-10000;pointer-events:none;';
      const scopedStyle = document.createElement('style');
      scopedStyle.textContent = pdfStyles.replace(/([^{}]+)\{/g, (_, selectors: string) => selectors.split(',').map(selector =>
        selector.trim() === ':host' ? '.wiki-pdf-capture' : `.wiki-pdf-capture ${selector.trim()}`).join(',') + ' {');
      captureHost.className = 'wiki-pdf-capture'; captureHost.append(scopedStyle, viewport); document.body.append(captureHost);
      try {
        const canvas = await capture(viewport, { scale: 2, backgroundColor: '#ffffff', logging: false });
        if (start) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 15, 20, 180, (end - start) * 180 / 794);
        clone.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
          if (!/^https?:/i.test(anchor.href)) return;
          const rect = anchor.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
          if (rect.top >= bounds.top && rect.bottom <= bounds.bottom) pdf.link(15 + (rect.left - bounds.left) * 180 / 794,
            20 + (rect.top - bounds.top) * 180 / 794, rect.width * 180 / 794, rect.height * 180 / 794, { url: anchor.href });
        });
        canvas.width = canvas.height = 0;
      } finally { captureHost.remove(); source.style.display = ''; }
      start = end;
    }
    return new Uint8Array(pdf.output('arraybuffer'));
  } finally { host.remove(); }
}
