import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
import React, { useState, useEffect } from 'react';
import { RiskWarning } from '../types';
import { ApiService } from '../services/api';
import { AlertTriangle, Sparkles, X, CheckCircle, ShieldAlert, Bot } from 'lucide-react';

interface RiskAlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RiskAlertsModal: React.FC<RiskAlertsModalProps> = ({ isOpen, onClose }) => {
  useLocale();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm" style={{ backgroundColor: 'var(--overlay)' }}>
      <div
        className="rounded-2xl border max-w-xl w-full p-6 space-y-4 shadow-popover overflow-y-auto max-h-[85vh]"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-main)',
          color: 'var(--text-main)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border-main)' }}>
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-main)' }}>{tr("common:riskAlertsModal.taskRiskAnalysis")}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-colors hover:bg-hover"
            style={{ color: 'var(--text-sub)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-sub)' }}>
          {tr("common:riskAlertsModal.reviewHighPriorityOverdueAndBlockedTasks")}</p>

        {loading ? (
          <div className="py-12 text-center text-xs animate-pulse" style={{ color: 'var(--text-sub)' }}>
            <Sparkles className="w-6 h-6 text-feature mx-auto mb-2 animate-spin" />
            <span>{tr("common:riskAlertsModal.analyzingTasks")}</span>
          </div>
        ) : warnings.length === 0 ? (
          <div
            className="py-12 text-center rounded-xl border"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <CheckCircle className="w-10 h-10 text-success mx-auto mb-2" />
            <h3 className="text-xs font-bold" style={{ color: 'var(--text-main)' }}>{tr("common:riskAlertsModal.noSignificantRisksFound")}</h3>
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-sub)' }}>{tr("common:riskAlertsModal.noHighRiskP1P2TasksWere")}</p>
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
                    <ShieldAlert className={w.level === 'high' ? 'w-4 h-4 text-danger' : 'w-4 h-4 text-warning'} />
                    {localizeMessage(w.title)}
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                      w.level === 'high' ? 'bg-rose-500/20 text-danger dark:text-danger' : 'bg-amber-500/20 text-warning'
                    }`}
                  >{tr("common:riskAlertsModal.risk", { value0: tr(`common:riskAlertsModal.level.${w.level}`) })}</span>
                </div>

                <p className="text-xs whitespace-pre-line" style={{ color: 'var(--text-main)' }}>{localizeMessage(w.description)}</p>

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
                    <span className="font-bold">{tr("common:riskAlertsModal.suggestedAction")}</span>
                    {localizeMessage(w.aiRecommendation)}
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
            {tr("common:riskAlertsModal.gotIt")}</button>
        </div>
      </div>
    </div>
  );
};
