/**
 * The honest empty state. When there is no data, LISA says so — it never renders
 * a plausible-looking zero that a reader could mistake for a measurement
 * (spec section 27).
 */
import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-lab-200 bg-white p-10 text-center">
      <h3 className="text-sm font-semibold text-lab-900">{title}</h3>
      {description ? (
        <p className="mx-auto mt-2 max-w-prose text-sm text-slate-600">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
