import React, { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { ApiService, CloseButtonBehavior } from '../services/api';
import { ThemeSelect } from './ThemeSelect';

export const WindowCloseSettings: React.FC<{ available?: boolean }> = ({ available = isTauri() }) => {
  const [behavior, setBehavior] = useState<CloseButtonBehavior>('tray');
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(available);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!available) return;
    let active = true;
    setLoading(true);
    setLoaded(false);
    setError('');
    ApiService.getCloseButtonBehavior()
      .then((value) => {
        if (!active) return;
        setBehavior(value);
        setLoaded(true);
      })
      .catch((error) => {
        if (active) setError(`读取关闭按钮行为失败：${String(error)}`);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [available, retry]);

  const changeBehavior = async (value: CloseButtonBehavior) => {
    if (!available || !loaded || loading || saving || value === behavior) return;
    setSaving(true);
    setError('');
    try {
      setBehavior(await ApiService.setCloseButtonBehavior(value));
    } catch (error) {
      setError(`保存关闭按钮行为失败：${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-5 rounded-xl border border-edge bg-canvas/60 p-4" aria-busy={loading || saving}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-bold text-main">
          <X className="h-3.5 w-3.5 text-info" />关闭按钮行为
          {(loading || saving) && <Loader2 className="h-3 w-3 animate-spin text-quiet" />}
        </div>
        <p className="mt-1 text-[11px] leading-5 text-sub">设置主窗口关闭按钮的行为，选择后立即生效并自动保存。</p>
      </div>
      <div className="w-[196px] shrink-0">
        <ThemeSelect
          portal
          ariaLabel="关闭按钮行为"
          value={behavior}
          options={[{ value: 'tray', label: '最小化到系统托盘' }, { value: 'exit', label: '退出程序' }]}
          disabled={!available || !loaded || loading || saving}
          onChange={(value) => void changeBehavior(value as CloseButtonBehavior)}
        />
      </div>
    </div>
    {!available && <p className="text-[11px] text-quiet">关闭按钮行为仅在桌面客户端中可用。</p>}
    {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{error}</span>
      {!loaded && <button type="button" className="shrink-0 underline" onClick={() => setRetry((value) => value + 1)}>重新读取</button>}
    </div>}
  </div>;
};
