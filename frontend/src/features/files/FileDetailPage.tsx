import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { formatBytes } from "@/features/files/FilesPage";
import { filesApi } from "@/services/files";
import type { SampleStream } from "@/types/api";

const STREAM_LABELS: Record<SampleStream, string> = {
  CALIBRATOR: "Calibrators",
  CONTROL: "Controls",
  PATIENT: "Patient samples",
  OTHER: "Other / unclassified",
  SKIPPED: "Skipped",
  NOT_IN_SCOPE: "Other analytes",
};

export function FileDetailPage() {
  const { fileId = "" } = useParams();
  const [stream, setStream] = useState<SampleStream | "">("");

  const file = useQuery({ queryKey: ["files", fileId], queryFn: () => filesApi.get(fileId) });
  const preview = useQuery({
    queryKey: ["files", fileId, "preview", stream],
    queryFn: () => filesApi.preview(fileId, 50, stream || undefined),
  });

  if (file.isPending) return <p className="text-sm text-slate-500">Loading…</p>;
  if (file.isError) {
    return (
      <EmptyState
        title="File not found"
        action={
          <Link to="/files" className="text-sm text-lab-600 underline">
            Back to files
          </Link>
        }
      />
    );
  }

  const item = file.data;

  return (
    <section className="space-y-6">
      <header>
        <Link to="/files" className="text-sm text-lab-600 hover:underline">
          ← Files
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-lab-900">{item.original_filename}</h1>
          <StatusBadge
            status={item.status === "PARSED" ? "PASS" : item.status === "INVALID" ? "FAIL" : "PENDING"}
            label={item.status}
          />
          {item.is_duplicate ? <StatusBadge status="WARNING" label="Duplicate content" /> : null}
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {item.analytics_name} · {formatBytes(item.size_bytes)} ·{" "}
          {new Date(item.uploaded_at).toLocaleString()}
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <a
          href={filesApi.downloadUrl(item.id)}
          className="rounded border border-lab-200 bg-white px-3 py-1.5 text-sm text-lab-700 hover:bg-lab-50"
        >
          Download original
        </a>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Rows", item.total_rows ?? "—"],
          ["Columns", item.header_columns?.length ?? "—"],
          ["Blank rows skipped", item.empty_rows ?? 0],
          ["Malformed rows", item.malformed_rows ?? 0],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-lab-200 bg-white p-4">
            <dt className="text-sm text-slate-600">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-lab-900">{String(value)}</dd>
          </div>
        ))}
      </dl>

      {preview.data ? (
        <>
          {preview.data.warnings.length ? (
            <ul className="list-disc rounded-lg border border-amber-200 bg-amber-50 p-4 pl-8 text-sm text-amber-900">
              {preview.data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <section className="rounded-lg border border-lab-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-lab-900">Detected samples</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStream("")}
                aria-pressed={stream === ""}
                className={`rounded border px-2.5 py-1 text-sm ${
                  stream === "" ? "border-lab-600 bg-lab-50 text-lab-900" : "border-lab-200"
                }`}
              >
                All ({preview.data.session.total_rows})
              </button>
              {Object.entries(preview.data.stream_counts).map(([key, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStream(key as SampleStream)}
                  aria-pressed={stream === key}
                  className={`rounded border px-2.5 py-1 text-sm ${
                    stream === key ? "border-lab-600 bg-lab-50 text-lab-900" : "border-lab-200"
                  }`}
                >
                  {STREAM_LABELS[key as SampleStream]} ({count})
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-lab-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-lab-900">Column mapping</h2>
            <p className="mt-1 text-sm text-slate-600">
              Roles are matched against this file&apos;s own headers. A role with no column is
              reported here rather than discovered later.
            </p>
            <div className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(preview.data.column_mappings).map(([role, column]) => (
                <div key={role} className="flex justify-between gap-3">
                  <span className="text-slate-600">{role}</span>
                  {column ? (
                    <code className="text-lab-900">{column}</code>
                  ) : (
                    <span className="text-amber-800">not in file</span>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-lab-200 bg-white">
            <h2 className="border-b border-lab-200 px-5 py-3 text-sm font-semibold text-lab-900">
              First {preview.data.rows.length} rows
              <span className="ml-2 font-normal text-slate-500">
                as uploaded, values unchanged
              </span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-lab-50 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Stream</th>
                    {preview.data.columns.slice(0, 8).map((column) => (
                      <th key={column} className="px-3 py-2 font-medium whitespace-nowrap">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.data.rows.map((row) => (
                    <tr key={row.source_row_number} className="border-t border-lab-100">
                      <td className="px-3 py-1.5 text-slate-500">{row.source_row_number}</td>
                      <td className="px-3 py-1.5">
                        <span title={row.classification_reason ?? undefined}>
                          {row.stream}
                        </span>
                        {row.is_malformed ? (
                          <span className="ml-1 text-red-700" title="Malformed row">
                            ⚠
                          </span>
                        ) : null}
                      </td>
                      {preview.data!.columns.slice(0, 8).map((column) => (
                        <td key={column} className="px-3 py-1.5 whitespace-nowrap">
                          {row.values[column] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
