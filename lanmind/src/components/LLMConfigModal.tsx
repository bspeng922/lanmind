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
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2 text-purple-400">
            <Sparkles className="w-5 h-5" />
            <h2 className="text-sm font-bold text-white">大模型 API 配置中心</h2>
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
            <label className="mb-1 flex items-center gap-1.5 font-semibold text-slate-400">
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
              <span>接口格式</span>
            </label>
            <div className="flex h-9 items-center rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-semibold text-slate-200">
              OpenAI 兼容格式
            </div>
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-slate-400 font-semibold mb-1 flex items-center gap-1">
              <Globe className="w-3.5 h-3.5 text-blue-400" /> <span>接口地址</span>
            </label>
            <input
              type="text"
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1 或 本地 Ollama URL"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-slate-400 font-semibold mb-1 flex items-center gap-1">
              <Key className="w-3.5 h-3.5 text-amber-400" /> <span>接口密钥</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Model Name */}
          <div>
            <label className="block text-slate-400 font-semibold mb-1 flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5 text-purple-400" /> <span>模型名称</span>
            </label>
            <input
              type="text"
              required
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="如 gpt-4o-mini, deepseek-chat, qwen-max..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Test Status Feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 break-all leading-relaxed">{testResult.message}</div>
            </div>
          )}

          {savedSuccess && (
            <div className="p-2 bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 rounded-lg flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>设置保存成功！</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-slate-800">
            <button
              type="button"
              disabled={testing}
              onClick={handleTestConnection}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-cyan-400 font-semibold rounded-xl border border-slate-700 hover:border-cyan-500/40 transition-all flex items-center gap-1.5"
            >
              {testing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                  <span>正在检测...</span>
                </>
              ) : (
                <>
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
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
                className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl shadow-lg shadow-purple-600/30 flex items-center gap-1.5"
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
