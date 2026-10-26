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

async function saveBinaryExport(bytes: Uint8Array, title: string, extension: string, mime: string): Promise<boolean> {
  const filename = (sanitizeAssetFileName(title) || '未命名文档') + '.' + extension;
  if (isTauri()) {
    const selected = await save({ defaultPath: filename, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (!selected) return false;
    await writeFile(selected, bytes);
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

/** Export a PDF file directly without opening the system print dialog. */
export async function exportWikiPdf(doc: WikiDocument, projectName?: string): Promise<boolean> {
  const { buildWikiPdf } = await import('./wikiRichExport');
  return saveBinaryExport(await buildWikiPdf(doc, projectName), doc.title, 'pdf', 'application/pdf');
}

/** Export a genuine, editable Office Open XML document. */
export async function exportWikiWord(doc: WikiDocument, projectName?: string): Promise<boolean> {
  const { buildWikiDocx } = await import('./wikiRichExport');
  return saveBinaryExport(await buildWikiDocx(doc, projectName), doc.title, 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
