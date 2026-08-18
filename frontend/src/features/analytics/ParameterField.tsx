import type { ParameterSpec } from "@/types/api";

/**
 * One rule parameter, rendered from the catalogue's description of it.
 *
 * The control type, the bounds, the unit, the choices and the help text all come
 * from the server. This component has no idea what a tolerance or a retention-time
 * window is, which is exactly why adding a rule needs no frontend change — and why
 * a business threshold can never end up hard-coded here (spec section 43).
 */
export function ParameterField({
  name,
  spec,
  value,
  disabled,
  onChange,
}: {
  name: string;
  spec: ParameterSpec;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const id = `param-${name}`;
  const describedBy = spec.help ? `${id}-help` : undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm text-slate-700">
        {spec.label}
        {spec.unit ? <span className="ml-1 text-slate-500">({spec.unit})</span> : null}
      </label>

      {spec.type === "number" ? (
        <input
          id={id}
          type="number"
          disabled={disabled}
          value={value === null || value === undefined ? "" : String(value)}
          // The same bounds the server validates against, so the form cannot
          // accept a value the API will refuse.
          {...(spec.minimum !== null ? { min: spec.minimum } : {})}
          {...(spec.maximum !== null ? { max: spec.maximum } : {})}
          step="any"
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="mt-1 w-full rounded border border-lab-200 px-3 py-1.5 text-sm disabled:bg-slate-50"
        />
      ) : spec.type === "choice" ? (
        <select
          id={id}
          disabled={disabled}
          value={String(value ?? "")}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded border border-lab-200 px-3 py-1.5 text-sm disabled:bg-slate-50"
        >
          {(spec.choices ?? []).map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : spec.type === "boolean" ? (
        <div className="mt-1 flex items-center gap-2">
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            checked={Boolean(value)}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm text-slate-600">{value ? "Enabled" : "Disabled"}</span>
        </div>
      ) : (
        <input
          id={id}
          type="text"
          disabled={disabled}
          value={String(value ?? "")}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded border border-lab-200 px-3 py-1.5 text-sm disabled:bg-slate-50"
        />
      )}

      {spec.help ? (
        <p id={describedBy} className="mt-1 text-xs text-slate-500">
          {spec.help}
        </p>
      ) : null}
      {spec.type === "number" && (spec.minimum !== null || spec.maximum !== null) ? (
        <p className="mt-0.5 text-xs text-slate-400">
          Allowed: {spec.minimum ?? "−∞"} to {spec.maximum ?? "∞"}
        </p>
      ) : null}
    </div>
  );
}
