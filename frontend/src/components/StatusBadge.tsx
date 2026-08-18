/**
 * Status is always conveyed by an icon AND a word, never by colour alone.
 * A reviewer who cannot distinguish the colours must still read the verdict.
 */

export type Status = "PASS" | "FAIL" | "WARNING" | "BLOCKED" | "READY" | "PENDING";

const STYLES: Record<Status, { className: string; glyph: string }> = {
  PASS: { className: "bg-green-50 text-green-800 ring-green-600/30", glyph: "✓" },
  READY: { className: "bg-green-50 text-green-800 ring-green-600/30", glyph: "✓" },
  FAIL: { className: "bg-red-50 text-red-800 ring-red-600/30", glyph: "✕" },
  BLOCKED: { className: "bg-orange-50 text-orange-900 ring-orange-600/30", glyph: "⦸" },
  WARNING: { className: "bg-amber-50 text-amber-900 ring-amber-600/30", glyph: "!" },
  PENDING: { className: "bg-slate-100 text-slate-700 ring-slate-500/30", glyph: "•" },
};

export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  const style = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${style.className}`}
    >
      <span aria-hidden="true">{style.glyph}</span>
      {label ?? status}
    </span>
  );
}
