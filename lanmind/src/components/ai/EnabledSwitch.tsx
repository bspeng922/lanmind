import { tr } from "../../i18n";
import { UiSwitch } from "../ui/UiSwitch";

export function EnabledSwitch({ checked, onChange, label, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-sub">
      <UiSwitch checked={checked} onChange={onChange} label={label} disabled={disabled} size="sm" />
      <span className="select-none">{checked ? tr("ai:v2.enabled") : tr("ai:v2.disabled")}</span>
    </span>
  );
}
