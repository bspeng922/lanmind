import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
/**
 * PPTTemplateModals — Preview and upload modal dialogs for PPT themes.
 *
 * CALLING SPEC:
 *   <PPTPreviewModal
 *     template={previewTemplate}
 *     onClose={() => setPreviewTemplate(null)}
 *   />
 *   <PPTUploadModal
 *     isOpen={showUploadModal}
 *     customJsonInput={customJsonInput}
 *     uploadError={uploadError}
 *     onJsonChange={setCustomJsonInput}
 *     onClose={() => setShowUploadModal(false)}
 *     onSubmit={handleUploadCustomTemplate}
 *   />
 */

import React from 'react';
import { PPTTemplate } from '../types';
import { Upload, X } from 'lucide-react';

export interface PPTPreviewModalProps {
  template: PPTTemplate | null;
  onClose: () => void;
}

export const PPTPreviewModal: React.FC<PPTPreviewModalProps> = ({ template, onClose }) => {
  useLocale();
  if (!template) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-md border border-subtle bg-surface p-5 shadow-popover"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-main">{template.name}</h3>
            <p className="mt-0.5 text-xs text-quiet">{template.description}</p>
          </div>
          <button
            type="button"
            title={tr("reports:pPTTemplateModals.closePreview")}
            onClick={onClose}
            className="p-1 text-sub hover:text-main"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div
          className="aspect-video border p-[6%]"
          style={{
            backgroundColor: template.backgroundColor,
            color: template.textColor,
            borderColor: template.secondaryColor,
          }}
        >
          <div className="flex h-full flex-col">
            <div className="h-1 w-16" style={{ backgroundColor: template.accentColor }} />
            <p
              className="mt-[8%] text-[clamp(12px,2.3vw,28px)] font-semibold"
              style={{ color: template.primaryColor }}
            >
              {tr("reports:pPTTemplateModals.workReport")}</p>
            <p className="mt-2 text-[clamp(8px,1vw,13px)]" style={{ color: template.secondaryColor }}>
              {tr("reports:pPTTemplateModals.resultsEvidenceActions")}</p>
            <div
              className="mt-auto grid grid-cols-3 gap-3 border-t pt-4"
              style={{ borderColor: `${template.secondaryColor}40` }}
            >
              {[tr("reports:pPTTemplateModals.completedInPeriod"), tr("reports:pPTTemplateModals.keyProgress"), tr("reports:pPTTemplateModals.riskActions")].map((label, index) => (
                <div key={label}>
                  <p
                    className="text-[clamp(12px,2vw,24px)] font-semibold"
                    style={{
                      color: index === 2 ? template.accentColor : template.primaryColor,
                    }}
                  >
                    {index === 0 ? '12' : index === 1 ? '8' : '2'}
                  </p>
                  <p className="text-[clamp(7px,.8vw,11px)]" style={{ color: template.secondaryColor }}>
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export interface PPTUploadModalProps {
  isOpen: boolean;
  customJsonInput: string;
  uploadError: string;
  onJsonChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export const PPTUploadModal: React.FC<PPTUploadModalProps> = ({
  isOpen,
  customJsonInput,
  uploadError,
  onJsonChange,
  onClose,
  onSubmit,
}) => {
  useLocale();
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-md border border-subtle bg-surface p-5 shadow-popover"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-main">
            <Upload className="report-studio-accent h-4 w-4" />
            {tr("reports:pPTTemplateModals.importPresentationTheme")}</h3>
          <button
            type="button"
            title={tr("reports:pPTTemplateModals.close")}
            onClick={onClose}
            className="p-1 text-sub hover:text-main"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <textarea
          value={customJsonInput}
          onChange={(event) => onJsonChange(event.target.value)}
          placeholder={
            tr("reports:pPTTemplateModals.idCompanyThemeNameCompanyThemePrimarycolor")
          }
          className="report-studio-field mt-4 h-56 w-full resize-none rounded border border-subtle bg-canvas p-3 font-mono text-xs leading-5 text-main outline-none"
        />
        {uploadError && <p className="mt-2 text-xs text-danger">{localizeMessage(uploadError)}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="ui-cancel-button h-8 rounded px-3 text-xs"
          >
            {tr("reports:pPTTemplateModals.cancel")}</button>
          <button
            type="button"
            onClick={onSubmit}
            className="report-studio-primary h-8 rounded px-4 text-xs font-semibold"
          >
            {tr("reports:pPTTemplateModals.saveTheme")}</button>
        </div>
      </div>
    </div>
  );
};
