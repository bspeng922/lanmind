import React from 'react';
import { useFeatures } from '../../src/modules/state';
import VaultApp, { type VaultProps } from './components/VaultApp';

export default function PasswordVaultPlugin(props: VaultProps) {
  const enabled = useFeatures().vault;
  return enabled ? <VaultApp {...props} /> : null;
}
