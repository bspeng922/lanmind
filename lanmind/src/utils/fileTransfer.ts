import { isTauri, invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

/**
 * Automatically format file size with appropriate dynamic units (B, KB, MB, GB).
 */
export function formatFileSize(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Universal file download function that works in both desktop Tauri (native save dialog + disk write)
 * and web browser (Blob + Object URL fallback).
 */
export async function downloadFile(dataUrl: string | undefined, name: string): Promise<string | null> {
  if (!dataUrl) {
    alert('文件数据无效，无法下载');
    return null;
  }

  if (isTauri()) {
    try {
      const destination = await save({
        defaultPath: name,
        title: `保存文件: ${name}`,
      });
      if (!destination) return null; // User cancelled

      await invoke('save_file_to_path', {
        dataUrl,
        destinationPath: destination,
      });

      return destination;
    } catch (err: any) {
      console.error('Download file failed', err);
      alert(err?.message || '保存文件失败');
      throw err;
    }
  }

  // Browser fallback
  try {
    if (dataUrl.startsWith('data:')) {
      const commaIdx = dataUrl.indexOf(',');
      const header = dataUrl.slice(0, commaIdx);
      const raw = dataUrl.slice(commaIdx + 1);
      const mime = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
      const binaryStr = atob(raw);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mime });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = name;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      return name;
    }

    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error('download failed');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return name;
  } catch {
    window.open(dataUrl, '_blank', 'noopener,noreferrer');
    return name;
  }
}
