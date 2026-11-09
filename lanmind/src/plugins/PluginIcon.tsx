import React, { useState } from 'react';
import { Puzzle } from 'lucide-react';

/** SVG stays in image context; plugin markup and external URLs never enter host DOM. */
export function PluginIcon({ source, className = 'h-10 w-10' }: { source?: string | null; className?: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const usable = source && source.length <= 180_000 && source !== failedSource
    && /^data:image\/(?:svg\+xml|png|webp|jpeg|x-icon);base64,[A-Za-z0-9+/]+={0,2}$/.test(source);
  return <span data-plugin-icon aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-hover ${className}`}>
    {usable
      ? <img src={source} alt="" draggable={false} decoding="async" onError={() => setFailedSource(source)} className="h-full w-full object-contain" />
      : <Puzzle className="h-1/2 w-1/2 text-sub" />}
  </span>;
}
