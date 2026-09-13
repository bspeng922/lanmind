import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Search,
  Trash2,
  Upload,
  X,
  ChevronRight,
  ChevronLeft,
  Wifi,
  CheckCircle2,
} from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { isTauri } from '@tauri-apps/api/core';
import { Project, ProjectFile, ProjectFolder, User } from '../types';
import { ApiService } from '../services/api';
import { FilePreviewModal } from './FilePreviewModal';
import { formatFileSize } from '../utils/fileTransfer';

interface Props {
  project: Project;
  users: User[];
  currentUser: User;
  onClose: () => void;
}

const formatSize = formatFileSize;

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export const ProjectFilesPanel: React.FC<Props> = ({ project, users, currentUser, onClose }) => {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [query, setQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<ProjectFile | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // New folder modal state
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = project.createdBy === currentUser.id || project.admins.includes(currentUser.id);

  // Load project files and folders
  const loadData = async () => {
    try {
      const [filesList, foldersList] = await Promise.all([
        ApiService.getProjectFiles(project.id),
        ApiService.getProjectFolders(project.id),
      ]);
      setFiles(filesList);
      setFolders(foldersList);
    } catch (e) {
      console.error('Failed to load project files', e);
    }
  };

  useEffect(() => {
    loadData();
  }, [project.id]);

  // Open create folder modal
  const handleOpenCreateFolder = () => {
    setNewFolderName('');
    setShowCreateFolderModal(true);
  };

  // Confirm create folder
  const handleConfirmCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const cleanName = trimmed.replace(/[\\/]/g, '-');
    const folderPath = currentPath ? `${currentPath}/${cleanName}` : cleanName;

    try {
      await ApiService.createProjectFolder(project.id, folderPath, currentUser.id);
      await loadData();
      setShowCreateFolderModal(false);
      setNewFolderName('');
      showToast(`目录 "${cleanName}" 创建成功`);
    } catch (err: any) {
      alert(err?.message || '创建目录失败');
    }
  };

  // Delete folder
  const handleDeleteFolder = async (folder: { name: string; fullPath: string; folderObj?: ProjectFolder }, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!window.confirm(`确定删除目录“${folder.name}”吗？目录内的文件和子目录也会被删除。`)) return;
    try {
      if (folder.folderObj) {
        await ApiService.deleteProjectFolder(folder.folderObj.id, currentUser.id, project.id, folder.fullPath);
      } else {
        const descendants = files.filter((file) => {
          const path = file.relativePath || file.name;
          return path === folder.fullPath || path.startsWith(`${folder.fullPath}/`);
        });
        for (const file of descendants) await ApiService.deleteProjectFile(file.id, currentUser.id);
      }
      if (currentPath === folder.fullPath || currentPath.startsWith(`${folder.fullPath}/`)) setCurrentPath('');
      await loadData();
      showToast(`目录“${folder.name}”已删除`);
    } catch (err: any) {
      alert(err?.message || '删除目录失败');
    }
  };

  // Native upload files (bypasses browser security prompt)
  const handleUploadFiles = async () => {
    if (isTauri()) {
      try {
        const selected = await open({
          title: '选择要上传的文件',
          multiple: true,
          directory: false,
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        if (paths.length === 0) return;

        setIsUploading(true);
        await ApiService.uploadProjectFilesFromPaths(project.id, currentPath, paths, currentUser.id);
        await loadData();
        showToast(`成功上传 ${paths.length} 个文件`);
      } catch (err: any) {
        console.error('Native file upload failed', err);
        alert(err?.message || '上传文件失败');
      } finally {
        setIsUploading(false);
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  // Native upload directory (bypasses browser security prompt)
  const handleUploadDirectory = async () => {
    if (isTauri()) {
      try {
        const selected = await open({
          title: '选择要上传的目录',
          multiple: false,
          directory: true,
        });
        if (!selected || Array.isArray(selected)) return;

        setIsUploading(true);
        await ApiService.uploadProjectFilesFromPaths(project.id, currentPath, [selected], currentUser.id);
        await loadData();
        showToast('目录及子文件上传同步完成');
      } catch (err: any) {
        console.error('Native directory upload failed', err);
        alert(err?.message || '上传目录失败');
      } finally {
        setIsUploading(false);
      }
    } else {
      directoryInputRef.current?.click();
    }
  };

  // Browser fallback file upload
  const handleBrowserFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []) as File[];
    if (selected.length === 0) return;
    setIsUploading(true);

    try {
      for (const file of selected) {
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        let filePath = file.name;
        if (relative) {
          filePath = currentPath ? `${currentPath}/${relative}` : relative;
        } else {
          filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
        }

        const base64Content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || '');
            const commaIndex = result.indexOf(',');
            resolve(commaIndex !== -1 ? result.slice(commaIndex + 1) : result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        await ApiService.saveProjectFile(
          project.id,
          file.name,
          filePath,
          base64Content,
          file.type || 'application/octet-stream',
          currentUser.id
        );
      }

      await loadData();
      showToast(`成功上传 ${selected.length} 个文件`);
    } catch (err: any) {
      console.error('Browser upload failed', err);
      alert(err?.message || '上传文件失败');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  // Download file
  const handleDownload = async (file: ProjectFile) => {
    try {
      if (isTauri()) {
        const destination = await save({
          defaultPath: file.name,
          title: `保存文件: ${file.name}`,
        });
        if (!destination) return;
        await ApiService.downloadProjectFileTo(project.id, file.id, destination);
        showToast(`已成功下载到: ${destination}`);
      } else {
        if (file.dataUrl) {
          const a = document.createElement('a');
          a.href = file.dataUrl;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else if (file.httpUrl) {
          window.open(file.httpUrl, '_blank');
        }
      }
    } catch (err: any) {
      console.error('Download failed', err);
      alert(err?.message || '下载失败');
    }
  };

  // Delete file
  const handleDeleteFile = async (file: ProjectFile) => {
    if (!window.confirm(`确定删除文件“${file.name}”吗？`)) return;
    try {
      await ApiService.deleteProjectFile(file.id, currentUser.id);
      await loadData();
      showToast('文件已删除');
    } catch (err: any) {
      alert(err?.message || '删除失败');
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Path segments for breadcrumbs
  const pathSegments = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.split('/').filter(Boolean);
  }, [currentPath]);

  // Navigate to breadcrumb segment
  const navigateToSegment = (index: number) => {
    if (index < 0) {
      setCurrentPath('');
    } else {
      const target = pathSegments.slice(0, index + 1).join('/');
      setCurrentPath(target);
    }
  };

  // Navigate up one level
  const navigateUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join('/'));
  };

  // Direct subfolders of currentPath
  const visibleFolders = useMemo(() => {
    if (query) return []; // In search mode, display flat file list
    const prefix = currentPath ? `${currentPath}/` : '';
    const folderMap = new Map<string, { name: string; fullPath: string; count: number; createdAt: string; folderObj?: ProjectFolder }>();

    // 1. From database folders
    folders.forEach((f) => {
      if (currentPath === '') {
        const topLevel = f.path.split('/')[0];
        if (!folderMap.has(topLevel)) {
          folderMap.set(topLevel, { name: topLevel, fullPath: topLevel, count: 0, createdAt: f.createdAt, folderObj: f });
        }
      } else if (f.path.startsWith(prefix) && f.path !== currentPath) {
        const sub = f.path.slice(prefix.length).split('/')[0];
        const full = `${prefix}${sub}`;
        if (!folderMap.has(sub)) {
          folderMap.set(sub, { name: sub, fullPath: full, count: 0, createdAt: f.createdAt, folderObj: f });
        }
      }
    });

    // 2. From file relative paths
    files.forEach((f) => {
      const rel = f.relativePath || f.name;
      if (currentPath === '') {
        const slashIdx = rel.indexOf('/');
        if (slashIdx !== -1) {
          const topLevel = rel.slice(0, slashIdx);
          const entry = folderMap.get(topLevel) || { name: topLevel, fullPath: topLevel, count: 0, createdAt: f.uploadedAt };
          entry.count += 1;
          folderMap.set(topLevel, entry);
        }
      } else if (rel.startsWith(prefix)) {
        const remainder = rel.slice(prefix.length);
        const slashIdx = remainder.indexOf('/');
        if (slashIdx !== -1) {
          const sub = remainder.slice(0, slashIdx);
          const full = `${prefix}${sub}`;
          const entry = folderMap.get(sub) || { name: sub, fullPath: full, count: 0, createdAt: f.uploadedAt };
          entry.count += 1;
          folderMap.set(sub, entry);
        }
      }
    });

    return Array.from(folderMap.values());
  }, [folders, files, currentPath, query]);

  // Files in currentPath or matched by search query
  const visibleFiles = useMemo(() => {
    if (query.trim()) {
      const q = query.toLowerCase();
      return files.filter(
        (f) => f.name.toLowerCase().includes(q) || (f.relativePath && f.relativePath.toLowerCase().includes(q))
      );
    }

    return files.filter((f) => {
      const rel = f.relativePath || f.name;
      if (currentPath === '') {
        return !rel.includes('/');
      }
      const prefix = `${currentPath}/`;
      if (!rel.startsWith(prefix)) return false;
      const sub = rel.slice(prefix.length);
      return !sub.includes('/');
    });
  }, [files, currentPath, query]);

  const canDelete = (file: ProjectFile) => isAdmin || file.uploadedBy === currentUser.id;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label="项目文件"
    >
      <div className="flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-[#0b1220] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 px-5 py-4 bg-[#0e1626]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400">
              <FolderOpen className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-slate-100">{project.name} · 项目文件</h2>
              <p className="text-[11px] text-slate-500">文件系统视图 · 局域网协同共享与在线预览</p>
            </div>
          </div>
          <button onClick={onClose} className="ui-modal-close-btn" aria-label="关闭文件面板">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Directory Navigation & Action Bar */}
        <div className="border-b border-slate-800/80 bg-[#0c1424] p-4">
          {/* Breadcrumb Path Display (Above Search Box) */}
          <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-800/90 bg-slate-950/70 px-3 py-2 text-xs">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto text-slate-300 scrollbar-none font-mono">
              <button
                onClick={() => navigateToSegment(-1)}
                className={`flex items-center gap-1 hover:text-sky-300 transition-colors ${
                  !currentPath ? 'text-sky-400 font-semibold' : 'text-slate-400'
                }`}
              >
                <Folder className="h-3.5 w-3.5" />
                <span>全部文件</span>
              </button>

              {pathSegments.map((segment, idx) => {
                const isLast = idx === pathSegments.length - 1;
                return (
                  <React.Fragment key={idx}>
                    <ChevronRight className="h-3 w-3 flex-shrink-0 text-slate-600" />
                    <button
                      onClick={() => navigateToSegment(idx)}
                      className={`truncate hover:text-sky-300 transition-colors ${
                        isLast ? 'text-slate-100 font-semibold' : 'text-slate-400'
                      }`}
                      title={segment}
                    >
                      {segment}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>

            <span className="ml-2 flex-shrink-0 text-[10px] text-slate-500 font-mono">
              {visibleFiles.length + visibleFolders.length} 项
            </span>
          </div>

          {/* Search Box + Icon Action Buttons */}
          <div className="flex items-center gap-2">
            {/* Search Input */}
            <div className="relative min-w-[140px] flex-1">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={currentPath ? '在当前目录中搜索...' : '搜索项目文件或目录...'}
                className="h-9 w-full rounded-lg border border-slate-700/80 bg-slate-950 pl-9 pr-3 text-xs text-slate-200 outline-none focus:border-sky-500 transition-colors font-mono"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Upload File Button (Icon Only, Native Dialog) */}
            <button
              onClick={handleUploadFiles}
              className="theme-btn-primary flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors"
              title="上传文件"
              aria-label="上传文件"
              disabled={isUploading}
            >
              <Upload className="h-4 w-4" />
            </button>

            {/* Upload Directory Button (Icon Only, Native Dialog, no browser security prompt) */}
            <button
              onClick={handleUploadDirectory}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-800/80 text-slate-300 hover:border-sky-500/60 hover:text-sky-300 hover:bg-slate-800 transition-colors"
              title="上传目录"
              aria-label="上传目录"
              disabled={isUploading}
            >
              <FolderUp className="h-4 w-4" />
            </button>

            {/* Create Directory Button (Icon Only, Modern Modal) */}
            <button
              onClick={handleOpenCreateFolder}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-800/80 text-slate-300 hover:border-sky-500/60 hover:text-sky-300 hover:bg-slate-800 transition-colors"
              title="新建目录"
              aria-label="新建目录"
            >
              <FolderPlus className="h-4 w-4" />
            </button>

            {/* Hidden Browser Inputs (Fallback only) */}
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleBrowserFileUpload} />
            <input
              ref={directoryInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleBrowserFileUpload}
              {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
            />
          </div>

          {/* Subtitle */}
          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500 font-mono">
            <span>{isUploading ? '正在通过本地通道高速读取并同步...' : '本地原生上传 · 跨局域网流式访问'}</span>
            <span className="flex items-center gap-1 text-emerald-400/80">
              <Wifi className="h-3 w-3" />
              HTTP 共享中
            </span>
          </div>
        </div>

        {/* Toast Notification */}
        {toastMessage && (
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 animate-in fade-in slide-in-from-top-1 font-mono">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400" />
            <span className="truncate flex-1">{toastMessage}</span>
          </div>
        )}

        {/* File System List Content (Referencing User Mockup) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {/* Back to Parent Directory (Matching Screenshot Style) */}
          {currentPath && !query && (
            <div className="pt-1 pb-1">
              <button
                onClick={navigateUp}
                className="group inline-flex items-center gap-2.5 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-400 group-hover:border-sky-400 group-hover:bg-sky-500/20 transition-colors">
                  <ChevronLeft className="h-4 w-4" />
                </span>
                <span className="text-sky-400 tracking-wide">上一级目录</span>
              </button>
              <div className="mt-3 mb-2 border-b border-dashed border-slate-800" />
            </div>
          )}

          {/* Folders List (Matching Screenshot Style) */}
          {visibleFolders.map((folder) => (
            <div
              key={folder.fullPath}
              onClick={() => setCurrentPath(folder.fullPath)}
              className="group flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-800/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                {/* Folder Outline Icon in Rounded-xl Box */}
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-400">
                  <Folder className="h-5 w-5" />
                </div>
                {/* Title + Timestamp */}
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-100 font-mono tracking-tight group-hover:text-sky-300 transition-colors">
                    {folder.name}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                    {formatDateTime(folder.createdAt)}
                  </p>
                </div>
              </div>

              {/* Folder Actions */}
              {isAdmin && (
                <button
                  onClick={(e) => handleDeleteFolder(folder, e)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-500 hover:text-rose-400 transition-all rounded-md hover:bg-rose-500/10"
                  title="删除目录"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}

          {/* Files List (Matching Screenshot Style) */}
          {visibleFiles.map((file) => (
            <div
              key={file.id}
              className="group flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-800/40"
            >
              <div
                className="flex min-w-0 flex-1 items-center gap-3 cursor-pointer"
                onClick={() => setPreviewFile(file)}
              >
                {/* File Document Outline Icon in Rounded-xl Box */}
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-800/40 text-slate-300 group-hover:border-slate-600 transition-colors">
                  <FileText className="h-5 w-5" />
                </div>
                {/* Title + Size + Timestamp */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-100 font-mono tracking-tight group-hover:text-sky-300 transition-colors">
                    {file.name}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                    {formatSize(file.size)} &nbsp;&nbsp; {formatDateTime(file.uploadedAt)}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity ml-2">
                <button
                  onClick={() => setPreviewFile(file)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-sky-500/10 hover:text-sky-400 transition-colors"
                  title="在线预览"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>

                <button
                  onClick={() => handleDownload(file)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-sky-500/10 hover:text-sky-400 transition-colors"
                  title="下载文件"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>

                {canDelete(file) && (
                  <button
                    onClick={() => handleDeleteFile(file)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
                    title="删除文件"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Empty State */}
          {visibleFolders.length === 0 && visibleFiles.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <FolderOpen className="mb-3 h-10 w-10 text-slate-700" />
              <p className="text-xs font-medium text-slate-400">
                {query ? '没有找到匹配的文件或目录' : currentPath ? '当前目录为空' : '项目暂无文件'}
              </p>
              <p className="mt-1 text-[11px] text-slate-600 font-mono">
                点击上方图标上传文件或新建目录
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800/80 px-5 py-3 text-[10px] text-slate-500 bg-[#0e1626] font-mono">
          <span>共 {files.length} 个文件 · {folders.length} 个目录</span>
          <span>局域网协同加密通道</span>
        </div>

        {/* Custom Modern Create Folder Modal */}
        {showCreateFolderModal && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setShowCreateFolderModal(false)}
            role="dialog"
            aria-modal="true"
            aria-label="新建项目目录"
          >
            <div
              className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl animate-in zoom-in-95 duration-150 space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                  <FolderPlus className="h-4 w-4 text-blue-400" />
                  <span>新建项目目录</span>
                </h2>
                <button
                  onClick={() => setShowCreateFolderModal(false)}
                  className="ui-modal-close-btn"
                  title="关闭 (Esc)"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="text-xs text-slate-400">
                创建层级目录用于分类管理项目中的文档、附件和媒体资源。
              </p>

              {/* Directory Form */}
              <div className="space-y-3">
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-300">
                      目录名称 <span className="text-rose-400">*</span>
                    </label>
                    <span className="text-[11px] font-mono text-slate-500">
                      创建位置: {currentPath ? `/${currentPath}` : '/ (根目录)'}
                    </span>
                  </div>
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConfirmCreateFolder();
                      if (e.key === 'Escape') setShowCreateFolderModal(false);
                    }}
                    placeholder="例如：raw, tmp, docs, reports..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all font-mono"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setShowCreateFolderModal(false)}
                  className="ui-cancel-button rounded-xl px-4 py-2 text-xs font-semibold"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCreateFolder}
                  disabled={!newFolderName.trim()}
                  className="theme-btn-primary flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  <span>创建目录</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Preview Modal */}
        {previewFile && (
          <FilePreviewModal
            name={previewFile.relativePath || previewFile.name}
            type={previewFile.type}
            dataUrl={previewFile.dataUrl}
            httpUrl={previewFile.httpUrl}
            projectId={previewFile.projectId}
            fileId={previewFile.id}
            onDownload={() => handleDownload(previewFile)}
            onClose={() => setPreviewFile(null)}
          />
        )}
      </div>
    </div>
  );
};
