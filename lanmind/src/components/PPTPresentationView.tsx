/**
 * PPTPresentationView — Renders the generated PPT presentation plan and slides cards.
 *
 * CALLING SPEC:
 *   <PPTPresentationView
 *     presentationPlan={presentationPlan}
 *     loading={loading}
 *     hasSelectedTemplate={Boolean(selectedTemplate)}
 *     onBackToTasks={() => setPresentationPlan(null)}
 *     onExportPPT={handleExportPPT}
 *   />
 */

import React from 'react';
import { GeneratedPresentation } from '../types';
import { Presentation, RotateCcw } from 'lucide-react';

export interface PPTPresentationViewProps {
  presentationPlan: GeneratedPresentation;
  loading: boolean;
  hasSelectedTemplate: boolean;
  onBackToTasks: () => void;
  onExportPPT: () => void;
}

export const PPTPresentationView: React.FC<PPTPresentationViewProps> = ({
  presentationPlan,
  loading,
  hasSelectedTemplate,
  onBackToTasks,
  onExportPPT,
}) => {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-shrink-0 flex-col gap-3 border-b border-edge px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-main">{presentationPlan.title}</h2>
            {presentationPlan.generationMode === 'fallback' && (
              <span className="border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-warning">
                事实模式
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-quiet">听众：{presentationPlan.audience}</p>
          <p className="mt-1 max-w-4xl text-sm font-semibold leading-6 text-main">
            {presentationPlan.keyTakeaway}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBackToTasks}
            className="flex h-9 items-center gap-1.5 rounded border border-subtle bg-surface px-3 text-xs text-sub transition-colors hover:bg-hover"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            返回任务清单
          </button>
          <button
            type="button"
            onClick={onExportPPT}
            disabled={loading || !hasSelectedTemplate}
            className="report-studio-primary flex h-9 flex-shrink-0 items-center gap-2 rounded px-4 text-xs font-semibold disabled:opacity-50"
          >
            <Presentation className="h-4 w-4" />
            导出当前方案
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-5xl space-y-3">
          {presentationPlan.slides.map((slide, index) => (
            <article key={slide.id} className="border border-edge bg-surface/50 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center bg-purple-500/15 text-xs font-semibold text-feature">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-main">{slide.title}</h3>
                    <span className="border border-subtle px-1.5 py-0.5 text-[10px] text-sub">
                      {slide.layout}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-feature">本页任务：{slide.purpose}</p>
                  <p className="mt-2 text-sm leading-6 text-sub">{slide.coreMessage}</p>
                  <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                    <div className="border-l-2 border-cyan-500/50 pl-3 text-sub">
                      <span className="text-quiet">页面承接：</span>
                      {slide.relationToPrevious.label}
                    </div>
                    <div className="border-l-2 border-amber-500/50 pl-3 text-sub">
                      <span className="text-quiet">建议图表：</span>
                      {slide.visual.title || '无'} · {slide.visual.kind}
                    </div>
                  </div>
                  {slide.supportingPoints.length > 0 && (
                    <ul className="mt-3 grid gap-2 text-xs text-sub md:grid-cols-2">
                      {slide.supportingPoints.map((point, pointIndex) => (
                        <li key={pointIndex} className="bg-canvas/70 p-2">
                          {point.text}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 border-t border-edge pt-3 text-xs leading-5 text-quiet">
                    <span className="text-sub">口播重点：</span>
                    {slide.speakerNotes}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
};
