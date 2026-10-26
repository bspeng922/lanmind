import type Vditor from 'vditor';

/**
 * Vditor 4.0.1 serializes the entire IR document when a space is entered.
 * Reuse unchanged blocks on large pages. Verify the combined result against
 * Lute whenever the block structure changes; contextual syntax uses Lute directly.
 */
export function installWikiSerializationCache(editor: Vditor): void {
  const lute = editor.vditor.lute;
  const serialize = lute.VditorIRDOM2Md.bind(lute);
  let previousHtml = '';
  let previousMarkdown = '';
  let shape = '';
  let compatible = false;
  let blocks = new Map<string, string>();
  lute.VditorIRDOM2Md = (html: string) => {
    if (html === previousHtml && previousHtml) return previousMarkdown;
    const remember = (markdown: string) => {
      previousHtml = html; previousMarkdown = markdown;
      return markdown;
    };
    const root = editor.vditor.ir.element;
    if (html.length < 50_000 || editor.getCurrentMode() !== 'ir' || html !== root.innerHTML ||
      /data-type="(?:link-ref[^" ]*|footnotes[^" ]*|html-block|toc-block)"/.test(html)) {
      shape = ''; blocks.clear();
      return remember(serialize(html));
    }
    const elements = Array.from(root.children);
    if (Array.from(root.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) ||
      elements.some(element => !/^(?:P|H[1-6]|UL|OL|BLOCKQUOTE|TABLE|PRE)$/.test(element.tagName) &&
        element.getAttribute('data-type') !== 'code-block') ||
      elements.some(element => !element.textContent?.trim())) {
      shape = ''; blocks.clear();
      return remember(serialize(html));
    }
    const nextBlocks = new Map<string, string>();
    const markdown = elements.map(element => {
      const source = element.outerHTML;
      const value = blocks.get(source) ?? serialize(source);
      nextBlocks.set(source, value);
      return value;
    }).join('\n');
    const nextShape = elements.map(element => `${element.tagName}:${element.getAttribute('data-type') || ''}`).join(',');
    blocks = nextBlocks;
    if (shape !== nextShape || !compatible) {
      const full = serialize(html);
      shape = nextShape; compatible = markdown === full;
      return remember(full);
    }
    return remember(markdown);
  };
}
