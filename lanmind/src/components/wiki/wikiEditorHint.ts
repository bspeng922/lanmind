/**
 * wikiEditorHint.ts — Enhances Vditor hint menu for code blocks and emojis.
 *
 * CALLING SPEC:
 *   installWikiEditorHint(editor: Vditor): void
 *
 * TOOL CONTRACT:
 *   - Expands the visible list in Vditor's hint dropdown from the default 8-item cap up to 32 items with scrolling.
 *   - Scrolls the currently focused item into view when navigating with ArrowUp / ArrowDown.
 *   - Preserves all original Vditor coordinate and positioning logic.
 *   - Deterministic and self-contained; no side effects outside the editor instance.
 */

import type Vditor from 'vditor';

export function installWikiEditorHint(editor: Vditor): void {
  const hint = (editor as any)?.vditor?.hint;
  if (!hint) return;

  const originalGenHTML = hint.genHTML.bind(hint);
  hint.genHTML = (data: Array<{ html: string; value: string }>, key: string, vditor: any) => {
    originalGenHTML(data, key, vditor);
    if (!data || data.length <= 8 || hint.element.style.display === 'none') return;

    let hintsHTML = '';
    data.forEach((hintData, i) => {
      if (i > 31) return;
      let html = hintData.html;
      if (key !== '') {
        const lastIndex = html.lastIndexOf('>') + 1;
        let replaceHtml = html.substr(lastIndex);
        const replaceIndex = replaceHtml.toLowerCase().indexOf(key.toLowerCase());
        if (replaceIndex > -1) {
          replaceHtml =
            replaceHtml.substring(0, replaceIndex) +
            '<b>' +
            replaceHtml.substring(replaceIndex, replaceIndex + key.length) +
            '</b>' +
            replaceHtml.substring(replaceIndex + key.length);
          html = html.substr(0, lastIndex) + replaceHtml;
        }
      }
      hintsHTML += `<button type="button" data-value="${encodeURIComponent(hintData.value)} "${
        i === 0 ? " class='vditor-hint--current'" : ''
      }> ${html}</button>`;
    });

    hint.element.innerHTML = hintsHTML;
    hint.element.querySelectorAll('button').forEach((element: HTMLElement) => {
      element.addEventListener('click', event => {
        hint.fillEmoji(element, vditor);
        event.preventDefault();
      });
    });
  };

  const originalSelect = hint.select.bind(hint);
  hint.select = (event: KeyboardEvent, vditor: any) => {
    const handled = originalSelect(event, vditor);
    if (handled && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const active = hint.element.querySelector('.vditor-hint--current') as HTMLElement | null;
      active?.scrollIntoView({ block: 'nearest' });
    }
    return handled;
  };
}
