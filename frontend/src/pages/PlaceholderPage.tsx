import { EmptyState } from "@/components/EmptyState";

/**
 * A route that exists but whose feature arrives in a later phase.
 *
 * It says which phase, rather than showing an empty table that looks like a
 * working screen with no data — an unbuilt feature and a feature with no data are
 * different things and must not look the same.
 */
export function PlaceholderPage({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold text-lab-900">{title}</h1>
      <EmptyState title={`Arrives in ${phase}`} description={description} />
    </section>
  );
}
