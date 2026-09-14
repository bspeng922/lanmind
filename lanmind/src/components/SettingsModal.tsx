import React, { useState, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useTheme } from '../context/ThemeContext';
import {
  DESKTOP_CALENDAR_DEFAULT_OPACITY,
  DESKTOP_CALENDAR_MAX_OPACITY,
  DESKTOP_CALENDAR_MIN_OPACITY,
  DESKTOP_CALENDAR_SHOW_COMPLETED_KEY,
  normalizeDesktopCalendarOpacity,
} from '../utils/desktopCalendar';
import {
  X,
  Palette,
  Keyboard,
  Check,
  RotateCcw,
  Settings,
  Sparkles,
  Globe,
  Key,
  Cpu,
  Save,
  Sliders,
  Activity,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Info,
  Zap,
  ShieldCheck,
  Server,
  Wifi,
  Copy,
  RefreshCw,
  Eye,
  EyeOff,
  CircleHelp,
  Database,
  Download,
  Monitor,
  Power,
  Upload,
  Calendar,
  ListFilter,
  Bell,
  Volume2,
  Clock,
  Timer,
} from 'lucide-react';
import { ShortcutItem, DEFAULT_SHORTCUTS } from './ShortcutModal';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { ApiService, McpStatus } from '../services/api';
import { WeekStartDay } from '../types';
import { getStoredWeekStartDay, setStoredWeekStartDay } from '../utils/calendarGrid';
import {
  NOTIFICATION_SOUND_TONES,
  NotificationSoundTone,
  getNotificationSoundSettings,
  previewNotificationSound,
  setNotificationSoundSettings,
} from '../utils/notificationSound';
import {
  getNotificationSettings,
  setNotificationSettings,
  MIN_NOTIFICATION_DURATION_SECONDS,
  MAX_NOTIFICATION_DURATION_SECONDS,
  DEFAULT_NOTIFICATION_DURATION_SECONDS,
} from '../utils/notificationSettings';

const NOTIFICATION_TONE_OPTIONS: ThemeSelectOption[] = [
  { value: 'chime', label: '清脆双音（默认）', tone: 'amber' },
  { value: 'gentle', label: '轻柔提示', tone: 'emerald' },
  { value: 'classic', label: '经典钟声', tone: 'blue' },
  { value: 'cyber', label: '灵动科技', tone: 'rose' },
];

export type SettingsTab = 'basic' | 'theme' | 'shortcuts' | 'llm' | 'mcp' | 'about';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  shortcuts: ShortcutItem[];
  onSaveShortcuts: (newShortcuts: ShortcutItem[]) => Promise<void>;
  currentUserId: string;
  onTasksImported: () => Promise<void>;
  defaultTab?: SettingsTab;
}

