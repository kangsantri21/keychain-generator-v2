import { MAX_LAYOUT_OFFSET_MM } from "@/lib/keychain-geometry";

const OFFSET_SLIDER_STEP = 0.5;

/** Shared by CharacterTemplateForm and FontTemplateForm — a labeled mm-range slider for a manual layout nudge (ring hole, text gap, etc). */
export function OffsetSlider({
  label,
  value,
  onChange,
  hint,
  min = -MAX_LAYOUT_OFFSET_MM,
  max = MAX_LAYOUT_OFFSET_MM,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint: string;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex flex-col gap-1 text-xs font-medium ${disabled ? "text-slate-300" : "text-slate-600"}`}
    >
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className={`font-mono ${disabled ? "text-slate-300" : "text-slate-500"}`}>{value.toFixed(1)} mm</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={OFFSET_SLIDER_STEP}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={disabled}
        className="accent-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
      />
      <span className="text-[11px] font-normal text-slate-400">{hint}</span>
    </label>
  );
}
