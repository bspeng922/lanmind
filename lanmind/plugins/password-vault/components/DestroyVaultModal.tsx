import React, { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { tr } from '../../../src/i18n';
import { vaultError, type VaultClient } from '../client';
import { Button, Field, Modal, inputClass } from './ui';

export interface DestroyVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: VaultClient;
}

export function DestroyVaultModal({ isOpen, onClose, client }: DestroyVaultModalProps) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleDestroy = async () => {
    if (!password.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await client.call('destroy', { currentPassword: password });
      onClose();
    } catch (e) {
      setError(vaultError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      icon={<Trash2 className="h-4 w-4 text-rose-500" />}
      title={tr('vault:destroyVaultTitle')}
      description={tr('vault:destroyHelp')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} className="ui-cancel-button">
            {tr('vault:cancel')}
          </Button>
          <Button
            danger
            disabled={busy || !password.trim()}
            onClick={() => void handleDestroy()}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {busy ? tr('vault:loading') : tr('vault:confirmDestroy')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 flex items-start gap-2.5 text-xs text-rose-500">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="leading-relaxed font-medium">{tr('vault:destroyConfirm')}</span>
        </div>

        <Field label={tr('vault:destroyPasswordPrompt')} required>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={tr('vault:masterPassword')}
            className={inputClass}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleDestroy();
              }
            }}
          />
        </Field>

        {error && (
          <div role="alert" className="text-xs text-rose-500 font-medium">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

