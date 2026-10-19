/**
 * wikiExport — Dedicated export utility for Wiki documents.
 *
 * CALLING SPEC:
 *   const success = await exportWikiDocument(doc, projectName);
 *   const success = await exportAllWikiDocuments(docs, projects);
 *
 * TOOL CONTRACT:
 *   - Builds clean Markdown documents with title header, metadata, and body
 *   - Supports full Wiki export preserving complete hierarchical folder structure
 *   - Synchronizes referenced images and file attachments into 'assets/'
 *   - Rewrites relative asset links based on folder depth (e.g. '../assets/...') for universal compatibility
 *   - Uses Tauri native save dialog + '@tauri-apps/plugin-fs' on desktop
 *   - Falls back to HTML5 Blob download in web environments
 *   - Deterministic and pure; no class state
 */

import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { ApiService } from '../../services/api';
import { ZipArchive } from '../../utils/zipUtils';
import {
  getWikiAssetBlob,
  getAllWikiAssets,
  sanitizeAssetFileName,
} from './wikiAssetStore';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { WikiDocument, WikiProjectOption } from './wikiTypes';

export function getWikiMarkdownFilename(doc: WikiDocument): string {
  const sanitized = sanitizeAssetFileName(doc.title) || '未命名文档';
  return `${sanitized}.md`;
}

export function formatWikiMarkdown(doc: WikiDocument, projectName?: string): string {
  const title = doc.title.trim() || '未命名文档';
  const hasH1Title = doc.content.trim().startsWith('# ');

  const metaLines = [
    `> **文档信息**`,
    `> - 更新时间: ${doc.updatedAt ? new Date(doc.updatedAt).toLocaleString() : new Date().toLocaleString()}`,
  ];
  if (projectName) {
    metaLines.push(`> - 关联项目: ${projectName}`);
  }

  const metaBlock = metaLines.join('\n') + '\n\n';

  if (hasH1Title) {
    return `${metaBlock}${doc.content}`;
  }
  return `# ${title}\n\n${metaBlock}${doc.content}`;
}

/**
 * Export a single Wiki document as a standalone Markdown file.
 */
