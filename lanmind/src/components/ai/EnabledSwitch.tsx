import { tr } from "../../i18n";

export function EnabledSwitch({ checked, onChange, label, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      disabled={disabled} onClick={() => onChange(!checked)}
      className="ai-v2-enabled-switch">
      <span className="ai-v2-enabled-switch-track" aria-hidden="true"><span /></span>
      <span>{checked ? tr("ai:v2.enabled") : tr("ai:v2.disabled")}</span>
    </button>
  );
}
