import type Vditor from 'vditor';
import { createRichContentSession } from '../richContent/diagramRuntime';
import { renderMath } from '../richContent/richMarkdown';
import { sanitizeRichHtml } from '../richContent/sanitize';
import { renderWikiMarkdown } from './wikiMarkdown';
import { tr } from '../../i18n';
import 'katex/dist/katex.min.css';
import '../richContent/rich-content.css';

/** Preview DOM is never part of Markdown, clipboard serialization or Lute's input. */
export function stripWikiRichPreviews(html: string): string {
  if (!html.includes('wiki-rich-')) return html;
  const template = document.createElement('template'); template.innerHTML = html;
  template.content.querySelectorAll('.wiki-rich-preview').forEach(node => node.remove());
  template.content.querySelectorAll('.wiki-rich-source').forEach(node => node.replaceWith(...Array.from(node.childNodes)));
  return template.innerHTML;
}

/** Pinned Vditor adapter: native remote/math renderers remain disabled. */
export function installWikiRichPreview(editor: Vditor): () => void {
  const root = editor.vditor.ir.element;
  root.classList.add('rich-content', 'markdown-body');
  const lute = editor.vditor.lute;
  const serialize = lute.VditorIRDOM2Md.bind(lute);
  const spin = lute.SpinVditorIRDOM.bind(lute);
  lute.VditorIRDOM2Md = html => serialize(stripWikiRichPreviews(html));
  lute.SpinVditorIRDOM = html => spin(stripWikiRichPreviews(html));
  const session = createRichContentSession(root);
  const signatures = new WeakMap<Element, string>();
  let frame = 0; let disposed = false;
  const unwrap = (block: HTMLElement) => {
    block.querySelectorAll(':scope > .wiki-rich-preview').forEach(node => node.remove());
    block.querySelectorAll(':scope > .wiki-rich-source').forEach(node => node.replaceWith(...Array.from(node.childNodes)));
    block.removeAttribute('data-wiki-rich-block');
    signatures.delete(block);
  };
  const refresh = () => {
    frame = 0; if (disposed || editor.getCurrentMode() !== 'ir') return;
    const selection = document.activeElement === root ? window.getSelection() : null;
    const anchor = selection?.anchorNode;
    root.querySelectorAll<HTMLElement>('[data-type="code-block"], [data-type="math-block"].vditor-ir__node, p[data-block], li[data-marker]').forEach(block => {
      if (block.closest('.wiki-rich-preview, .wiki-rich-source') || block.closest('code')) return;
      if (block.tagName === 'LI' && block.querySelector(':scope > p[data-block]')) return;
      const selected = anchor && block.contains(anchor) && !(anchor.parentElement?.closest('.wiki-rich-preview'));
      if (selected) { if (block.querySelector(':scope > .wiki-rich-preview')) unwrap(block); return; }
      let html: string;
      let source: string;
      let language = '';
      if (block.tagName === 'P' || block.tagName === 'LI') {
        if (!/\$|\\/.test(block.textContent || '')) return;
        source = serialize(stripWikiRichPreviews(block.outerHTML));
        if (!/\$|\\[([]/.test(source)) return;
        if (signatures.get(block) === JSON.stringify([language, source]) && block.querySelector(':scope > .wiki-rich-preview')) return;
        html = renderWikiMarkdown(source);
        if (!html.includes('data-math-source=')) return;
      } else {
        const code = block.querySelector(':scope > pre > code, :scope > .wiki-rich-source > pre > code'); if (!code) return;
        language = (block.getAttribute('data-type') === 'math-block' ? 'math' : code.className.replace('language-', '')).trim().toLowerCase();
        source = code.textContent || '';
        if (signatures.get(block) === JSON.stringify([language, source]) && block.querySelector(':scope > .wiki-rich-preview')) return;
        html = ['math', 'latex', 'tex'].includes(language) ? `<div class="rich-math-display">${sanitizeRichHtml(renderMath(source, true))}</div>`
          : renderWikiMarkdown(`\`\`\`${language}\n${source}\n\`\`\``);
      }
      const signature = JSON.stringify([language, source]);
      unwrap(block);
      if (block.tagName === 'P' || block.tagName === 'LI') {
        const original = document.createElement('span'); original.className = 'wiki-rich-source'; original.hidden = true;
        original.append(...Array.from(block.childNodes)); block.append(original);
      } else block.setAttribute('data-wiki-rich-block', 'true');
      const preview = document.createElement(block.tagName === 'P' || block.tagName === 'LI' ? 'span' : 'div');
      preview.className = 'wiki-rich-preview rich-content'; preview.contentEditable = 'false';
      if (block.tagName !== 'P' && block.tagName !== 'LI') { preview.classList.add('vditor-ir__preview'); preview.dataset.render = '1'; }
      preview.addEventListener('click', event => event.stopPropagation());
      if (block.tagName === 'P' || block.tagName === 'LI') {
        const temp = document.createElement('div'); temp.innerHTML = html;
        if (block.tagName === 'LI') {
          const item = temp.querySelector('li') || temp.firstElementChild;
          preview.innerHTML = item ? item.innerHTML : html;
        } else {
          const paragraph = temp.firstElementChild;
          preview.innerHTML = paragraph?.tagName === 'P' ? paragraph.innerHTML : html;
        }
      } else preview.innerHTML = html;
      if (preview.querySelector('.rich-code-block')) {
        // The original code node remains the editor's only editable code node.
        preview.querySelectorAll('pre > code').forEach(code => {
          const span = document.createElement('span'); span.className = code.className; span.innerHTML = code.innerHTML; code.replaceWith(span);
        });
        const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = tr('wiki:wikiEditor.copyCode');
        copy.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void Promise.resolve().then(() => navigator.clipboard.writeText(source)).catch(() => { copy.textContent = tr('common:richContent.actionFailed'); }); });
        preview.querySelector('.rich-code-header')?.append(copy);
      }
      block.append(preview); signatures.set(block, signature);
    });
    void session.update();
  };
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(refresh); };
  const observer = new MutationObserver(records => {
    if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('.wiki-rich-preview'))) schedule();
  });
  observer.observe(root, { childList: true, characterData: true, subtree: true });
  const reveal = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const preview = target.closest<HTMLElement>('.wiki-rich-preview');
    if (!preview || target.closest('button, a') || (event.type === 'click' && preview.querySelector('.rich-diagram, .rich-code-block'))) return;
    const block = preview.parentElement!; unwrap(block);
    const range = document.createRange(); const code = block.querySelector('code'); range.selectNodeContents(code || block); range.collapse(false);
    root.focus(); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    event.preventDefault(); event.stopPropagation();
  };
  root.addEventListener('click', reveal, true); root.addEventListener('dblclick', reveal, true);
  root.addEventListener('blur', schedule); root.addEventListener('keyup', schedule); root.addEventListener('mouseup', schedule);
  schedule();
  return () => {
    disposed = true; cancelAnimationFrame(frame); observer.disconnect(); session.dispose();
    root.removeEventListener('click', reveal, true); root.removeEventListener('dblclick', reveal, true);
    root.removeEventListener('blur', schedule); root.removeEventListener('keyup', schedule); root.removeEventListener('mouseup', schedule);
  };
}
