import React, { useState, useEffect } from 'react';
import { ApiService } from '../services/api';
import {
  Sparkles,
  X,
  Check,
  Save,
  Key,
  Globe,
  Cpu,
  Activity,
  Loader2,
  AlertCircle,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';

interface LLMConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LLMConfigModal: React.FC<LLMConfigModalProps> = ({ isOpen, onClose }) => {
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('gpt-4o-mini');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      setTestResult(null);
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      const cfg = await ApiService.getLLMConfig();
      if (cfg) {
        setBaseUrl(cfg.baseUrl || 'https://api.openai.com/v1');
        setApiKey(cfg.apiKey || '');
        setModelName(cfg.modelName || 'gpt-4o-mini');
      }
    } catch (e) {
      console.error('Failed to load LLM config', e);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await ApiService.testLLMConnection({
        protocol: 'openai',
        baseUrl,
        apiKey,
        modelName,
      });
      if (res.success) {
        setTestResult({ success: true, message: res.message || '连通性测试成功' });
      } else {
        setTestResult({ success: false, message: res.error || '连通性测试失败' });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || '测试连接异常' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await ApiService.updateLLMConfig({
        protocol: 'openai',
        baseUrl,
        apiKey,
        modelName,
      });
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 1000);
    } catch (e) {
      console.error('Failed to save LLM config', e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-edge rounded-2xl max-w-md w-full p-6 space-y-4 shadow-popover">
        <div className="flex items-center justify-between pb-3 border-b border-edge">
          <div className="flex items-center space-x-2 text-feature">
            <Sparkles className="w-5 h-5" />
            <h2 className="text-sm font-bold text-main">大模型 API 配置中心</h2>
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

        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div>
            <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub">
              <SlidersHorizontal className="h-3.5 w-3.5 text-sub" />
              <span>接口格式</span>
            </label>
            <div className="flex h-9 items-center rounded-xl border border-subtle bg-canvas px-3 text-xs font-semibold text-main">
              OpenAI 兼容格式
            </div>
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sub font-semibold mb-1 flex items-center gap-1">
              <Globe className="w-3.5 h-3.5 text-info" /> <span>接口地址</span>
            </label>
            <input
              type="text"
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1 或 本地 Ollama URL"
              className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-main font-mono focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sub font-semibold mb-1 flex items-center gap-1">
              <Key className="w-3.5 h-3.5 text-warning" /> <span>接口密钥</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-main font-mono focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* Model Name */}
          <div>
            <label className="block text-sub font-semibold mb-1 flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5 text-feature" /> <span>模型名称</span>
            </label>
            <input
              type="text"
              required
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="如 gpt-4o-mini, deepseek-chat, qwen-max..."
              className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-main font-mono focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* Test Status Feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                testResult.success
                  ? 'bg-success/10 border-emerald-500/40 text-success'
                  : 'bg-danger/10 border-rose-500/40 text-danger'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 break-all leading-relaxed">{testResult.message}</div>
            </div>
          )}

          {savedSuccess && (
            <div className="p-2 bg-success/10 border border-emerald-500/40 text-success rounded-lg flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>设置保存成功！</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-edge">
            <button
              type="button"
              disabled={testing}
              onClick={handleTestConnection}
              className="px-3.5 py-2 bg-card hover:bg-hover disabled:opacity-50 text-info font-semibold rounded-xl border border-subtle hover:border-cyan-500/40 transition-all flex items-center gap-1.5"
            >
              {testing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-info" />
                  <span>正在检测...</span>
                </>
              ) : (
                <>
                  <Activity className="w-3.5 h-3.5 text-info" />
                  <span>检测连通性</span>
                </>
              )}
            </button>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="ui-cancel-button px-4 py-2 rounded-xl font-semibold"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-on-solid font-bold rounded-xl shadow-panel shadow-purple-600/30 flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                <span>保存 API 参数</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
