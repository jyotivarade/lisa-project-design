import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { StatusBadge } from "@/components/StatusBadge";
import { analyticsApi } from "@/services/analytics";

export function VersionHistoryTab({ analyticsId }: { analyticsId: string }) {
  const [selected, setSelected] = useState<number | null>(null);

  const versions = useQuery({
    queryKey: ["analytics", analyticsId, "versions"],
    queryFn: () => analyticsApi.versions(analyticsId),
  });
  const detail = useQuery({
    queryKey: ["analytics", analyticsId, "version", selected],
    queryFn: () => analyticsApi.version(analyticsId, selected!),
    enabled: selected !== null,
  });

  if (versions.isPending) return <p className="text-sm text-slate-500">Loading…</p>;
  if (versions.isError) return <p className="text-sm text-red-800">Could not load history.</p>;

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-slate-600">
        Configuration is append-only. Every version ever used is still here, and a run
        processed under an older one still reports that older one.
      </p>

      <ul className="divide-y divide-lab-100 rounded-lg border border-lab-200 bg-white">
        {versions.data.map((version) => (
          <li key={version.id} className="flex items-center justify-between gap-4 px-5 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-lab-900">
                Version {version.version}
                {version.is_active ? <StatusBadge status="PASS" label="Active" /> : null}
              </div>
              <p className="text-sm text-slate-600">
                {version.change_note ?? "No note recorded."}
              </p>
              <p className="text-xs text-slate-500">
                {new Date(version.created_at).toLocaleString()}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setSelected((current) => (current === version.version ? null : version.version))
              }
              className="rounded border border-lab-200 px-2.5 py-1 text-sm text-lab-700"
            >
              {selected === version.version ? "Hide" : "View"}
            </button>
          </li>
        ))}
      </ul>

      {selected !== null && detail.data ? (
        <pre className="max-h-96 overflow-auto rounded-lg border border-lab-200 bg-lab-50 p-4 text-xs">
          {JSON.stringify(detail.data.payload, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