export async function exportWikiDocument(
  doc: WikiDocument,
  projectName?: string
): Promise<boolean> {
  const markdownContent = formatWikiMarkdown(doc, projectName);
  const defaultFilename = getWikiMarkdownFilename(doc);

  if (isTauri()) {
    const selected = await save({
      title: '导出 Wiki 页面为 Markdown',
      defaultPath: defaultFilename,
      filters: [{ name: 'Markdown (*.md)', extensions: ['md', 'markdown'] }],
    });
    if (!selected) {
      return false;
    }
    await ApiService.saveTextFile(selected, markdownContent);
    return true;
  }

  // Web fallback
  const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Internal helper to compute the path in the exported directory tree.
 */
function resolveDocExportPath(
  doc: WikiDocument,
  docsMap: Map<string, WikiDocument>,
  childrenMap: Map<string, WikiDocument[]>,
  memo: Map<string, { folderPath: string; filePath: string; depth: number }>
): { folderPath: string; filePath: string; depth: number } {
  if (memo.has(doc.id)) {
    return memo.get(doc.id)!;
  }

  const safeTitle = sanitizeAssetFileName(doc.title) || '未命名文档';
  const hasChildren = (childrenMap.get(doc.id) || []).length > 0;

  if (!doc.parentId || !docsMap.has(doc.parentId)) {
    // Root level
    if (hasChildren) {
      const result = {
        folderPath: safeTitle,
        filePath: `${safeTitle}/${safeTitle}.md`,
        depth: 1,
      };
      memo.set(doc.id, result);
      return result;
    }
    const result = {
      folderPath: '',
      filePath: `${safeTitle}.md`,
      depth: 0,
    };
    memo.set(doc.id, result);
    return result;
  }

  // Child level
  const parent = docsMap.get(doc.parentId)!;
  const parentResolved = resolveDocExportPath(parent, docsMap, childrenMap, memo);

  const currentFolder = parentResolved.folderPath
    ? `${parentResolved.folderPath}/${safeTitle}`
    : safeTitle;

  if (hasChildren) {
    const result = {
      folderPath: currentFolder,
      filePath: `${currentFolder}/${safeTitle}.md`,
      depth: parentResolved.depth + 1,
    };
    memo.set(doc.id, result);
    return result;
  }

  const result = {
    folderPath: parentResolved.folderPath,
    filePath: parentResolved.folderPath ? `${parentResolved.folderPath}/${safeTitle}.md` : `${safeTitle}.md`,
    depth: parentResolved.depth,
  };
  memo.set(doc.id, result);
  return result;
}

/**
 * Adjust markdown relative asset paths based on directory depth.
 * Depth 0: 'assets/...'
 * Depth 1: '../assets/...'
 * Depth 2: '../../assets/...'
 */
function adjustAssetPathsForDepth(content: string, depth: number): string {
  if (depth === 0) return content;
  const prefix = '../'.repeat(depth);
  // Match standard markdown links to assets/
  return content.replace(/(\]\()assets\//g, `$1${prefix}assets/`);
}

/**
 * Export all Wiki documents preserving the full directory tree and attachments as a ZIP archive.
 */
export async function exportAllWikiDocuments(
  documents: WikiDocument[],
  projects: WikiProjectOption[] = []
): Promise<boolean> {
  if (!documents || documents.length === 0) {
    return false;
  }

  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const docsMap = new Map(documents.map((d) => [d.id, d]));
  const childrenMap = new Map<string, WikiDocument[]>();

  documents.forEach((d) => {
    const pId = d.parentId && docsMap.has(d.parentId) ? d.parentId : '';
    const list = childrenMap.get(pId) || [];
    list.push(d);
    childrenMap.set(pId, list);
  });

  const pathMemo = new Map<string, { folderPath: string; filePath: string; depth: number }>();
  const zip = new ZipArchive();
  const referencedAssets = new Set<string>();

  // 1. Process documents and write markdown files
  for (const doc of documents) {
    const { filePath, depth } = resolveDocExportPath(doc, docsMap, childrenMap, pathMemo);
    const projectName = doc.projectId ? projectMap.get(doc.projectId) : undefined;
    const baseMarkdown = formatWikiMarkdown(doc, projectName);

    // Collect all asset references: (assets/...)
    const assetMatches = baseMarkdown.match(/assets\/[a-zA-Z0-9_\-.]+/g) || [];
    assetMatches.forEach((match) => referencedAssets.add(match));

    // Rewrites relative paths so any reader like Obsidian or VSCode resolves properly
    const adjustedContent = adjustAssetPathsForDepth(baseMarkdown, depth);
    zip.addFile(filePath, adjustedContent, doc.updatedAt ? new Date(doc.updatedAt) : new Date());
  }

  // 2. Load and add all referenced assets into the root assets/ folder
  const allStoredAssets = await getAllWikiAssets();
  for (const assetPath of referencedAssets) {
    let blob = allStoredAssets.get(assetPath);
    if (!blob) {
      blob = await getWikiAssetBlob(assetPath) || undefined;
    }
    if (blob) {
      zip.addFile(assetPath, blob);
    }
  }

  // 3. Generate ZIP binary
  const zipBytes = await zip.generateAsync();
  const todayStr = new Date().toISOString().slice(0, 10);
  const defaultZipName = `LanMind-Wiki-Export-${todayStr}.zip`;

  // 4. Save to filesystem or trigger browser download
  if (isTauri()) {
    const selected = await save({
      title: '导出全部 Wiki 文档 (保留原始目录结构与附件)',
      defaultPath: defaultZipName,
      filters: [{ name: 'ZIP 压缩包 (*.zip)', extensions: ['zip'] }],
    });
    if (!selected) {
      return false;
    }
    await writeFile(selected, zipBytes);
    return true;
  }

  // Web environment fallback
  const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultZipName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * 导出 Wiki 文档为 PDF 格式（生成高质量矢量排版打印流）。
 */
export async function exportWikiPdf(doc: WikiDocument, projectName?: string): Promise<boolean> {
  const title = doc.title.trim() || '未命名文档';
  const parsedHtml = DOMPurify.sanitize(marked.parse(doc.content || '', { gfm: true, breaks: true }) as string);
  const updatedAt = doc.updatedAt ? new Date(doc.updatedAt).toLocaleString() : new Date().toLocaleString();
  const authorInfo = doc.createdByName ? `创建者: ${doc.createdByName}` : '';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { margin: 20mm 15mm; size: A4; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color: #1a1a1a;
    line-height: 1.6;
    padding: 20px;
    margin: 0 auto;
    max-width: 800px;
  }
  h1.doc-title { font-size: 26px; margin-bottom: 8px; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; }
  .doc-meta { font-size: 12px; color: #666; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid #e5e5e5; }
  h1, h2, h3, h4, h5, h6 { color: #111; margin-top: 1.2em; margin-bottom: 0.6em; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background-color: #f8fafc; font-weight: 600; }
  pre { background: #f1f5f9; padding: 12px; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 13px; }
  code { background: #f1f5f9; padding: 2px 5px; border-radius: 4px; font-family: monospace; font-size: 13px; }
  blockquote { border-left: 4px solid #3b82f6; margin: 12px 0; padding-left: 14px; color: #475569; }
  img { max-width: 100%; height: auto; }
</style>
</head>
<body>
  <h1 class="doc-title">${title}</h1>
  <div class="doc-meta">
    <span>更新时间: ${updatedAt}</span>
    ${authorInfo ? `<span> · ${authorInfo}</span>` : ''}
    ${projectName ? `<span> · 关联项目: ${projectName}</span>` : ''}
  </div>
  <div class="doc-content">${parsedHtml}</div>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  return new Promise((resolve) => {
    const docFrame = iframe.contentWindow?.document;
    if (!docFrame) {
      document.body.removeChild(iframe);
      resolve(false);
      return;
    }
    docFrame.open();
    docFrame.write(html);
    docFrame.close();

    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          resolve(true);
        } catch {
          resolve(false);
        } finally {
          setTimeout(() => {
            if (document.body.contains(iframe)) document.body.removeChild(iframe);
          }, 2000);
        }
      }, 250);
    };
  });
}

/**
 * 导出 Wiki 文档为 Word (.doc / .docx 兼容) 格式。
 */
export async function exportWikiWord(doc: WikiDocument, projectName?: string): Promise<boolean> {
  const title = doc.title.trim() || '未命名文档';
  const parsedHtml = DOMPurify.sanitize(marked.parse(doc.content || '', { gfm: true, breaks: true }) as string);
  const updatedAt = doc.updatedAt ? new Date(doc.updatedAt).toLocaleString() : new Date().toLocaleString();
  const authorInfo = doc.createdByName ? `创建者: ${doc.createdByName}` : '';

  const wordContent = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset="utf-8">
<title>${title}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
  body { font-family: 'Microsoft YaHei', 'SimSun', sans-serif; font-size: 11pt; line-height: 1.6; }
  h1 { font-size: 18pt; color: #1e3a8a; }
  h2 { font-size: 15pt; color: #1e40af; }
  h3 { font-size: 13pt; color: #1d4ed8; }
  p { margin: 6pt 0; }
  table { border-collapse: collapse; width: 100%; margin: 12pt 0; }
  td, th { border: 1px solid #999; padding: 6pt 8pt; font-size: 10pt; }
  th { background-color: #f1f5f9; font-weight: bold; }
  code { font-family: Consolas, monospace; background: #f3f4f6; padding: 2pt 4pt; }
  pre { background: #f3f4f6; padding: 8pt; font-family: Consolas, monospace; }
  blockquote { border-left: 3pt solid #3b82f6; padding-left: 8pt; color: #4b5563; }
</style>
</head>
<body>
  <h1>${title}</h1>
  <p style="font-size: 9pt; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding-bottom: 6pt; margin-bottom: 12pt;">
    更新时间: ${updatedAt} ${authorInfo ? ` | ${authorInfo}` : ''} ${projectName ? ` | 关联项目: ${projectName}` : ''}
  </p>
  <div>${parsedHtml}</div>
</body>
</html>`;

  const defaultFilename = `${sanitizeAssetFileName(doc.title) || '未命名文档'}.doc`;

  if (isTauri()) {
    const selected = await save({
      title: '导出 Wiki 页面为 Word 文档',
      defaultPath: defaultFilename,
      filters: [{ name: 'Word 文档 (*.doc)', extensions: ['doc'] }],
    });
    if (!selected) return false;
    await ApiService.saveTextFile(selected, wordContent);
    return true;
  }

  const blob = new Blob(['\ufeff' + wordContent], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

