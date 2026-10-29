import React from 'react';
import OpticalTransferApp from '../../src/optical/OpticalTransferApp';
import { useFeatures } from '../../src/modules/state';
import { tr, useLocale } from '../../src/i18n';

/** Bundled plugin boundary; the standalone exported receiver has no host dependency. */
export default function OpticalTransferPlugin() {
  useLocale();
  const enabled = useFeatures().optical;
  return enabled ? <OpticalTransferApp /> : (
    <div className="flex h-full items-center justify-center bg-surface p-8 text-sub" role="status">
      {tr('settings:features.disabledMessage')}
    </div>
  );
}