const McpHelpTooltip: React.FC<{ content: string; align?: 'center' | 'left' }> = ({
  content,
  align = 'center',
}) => {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: align === 'left' ? rect.left : rect.left + rect.width / 2,
      top: rect.top,
    });
  };

  useEffect(() => {
    if (!visible) return;
    updatePosition();
    const handleViewportChange = () => updatePosition();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    return () => {
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [visible, align]);

  return (
    <span className="mcp-help">
      <button
        ref={triggerRef}
        type="button"
        className="mcp-help-trigger"
        aria-label={content}
        aria-describedby={visible ? tooltipId : undefined}
        onMouseEnter={() => { updatePosition(); setVisible(true); }}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => { updatePosition(); setVisible(true); }}
        onBlur={() => setVisible(false)}
      >
      <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {visible && createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          className={`mcp-help-tooltip mcp-help-tooltip-portal ${align === 'left' ? 'mcp-help-tooltip-left' : ''}`}
          style={{ left: position.left, top: position.top }}
        >
          {content}
        </span>,
        document.body,
      )}
    </span>
  );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  shortcuts,
  onSaveShortcuts,
  currentUserId,
  onTasksImported,
  defaultTab = 'basic',
}) => {
  const { currentTheme, themePreference, setThemeId, allThemes } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);
  const desktopAvailable = isTauri();

  // Basic settings state
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(false);
  const [autostartError, setAutostartError] = useState('');
  const [dataOperation, setDataOperation] = useState<'import' | 'export' | null>(null);
  const [dataResult, setDataResult] = useState<{ success: boolean; message: string } | null>(null);

  // Notification sound settings state
  const [notificationSoundSettings, setNotificationSoundState] = useState(() =>
    getNotificationSoundSettings(),
  );
  const [notificationDurationSettings, setNotificationDurationSettings] = useState(() =>
    getNotificationSettings(),
  );
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [testingNotification, setTestingNotification] = useState(false);
  const [testNotificationResult, setTestNotificationResult] = useState<string | null>(null);

  // Shortcuts state
  const [localShortcuts, setLocalShortcuts] = useState<ShortcutItem[]>(shortcuts);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [shortcutSavedSuccess, setShortcutSavedSuccess] = useState(false);
  const [shortcutSaving, setShortcutSaving] = useState(false);
  const [shortcutSaveError, setShortcutSaveError] = useState('');

  // LLM Config state
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('gpt-4o-mini');
  const [llmSavedSuccess, setLlmSavedSuccess] = useState(false);
  const [llmLoading, setLlmLoading] = useState(false);
  const [testingLLM, setTestingLLM] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [modelFilterQuery, setModelFilterQuery] = useState('');
  const [modelFetchMessage, setModelFetchMessage] = useState<{ success: boolean; message: string } | null>(null);
  const [dropdownPlacement, setDropdownPlacement] = useState<'up' | 'down'>('up');
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const modelSectionRef = useRef<HTMLDivElement>(null);
  const modelInputBoxRef = useRef<HTMLDivElement>(null);
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [mcpPort, setMcpPort] = useState(45992);
  const [mcpTokenVisible, setMcpTokenVisible] = useState(false);
  const [mcpSaving, setMcpSaving] = useState(false);
  const [mcpError, setMcpError] = useState('');
  const [mcpSaved, setMcpSaved] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  // Desktop Calendar & Lunar state
  const [showLunarCalendar, setShowLunarCalendar] = useState<boolean>(() => {
    return localStorage.getItem('lanmind_show_lunar') !== 'false';
  });
  const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>(getStoredWeekStartDay);

  const handleSelectWeekStartDay = (value: WeekStartDay) => {
    setWeekStartDay(value);
    setStoredWeekStartDay(value);
  };
  const [showCompletedDesktopTasks, setShowCompletedDesktopTasks] = useState<boolean>(() => {
    return localStorage.getItem(DESKTOP_CALENDAR_SHOW_COMPLETED_KEY) !== 'false';
  });
  const [desktopCalOpacity, setDesktopCalOpacity] = useState<number>(() => {
    const saved = localStorage.getItem('lanmind_desktop_cal_opacity');
    return normalizeDesktopCalendarOpacity(saved);
  });

  const handleDesktopCalOpacityChange = (val: number) => {
    const clamped = normalizeDesktopCalendarOpacity(val);
    setDesktopCalOpacity(clamped);
    localStorage.setItem('lanmind_desktop_cal_opacity', String(clamped));
    window.dispatchEvent(new CustomEvent('lanmind-desktop-cal-opacity-change', { detail: clamped }));
    void ApiService.setDesktopCalendarOpacity(clamped);
  };

  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setActiveTab(defaultTab);
      setLocalShortcuts(shortcuts);
      setRecordingId(null);
      setShortcutSaveError('');
      setLlmTestResult(null);
      setDataResult(null);
      loadAutostart();
      loadDesktopCalendarConfig();
      loadLLMConfig();
      loadMcpStatus();
      setNotificationDurationSettings(getNotificationSettings());
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, defaultTab]);

  useEffect(() => {
    if (!recordingId) {
      setLocalShortcuts(shortcuts);
    }
  }, [shortcuts]);

  useEffect(() => {
    if (!isOpen) return;
    if (!desktopAvailable) {
      setAppVersion(null);
      return;
    }

    let active = true;
    getVersion()
      .then((version) => {
        if (active) setAppVersion(version);
      })
      .catch((error) => {
        console.error('Failed to read application version', error);
        if (active) setAppVersion('未知');
      });

    return () => {
      active = false;
    };
  }, [isOpen, desktopAvailable]);

  useEffect(() => {
    if (!showModelDropdown) return;

    const updatePlacement = () => {
      if (!modelInputBoxRef.current) return;
      const inputRect = modelInputBoxRef.current.getBoundingClientRect();
      const container = contentAreaRef.current;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const spaceBelow = containerRect.bottom - inputRect.bottom;
        const spaceAbove = inputRect.top - containerRect.top;
        setDropdownPlacement(spaceBelow < 260 && spaceAbove > spaceBelow ? 'up' : 'down');
      } else {
        const spaceBelow = window.innerHeight - inputRect.bottom;
        const spaceAbove = inputRect.top;
        setDropdownPlacement(spaceBelow < 260 && spaceAbove > spaceBelow ? 'up' : 'down');
      }
    };

    updatePlacement();

    const handlePointerDown = (e: MouseEvent) => {
      if (modelSectionRef.current && !modelSectionRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowModelDropdown(false);
      }
    };

    const container = contentAreaRef.current;
    window.addEventListener('resize', updatePlacement);
    container?.addEventListener('scroll', updatePlacement);
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', updatePlacement);
      container?.removeEventListener('scroll', updatePlacement);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showModelDropdown]);

  const handleToggleLunarCalendar = () => {
    const next = !showLunarCalendar;
    setShowLunarCalendar(next);
    localStorage.setItem('lanmind_show_lunar', String(next));
    window.dispatchEvent(new CustomEvent('lanmind-lunar-change', { detail: next }));
  };

  const handleToggleShowCompletedDesktopTasks = () => {
    const next = !showCompletedDesktopTasks;
    setShowCompletedDesktopTasks(next);
    localStorage.setItem(DESKTOP_CALENDAR_SHOW_COMPLETED_KEY, String(next));
    window.dispatchEvent(new CustomEvent('lanmind-desktop-cal-show-completed-change', { detail: next }));
    void ApiService.setDesktopCalendarShowCompleted(next);
  };

  const handleToggleNotificationSound = () => {
    const nextEnabled = !notificationSoundSettings.enabled;
    setNotificationSoundSettings({ enabled: nextEnabled });
    setNotificationSoundState((prev) => ({ ...prev, enabled: nextEnabled }));
  };

  const handleSelectNotificationTone = (tone: NotificationSoundTone) => {
    setNotificationSoundSettings({ tone });
    setNotificationSoundState((prev) => ({ ...prev, tone }));
  };

  const handlePreviewTone = (tone: NotificationSoundTone) => {
    previewNotificationSound(tone);
    setIsPlayingPreview(true);
    setTimeout(() => setIsPlayingPreview(false), 1100);
  };

  const handleToggleAutoDismiss = () => {
    const nextAutoDismiss = !notificationDurationSettings.autoDismiss;
    const updated = setNotificationSettings({ autoDismiss: nextAutoDismiss });
    setNotificationDurationSettings(updated);
  };

  const handleDurationSecondsChange = (seconds: number) => {
    const updated = setNotificationSettings({ durationSeconds: seconds });
    setNotificationDurationSettings(updated);
  };

  const handleSendTestNotification = async () => {
    setTestingNotification(true);
    setTestNotificationResult(null);
    try {
      if (desktopAvailable) {
        await ApiService.showNotificationWindow({
          id: `test:${Date.now()}`,
          kind: 'reminder',
          title: '提醒通知测试',
          body: '桌面右下角弹窗提醒与提示音运行正常。\n到期时间：刚刚',
          createdAt: new Date().toISOString(),
          themeId: currentTheme.id,
          themePreference,
        });
        setTestNotificationResult('已触发桌面右下角弹窗提醒！');
      } else {
        previewNotificationSound(notificationSoundSettings.tone);
        setTestNotificationResult('已在浏览器中播放提示音。');
      }
    } catch (err) {
      setTestNotificationResult(`发送失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTestingNotification(false);
      setTimeout(() => setTestNotificationResult(null), 3500);
    }
  };

  const loadAutostart = async () => {
    if (!desktopAvailable) return;
    setAutostartLoading(true);
    setAutostartError('');
    try {
      setAutostartEnabled(await ApiService.getAutostartEnabled());
    } catch (error) {
      setAutostartError(error instanceof Error ? error.message : String(error));
    } finally {
      setAutostartLoading(false);
    }
  };

  const loadDesktopCalendarConfig = async () => {
    if (!desktopAvailable) return;
    try {
      const config = await ApiService.getDesktopCalendarConfig();
      if (typeof config?.showCompleted === 'boolean') {
        setShowCompletedDesktopTasks(config.showCompleted);
        localStorage.setItem(DESKTOP_CALENDAR_SHOW_COMPLETED_KEY, String(config.showCompleted));
      }
      if (typeof config?.opacity === 'number') {
        const normalized = normalizeDesktopCalendarOpacity(config.opacity);
        setDesktopCalOpacity(normalized);
        localStorage.setItem('lanmind_desktop_cal_opacity', String(normalized));
      }
    } catch (error) {
      console.warn('Failed to load desktop calendar config', error);
    }
  };

  const handleToggleAutostart = async () => {
    if (!desktopAvailable || autostartLoading) return;
    const requested = !autostartEnabled;
    setAutostartLoading(true);
    setAutostartError('');
    try {
      const applied = await ApiService.setAutostartEnabled(requested);
      setAutostartEnabled(applied);
      if (applied !== requested) {
        setAutostartError('系统未能应用开机启动设置，请稍后重试。');
      }
    } catch (error) {
      setAutostartError(error instanceof Error ? error.message : String(error));
    } finally {
      setAutostartLoading(false);
    }
  };

  const handleExportTasks = async () => {
    if (!desktopAvailable || dataOperation) return;
    setDataResult(null);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const selected = await save({
        title: '导出任务数据',
        defaultPath: `LanMind-任务数据-${date}.json`,
        filters: [{ name: 'LanMind 任务数据', extensions: ['json'] }],
      });
      if (!selected) return;
      setDataOperation('export');
      const result = await ApiService.exportTasks(selected, currentUserId);
      setDataResult({
        success: true,
        message: `已导出 ${result.exportedCount} 条当前账号可见任务。`,
      });
    } catch (error) {
      setDataResult({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDataOperation(null);
    }
  };

  const handleImportTasks = async () => {
    if (!desktopAvailable || dataOperation) return;
    setDataResult(null);
    try {
      const selected = await open({
        title: '导入任务数据',
        multiple: false,
        directory: false,
        filters: [{ name: 'LanMind 任务数据', extensions: ['json'] }],
      });
      if (!selected || Array.isArray(selected)) return;
      setDataOperation('import');
      const result = await ApiService.importTasks(selected, currentUserId);
      await onTasksImported();
      setDataResult({
        success: true,
        message: `已导入 ${result.importedCount} 条，跳过 ${result.skippedCount} 条重复任务，${result.convertedCount} 条已转为个人任务。`,
      });
    } catch (error) {
      setDataResult({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDataOperation(null);
    }
  };

  const handleTestLLM = async () => {
    setTestingLLM(true);
    setLlmTestResult(null);
    try {
      const res = await ApiService.testLLMConnection({
        protocol: 'openai',
        baseUrl,
        apiKey,
        modelName,
      });
      if (res.success) {
        setLlmTestResult({ success: true, message: res.message || '连通性测试成功' });
      } else {
        setLlmTestResult({ success: false, message: res.error || '连通性测试失败' });
      }
    } catch (err: any) {
      setLlmTestResult({ success: false, message: err.message || '测试连接异常' });
    } finally {
      setTestingLLM(false);
    }
  };

  const loadLLMConfig = async () => {
    try {
      setLlmLoading(true);
      const cfg = await ApiService.getLLMConfig();
      if (cfg) {
        setBaseUrl(cfg.baseUrl || 'https://api.openai.com/v1');
        setApiKey(cfg.apiKey || '');
        setModelName(cfg.modelName || 'gpt-4o-mini');
      }
    } catch (e) {
      console.error('Failed to load LLM config', e);
    } finally {
      setLlmLoading(false);
    }
  };

  const applyMcpStatus = (status: McpStatus) => {
    setMcpStatus(status);
    setMcpEnabled(status.enabled);
    setMcpPort(status.port);
  };

  const loadMcpStatus = async () => {
    try {
      setMcpError('');
      applyMcpStatus(await ApiService.getMcpStatus());
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSaveMcp = async (customEnabled?: boolean, customPort?: number) => {
    const targetEnabled = customEnabled !== undefined ? customEnabled : mcpEnabled;
    const targetPort = customPort !== undefined ? customPort : mcpPort;
    setMcpSaving(true);
    setMcpError('');
    try {
      applyMcpStatus(await ApiService.updateMcpConfig(targetEnabled, targetPort));
      setMcpSaved(true);
      setTimeout(() => setMcpSaved(false), 1500);
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    } finally {
      setMcpSaving(false);
    }
  };

  const handleToggleMcp = async (nextEnabled: boolean) => {
    setMcpEnabled(nextEnabled);
    await handleSaveMcp(nextEnabled, mcpPort);
  };

  const handlePortBlur = async () => {
    if (Number.isInteger(mcpPort) && mcpPort >= 1024 && mcpPort <= 65535 && mcpPort !== mcpStatus?.port) {
      await handleSaveMcp(mcpEnabled, mcpPort);
    }
  };

  const handleRotateMcpToken = async () => {
    setMcpSaving(true);
    setMcpError('');
    try {
      applyMcpStatus(await ApiService.rotateMcpToken());
      setMcpTokenVisible(true);
      setMcpSaved(true);
      setTimeout(() => setMcpSaved(false), 1500);
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    } finally {
      setMcpSaving(false);
    }
  };

  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  const saveShortcutsList = async (list: ShortcutItem[]) => {
    setShortcutSaving(true);
    setShortcutSaveError('');
    try {
      await onSaveShortcuts(list);
      setShortcutSavedSuccess(true);
      setTimeout(() => {
        setShortcutSavedSuccess(false);
      }, 1500);
    } catch (error) {
      setShortcutSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setShortcutSaving(false);
    }
  };

  // Key combo recorder listener for shortcuts
  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      return;
    }

    const ctrlKey = e.ctrlKey || e.metaKey;
    const altKey = e.altKey;
    const shiftKey = e.shiftKey;
    const code = e.code;

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

    const updated = localShortcuts.map((item) =>
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
    );
    setLocalShortcuts(updated);
    setRecordingId(null);
    void saveShortcutsList(updated);
  };

  const handleResetDefaults = () => {
    setLocalShortcuts(DEFAULT_SHORTCUTS);
    void saveShortcutsList(DEFAULT_SHORTCUTS);
  };

  const handleSaveLLM = async (e?: React.FormEvent, customModel?: string) => {
    if (e) e.preventDefault();
    const effectiveModel = customModel !== undefined ? customModel : modelName;
    try {
      await ApiService.updateLLMConfig({
        protocol: 'openai',
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        modelName: effectiveModel.trim(),
      });
      setLlmSavedSuccess(true);
      setTimeout(() => {
        setLlmSavedSuccess(false);
      }, 1500);
    } catch (err) {
      console.error('Failed to save LLM config', err);
    }
  };

  const handleFetchModels = async () => {
    if (!baseUrl.trim()) {
      setModelFetchMessage({ success: false, message: '请先填写接口地址' });
      return;
    }
    setFetchingModels(true);
    setModelFetchMessage(null);
    try {
      const res = await ApiService.fetchLLMModels({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
      if (res.success && res.models && res.models.length > 0) {
        setAvailableModels(res.models);
        setShowModelDropdown(true);
        setModelFetchMessage({ success: true, message: `已获取到 ${res.models.length} 个可用模型` });
      } else {
        setModelFetchMessage({ success: false, message: res.error || '未能获取到模型列表，请核对地址与密钥' });
      }
    } catch (err: any) {
      setModelFetchMessage({ success: false, message: err.message || '获取模型列表异常' });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleClose = () => {
    void handleSaveLLM();
    onClose();
  };

  if (!isOpen) return null;

  const menuItems = [
    {
      id: 'basic' as SettingsTab,
      label: '基础配置',
      icon: Settings,
      badgeColor: 'text-info',
    },
    {
      id: 'theme' as SettingsTab,
      label: '界面主题配色',
      icon: Palette,
      badgeColor: 'text-feature',
    },
    {
      id: 'shortcuts' as SettingsTab,
      label: '自定义快捷键',
      icon: Keyboard,
      badgeColor: 'text-warning',
    },
    {
      id: 'llm' as SettingsTab,
      label: '大模型配置',
      icon: Sparkles,
      badgeColor: 'text-feature',
    },
    {
      id: 'mcp' as SettingsTab,
      label: 'MCP 服务',
      icon: Server,
      badgeColor: 'text-info',
    },
    {
      id: 'about' as SettingsTab,
      label: '关于系统',
      icon: Info,
      badgeColor: 'text-info',
    },
  ];

  return (
    <div className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-edge rounded-2xl max-w-4xl w-full h-[620px] max-h-[calc(100vh-2rem)] flex flex-col shadow-popover overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge bg-surface/80 flex-shrink-0">
          <div className="flex items-center space-x-2 text-info">
            <Sliders className="w-5 h-5 text-info" />
            <h2 className="text-base font-bold text-main">系统全域配置中心 Settings</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="ui-modal-close-btn"
            title="关闭设置 (Esc)"
            aria-label="关闭设置"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Side-by-side Body Layout */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left Navigation Sidebar */}
          <div className="w-56 border-r border-edge bg-canvas/70 p-3 space-y-1.5 flex-shrink-0 select-none">
            <div className="px-3 py-1.5 text-[10px] font-bold text-quiet uppercase tracking-wider">
              配置分类
            </div>
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-start gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-left transition-all ${
                    isActive
                      ? `${currentTheme.primaryButton} !justify-start !gap-2.5 shadow-soft`
                      : 'text-sub hover:text-main hover:bg-hover/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-current' : item.badgeColor}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right Content Area */}
          <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden bg-surface/60">
            <div ref={contentAreaRef} className="min-h-0 flex-1 overflow-y-auto p-6">
            {/* Tab 1: Basic Settings */}
            {activeTab === 'basic' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-bold text-main">
                    <Settings className="h-4 w-4 text-info" /> 基础配置
                  </h3>
                  <p className="mt-1 text-xs text-sub">
                    管理当前设备的启动行为，并迁移当前账号可见的任务数据。
                  </p>
                </div>

                <section aria-labelledby="general-settings-heading" className="space-y-3">
                  <div>
                    <h4 id="general-settings-heading" className="flex items-center gap-2 text-xs font-bold text-main">
                      <Power className="h-3.5 w-3.5 text-success" /> 常规
                    </h4>
                  </div>

                  <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-main flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-success" />
                        显示农历与节气
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-sub">
                        在主界面日历视图和桌面日历中同步显示农历、二十四节气与传统节日。
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showLunarCalendar}
                      aria-label="显示农历与节气"
                      onClick={handleToggleLunarCalendar}
                      className="ui-switch"
                      data-state={showLunarCalendar ? 'checked' : 'unchecked'}
                    >
                      <span className="ui-switch-thumb" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-main flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-info" />
                        每周第一天
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-sub">
                        统一主程序日历排期、桌面挂件与任务日期选择器的每周起始日。
                      </p>
                    </div>
                    <div className="flex items-center rounded-lg border border-edge bg-surface p-1">
                      <button
                        type="button"
                        onClick={() => handleSelectWeekStartDay('monday')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                          weekStartDay === 'monday'
                            ? `${currentTheme.primaryButton} text-main shadow-soft`
                            : 'text-sub hover:text-main'
                        }`}
                      >
                        周一 (推荐)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectWeekStartDay('sunday')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                          weekStartDay === 'sunday'
                            ? `${currentTheme.primaryButton} text-main shadow-soft`
                            : 'text-sub hover:text-main'
                        }`}
                      >
                        周日
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-main">开机自动启动</div>
                      <p className="mt-1 text-[11px] leading-5 text-sub">
                        登录系统后静默启动 LanMind 至托盘，继续接收通知并保持局域网同步。
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autostartEnabled}
                      aria-label="开机自动启动"
                      disabled={!desktopAvailable || autostartLoading}
                      onClick={handleToggleAutostart}
                      className="ui-switch"
                      data-state={autostartEnabled ? 'checked' : 'unchecked'}
                    >
                      <span className="ui-switch-thumb">
                        {autostartLoading && <Loader2 className="h-3 w-3 animate-spin text-quiet" />}
                      </span>
                    </button>
                  </div>
                  {!desktopAvailable && (
                    <p className="text-[11px] text-quiet">开机启动仅在桌面客户端中可用。</p>
                  )}
                  {autostartError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-danger/10 p-2.5 text-xs text-danger">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>{autostartError}</span>
                    </div>
                  )}
                </section>

                <section aria-labelledby="notification-sound-settings-heading" className="space-y-3">
                  <div>
                    <h4
                      id="notification-sound-settings-heading"
                      className="flex items-center gap-2 text-xs font-bold text-main"
                    >
                      <Bell className="h-3.5 w-3.5 text-warning" /> 提醒通知与音效
                    </h4>
                  </div>

                  {/* Switch row */}
                  <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-main flex items-center gap-1.5">
                        <Volume2 className="h-3.5 w-3.5 text-warning" />
                        启用提醒提示音
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-sub">
                        任务到期提醒与桌面弹窗出现时播放提示声。
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notificationSoundSettings.enabled}
                      aria-label="启用提醒提示音"
                      onClick={handleToggleNotificationSound}
                      className="ui-switch"
                      data-state={notificationSoundSettings.enabled ? 'checked' : 'unchecked'}
                    >
                      <span className="ui-switch-thumb" />
                    </button>
                  </div>

                  {/* Tone selection & audition row */}
                  <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-main">提示音效</div>
                      <p className="mt-1 text-[11px] leading-5 text-sub">
                        选择弹窗提醒时的专属音律风格，支持实时试听。
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <ThemeSelect
                        ariaLabel="选择提醒提示音效"
                        value={notificationSoundSettings.tone}
                        options={NOTIFICATION_TONE_OPTIONS}
                        onChange={(val) =>
                          handleSelectNotificationTone(val as NotificationSoundTone)
                        }
                        disabled={!notificationSoundSettings.enabled}
                        width="168px"
                      />
                      <button
                        type="button"
                        onClick={() => handlePreviewTone(notificationSoundSettings.tone)}
                        disabled={!notificationSoundSettings.enabled}
                        className={`theme-btn-secondary relative flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
                          isPlayingPreview
                            ? 'border-amber-500/80 text-warning bg-amber-500/10 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                            : ''
                        }`}
                        title="试听当前提示音"
                        aria-label="试听当前提示音"
                      >
                        {isPlayingPreview && (
                          <svg
                            className="absolute inset-0 h-full w-full pointer-events-none animate-audio-arc text-warning"
                            viewBox="0 0 32 32"
                            fill="none"
                          >
                            <circle
                              cx="16"
                              cy="16"
                              r="13"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeDasharray="26 56"
                            />
                          </svg>
                        )}
                        <Volume2
                          className={`h-4 w-4 transition-transform duration-200 ${
                            isPlayingPreview ? 'text-warning scale-105' : 'text-sub'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Auto-dismiss switch row */}
                  <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-main flex items-center gap-1.5">
                        <Timer className="h-3.5 w-3.5 text-warning" />
                        提醒弹窗自动关闭
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-sub">
                        开启后倒计时结束自动关闭；关闭后弹窗将常驻屏幕，需手动点击关闭。
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notificationDurationSettings.autoDismiss}
                      aria-label="提醒弹窗自动关闭"
                      onClick={handleToggleAutoDismiss}
                      className="ui-switch"
                      data-state={notificationDurationSettings.autoDismiss ? 'checked' : 'unchecked'}
                    >
                      <span className="ui-switch-thumb" />
                    </button>
                  </div>

                  {/* Notification countdown duration slider & presets row */}
                  <div
                    className={`rounded-xl border border-edge bg-canvas/60 p-4 space-y-3 transition-opacity ${
                      notificationDurationSettings.autoDismiss ? 'opacity-100' : 'opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-main flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-warning" />
                          自动关闭倒计时时长
                        </span>
                        <span className="mt-0.5 block text-[11px] text-sub">
                          {notificationDurationSettings.autoDismiss
                            ? '设定弹窗停留时间（3 ~ 30 秒，鼠标悬停可暂停倒计时）。'
                            : '已切换为手动关闭模式，弹窗将持续常驻直至手动确认。'}
                        </span>
                      </div>
                      <span className="font-mono text-xs font-bold text-warning">
                        {notificationDurationSettings.autoDismiss
                          ? `${notificationDurationSettings.durationSeconds} 秒`
                          : '常驻显示'}
                      </span>
                    </div>

                    {/* Slider & Accurate Track Ruler */}
                    <div className="relative pt-1">
                      <input
                        type="range"
                        min={MIN_NOTIFICATION_DURATION_SECONDS}
                        max={MAX_NOTIFICATION_DURATION_SECONDS}
                        step="1"
                        disabled={!notificationDurationSettings.autoDismiss}
                        value={notificationDurationSettings.durationSeconds}
                        onChange={(e) => handleDurationSecondsChange(Number(e.target.value))}
                        className="w-full h-1.5 bg-card rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                      />

                      {/* Precise scale ruler directly below the slider track */}
                      <div className="relative mt-1 h-4 text-[10px] text-quiet font-mono select-none">
                        <span className="absolute left-0">3秒</span>
                        <span
                          className="absolute -translate-x-1/2 text-center"
                          style={{
                            left: `${
                              ((DEFAULT_NOTIFICATION_DURATION_SECONDS - MIN_NOTIFICATION_DURATION_SECONDS) /
                                (MAX_NOTIFICATION_DURATION_SECONDS - MIN_NOTIFICATION_DURATION_SECONDS)) *
                              100
                            }%`,
                          }}
                        >
                          10秒<span className="text-[9px] opacity-75">(默认)</span>
                        </span>
                        <span
                          className="absolute -translate-x-1/2 text-center"
                          style={{
                            left: `${
                              ((20 - MIN_NOTIFICATION_DURATION_SECONDS) /
                                (MAX_NOTIFICATION_DURATION_SECONDS - MIN_NOTIFICATION_DURATION_SECONDS)) *
                              100
                            }%`,
                          }}
                        >
                          20秒
                        </span>
                        <span className="absolute right-0 text-right">30秒</span>
                      </div>
                    </div>

                    {/* Quick Preset Buttons Row */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-[10px] text-sub mr-1">快捷选择:</span>
                      {[3, 5, 10, 15, 20, 30].map((sec) => {
                        const isSelected =
                          notificationDurationSettings.autoDismiss &&
                          notificationDurationSettings.durationSeconds === sec;
                        const isDefault = sec === DEFAULT_NOTIFICATION_DURATION_SECONDS;
                        return (
                          <button
                            key={sec}
                            type="button"
                            disabled={!notificationDurationSettings.autoDismiss}
                            onClick={() => handleDurationSecondsChange(sec)}
                            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all border ${
                              isSelected
                                ? 'bg-amber-500/20 text-warning border-amber-500/50 font-bold shadow-xs'
                                : 'bg-surface/80 border-edge text-sub hover:text-main hover:border-subtle disabled:opacity-50'
                            }`}
                          >
                            {sec}秒{isDefault ? ' (默认)' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Test notification row */}
                  <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-main flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-warning" />
                        测试桌面弹窗提醒
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-sub">
                        立即向屏幕右下角触发一条测试提醒，验证弹窗动画与提示音效。
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        disabled={testingNotification}
                        onClick={handleSendTestNotification}
                        className="theme-btn-secondary px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-all"
                        title="发送测试提醒至桌面右下角"
                      >
                        {testingNotification ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Bell className="h-3.5 w-3.5 text-warning" />
                        )}
                        <span>{testingNotification ? '发送中...' : '发送测试提醒'}</span>
                      </button>
                    </div>
                  </div>
                  {testNotificationResult && (
                    <div
                      className={`flex items-start gap-2 rounded-xl border p-2.5 text-xs ${
                        testNotificationResult.includes('失败')
                          ? 'border-rose-500/40 bg-danger/10 text-danger'
                          : 'border-emerald-500/40 bg-success/10 text-success'
                      }`}
                    >
                      {testNotificationResult.includes('失败') ? (
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      )}
                      <span>{testNotificationResult}</span>
                    </div>
                  )}
                </section>

                <section aria-labelledby="desktop-calendar-settings-heading" className="space-y-3">
                  <div>
                    <h4 id="desktop-calendar-settings-heading" className="flex items-center gap-2 text-xs font-bold text-main">
                      <Monitor className="h-3.5 w-3.5 text-info" /> 桌面日历
                    </h4>
                  </div>

                  <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-main flex items-center gap-1.5">
                        <Eye className="h-3.5 w-3.5 text-info" />
                        显示已完成任务
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-sub">
                        已完成任务会排在当天未完成任务之后，并以删除线和灰色显示。
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showCompletedDesktopTasks}
                      aria-label="桌面日历显示已完成任务"
                      onClick={handleToggleShowCompletedDesktopTasks}
                      className="ui-switch"
                      data-state={showCompletedDesktopTasks ? 'checked' : 'unchecked'}
                    >
                      <span className="ui-switch-thumb" />
                    </button>
                  </div>

                  <div className="rounded-xl border border-edge bg-canvas/60 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="block text-xs font-bold text-main">桌面日历透明度</span>
                        <span className="mt-0.5 block text-[11px] text-sub">
                          只调整日历底色，数值越低越透明；0% 完全透明，文字保持清晰。
                        </span>
                      </div>
                      <span className="font-mono text-xs font-bold text-info">{desktopCalOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min={DESKTOP_CALENDAR_MIN_OPACITY}
                      max={DESKTOP_CALENDAR_MAX_OPACITY}
                      step="1"
                      value={desktopCalOpacity}
                      onChange={(e) => handleDesktopCalOpacityChange(Number(e.target.value))}
                      className="w-full h-1.5 bg-card rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <div className="flex items-center justify-between gap-2 text-[10px] text-quiet font-mono">
                      <button
                        type="button"
                        onClick={() => handleDesktopCalOpacityChange(0)}
                        className={`transition-colors ${desktopCalOpacity === 0 ? 'text-info font-bold' : 'hover:text-sub'}`}
                      >
                        0% (完全透明 · 默认)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDesktopCalOpacityChange(30)}
                        className={`transition-colors ${desktopCalOpacity === 30 ? 'text-info font-bold' : 'hover:text-sub'}`}
                      >
                        30% (微透)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDesktopCalOpacityChange(60)}
                        className={`transition-colors ${desktopCalOpacity === 60 ? 'text-info font-bold' : 'hover:text-sub'}`}
                      >
                        60% (半透明)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDesktopCalOpacityChange(90)}
                        className={`transition-colors ${desktopCalOpacity === 90 ? 'text-info font-bold' : 'hover:text-sub'}`}
                      >
                        {DESKTOP_CALENDAR_MAX_OPACITY}% (深底色)
                      </button>
                    </div>
                  </div>
                </section>

                <section aria-labelledby="data-settings-heading" className="space-y-3">
                  <div>
                    <h4 id="data-settings-heading" className="flex items-center gap-2 text-xs font-bold text-main">
                      <Database className="h-3.5 w-3.5 text-info" /> 数据
                    </h4>
                    <p className="mt-1 text-[11px] leading-5 text-sub">
                      使用 JSON 文件迁移当前账号可见的任务。导入只添加不存在的任务，不会覆盖已有数据。
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={!desktopAvailable || dataOperation !== null}
                      onClick={handleImportTasks}
                      className="group flex min-h-20 items-center gap-3 rounded-xl border border-edge bg-canvas/60 p-4 text-left transition-colors hover:border-cyan-500/40 hover:bg-hover/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-info">
                        {dataOperation === 'import' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-main">导入任务</span>
                        <span className="mt-1 block text-[11px] leading-4 text-sub">选择 LanMind 任务数据文件</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={!desktopAvailable || dataOperation !== null}
                      onClick={handleExportTasks}
                      className="group flex min-h-20 items-center gap-3 rounded-xl border border-edge bg-canvas/60 p-4 text-left transition-colors hover:border-blue-500/40 hover:bg-hover/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-info">
                        {dataOperation === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-main">导出任务</span>
                        <span className="mt-1 block text-[11px] leading-4 text-sub">保存当前可见任务数据</span>
                      </span>
                    </button>
                  </div>
                  {dataResult && (
                    <div className={`flex items-start gap-2 rounded-xl border p-2.5 text-xs ${
                      dataResult.success
                        ? 'border-emerald-500/40 bg-success/10 text-success'
                        : 'border-rose-500/40 bg-danger/10 text-danger'
                    }`}>
                      {dataResult.success
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        : <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />}
                      <span>{dataResult.message}</span>
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* Tab 2: Theme Settings */}
            {activeTab === 'theme' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-main flex items-center gap-2">
                    <Palette className="w-4 h-4 text-feature" /> 界面主题配色
                  </h3>
                  <p className="text-xs text-sub mt-1">
                    选择您喜爱的全域 UI 色彩风格，改动将实时在本机持久化。
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={themePreference === 'system'}
                  onClick={() => setThemeId(themePreference === 'system' ? currentTheme.id : 'system')}
                  className="flex w-full items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4 text-left transition-colors hover:border-subtle hover:bg-hover/50"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-info">
                      <Monitor className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-main">跟随系统</span>
                      <span className="mt-1 block text-[11px] leading-4 text-sub">
                        系统浅色模式使用钛白明亮，深色模式使用深蓝星空
                      </span>
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="ui-switch"
                    data-state={themePreference === 'system' ? 'checked' : 'unchecked'}
                  >
                    <span className="ui-switch-thumb" />
                  </span>
                </button>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {allThemes.map((theme) => {
                    const isSelected = themePreference === theme.id;
                    const accentColor = theme.accentColor || '#3b82f6';
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => setThemeId(theme.id)}
                        style={isSelected ? { borderColor: accentColor, boxShadow: `0 8px 24px ${accentColor}25` } : undefined}
                        className={`p-3.5 rounded-xl border text-left transition-all duration-200 relative group flex flex-col justify-between ${
                          isSelected
                            ? 'bg-card/90 ring-1'
                            : 'bg-canvas/60 border-edge hover:border-subtle hover:bg-hover/50'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2.5">
                              <div
                                className="w-4 h-4 rounded-full shadow-inner flex-shrink-0 ring-1 ring-white/20"
                                style={{ background: theme.previewColor }}
                              />
                              <span className="text-xs font-bold text-main group-hover:text-info transition-colors">
                                {theme.name}
                              </span>
                            </div>

                            {isSelected && (
                              <span
                                className="w-4 h-4 rounded-full text-main flex items-center justify-center text-[10px] shadow-panel"
                                style={{ backgroundColor: accentColor }}
                              >
                                <Check className="w-2.5 h-2.5" />
                              </span>
                            )}
                          </div>

                          <p className="text-[11px] text-sub line-clamp-2 leading-relaxed">
                            {theme.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tab 2: Hotkeys Shortcuts */}
            {activeTab === 'shortcuts' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-main flex items-center gap-2">
                    <Keyboard className="w-4 h-4 text-warning" /> 自定义全局快捷键
                  </h3>
                  <p className="text-xs text-sub mt-1">
                    点击右侧按钮并按下键盘组合键。全局快捷键在全系统生效，建议使用 <span className="text-warning font-mono">Ctrl + Alt + 键</span> 或 <span className="text-warning font-mono">Alt + 键</span>，避免与系统及常用软件内置热键（如 Ctrl+C/V/W 等）冲突。
                  </p>
                </div>

                <div className="space-y-2.5 pt-1">
                  {localShortcuts.map((item) => {
                    const isRecording = recordingId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                          isRecording
                            ? 'bg-warning/10 border-amber-500/60 ring-1 ring-amber-500'
                            : 'bg-canvas/60 border-edge hover:bg-hover/40'
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-main">{item.name}</div>
                          <div className="text-[11px] text-sub">{item.description}</div>
                        </div>

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
                          {isRecording ? '请按下快捷键...' : item.keyLabel}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {shortcutSavedSuccess && (
                  <div className="p-2.5 bg-success/10 border border-emerald-500/40 text-success rounded-xl flex items-center gap-2 font-medium text-xs">
                    <Check className="w-4 h-4 text-success" />
                    <span>快捷键组合配置已保存并生效！</span>
                  </div>
                )}
                {shortcutSaveError && (
                  <div className="p-2.5 bg-danger/10 border border-rose-500/40 text-danger rounded-xl flex items-start gap-2 font-medium text-xs">
                    <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
                    <span>{shortcutSaveError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: LLM AI Model API Config */}
            {activeTab === 'llm' && (
              <form onSubmit={handleSaveLLM} className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-main flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-feature" /> 大模型 API 配置
                  </h3>
                  <p className="text-xs text-sub mt-1">
                    用于局域网智能风险诊断、任务智能分解与 AI 自动化处理引擎。
                  </p>
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
                    <Sliders className="h-3.5 w-3.5 text-sub" />
                    <span>接口格式</span>
                  </label>
                  <div className="flex h-9 items-center rounded-xl border border-subtle bg-canvas px-3 text-xs font-semibold text-main">
                    OpenAI 兼容格式
                  </div>
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-sub font-semibold mb-1 text-xs flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5 text-info" /> <span>接口地址</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    onBlur={() => void handleSaveLLM()}
                    placeholder="https://api.openai.com/v1 或 本地 Ollama URL"
                    className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-main font-mono focus:outline-none focus:border-accent/50 text-xs"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-sub font-semibold mb-1 text-xs flex items-center gap-1">
                    <Key className="w-3.5 h-3.5 text-warning" /> <span>接口密钥</span>
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onBlur={() => void handleSaveLLM()}
                    placeholder="sk-..."
                    className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-main font-mono focus:outline-none focus:border-accent/50 text-xs"
                  />
                </div>

                {/* Model Name with fetch button and dropdown */}
                <div ref={modelSectionRef}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sub font-semibold text-xs flex items-center gap-1">
                      <Cpu className="w-3.5 h-3.5 text-feature" /> <span>模型名称</span>
                    </label>
                    {availableModels.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowModelDropdown((v) => !v)}
                        className="text-[11px] text-info hover:text-info transition-colors"
                      >
                        {showModelDropdown ? '收起候选列表' : `查看候选模型 (${availableModels.length})`}
                      </button>
                    )}
                  </div>
                  <div ref={modelInputBoxRef} className="relative">
                    <input
                      type="text"
                      required
                      value={modelName}
                      onChange={(e) => setModelName(e.target.value)}
                      onBlur={() => void handleSaveLLM()}
                      placeholder="如 gpt-4o-mini, deepseek-chat, qwen-max..."
                      className="w-full bg-canvas border border-subtle rounded-xl pl-3 pr-10 py-2 text-main font-mono focus:outline-none focus:border-accent/50 text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleFetchModels}
                      disabled={fetchingModels}
                      className="absolute right-1.5 top-1.5 p-1 rounded-lg border border-subtle hover:border-subtle bg-surface text-sub hover:text-main transition-all disabled:opacity-50"
                      title="点击获取当前接口支持的模型列表"
                      aria-label="获取当前接口支持的模型列表"
                    >
                      {fetchingModels ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-info" />
                      ) : (
                        <ListFilter className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {/* Model Dropdown Popover */}
                    {showModelDropdown && availableModels.length > 0 && (
                      <div className={`absolute left-0 right-0 z-50 rounded-xl border border-subtle bg-surface/95 backdrop-blur-md shadow-popover p-2 animate-in fade-in zoom-in-95 ${
                        dropdownPlacement === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                      }`}>
                        <div className="flex items-center justify-between px-2 pb-1.5 border-b border-edge">
                          <span className="text-[11px] font-bold text-sub">选择可用模型 (共 {availableModels.length} 个)</span>
                          <button
                            type="button"
                            onClick={() => setShowModelDropdown(false)}
                            className="ui-modal-close-btn h-6 w-6 rounded-md"
                            title="关闭下拉面板"
                            aria-label="关闭下拉面板"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="mt-1.5 px-1">
                          <input
                            type="text"
                            placeholder="筛选模型名称..."
                            value={modelFilterQuery}
                            onChange={(e) => setModelFilterQuery(e.target.value)}
                            className="w-full bg-canvas border border-edge rounded-lg px-2.5 py-1 text-[11px] text-main focus:outline-none focus:border-accent/50 font-mono"
                          />
                        </div>
                        <div className="mt-1.5 max-h-44 overflow-y-auto space-y-0.5 pr-1">
                          {availableModels.filter((m) => m.toLowerCase().includes(modelFilterQuery.toLowerCase())).length === 0 ? (
                            <div className="py-3 text-center text-[11px] text-quiet">未找到匹配模型</div>
                          ) : (
                            availableModels
                              .filter((m) => m.toLowerCase().includes(modelFilterQuery.toLowerCase()))
                              .map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => {
                                    setModelName(m);
                                    setShowModelDropdown(false);
                                    void handleSaveLLM(undefined, m);
                                  }}
                                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors flex items-center justify-between ${
                                    modelName === m
                                      ? 'bg-blue-600/20 text-info font-semibold border border-blue-500/30'
                                      : 'hover:bg-hover text-sub hover:text-main'
                                  }`}
                                >
                                  <span className="truncate">{m}</span>
                                  {modelName === m && <Check className="w-3.5 h-3.5 text-info shrink-0" />}
                                </button>
                              ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {modelFetchMessage && (
                    <div className={`mt-1.5 text-[11px] flex items-center gap-1.5 ${
                      modelFetchMessage.success ? 'text-success' : 'text-warning'
                    }`}>
                      {modelFetchMessage.success ? (
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3 h-3 shrink-0" />
                      )}
                      <span>{modelFetchMessage.message}</span>
                    </div>
                  )}
                </div>

                {/* Test Status Feedback */}
                {llmTestResult && (
                  <div
                    className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                      llmTestResult.success
                        ? 'bg-success/10 border-emerald-500/40 text-success'
                        : 'bg-danger/10 border-rose-500/40 text-danger'
                    }`}
                  >
                    {llmTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 break-all leading-relaxed">{llmTestResult.message}</div>
                  </div>
                )}

                {llmSavedSuccess && (
                  <div className="p-2.5 bg-success/10 border border-emerald-500/40 text-success rounded-xl flex items-center gap-2 font-medium text-xs">
                    <Check className="w-4 h-4 text-success" />
                    <span>大模型 API 配置已自动保存！</span>
                  </div>
                )}
              </form>
            )}

            {activeTab === 'mcp' && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="flex items-center gap-2 whitespace-nowrap text-sm font-bold text-main">
                      <Server className="h-4 w-4 shrink-0 text-info" />
                      <span className="shrink-0">MCP 局域网服务</span>
                      <McpHelpTooltip content="MCP 服务允许可信局域网内的模型和 Agent 查询、创建及更新当前用户有权限访问的任务。" />
                    </h3>
                    <p className="text-xs text-sub mt-1 leading-relaxed">
                      允许可信局域网内的大模型和 Agent 查询、创建及更新当前用户有权访问的任务。
                    </p>
                  </div>
                  <div className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    mcpStatus?.running
                      ? 'mcp-status-running'
                      : 'mcp-status-off'
                  }`}>
                    <span className={`h-2 w-2 rounded-full ${mcpStatus?.running ? 'bg-emerald-400' : 'bg-muted'}`} />
                    {mcpStatus?.running ? '正在运行' : '未运行'}
                  </div>
                </div>

                <div className="mcp-warning rounded-xl p-3 text-[11px] leading-relaxed">
                  当前使用 HTTP + Bearer Token，仅适合受信任的办公局域网。请勿在访客 Wi-Fi 或不可信网络中启用。
                </div>

                <div className="mcp-panel flex items-center justify-between gap-3 rounded-xl p-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-main">启用 MCP 服务</div>
                    <div className="mt-0.5 text-[11px] text-sub">随 LanMind 自动启动，退出应用时停止。</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={mcpEnabled}
                    onClick={() => void handleToggleMcp(!mcpEnabled)}
                    className="ui-switch"
                    data-state={mcpEnabled ? 'checked' : 'unchecked'}
                  >
                    <span className="ui-switch-thumb" />
                  </button>
                </div>

                <div className="grid grid-cols-[minmax(110px,130px)_minmax(0,1fr)] gap-3">
                  <div className="min-w-0">
                    <label className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-sub">监听端口 <McpHelpTooltip content="MCP 服务监听的本机端口，范围为 1024–65535。" /></label>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={mcpPort}
                      onChange={(event) => setMcpPort(Number(event.target.value))}
                      onBlur={handlePortBlur}
                      className="mcp-field w-full rounded-xl px-3 py-2 font-mono text-xs focus:outline-none"
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-sub">Streamable HTTP 地址 <McpHelpTooltip content="将此地址填入支持 Streamable HTTP 的 MCP 客户端。" /></label>
                    <div className="flex min-w-0 gap-2">
                      <div className="mcp-field min-w-0 flex-1 truncate rounded-xl px-3 py-2 font-mono text-xs">
                        {mcpStatus?.endpoint || `http://<局域网IP>:${mcpPort}/mcp`}
                      </div>
                      <button
                        type="button"
                        disabled={!mcpStatus?.endpoint}
                        onClick={() => mcpStatus?.endpoint && copyText(mcpStatus.endpoint)}
                        className="mcp-button shrink-0 rounded-xl px-3 disabled:opacity-40"
                        title="复制地址"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-sub">Bearer Token <McpHelpTooltip content="所有 MCP 请求都必须携带此 Bearer Token。令牌只保存在当前设备，请勿分享。" align="left" /></label>
                  <div className="flex min-w-0 flex-wrap gap-2">
                    <div className="mcp-field min-w-[180px] flex-1 truncate rounded-xl px-3 py-2 font-mono text-xs">
                      {mcpTokenVisible ? mcpStatus?.token || '' : '••••••••••••••••••••••••••••••••'}
                    </div>
                    <button
                      type="button"
                      onClick={() => setMcpTokenVisible((visible) => !visible)}
                      className="mcp-button shrink-0 rounded-xl px-3"
                      title={mcpTokenVisible ? '隐藏令牌' : '显示令牌'}
                    >
                      {mcpTokenVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      disabled={!mcpStatus?.token}
                      onClick={() => mcpStatus?.token && copyText(mcpStatus.token)}
                      className="mcp-button shrink-0 rounded-xl px-3 disabled:opacity-40"
                      title="复制令牌"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={mcpSaving}
                      onClick={handleRotateMcpToken}
                      className="mcp-button flex shrink-0 items-center gap-1.5 rounded-xl px-3 text-[11px] font-semibold text-warning disabled:opacity-40"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> 轮换
                    </button>
                  </div>
                </div>

                {(mcpError || mcpStatus?.error) && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-danger/10 p-2.5 text-xs text-danger">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{mcpError || mcpStatus?.error}</span>
                  </div>
                )}
                {mcpSaved && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-success/10 p-2.5 text-xs text-success">
                    <Check className="h-4 w-4" /> MCP 配置已保存并生效
                  </div>
                )}
              </div>
            )}

            {/* Tab 4: About System */}
            {activeTab === 'about' && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div>
                  <h3 className="text-sm font-bold text-main flex items-center gap-2">
                    <Info className="w-4 h-4 text-info" /> 关于系统 About
                  </h3>
                  <p className="text-xs text-sub mt-1">
                    系统基本信息、网络通信与核心功能架构概览。
                  </p>
                </div>

                {/* Main Hero Card */}
                <div className="p-4 bg-canvas/80 border border-edge rounded-2xl flex items-start space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-panel shadow-blue-500/20 flex-shrink-0 mt-0.5">
                    <Zap className="w-7 h-7 text-main" />
                  </div>
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-extrabold text-main">智域协同</h4>
                      <span className="rounded-md border border-subtle bg-surface px-2 py-0.5 font-mono text-[10px] font-semibold text-sub">
                        {appVersion
                          ? appVersion === '未知' ? '版本未知' : `v${appVersion}`
                          : desktopAvailable ? '版本读取中' : 'Web 预览'}
                      </span>
                    </div>
                    <p className="text-xs text-sub leading-relaxed">
                      基于 P2P 局域网无服务器协同与大模型赋能的智能化团队任务管理平台。支持团队任务分配、多端增量同步、风险智能诊断、周报与 PPT 自动生成、局域网即时通信与文件传输。
                    </p>
                  </div>
                </div>

                {/* Key Architectural Features Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div className="p-3 bg-canvas/50 border border-edge/80 rounded-xl space-y-1">
                    <div className="flex items-center space-x-2 text-success text-xs font-bold">
                      <Wifi className="w-3.5 h-3.5" />
                      <span>P2P 局域网协同</span>
                    </div>
                    <p className="text-[11px] text-sub leading-normal">
                      支持增量数据分发、状态广播与节点自动发现，零外部服务器依赖。
                    </p>
                  </div>

                  <div className="p-3 bg-canvas/50 border border-edge/80 rounded-xl space-y-1">
                    <div className="flex items-center space-x-2 text-feature text-xs font-bold">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>AI 智能化中枢</span>
                    </div>
                    <p className="text-[11px] text-sub leading-normal">
                      多协议 LLM 接入，支持智能风险诊断、汇报工坊与演示文稿一键生成。
                    </p>
                  </div>

                  <div className="p-3 bg-canvas/50 border border-edge/80 rounded-xl space-y-1">
                    <div className="flex items-center space-x-2 text-info text-xs font-bold">
                      <Sliders className="w-3.5 h-3.5" />
                      <span>多维视图 & 协作</span>
                    </div>
                    <p className="text-[11px] text-sub leading-normal">
                      包含 Kanban 看板、甘特图、局域网 P2P 聊天室及项目文件分发频道。
                    </p>
                  </div>

                  <div className="p-3 bg-canvas/50 border border-edge/80 rounded-xl space-y-1">
                    <div className="flex items-center space-x-2 text-warning text-xs font-bold">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>数据安全与状态</span>
                    </div>
                    <p className="text-[11px] text-sub leading-normal">
                      支持多主题防护、快捷键操控、本地缓存持久化与离线模式无缝续传。
                    </p>
                  </div>
                </div>
              </div>
            )}

            </div>

            {/* Bottom Footer Action Bar */}
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-edge px-6 py-4 text-xs">
              {activeTab === 'shortcuts' ? (
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="flex items-center gap-1.5 text-sub hover:text-main px-3 py-1.5 rounded-xl border border-subtle/60 bg-surface/60 hover:bg-hover transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>恢复默认快捷键</span>
                </button>
              ) : activeTab === 'llm' ? (
                <button
                  type="button"
                  disabled={testingLLM}
                  onClick={handleTestLLM}
                  className="px-3.5 py-1.5 bg-card/90 hover:bg-hover disabled:opacity-50 text-main hover:text-main font-semibold rounded-xl border border-subtle hover:border-subtle transition-all flex items-center gap-1.5 text-xs shadow-soft"
                >
                  {testingLLM ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-info" />
                      <span>正在检测...</span>
                    </>
                  ) : (
                    <>
                      <Activity className="w-3.5 h-3.5 text-info" />
                      <span>检测接口连通性</span>
                    </>
                  )}
                </button>
              ) : activeTab === 'theme' ? (
                <div className="text-sub text-[11px]">
                  当前主题: <span className="text-main font-bold">{currentTheme.name}</span>
                  {themePreference === 'system' && <span>（跟随系统）</span>}
                </div>
              ) : activeTab === 'mcp' ? (
                <div className="text-[11px] text-sub">所有改动即时生效 · 随应用自启</div>
              ) : (
                <div className="text-sub text-[11px] flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>智域协同 · 运行状态正常</span>
                </div>
              )}

              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="ui-cancel-button px-5 py-2 rounded-xl text-xs font-semibold shadow-soft"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
