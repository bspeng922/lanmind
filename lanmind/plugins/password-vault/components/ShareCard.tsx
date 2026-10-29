import React from 'react';
import { LockKeyhole } from 'lucide-react';
import { tr, useLocale } from '../../../src/i18n';
import { useFeatures } from '../../../src/modules/state';
import type { LanChatMessage } from '../../../src/types';

/** This component never decrypts or copies a chat payload. */
export function VaultShareCard({ message, currentUserId }: { message: LanChatMessage; currentUserId: string }) {
  useLocale(); const enabled = useFeatures().vault;
  const received = message.receiverId === currentUserId;
  return <div className="max-w-sm rounded-xl border border-edge bg-surface p-4 text-main">
    <p className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole className="h-4 w-4 text-accent" />{tr('vault:shareCard')}</p>
    <p className="mt-2 text-xs leading-5 text-sub">{tr(received ? 'vault:enableToReceive' : 'vault:sentShare')}</p>
    {received && <button type="button" disabled={!enabled} className="mt-3 rounded-lg border border-edge px-3 py-2 text-xs hover:bg-hover disabled:opacity-40" onClick={() => window.dispatchEvent(new CustomEvent('vault:open-share', { detail: message.id }))}>{tr('vault:viewShare')}</button>}
  </div>;
}
