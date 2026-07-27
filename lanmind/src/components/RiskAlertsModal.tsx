import React, { useState, useEffect } from 'react';
import { RiskWarning } from '../types';
import { ApiService } from '../services/api';
import { AlertTriangle, Sparkles, X, CheckCircle, ShieldAlert, Bot } from 'lucide-react';

interface RiskAlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RiskAlertsModal: React.FC<RiskAlertsModalProps> = ({ isOpen, onClose }) => {
  const [warnings, setWarnings] = useState<RiskWarning[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadWarnings();
    }
  }, [isOpen]);

  const loadWarnings = async () => {
    setLoading(true);
    try {
      const res = await ApiService.getRiskWarnings();
      setWarnings(res);
    } catch (e) {
      console.error('Failed to load risk warnings', e);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-main) 80%, transparent)' }}>
      <div
        className="rounded-2xl border max-w-xl w-full p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[85vh]"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-main)',
          color: 'var(--text-main)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border-main)' }}>
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-main)' }}>AI 智能任务风险诊断与预警</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-colors hover:bg-black/10 dark:hover:bg-white/10"
            style={{ color: 'var(--text-sub)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-sub)' }}>
          大模型引擎定期扫描积压的高优先级任务、逾期任务与瓶颈阻塞，输出防范建议：
        </p>

        {loading ? (
          <div className="py-12 text-center text-xs animate-pulse" style={{ color: 'var(--text-sub)' }}>
            <Sparkles className="w-6 h-6 text-purple-400 mx-auto mb-2 animate-spin" />
            <span>AI 正在全盘扫描局域网任务清单...</span>
          </div>
        ) : warnings.length === 0 ? (
          <div
            className="py-12 text-center rounded-xl border"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
            <h3 className="text-xs font-bold" style={{ color: 'var(--text-main)' }}>未扫描到显著高风险</h3>
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-sub)' }}>当前所有关键 P1/P2 任务均在正常进度掌控中</p>
          </div>
        ) : (
          <div className="space-y-3">
            {warnings.map((w) => (
              <div
                key={w.id}
                className={`p-4 rounded-xl border space-y-2.5 ${
                  w.level === 'high'
                    ? 'bg-rose-500/10 border-rose-500/30'
                    : 'bg-amber-500/10 border-amber-500/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold flex items-center gap-2" style={{ color: 'var(--text-main)' }}>
                    <ShieldAlert className={w.level === 'high' ? 'w-4 h-4 text-rose-500' : 'w-4 h-4 text-amber-500'} />
                    {w.title}
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                      w.level === 'high' ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300' : 'bg-amber-500/20 text-amber-600 dark:text-amber-300'
                    }`}
                  >
                    {w.level} 级风险
                  </span>
                </div>

                <p className="text-xs whitespace-pre-line" style={{ color: 'var(--text-main)' }}>{w.description}</p>

                {/* AI Recommendation Box */}
                <div
                  className="p-2.5 rounded-lg border border-purple-500/30 text-[11px] flex items-start gap-2"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--accent) 8%, var(--bg-card))',
                    color: 'var(--accent)',
                  }}
                >
                  <Bot className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
                  <div>
                    <span className="font-bold">AI 求解建议：</span>
                    {w.aiRecommendation}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="theme-btn-primary px-4 py-1.5 text-xs font-semibold rounded-lg"
          >
            知晓并关闭
          </button>
        </div>
      </div>
    </div>
  );
};
