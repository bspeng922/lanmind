/**
 * wikiAssetHelper — 处理编辑器剪贴板粘贴与文件拖拽中的附件/图片插入。
 *
 * CALLING SPEC:
 *   const snippet = await wikiFilesMarkdown(clipboardFiles(clipboardData));
 *   const snippet = await wikiFilesMarkdown(Array.from(dataTransfer.files));
 *
 * TOOL CONTRACT:
 *   - 自动将二进制文件存入本地资产库（wikiAssetStore）
 *   - 返回标准 Markdown 语法片段（图片：![name](path)，附件：[📎 name](path)）
 *   - 绝不产生 Base64 内联膨胀
 */

import { saveWikiAsset, getWikiAssetUrl } from './wikiAssetStore';

export function clipboardFiles(data: DataTransfer): File[] {
  const files = Array.from(data.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file);
  return files.length ? files : Array.from(data.files || []);
}

export async function wikiFilesMarkdown(files: File[]): Promise<string> {
  const snippets = [];
  for (const file of files) {
    const { assetPath, fileName } = await saveWikiAsset(file, file.name);
    const label = fileName.replace(/[\\[\]]/g, '\\$&');
    const destination = assetPath.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)).join('/');
    snippets.push(file.type.startsWith('image/') ? `![${label}](${destination})` : `[📎 ${label}](${destination})`);
  }
  return `\n${snippets.join('\n\n')}\n`;
}

/** Hydrate display-only nodes. Canonical URLs are retained in the Markdown model. */
export async function hydrateWikiAssets(root: HTMLElement, allowDetached = false): Promise<void> {
  await Promise.all(Array.from(root.querySelectorAll<HTMLImageElement | HTMLAnchorElement>('img[src], a[href]')).map(async node => {
    const attribute = node.tagName === 'IMG' ? 'src' : 'href';
    const raw = node.getAttribute(attribute) || '';
    if (!/^(?:\.\.?\/)*assets\//.test(raw)) return;
    const assetPath = raw.replace(/^(?:\.\.?\/)+/, '');

    if (node.tagName === 'A') {
      const fileName = node.textContent?.replace(/^📎\s*/, '').trim() || assetPath.split('_').slice(3).join('_') || 'attachment';
      if (!node.hasAttribute('download')) {
        node.setAttribute('download', fileName);
      }
    }

    const url = await getWikiAssetUrl(assetPath);
    if (url && (allowDetached || node.isConnected) && node.getAttribute(attribute) === raw) {
      node.setAttribute(attribute, url);
    } else if (!url && !raw.startsWith('/')) {
      node.setAttribute(attribute, `/${assetPath}`);
    }
  }));
}
