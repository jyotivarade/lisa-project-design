import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { filesApi } from "@/services/files";
import type { UploadedFileDetail } from "@/types/api";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesPage() {
  const navigate = useNavigate();
  const files = useQuery({ queryKey: ["files"], queryFn: filesApi.listAll });

  const columns: Array<Column<UploadedFileDetail>> = [
    {
      key: "name",
      header: "File",
      render: (row) => (
        <span className="font-medium">
          {row.original_filename}
          {row.is_duplicate ? (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
              duplicate content
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "analytics", header: "Analytics", render: (row) => row.analytics_name ?? "—" },
    {
      key: "uploaded",
      header: "Uploaded",
      render: (row) => new Date(row.uploaded_at).toLocaleString(),
    },
    { key: "size", header: "Size", align: "right", render: (row) => formatBytes(row.size_bytes) },
    { key: "rows", header: "Rows", align: "right", render: (row) => row.total_rows ?? "—" },
    {
      key: "streams",
      header: "Cal / Ctl / Pat",
      align: "right",
      render: (row) => {
        const session = row.sessions.at(-1);
        return session
          ? `${session.calibrator_rows} / ${session.control_rows} / ${session.patient_rows}`
          : "—";
      },
    },
    {
      key: "state",
      header: "Status",
      render: (row) => {
        const session = row.sessions.at(-1);
        if (!session) return <StatusBadge status="PENDING" label="Not parsed" />;
        if (session.state === "PROCESSING_FAILED") {
          return <StatusBadge status="FAIL" label={session.error_code ?? "Failed"} />;
        }
        if (session.state === "COMPLETED") return <StatusBadge status="PASS" label="Completed" />;
        return <StatusBadge status="PENDING" label={session.state.replace(/_/g, " ")} />;
      },
    },
  ];

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-lab-900">Files</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every upload ever made, across all analytics. Files are never overwritten and
          never replaced.
        </p>
      </header>

      <div className="rounded-lg border border-lab-200 bg-white">
        {files.isPending ? (
          <p className="p-5 text-sm text-slate-500">Loading…</p>
        ) : files.isError ? (
          <p className="p-5 text-sm text-red-800">Could not load files.</p>
        ) : (
          <DataTable
            columns={columns}
            rows={files.data.items}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/files/${row.id}`)}
            empty={{
              title: "No files uploaded yet",
              description:
                "Open an analytics and drop a CSV onto its Files tab. Every number in LISA comes from a file you upload.",
            }}
          />
        )}
      </div>
    </section>
  );
}
