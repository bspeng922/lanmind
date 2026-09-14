import React, { useId } from 'react';
import { Check } from 'lucide-react';

/**
 * ThemeCheckbox — Unified theme-compliant accessible checkbox component.
 *
 * CALLING SPEC:
 *   import { ThemeCheckbox } from './ThemeCheckbox';
 *
 *   <ThemeCheckbox
 *     checked={isShared}
 *     onChange={setIsShared}
 *     label="开启局域网共享"
 *     id="sharedCheck"
 *   />
 *
 *   <ThemeCheckbox
 *     checked={st.completed}
 *     onChange={(checked) => handleToggle(st.id, checked)}
 *     size="sm"
 *     ariaLabel={`标记完成子任务：${st.title}`}
 *   />
 *
 * TOOL CONTRACT:
 *   - Controlled boolean state with native hidden checkbox for full keyboard & screen reader support
 *   - Follows active theme tokens (--accent, --bg-input, --border-subtle, --accent-glow)
 *   - Side effects: None
 */

export interface ThemeCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  id?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
  title?: string;
  onClick?: (event: React.MouseEvent) => void;
}

export const ThemeCheckbox: React.FC<ThemeCheckboxProps> = ({
  checked,
  onChange,
  label,
  id,
  disabled = false,
  size = 'md',
  className = '',
  ariaLabel,
  title,
  onClick,
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <label
      htmlFor={inputId}
      className={`theme-checkbox-wrapper ${className}`}
      data-checked={checked}
      data-disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <span className="relative inline-flex items-center justify-center shrink-0">
        <input
          type="checkbox"
          id={inputId}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
          className="theme-checkbox-input sr-only"
        />
        <span
          className="theme-checkbox-box"
          data-size={size}
          data-checked={checked}
          data-disabled={disabled}
          aria-hidden="true"
        >
          <Check
            className={`transition-all duration-150 ${
              size === 'sm' ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5'
            } ${checked ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}
            strokeWidth={3}
          />
        </span>
      </span>
      {label && <span className="theme-checkbox-label">{label}</span>}
    </label>
  );
};
