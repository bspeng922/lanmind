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
} from 'lucide-react';
import { ShortcutItem, DEFAULT_SHORTCUTS } from './ShortcutModal';
import { ApiService, McpStatus } from '../services/api';

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
      badgeColor: 'text-blue-400',
    },
    {
      id: 'theme' as SettingsTab,
      label: '界面主题配色',
      icon: Palette,
      badgeColor: 'text-indigo-400',
    },
    {
      id: 'shortcuts' as SettingsTab,
      label: '自定义快捷键',
      icon: Keyboard,
      badgeColor: 'text-amber-400',
    },
    {
      id: 'llm' as SettingsTab,
      label: '大模型配置',
      icon: Sparkles,
      badgeColor: 'text-purple-400',
    },
    {
      id: 'mcp' as SettingsTab,
      label: 'MCP 服务',
      icon: Server,
      badgeColor: 'text-cyan-400',
    },
    {
      id: 'about' as SettingsTab,
      label: '关于系统',
      icon: Info,
      badgeColor: 'text-blue-400',
    },
  ];

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full h-[620px] max-h-[calc(100vh-2rem)] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80 flex-shrink-0">
          <div className="flex items-center space-x-2 text-blue-400">
            <Sliders className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-bold text-white">系统全域配置中心 Settings</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Side-by-side Body Layout */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left Navigation Sidebar */}
          <div className="w-56 border-r border-slate-800 bg-slate-950/70 p-3 space-y-1.5 flex-shrink-0 select-none">
            <div className="px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
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
                  className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? `${currentTheme.primaryButton} shadow-sm`
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : item.badgeColor}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right Content Area */}
          <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden bg-slate-900/60">
            <div ref={contentAreaRef} className="min-h-0 flex-1 overflow-y-auto p-6">
            {/* Tab 1: Basic Settings */}
            {activeTab === 'basic' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                    <Settings className="h-4 w-4 text-blue-400" /> 基础配置
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    管理当前设备的启动行为，并迁移当前账号可见的任务数据。
                  </p>
                </div>

                <section aria-labelledby="general-settings-heading" className="space-y-3">
                  <div>
                    <h4 id="general-settings-heading" className="flex items-center gap-2 text-xs font-bold text-slate-200">
                      <Power className="h-3.5 w-3.5 text-emerald-400" /> 常规
                    </h4>
                  </div>

                  <div className="flex items-center justify-between gap-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-emerald-400" />
                        显示农历与节气
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-slate-400">
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

                  <div className="flex items-center justify-between gap-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white">开机自动启动</div>
                      <p className="mt-1 text-[11px] leading-5 text-slate-400">
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
                        {autostartLoading && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
                      </span>
                    </button>
                  </div>
                  {!desktopAvailable && (
                    <p className="text-[11px] text-slate-500">开机启动仅在桌面客户端中可用。</p>
                  )}
                  {autostartError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/40 p-2.5 text-xs text-rose-300">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>{autostartError}</span>
                    </div>
                  )}
                </section>

                <section aria-labelledby="desktop-calendar-settings-heading" className="space-y-3">
                  <div>
                    <h4 id="desktop-calendar-settings-heading" className="flex items-center gap-2 text-xs font-bold text-slate-200">
                      <Monitor className="h-3.5 w-3.5 text-blue-400" /> 桌面日历
                    </h4>
                  </div>

                  <div className="flex items-center justify-between gap-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Eye className="h-3.5 w-3.5 text-blue-400" />
                        显示已完成任务
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-slate-400">
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

                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="block text-xs font-bold text-white">桌面日历透明度</span>
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          只调整日历底色，数值越低越透明；0% 完全透明，文字保持清晰。
                        </span>
                      </div>
                      <span className="font-mono text-xs font-bold text-blue-400">{desktopCalOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min={DESKTOP_CALENDAR_MIN_OPACITY}
                      max={DESKTOP_CALENDAR_MAX_OPACITY}
                      step="1"
                      value={desktopCalOpacity}
                      onChange={(e) => handleDesktopCalOpacityChange(Number(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
                      <button
                        type="button"
                        onClick={() => handleDesktopCalOpacityChange(0)}
                        className={`transition-colors ${desktopCalOpacity === 0 ? 'text-blue-400 font-bold' : 'hover:text-slate-300'}`}
                      >
                        0% (完全透明 · 默认)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDesktopCalOpacityChange(30)}
                        className={`transition-colors ${desktopCalOpacity === 30 ? 'text-blue-400 font-bold' : 'hover:text-slate-300'}`}
                      >
                        30% (微透)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDesktopCalOpacityChange(60)}
                        className={`transition-colors ${desktopCalOpacity === 60 ? 'text-blue-400 font-bold' : 'hover:text-slate-300'}`}
                      >
                        60% (半透明)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDesktopCalOpacityChange(90)}
                        className={`transition-colors ${desktopCalOpacity === 90 ? 'text-blue-400 font-bold' : 'hover:text-slate-300'}`}
                      >
                        {DESKTOP_CALENDAR_MAX_OPACITY}% (深底色)
                      </button>
                    </div>
                  </div>
                </section>

                <section aria-labelledby="data-settings-heading" className="space-y-3">
                  <div>
                    <h4 id="data-settings-heading" className="flex items-center gap-2 text-xs font-bold text-slate-200">
                      <Database className="h-3.5 w-3.5 text-cyan-400" /> 数据
                    </h4>
                    <p className="mt-1 text-[11px] leading-5 text-slate-400">
                      使用 JSON 文件迁移当前账号可见的任务。导入只添加不存在的任务，不会覆盖已有数据。
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={!desktopAvailable || dataOperation !== null}
                      onClick={handleImportTasks}
                      className="group flex min-h-20 items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left transition-colors hover:border-cyan-500/40 hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
                        {dataOperation === 'import' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-white">导入任务</span>
                        <span className="mt-1 block text-[11px] leading-4 text-slate-400">选择 LanMind 任务数据文件</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={!desktopAvailable || dataOperation !== null}
                      onClick={handleExportTasks}
                      className="group flex min-h-20 items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left transition-colors hover:border-blue-500/40 hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                        {dataOperation === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-white">导出任务</span>
                        <span className="mt-1 block text-[11px] leading-4 text-slate-400">保存当前可见任务数据</span>
                      </span>
                    </button>
                  </div>
                  {dataResult && (
                    <div className={`flex items-start gap-2 rounded-xl border p-2.5 text-xs ${
                      dataResult.success
                        ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                        : 'border-rose-500/40 bg-rose-950/40 text-rose-300'
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
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Palette className="w-4 h-4 text-indigo-400" /> 界面主题配色
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    选择您喜爱的全域 UI 色彩风格，改动将实时在本机持久化。
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={themePreference === 'system'}
                  onClick={() => setThemeId(themePreference === 'system' ? currentTheme.id : 'system')}
                  className="flex w-full items-center justify-between gap-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left transition-colors hover:border-slate-700 hover:bg-slate-800/50"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                      <Monitor className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-white">跟随系统</span>
                      <span className="mt-1 block text-[11px] leading-4 text-slate-400">
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
                            ? 'bg-slate-800/90 ring-1'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2.5">
                              <div
                                className="w-4 h-4 rounded-full shadow-inner flex-shrink-0 ring-1 ring-white/20"
                                style={{ background: theme.previewColor }}
                              />
                              <span className="text-xs font-bold text-white group-hover:text-blue-300 transition-colors">
                                {theme.name}
                              </span>
                            </div>

                            {isSelected && (
                              <span
                                className="w-4 h-4 rounded-full text-white flex items-center justify-center text-[10px] shadow-md"
                                style={{ backgroundColor: accentColor }}
                              >
                                <Check className="w-2.5 h-2.5" />
                              </span>
                            )}
                          </div>

                          <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
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
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Keyboard className="w-4 h-4 text-amber-400" /> 自定义全局快捷键
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    点击右侧按钮并按下键盘组合键。全局快捷键在全系统生效，建议使用 <span className="text-amber-300 font-mono">Ctrl + Alt + 键</span> 或 <span className="text-amber-300 font-mono">Alt + 键</span>，避免与系统及常用软件内置热键（如 Ctrl+C/V/W 等）冲突。
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
                            ? 'bg-amber-950/30 border-amber-500/60 ring-1 ring-amber-500'
                            : 'bg-slate-950/60 border-slate-800 hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-white">{item.name}</div>
                          <div className="text-[11px] text-slate-400">{item.description}</div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setRecordingId(item.id)}
                          onKeyDown={isRecording ? (e) => handleKeyDown(e, item.id) : undefined}
                          autoFocus={isRecording}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold transition-all min-w-[100px] text-center ${
                            isRecording
                              ? 'bg-amber-500 text-slate-950 border-amber-400 animate-pulse shadow-lg shadow-amber-500/20'
                              : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700 hover:border-amber-500/40'
                          }`}
                        >
                          {isRecording ? '请按下快捷键...' : item.keyLabel}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {shortcutSavedSuccess && (
                  <div className="p-2.5 bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 rounded-xl flex items-center gap-2 font-medium text-xs">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>快捷键组合配置已保存并生效！</span>
                  </div>
                )}
                {shortcutSaveError && (
                  <div className="p-2.5 bg-rose-950/40 border border-rose-500/40 text-rose-300 rounded-xl flex items-start gap-2 font-medium text-xs">
                    <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    <span>{shortcutSaveError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: LLM AI Model API Config */}
            {activeTab === 'llm' && (
              <form onSubmit={handleSaveLLM} className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-400" /> 大模型 API 配置
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    用于局域网智能风险诊断、任务智能分解与 AI 自动化处理引擎。
                  </p>
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Sliders className="h-3.5 w-3.5 text-slate-400" />
                    <span>接口格式</span>
                  </label>
                  <div className="flex h-9 items-center rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-semibold text-slate-200">
                    OpenAI 兼容格式
                  </div>
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1 text-xs flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5 text-blue-400" /> <span>接口地址</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    onBlur={() => void handleSaveLLM()}
                    placeholder="https://api.openai.com/v1 或 本地 Ollama URL"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500 text-xs"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1 text-xs flex items-center gap-1">
                    <Key className="w-3.5 h-3.5 text-amber-400" /> <span>接口密钥</span>
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onBlur={() => void handleSaveLLM()}
                    placeholder="sk-..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500 text-xs"
                  />
                </div>

                {/* Model Name with fetch button and dropdown */}
                <div ref={modelSectionRef}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-300 font-semibold text-xs flex items-center gap-1">
                      <Cpu className="w-3.5 h-3.5 text-purple-400" /> <span>模型名称</span>
                    </label>
                    {availableModels.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowModelDropdown((v) => !v)}
                        className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
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
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-3 pr-10 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500 text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleFetchModels}
                      disabled={fetchingModels}
                      className="absolute right-1.5 top-1.5 p-1 rounded-lg border border-slate-700 hover:border-slate-500 bg-slate-900 text-slate-300 hover:text-white transition-all disabled:opacity-50"
                      title="点击获取当前接口支持的模型列表"
                      aria-label="获取当前接口支持的模型列表"
                    >
                      {fetchingModels ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                      ) : (
                        <ListFilter className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {/* Model Dropdown Popover */}
                    {showModelDropdown && availableModels.length > 0 && (
                      <div className={`absolute left-0 right-0 z-50 rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur-md shadow-2xl p-2 animate-in fade-in zoom-in-95 ${
                        dropdownPlacement === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                      }`}>
                        <div className="flex items-center justify-between px-2 pb-1.5 border-b border-slate-800">
                          <span className="text-[11px] font-bold text-slate-300">选择可用模型 (共 {availableModels.length} 个)</span>
                          <button
                            type="button"
                            onClick={() => setShowModelDropdown(false)}
                            className="text-slate-400 hover:text-white p-0.5 rounded"
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
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                          />
                        </div>
                        <div className="mt-1.5 max-h-44 overflow-y-auto space-y-0.5 pr-1">
                          {availableModels.filter((m) => m.toLowerCase().includes(modelFilterQuery.toLowerCase())).length === 0 ? (
                            <div className="py-3 text-center text-[11px] text-slate-500">未找到匹配模型</div>
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
                                      ? 'bg-blue-600/20 text-blue-300 font-semibold border border-blue-500/30'
                                      : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                                  }`}
                                >
                                  <span className="truncate">{m}</span>
                                  {modelName === m && <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                                </button>
                              ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {modelFetchMessage && (
                    <div className={`mt-1.5 text-[11px] flex items-center gap-1.5 ${
                      modelFetchMessage.success ? 'text-emerald-400' : 'text-amber-400'
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
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                        : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                    }`}
                  >
                    {llmTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 break-all leading-relaxed">{llmTestResult.message}</div>
                  </div>
                )}

                {llmSavedSuccess && (
                  <div className="p-2.5 bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 rounded-xl flex items-center gap-2 font-medium text-xs">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>大模型 API 配置已自动保存！</span>
                  </div>
                )}
              </form>
            )}

            {activeTab === 'mcp' && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="flex items-center gap-2 whitespace-nowrap text-sm font-bold text-white">
                      <Server className="h-4 w-4 shrink-0 text-cyan-400" />
                      <span className="shrink-0">MCP 局域网服务</span>
                      <McpHelpTooltip content="MCP 服务允许可信局域网内的模型和 Agent 查询、创建及更新当前用户有权限访问的任务。" />
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      允许可信局域网内的大模型和 Agent 查询、创建及更新当前用户有权访问的任务。
                    </p>
                  </div>
                  <div className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    mcpStatus?.running
                      ? 'mcp-status-running'
                      : 'mcp-status-off'
                  }`}>
                    <span className={`h-2 w-2 rounded-full ${mcpStatus?.running ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    {mcpStatus?.running ? '正在运行' : '未运行'}
                  </div>
                </div>

                <div className="mcp-warning rounded-xl p-3 text-[11px] leading-relaxed">
                  当前使用 HTTP + Bearer Token，仅适合受信任的办公局域网。请勿在访客 Wi-Fi 或不可信网络中启用。
                </div>

                <div className="mcp-panel flex items-center justify-between gap-3 rounded-xl p-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white">启用 MCP 服务</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">随 LanMind 自动启动，退出应用时停止。</div>
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
                    <label className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-slate-300">监听端口 <McpHelpTooltip content="MCP 服务监听的本机端口，范围为 1024–65535。" /></label>
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
                    <label className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-slate-300">Streamable HTTP 地址 <McpHelpTooltip content="将此地址填入支持 Streamable HTTP 的 MCP 客户端。" /></label>
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
                  <label className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-slate-300">Bearer Token <McpHelpTooltip content="所有 MCP 请求都必须携带此 Bearer Token。令牌只保存在当前设备，请勿分享。" align="left" /></label>
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
                      className="mcp-button flex shrink-0 items-center gap-1.5 rounded-xl px-3 text-[11px] font-semibold text-amber-300 disabled:opacity-40"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> 轮换
                    </button>
                  </div>
                </div>

                {(mcpError || mcpStatus?.error) && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/40 p-2.5 text-xs text-rose-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{mcpError || mcpStatus?.error}</span>
                  </div>
                )}
                {mcpSaved && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-2.5 text-xs text-emerald-300">
                    <Check className="h-4 w-4" /> MCP 配置已保存并生效
                  </div>
                )}
              </div>
            )}

            {/* Tab 4: About System */}
            {activeTab === 'about' && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Info className="w-4 h-4 text-blue-400" /> 关于系统 About
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    系统基本信息、网络通信与核心功能架构概览。
                  </p>
                </div>

                {/* Main Hero Card */}
                <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-start space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20 flex-shrink-0 mt-0.5">
                    <Zap className="w-7 h-7 text-white" />
                  </div>
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-extrabold text-white">智域协同</h4>
                      <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-300">
                        {appVersion
                          ? appVersion === '未知' ? '版本未知' : `v${appVersion}`
                          : desktopAvailable ? '版本读取中' : 'Web 预览'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      基于 P2P 局域网无服务器协同与大模型赋能的智能化团队任务管理平台。支持团队任务分配、多端增量同步、风险智能诊断、周报与 PPT 自动生成、局域网即时通信与文件传输。
                    </p>
                  </div>
                </div>

                {/* Key Architectural Features Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl space-y-1">
                    <div className="flex items-center space-x-2 text-emerald-400 text-xs font-bold">
                      <Wifi className="w-3.5 h-3.5" />
                      <span>P2P 局域网协同</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      支持增量数据分发、状态广播与节点自动发现，零外部服务器依赖。
                    </p>
                  </div>

                  <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl space-y-1">
                    <div className="flex items-center space-x-2 text-purple-400 text-xs font-bold">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>AI 智能化中枢</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      多协议 LLM 接入，支持智能风险诊断、汇报工坊与演示文稿一键生成。
                    </p>
                  </div>

                  <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl space-y-1">
                    <div className="flex items-center space-x-2 text-blue-400 text-xs font-bold">
                      <Sliders className="w-3.5 h-3.5" />
                      <span>多维视图 & 协作</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      包含 Kanban 看板、甘特图、局域网 P2P 聊天室及项目文件分发频道。
                    </p>
                  </div>

                  <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl space-y-1">
                    <div className="flex items-center space-x-2 text-amber-400 text-xs font-bold">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>数据安全与状态</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      支持多主题防护、快捷键操控、本地缓存持久化与离线模式无缝续传。
                    </p>
                  </div>
                </div>
              </div>
            )}

            </div>

            {/* Bottom Footer Action Bar */}
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-6 py-4 text-xs">
              {activeTab === 'shortcuts' ? (
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-xl border border-slate-700/60 bg-slate-900/60 hover:bg-slate-800 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>恢复默认快捷键</span>
                </button>
              ) : activeTab === 'llm' ? (
                <button
                  type="button"
                  disabled={testingLLM}
                  onClick={handleTestLLM}
                  className="px-3.5 py-1.5 bg-slate-800/90 hover:bg-slate-700 disabled:opacity-50 text-slate-200 hover:text-white font-semibold rounded-xl border border-slate-700 hover:border-slate-500 transition-all flex items-center gap-1.5 text-xs shadow-sm"
                >
                  {testingLLM ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                      <span>正在检测...</span>
                    </>
                  ) : (
                    <>
                      <Activity className="w-3.5 h-3.5 text-blue-400" />
                      <span>检测接口连通性</span>
                    </>
                  )}
                </button>
              ) : activeTab === 'theme' ? (
                <div className="text-slate-400 text-[11px]">
                  当前主题: <span className="text-white font-bold">{currentTheme.name}</span>
                  {themePreference === 'system' && <span>（跟随系统）</span>}
                </div>
              ) : activeTab === 'mcp' ? (
                <div className="text-[11px] text-slate-400">所有改动即时生效 · 随应用自启</div>
              ) : (
                <div className="text-slate-400 text-[11px] flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>智域协同 · 运行状态正常</span>
                </div>
              )}

              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl transition-all"
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
