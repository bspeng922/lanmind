/**
 * ChatFilesModal.tsx — Historical files and attachments viewer for current LAN chat conversation.
 *
 * CALLING SPEC:
 *   <ChatFilesModal
 *     isOpen={showFilesModal}
 *     onClose={() => setShowFilesModal(false)}
 *     messages={filteredMessages}
 *     onDownloadFile={handleDownloadFile}
 *     onPreviewImage={setPreviewImage}
 *   />
 *
 * TOOL CONTRACT:
 *   - Extracts and indexes files/images from active conversation messages
 *   - Synchronizes automatically with cleared chat history (shows empty state when cleared)
 *   - Pure React controlled modal; side effects limited to download/preview callbacks
 */

import React, { useMemo, useState } from 'react';
import {
  X,
  Search,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  FileArchive,
  FileSpreadsheet,
  FileCode,
  Paperclip,
  Clock,
  User as UserIcon,
} from 'lucide-react';
import { LanChatMessage } from '../types';
import { formatMessageDisplayTime } from '../utils/chatTime';

export interface ChatFilesModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: LanChatMessage[];
  onDownloadFile: (message: LanChatMessage) => void;
  onPreviewImage?: (url: string) => void;
}

export const getFileIconComponent = (fileName?: string, type?: string) => {
  const name = (fileName || '').toLowerCase();
  if (type === 'image' || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) {
    return <ImageIcon className="w-4 h-4 text-feature flex-shrink-0" />;
  }
  if (/\.(xlsx?|csv)$/.test(name)) {
    return <FileSpreadsheet className="w-4 h-4 text-success flex-shrink-0" />;
  }
  if (/\.(zip|tar|gz|7z|rar)$/.test(name)) {
    return <FileArchive className="w-4 h-4 text-warning flex-shrink-0" />;
  }
  if (/\.(ts|tsx|js|jsx|json|rs|py|html|css|sql)$/.test(name)) {
    return <FileCode className="w-4 h-4 text-info flex-shrink-0" />;
  }
  return <FileText className="w-4 h-4 text-info flex-shrink-0" />;
};

