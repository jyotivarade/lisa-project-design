import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfigurationTab } from "@/features/analytics/ConfigurationTab";
import { VersionHistoryTab } from "@/features/analytics/VersionHistoryTab";
import { AnalyticsFilesTab } from "@/features/files/AnalyticsFilesTab";
import { analyticsApi } from "@/services/analytics";

/** Tabs per spec section 17. Each becomes real in the phase that builds it. */
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "configuration", label: "Configuration" },
  { key: "files", label: "Files" },
  { key: "calibration", label: "Calibration", phase: "Phase 6" },
  { key: "controls", label: "Controls", phase: "Phase 6" },
  { key: "patients", label: "Patients", phase: "Phase 7" },
  { key: "history", label: "Processing History", phase: "Phase 8" },
  { key: "versions", label: "Configuration History" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function AnalyticsDetailPage() {
  const { analyticsId = "" } = useParams();
  const [tab, setTab] = useState<TabKey>("overview");

  const analytics = useQuery({
    queryKey: ["analytics", analyticsId],
    queryFn: () => analyticsApi.get(analyticsId),
  });

  if (analytics.isPending) return <p className="text-sm text-slate-500">Loading…</p>;
  if (analytics.isError) {
    return (
      <EmptyState
        title="Analytics not found"
        description="It may have been removed."
        action={
          <Link to="/analytics" className="text-sm text-lab-600 underline">
            Back to analytics
          </Link>
        }
      />
    );
  }

  const item = analytics.data;
  const active = TABS.find((t) => t.key === tab);

  return (
    <section className="space-y-6">
      <header>
        <Link to="/analytics" className="text-sm text-lab-600 hover:underline">
          ← Analytics
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-lab-900">{item.name}</h1>
          <StatusBadge
            status={item.is_active ? "PASS" : "BLOCKED"}
            label={item.is_active ? "Active" : "Inactive"}
          />
          <span className="text-sm text-slate-500">
            <code>{item.code}</code> · analyte {item.analyte_name} · configuration v
            {item.configuration_version ?? "—"}
          </span>
        </div>
        {item.description ? (
          <p className="mt-1 text-sm text-slate-600">{item.description}</p>
        ) : null}
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-lab-200" aria-label="Analytics sections">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            aria-current={tab === entry.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === entry.key
                ? "border-lab-600 font-medium text-lab-900"
                : "border-transparent text-slate-600 hover:text-lab-700"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Uploaded files", value: "0" },
            { label: "Processing runs", value: "0" },
            { label: "Configuration", value: `v${item.configuration_version ?? "—"}` },
            { label: "Created", value: new Date(item.created_at).toLocaleDateString() },
          ].map((tile) => (
            <div key={tile.label} className="rounded-lg border border-lab-200 bg-white p-4">
              <dt className="text-sm text-slate-600">{tile.label}</dt>
              <dd className="mt-1 text-2xl font-semibold text-lab-900">{tile.value}</dd>
            </div>
          ))}
        </dl>
      ) : tab === "configuration" ? (
        <ConfigurationTab analyticsId={analyticsId} />
      ) : tab === "files" ? (
        <AnalyticsFilesTab analyticsId={analyticsId} />
      ) : tab === "versions" ? (
        <VersionHistoryTab analyticsId={analyticsId} />
      ) : (
        <EmptyState
          title={`${active?.label} arrives in ${active && "phase" in active ? active.phase : "a later phase"}`}
          description="The route exists so the shape of the application is visible; the feature is not built yet."
        />
      )}
    </section>
  );
}
