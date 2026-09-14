import React, { useState, useEffect } from 'react';
import { X, Keyboard, RotateCcw, Check, Command, Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { formatShortcutKey, isMacOS } from '../utils/platform';

export interface ShortcutItem {
  id: string;
  name: string;
  description: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  code: string;
  keyLabel: string;
}

export const DEFAULT_SHORTCUTS: ShortcutItem[] = [
  {
    id: 'quickAdd',
    name: '快捷创建任务',
    description: '系统级全局快捷键，程序隐藏到托盘后仍可快速唤起输入框',
    ctrlKey: true,
    altKey: false,
    shiftKey: true,
    code: 'Space',
    keyLabel: 'Ctrl + Shift + Space',
  },
  {
    id: 'toggleRightPanel',
    name: '切换右侧 LAN 节点面板',
    description: '展开或收起局域网节点与协同成员侧边栏',
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
    code: 'KeyN',
    keyLabel: 'Alt + N',
  },
  {
    id: 'toggleRiskScanner',
    name: '开启 / 关闭 AI 风险诊断',
    description: '召唤局域网 AI 引擎进行多项目风险扫描',
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
    code: 'KeyR',
    keyLabel: 'Alt + R',
  },
  {
    id: 'toggleTheme',
    name: '切换界面主题配色',
    description: '打开全域 UI 主题定制与色系切换面板',
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
    code: 'KeyT',
    keyLabel: 'Alt + T',
  },
  {
    id: 'openReportStudio',
    name: '打开工作汇报',
    description: '快速进入日报、周报和 PPT 汇报生成页面',
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    code: 'KeyW',
    keyLabel: 'Ctrl + Alt + W',
  },
  {
    id: 'openToday',
    name: '打开今日安排',
    description: '快速查看今天需要处理和完成的任务',
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    code: 'KeyD',
    keyLabel: 'Ctrl + Alt + D',
  },
  {
    id: 'openInbox',
    name: '打开全部任务',
    description: '快速回到全部任务清单页面，查看并管理所有待办与协作任务',
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    code: 'KeyI',
    keyLabel: 'Ctrl + Alt + I',
  },
  {
    id: 'openCalendar',
    name: '打开日历视图',
    description: '快速查看任务排期和日历安排',
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    code: 'KeyC',
    keyLabel: 'Ctrl + Alt + C',
  },
  {
    id: 'openSettings',
    name: '打开系统设置',
    description: '快速进入主题、模型、快捷键和数据设置',
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    code: 'Comma',
    keyLabel: 'Ctrl + Alt + ,',
  },
];

interface ShortcutModalProps {
  isOpen: boolean;
  onClose: () => void;
  shortcuts: ShortcutItem[];
  onSaveShortcuts: (newShortcuts: ShortcutItem[]) => Promise<void>;
}

export const ShortcutModal: React.FC<ShortcutModalProps> = ({
  isOpen,
  onClose,
  shortcuts,
  onSaveShortcuts,
}) => {
  const [localList, setLocalList] = useState<ShortcutItem[]>(shortcuts);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const isMac = isMacOS();

  useEffect(() => {
    setLocalList(shortcuts);
    setRecordingId(null);
    setSaveError('');
  }, [isOpen, shortcuts]);

  if (!isOpen) return null;

  // Key combo recorder listener
  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();

    // Ignore single modifier key presses like Ctrl or Alt alone
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      return;
    }

    const ctrlKey = e.ctrlKey || e.metaKey;
    const altKey = e.altKey;
    const shiftKey = e.shiftKey;
    const code = e.code;

    // Format label
    const parts: string[] = [];
    if (ctrlKey) parts.push('Ctrl');
    if (altKey) parts.push('Alt');
    if (shiftKey) parts.push('Shift');

    let keyDisplay = e.key.toUpperCase();
    if (code === 'Space') keyDisplay = 'Space';
    else if (code.startsWith('Key')) keyDisplay = code.replace('Key', '');
    else if (code.startsWith('Digit')) keyDisplay = code.replace('Digit', '');
    else if (code.startsWith('Numpad')) keyDisplay = code.replace('Numpad', 'Num');
    else if (keyDisplay === 'PROCESS' || keyDisplay === 'UNIDENTIFIED') {
      if (code.startsWith('Key')) keyDisplay = code.replace('Key', '');
      else if (code.startsWith('Digit')) keyDisplay = code.replace('Digit', '');
      else keyDisplay = code;
    }

    parts.push(keyDisplay);
    const keyLabel = parts.join(' + ');

    setLocalList((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              ctrlKey,
              altKey,
              shiftKey,
              code,
              keyLabel,
            }
          : item
      )
    );
    setRecordingId(null);
  };

  const handleResetDefaults = () => {
    setLocalList(DEFAULT_SHORTCUTS);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await onSaveShortcuts(localList);
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 600);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-edge rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-popover animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-edge">
          <div className="flex items-center space-x-2 text-warning">
            <Keyboard className="w-5 h-5" />
            <h2 className="text-sm font-bold text-main">自定义快捷键设置 (Hotkeys)</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-modal-close-btn"
            title="关闭 (Esc)"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-sub">
          {`点击任意快捷键组合按钮并按下您偏好的键盘按键（支持 ${isMac ? '⌘ / ⌥ / ⇧' : 'Ctrl / Alt / Shift'} 组合键）。设置将自动保存在本机。`}
        </p>

        {/* Shortcut Items List */}
        <div className="space-y-3">
          {localList.map((item) => {
            const isRecording = recordingId === item.id;
            return (
              <div
                key={item.id}
                className={`p-3.5 rounded-xl border flex items-center justify-between transition-all ${
                  isRecording
                    ? 'bg-warning/10 border-amber-500/60 ring-1 ring-amber-500'
                    : 'bg-canvas/60 border-edge hover:bg-hover/40'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-main flex items-center gap-2">
                    <span>{item.name}</span>
                  </div>
                  <div className="text-[11px] text-sub">{item.description}</div>
                </div>

                {/* Recorder Button */}
                <button
                  type="button"
                  onClick={() => setRecordingId(item.id)}
                  onKeyDown={isRecording ? (e) => handleKeyDown(e, item.id) : undefined}
                  autoFocus={isRecording}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold transition-all min-w-[100px] text-center ${
                    isRecording
                      ? 'bg-amber-500 text-main border-amber-400 animate-pulse shadow-panel shadow-amber-500/20'
                      : 'bg-card hover:bg-hover text-warning border-subtle hover:border-amber-500/40'
                  }`}
                >
                  {isRecording ? '请按下新快捷键...' : formatShortcutKey(item.keyLabel, isMac)}
                </button>
              </div>
            );
          })}
        </div>

        {savedSuccess && (
          <div className="p-2.5 bg-success/10 border border-emerald-500/40 text-success rounded-xl flex items-center gap-2 font-medium text-xs">
            <Check className="w-4 h-4 text-success" />
            <span>快捷键组合配置已保存并生效！</span>
          </div>
        )}
        {saveError && (
          <div className="p-2.5 bg-danger/10 border border-rose-500/40 text-danger rounded-xl flex items-start gap-2 font-medium text-xs">
            <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-edge text-xs">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 text-sub hover:text-main px-3 py-1.5 rounded-lg hover:bg-hover transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>恢复默认快捷键</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="ui-cancel-button px-3.5 py-1.5 rounded-xl font-medium"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-main font-bold rounded-xl shadow-panel transition-all flex items-center gap-1.5"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{saving ? '正在应用...' : '保存快捷键'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
