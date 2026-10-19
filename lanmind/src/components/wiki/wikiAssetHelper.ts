/**
 * wikiAssetHelper — 处理编辑器剪贴板粘贴与文件拖拽中的附件/图片插入。
 *
 * CALLING SPEC:
 *   const snippet = await processPastedAsset(clipboardData);
 *   const snippet = await processDroppedAsset(dataTransfer);
 *
 * TOOL CONTRACT:
 *   - 自动将二进制文件存入本地资产库（wikiAssetStore）
 *   - 返回标准 Markdown 语法片段（图片：![name](path)，附件：[📎 name](path)）
 *   - 绝不产生 Base64 内联膨胀
 */

import { saveWikiAsset } from './wikiAssetStore';

export async function processPastedAsset(clipboardData: DataTransfer): Promise<string | null> {
  const items = clipboardData.items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (!file) continue;
      const { assetPath, fileName } = await saveWikiAsset(file, file.name || 'image.png');
      return `\n![${fileName}](${assetPath})\n`;
    } else if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) {
        const { assetPath, fileName } = await saveWikiAsset(file, file.name || 'attachment.bin');
        return `\n[📎 ${fileName}](${assetPath})\n`;
      }
    }
  }
  return null;
}

export async function processDroppedAsset(dataTransfer: DataTransfer): Promise<string | null> {
  const files = dataTransfer.files;
  if (!files || files.length === 0) return null;
  const file = files[0];
  const { assetPath, fileName } = await saveWikiAsset(file, file.name || 'file.bin');
  return file.type.startsWith('image/')
    ? `\n![${fileName}](${assetPath})\n`
    : `\n[📎 ${fileName}](${assetPath})\n`;
}
