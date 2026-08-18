import { useQuery } from "@tanstack/react-query";

import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { ApiError } from "@/services/client";
import { healthApi } from "@/services/health";

/**
 * Phase 1 dashboard.
 *
 * There is no analytics data yet and none is invented: the summary tiles arrive in
 * Phase 9 backed by real aggregates. What this page does prove is that the browser
 * reaches the API and reads its real state.
 */
export function DashboardPage() {
  const health = useQuery({
    queryKey: ["health", "ready"],
    queryFn: healthApi.ready,
    retry: false,
  });

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-lab-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Totals across every analytics, from real uploaded data.
        </p>
      </header>

      <EmptyState
        title="No analytics data available"
        description="Create an analytics and upload a CSV file to see processing results here. Nothing on this page is simulated."
      />

      <div className="rounded-lg border border-lab-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-lab-900">System status</h2>
          {health.isPending ? (
            <StatusBadge status="PENDING" label="Checking" />
          ) : health.isError ? (
            <StatusBadge status="FAIL" label="Unreachable" />
          ) : (
            <StatusBadge
              status={health.data.status === "ready" ? "READY" : "WARNING"}
              label={health.data.status === "ready" ? "Ready" : "Degraded"}
            />
          )}
        </div>

        {health.isError ? (
          <p className="mt-3 text-sm text-red-800">
            {health.error instanceof ApiError
              ? `${health.error.errorCode}: ${health.error.message}`
              : "The API did not respond."}
          </p>
        ) : health.data ? (
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Environment</dt>
              <dd className="font-medium">{health.data.environment}</dd>
            </div>
            {Object.entries(health.data.checks).map(([name, value]) => (
              <div key={name} className="flex justify-between gap-4">
                <dt className="text-slate-600 capitalize">{name}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </section>
  );
}