export const ChatFilesModal: React.FC<ChatFilesModalProps> = ({
  isOpen,
  onClose,
  messages,
  onDownloadFile,
  onPreviewImage,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | 'doc' | 'image'>('all');

  // Filter messages that contain files or images
  const fileMessages = useMemo(() => {
    return messages.filter((msg) => {
      const isFile = msg.type === 'file' || (Boolean(msg.fileUrl) && Boolean(msg.fileName));
      const isImg = msg.type === 'image' || (Boolean(msg.fileUrl) && /\.(png|jpe?g|gif|webp|svg)$/i.test(msg.fileName || ''));
      return isFile || isImg;
    });
  }, [messages]);

  // Apply search query and category filter
  const displayedFiles = useMemo(() => {
    return fileMessages.filter((msg) => {
      const name = (msg.fileName || msg.content || '').toLowerCase();
      const sender = (msg.senderName || '').toLowerCase();
      const query = searchQuery.trim().toLowerCase();
      const matchesQuery = !query || name.includes(query) || sender.includes(query);
      if (!matchesQuery) return false;

      const isImg = msg.type === 'image' || /\.(png|jpe?g|gif|webp|svg)$/i.test(msg.fileName || '');
      if (activeCategory === 'image') return isImg;
      if (activeCategory === 'doc') return !isImg;
      return true;
    });
  }, [fileMessages, searchQuery, activeCategory]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-xl max-h-[85vh] bg-surface border border-subtle/80 rounded-2xl shadow-popover overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge bg-canvas/40">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-info border border-blue-500/20">
              <Paperclip className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-main">当前对话历史文件</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-card text-info border border-subtle">
                  {fileMessages.length} 个文件
                </span>
              </div>
              <p className="text-[11px] text-sub mt-0.5">
                浏览并下载当前会话中发送的所有文件与图片记录
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭文件窗口"
            className="p-1.5 rounded-lg text-sub hover:text-main hover:bg-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar: Search & Category Tabs */}
        <div className="px-5 py-3 border-b border-edge/80 bg-canvas/20 flex flex-col sm:flex-row items-center gap-2.5">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-sub" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索文件名或发送者..."
              className="w-full pl-9 pr-3 py-1.5 bg-canvas/60 border border-subtle/80 rounded-xl text-xs text-main placeholder-quiet focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>
          <div className="flex items-center space-x-1 p-0.5 bg-canvas/80 border border-edge rounded-xl self-stretch sm:self-auto justify-center">
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors font-medium ${
                activeCategory === 'all'
                  ? 'bg-blue-600 text-on-solid shadow-soft'
                  : 'text-sub hover:text-main'
              }`}
            >
              全部 ({fileMessages.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory('doc')}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors font-medium ${
                activeCategory === 'doc'
                  ? 'bg-blue-600 text-on-solid shadow-soft'
                  : 'text-sub hover:text-main'
              }`}
            >
              文档
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory('image')}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors font-medium ${
                activeCategory === 'image'
                  ? 'bg-blue-600 text-on-solid shadow-soft'
                  : 'text-sub hover:text-main'
              }`}
            >
              图片
            </button>
          </div>
        </div>

        {/* Files List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[50vh]">
          {displayedFiles.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <div className="p-3.5 rounded-2xl bg-card/50 border border-subtle/50 text-quiet mb-3">
                <Paperclip className="w-6 h-6 opacity-60" />
              </div>
              <p className="text-xs font-medium text-sub">当前对话暂无文件记录</p>
              <p className="text-[11px] text-quiet mt-1 max-w-xs">
                {fileMessages.length === 0
                  ? '在会话中发送的文件或图片会自动保存在此处；若清空对话记录，文件列表也将同步清空。'
                  : '未找到符合条件的筛选文件。'}
              </p>
            </div>
          ) : (
            displayedFiles.map((msg) => {
              const isImg =
                msg.type === 'image' ||
                /\.(png|jpe?g|gif|webp|svg)$/i.test(msg.fileName || '');
              const displayName = msg.fileName || (msg.type === 'image' ? '图片' : '未命名文件');

              return (
                <div
                  key={msg.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-edge bg-canvas/40 hover:bg-hover/40 hover:border-subtle transition-all group"
                >
                  <div className="flex items-center space-x-3 min-w-0 flex-1 mr-3">
                    <div className="w-9 h-9 rounded-lg bg-surface border border-edge flex items-center justify-center flex-shrink-0">
                      {isImg && msg.fileUrl && !msg.fileUrl.startsWith('zhiyu-file://') ? (
                        <img
                          src={msg.fileUrl}
                          alt={displayName}
                          className="w-full h-full object-cover rounded-lg"
                        />
                      ) : (
                        getFileIconComponent(msg.fileName, msg.type)
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-main truncate" title={displayName}>
                          {displayName}
                        </span>
                        {msg.fileSize && (
                          <span className="text-[10px] font-mono text-quiet flex-shrink-0">
                            {msg.fileSize}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-sub">
                        <span className="flex items-center gap-1">
                          <UserIcon className="w-3 h-3 text-quiet" />
                          <span className="truncate max-w-[100px]">{msg.senderName}</span>
                        </span>
                        <span className="flex items-center gap-1 font-mono text-quiet">
                          <Clock className="w-3 h-3" />
                          <span>{formatMessageDisplayTime(msg.timestamp, msg.id)}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-1.5 flex-shrink-0">
                    {isImg && msg.fileUrl && onPreviewImage && (
                      <button
                        type="button"
                        onClick={() => onPreviewImage(msg.fileUrl!)}
                        className="p-1.5 text-sub hover:text-main hover:bg-hover rounded-lg transition-colors"
                        title="在线预览图片"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDownloadFile(msg)}
                      className="p-1.5 bg-blue-500/10 hover:bg-blue-600/20 text-info hover:text-info rounded-lg text-xs flex items-center space-x-1 border border-blue-500/20 transition-colors"
                      title="下载 / 另存为文件"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline text-[11px]">下载</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-edge bg-canvas/40 flex items-center justify-between text-xs text-sub">
          <span>共找到 {displayedFiles.length} 项记录</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl bg-card hover:bg-hover text-main text-xs font-semibold transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
