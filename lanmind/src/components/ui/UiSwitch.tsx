import React from 'react';

export interface UiSwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  size?: 'sm' | 'md';
  onChange: (next: boolean) => void;
  className?: string;
}

/**
 * Unified modern toggle switch shared across Settings, AI, Plugins and Feature panels.
 */
export const UiSwitch: React.FC<UiSwitchProps> = ({
  checked,
  disabled = false,
  label,
  size = 'md',
  onChange,
  className = '',
}) => {
  const isSmall = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-state={checked ? 'checked' : 'unchecked'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
        isSmall ? 'h-[18px] w-[32px]' : 'h-[22px] w-[38px]'
      } ${
        checked
          ? 'border-accent bg-accent'
          : 'border-edge-strong bg-muted hover:bg-hover'
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none block rounded-full bg-on-solid shadow-soft transition-transform duration-150 ${
          isSmall
            ? `h-3.5 w-3.5 ${checked ? 'translate-x-[15px]' : 'translate-x-[1px]'}`
            : `h-4 w-4 ${checked ? 'translate-x-[18px]' : 'translate-x-[2px]'}`
        }`}
      />
    </button>
  );
};
