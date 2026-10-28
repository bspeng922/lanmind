import DOMPurify from 'dompurify';

/** Drawing and MathML metadata are inert, not URLs. URI policy must not erase them. */
export function sanitizeRichHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|lanmind|data|blob):|assets\/|\.\.?\/|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    ADD_TAGS: ['semantics', 'annotation'],
    ADD_ATTR: ['encoding'],
    ADD_URI_SAFE_ATTR: ['d', 'points', 'viewbox', 'preserveaspectratio', 'encoding', 'display', 'transform'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'foreignObject'],
  });
}

function getDocumentNonce(): string {
  if (typeof document === 'undefined') return '';
  const element = document.querySelector('script[nonce], style[nonce]') as HTMLElement | null;
  if (element?.nonce) return element.nonce;
  const meta = document.querySelector('meta[name="csp-nonce"]') as HTMLMetaElement | null;
  return meta?.content || '';
}

/** Engine SVGs cannot execute scripts, embed HTML or fetch external resources. */
export function sanitizeDiagramSvg(svg: string, prefix: string): string {
  const safe = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_URI_SAFE_ATTR: ['d', 'points', 'viewbox', 'preserveaspectratio', 'transform'],
    FORBID_TAGS: ['script', 'foreignObject', 'image', 'a', 'animate', 'set'],
    FORBID_ATTR: ['href', 'xlink:href', 'onload'],
  });
  const host = document.createElement('div'); host.innerHTML = safe;
  const ids = new Map<string, string>();
  host.querySelectorAll('[id]').forEach(node => {
    const id = node.id; ids.set(id, `${prefix}-${id}`); node.id = `${prefix}-${id}`;
  });
  host.querySelectorAll('*').forEach(node => {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name === 'aria-labelledby' || attr.name === 'aria-describedby') {
        node.setAttribute(attr.name, attr.value.split(/\s+/).map(id => ids.get(id) || id).join(' '));
        continue;
      }
      let value = attr.value.replace(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g,
        (_, id: string) => `url(#${ids.get(id) || id})`);
      value = value.replace(/url\((?!#[^)]*\))[^)]*\)/gi, 'none');
      if (attr.name !== 'id' && value !== attr.value) node.setAttribute(attr.name, value);
    }
  });
  const nonce = getDocumentNonce();
  host.querySelectorAll('style').forEach(style => {
    let css = (style.textContent || '').replace(/@import[^;]+;?/gi, '').replace(/url\((?!\s*['"]?#[^)]*\))[^)]*\)/gi, 'none');
    ids.forEach((value, id) => { css = css.replace(new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g'), `#${value}`); });
    style.textContent = css;
    if (nonce) {
      style.setAttribute('nonce', nonce);
      (style as any).nonce = nonce;
    }
  });
  return host.innerHTML;
}
