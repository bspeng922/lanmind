import React, { useState } from 'react';
import { Check as CheckIcon, Copy, Download, KeyRound, ShieldAlert } from 'lucide-react';
import { tr } from '../../../src/i18n';
import { type VaultClient, vaultError } from '../client';
import { Button, Modal } from './ui';

export interface RecoveryKeyModalProps {
  client: VaultClient;
  recoveryKey: string;
  onClose: () => void;
}

export function RecoveryKeyModal({ client, recoveryKey, onClose }: RecoveryKeyModalProps) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(recoveryKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Ignore clipboard failures outside secure context
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      setSaved(await client.call<boolean>('saveRecoveryKey', { recoveryKey }));
    } catch (cause) {
      setError(vaultError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      icon={<KeyRound className="h-4 w-4 text-accent" />}
      title={tr('vault:recoveryKeyTitle')}
      description={tr('vault:recoveryKeySubtitle')}
      onClose={() => { if (!saving) onClose(); }}
      footer={
        <>
          <Button disabled={saving} aria-busy={saving} onClick={() => void handleSave()}>
            <Download className="h-3.5 w-3.5" />
            {tr('vault:downloadRecoveryKey')}
          </Button>
          <Button disabled={saving} onClick={() => void handleCopy()}>
            {copied ? <CheckIcon className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? tr('vault:recoveryKeyCopied') : tr('vault:copyRecoveryKey')}
          </Button>
          <Button primary disabled={saving} onClick={onClose}>
            {tr('vault:savedRecoveryKey')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-600 dark:text-amber-400">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed font-medium">{tr('vault:recoveryKeyWarning')}</p>
        </div>

        <div className="rounded-xl border border-edge bg-canvas/70 px-4 py-3.5 text-center">
          <code className="select-all break-all font-mono text-sm font-bold tracking-wider text-main">
            {recoveryKey}
          </code>
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        {saved && <p role="status" className="text-xs text-success">{tr('vault:recoveryKeySaved')}</p>}
      </div>
    </Modal>
  );
}
