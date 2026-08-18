import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { formatBytes } from "@/features/files/FilesPage";
import { UploadPanel } from "@/features/files/UploadPanel";
import { filesApi } from "@/services/files";
import type { UploadedFile } from "@/types/api";

export function AnalyticsFilesTab({ analyticsId }: { analyticsId: string }) {
  const navigate = useNavigate();
  const files = useQuery({
    queryKey: ["files", "analytics", analyticsId],
    queryFn: () => filesApi.listForAnalytics(analyticsId),
  });

  const columns: Array<Column<UploadedFile>> = [
    {
      key: "name",
      header: "File",
      render: (row) => <span className="font-medium">{row.original_filename}</span>,
    },
    {
      key: "uploaded",
      header: "Uploaded",
      render: (row) => new Date(row.uploaded_at).toLocaleString(),
    },
    { key: "size", header: "Size", align: "right", render: (row) => formatBytes(row.size_bytes) },
    { key: "rows", header: "Rows", align: "right", render: (row) => row.total_rows ?? "—" },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge
          status={row.status === "PARSED" ? "PASS" : row.status === "INVALID" ? "FAIL" : "PENDING"}
          label={row.status}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <UploadPanel analyticsId={analyticsId} />
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
            empty={{ title: "No files uploaded to this analytics yet" }}
          />
        )}
      </div>
    </div>
  );
}
