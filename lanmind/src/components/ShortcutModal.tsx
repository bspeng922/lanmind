import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
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
    get name() { return tr("settings:shortcutModal.quickAddTask"); },
    get description() { return tr("settings:shortcutModal.openQuickCaptureEvenWhenTheApp"); },
    ctrlKey: true,
    altKey: false,
    shiftKey: true,
    code: 'Space',
    keyLabel: 'Ctrl + Shift + Space',
  },
  {
    id: 'toggleRightPanel',
    get name() { return tr("settings:shortcutModal.toggleLanNodesPanel"); },
    get description() { return tr("settings:shortcutModal.expandOrCollapseLanNodesAndMembers"); },
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
    code: 'KeyN',
    keyLabel: 'Alt + N',
  },
  {
    id: 'toggleRiskScanner',
    get name() { return tr("settings:shortcutModal.toggleRiskAnalysis"); },
    get description() { return tr("settings:shortcutModal.openOrCloseTaskRiskAnalysis"); },
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
    code: 'KeyR',
    keyLabel: 'Alt + R',
  },
  {
    id: 'toggleTheme',
    get name() { return tr("settings:shortcutModal.changeTheme"); },
    get description() { return tr("settings:shortcutModal.openAppearanceSettings"); },
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
    code: 'KeyT',
    keyLabel: 'Alt + T',
  },
  {
    id: 'openReportStudio',
    get name() { return tr("settings:shortcutModal.openWorkReports"); },
    get description() { return tr("settings:shortcutModal.openReportAndPresentationGeneration"); },
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    code: 'KeyW',
    keyLabel: 'Ctrl + Alt + W',
  },
  {
    id: 'openToday',
    get name() { return tr("settings:shortcutModal.openTodaySSchedule"); },
    get description() { return tr("settings:shortcutModal.viewTodaySTasks"); },
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    code: 'KeyD',
    keyLabel: 'Ctrl + Alt + D',
  },
  {
    id: 'openInbox',
    get name() { return tr("settings:shortcutModal.openAllTasks"); },
    get description() { return tr("settings:shortcutModal.viewAndManageAllTasks"); },
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    code: 'KeyI',
    keyLabel: 'Ctrl + Alt + I',
  },
  {
    id: 'openCalendar',
    get name() { return tr("settings:shortcutModal.openCalendar"); },
    get description() { return tr("settings:shortcutModal.viewScheduledTasks"); },
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    code: 'KeyC',
    keyLabel: 'Ctrl + Alt + C',
  },
  {
    id: 'openSettings',
    get name() { return tr("settings:shortcutModal.openSettings"); },
    get description() { return tr("settings:shortcutModal.openAppearanceModelShortcutAndDataSettings"); },
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
  useLocale();
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
            <h2 className="text-sm font-bold text-main">{tr("settings:shortcutModal.keyboardShortcuts")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-modal-close-btn"
            title={tr("settings:shortcutModal.closeEsc")}
            aria-label={tr("settings:shortcutModal.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-sub">
          {tr("settings:shortcutModal.selectAShortcutAndPressYourPreferred", { value0: isMac ? '⌘ / ⌥ / ⇧' : 'Ctrl / Alt / Shift' })}
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
                    <span>{DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === item.id)?.name || item.name}</span>
                  </div>
                  <div className="text-[11px] text-sub">{DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === item.id)?.description || item.description}</div>
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
                  {isRecording ? tr("settings:shortcutModal.pressANewShortcut") : formatShortcutKey(item.keyLabel, isMac)}
                </button>
              </div>
            );
          })}
        </div>

        {savedSuccess && (
          <div className="p-2.5 bg-success/10 border border-emerald-500/40 text-success rounded-xl flex items-center gap-2 font-medium text-xs">
            <Check className="w-4 h-4 text-success" />
            <span>{tr("settings:shortcutModal.shortcutsSavedAndApplied")}</span>
          </div>
        )}
        {saveError && (
          <div className="p-2.5 bg-danger/10 border border-rose-500/40 text-danger rounded-xl flex items-start gap-2 font-medium text-xs">
            <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
            <span>{localizeMessage(saveError)}</span>
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
            <span>{tr("settings:shortcutModal.restoreDefaultShortcuts")}</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="ui-cancel-button px-3.5 py-1.5 rounded-xl font-medium"
            >
              {tr("settings:shortcutModal.cancel")}</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-main font-bold rounded-xl shadow-panel transition-all flex items-center gap-1.5"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{saving ? tr("settings:shortcutModal.applying") : tr("settings:shortcutModal.saveShortcuts")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
