/**
 * TwoLineTitle.tsx — Accurate word-wrapped 2-line title with character-level truncation.
 *
 * CALLING SPEC:
 *   <TwoLineTitle text={task.title} className="text-xs font-medium" />
 */

import React, { useLayoutEffect, useRef, useState } from 'react';

let canvas: HTMLCanvasElement | null = null;

function wrap(text: string, el: HTMLElement): string[] {
  if (typeof document === 'undefined') return [text];
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return [text];

  const cs = getComputedStyle(el);
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.letterSpacing = cs.letterSpacing;
  const max = el.clientWidth;
  if (max <= 0) return [text];

  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function TwoLineTitle({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [lines, setLines] = useState<[string, string] | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const all = wrap(text, el);
      setLines(all.length > 2 ? [all[0], all.slice(1).join(' ')] : null);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (document.fonts?.ready) {
      void document.fonts.ready.then(measure);
    }
    return () => ro.disconnect();
  }, [text]);

  return (
    <p ref={ref} className={className} title={lines ? text : undefined}>
      {lines ? (
        <>
          <span className="block truncate">{lines[0]}</span>
          <span className="block truncate">{lines[1]}</span>
        </>
      ) : (
        <span className="block line-clamp-2">{text}</span>
      )}
    </p>
  );
}

