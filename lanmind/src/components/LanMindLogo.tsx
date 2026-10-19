/**
 * LanMind Brand Logo Component
 *
 * CALLING SPEC:
 * <LanMindLogo size="md" showText subtitle="智域协同" />
 *
 * INPUTS:
 * - size?: 'sm' | 'md' | 'lg' | 'xl' (default 'md')
 * - showText?: boolean (default false)
 * - subtitle?: string
 * - className?: string
 *
 * SIDE EFFECTS: None (Pure presentation component)
 */

import React from 'react';
import { useAppIcon } from '../utils/appIcon';

export interface LanMindLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  subtitle?: string;
  className?: string;
}

const SIZE_MAP = {
  sm: { icon: 24, box: 'w-6 h-6', text: 'text-sm', sub: 'text-[10px]' },
  md: { icon: 36, box: 'w-9 h-9', text: 'text-base', sub: 'text-[11px]' },
  lg: { icon: 48, box: 'w-12 h-12', text: 'text-lg', sub: 'text-xs' },
  xl: { icon: 64, box: 'w-16 h-16', text: 'text-2xl', sub: 'text-xs' },
};

export const LanMindLogo: React.FC<LanMindLogoProps> = ({
  size = 'md',
  showText = false,
  subtitle,
  className = '',
}) => {
  const { iconConfig } = useAppIcon();
  const cfg = SIZE_MAP[size] || SIZE_MAP.md;

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      <div
        className={`relative ${cfg.box} flex items-center justify-center rounded-xl transition-transform hover:scale-105`}
        style={{
          background: iconConfig.gradient,
          boxShadow: `0 8px 20px -4px ${iconConfig.glow}`,
        }}
        aria-hidden="true"
      >
        {/* Ambient inner border highlight */}
        <div className="absolute inset-0 rounded-xl border border-white/25 pointer-events-none" />

        <svg
          viewBox="0 0 100 100"
          className="w-3/5 h-3/5 text-white"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M55 18L26 53H51L45 82L74 47H49L55 18Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col">
          <span className={`font-bold tracking-tight text-main ${cfg.text} leading-tight`}>
            Lan<span className="text-info">Mind</span>
          </span>
          {subtitle && (
            <span className={`text-quiet font-medium tracking-normal ${cfg.sub} leading-tight mt-0.5`}>
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
