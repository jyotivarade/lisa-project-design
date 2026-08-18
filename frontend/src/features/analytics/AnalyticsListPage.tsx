import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { usePermission } from "@/features/auth/useAuth";
import { analyticsApi } from "@/services/analytics";
import { ApiError } from "@/services/client";
import type { AnalyticsListItem } from "@/types/api";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function AnalyticsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = usePermission("analytics:write");
  const [showForm, setShowForm] = useState(false);

  const analytics = useQuery({
    queryKey: ["analytics"],
    queryFn: analyticsApi.list,
  });

  const columns: Array<Column<AnalyticsListItem>> = [
    { key: "name", header: "Analytics", render: (row) => <span className="font-medium">{row.name}</span> },
    { key: "analyte", header: "Analyte", render: (row) => row.analyte_name },
    { key: "files", header: "Files", align: "right", render: (row) => row.file_count },
    { key: "runs", header: "Runs", align: "right", render: (row) => row.session_count },
    {
      key: "last",
      header: "Last run",
      render: (row) =>
        row.last_session_state ? (
          <StatusBadge
            status={row.last_session_state === "COMPLETED" ? "PASS" : "PENDING"}
            label={row.last_session_state}
          />
        ) : (
          <span className="text-slate-500">Never</span>
        ),
    },
    {
      key: "config",
      header: "Config",
      align: "right",
      render: (row) => <span className="text-slate-600">v{row.configuration_version ?? "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge
          status={row.is_active ? "PASS" : "BLOCKED"}
          label={row.is_active ? "Active" : "Inactive"}
        />
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-lab-900">Analytics</h1>
          <p className="mt-1 text-sm text-slate-600">
            One analytics per assay. Each carries its own configuration and its own uploads.
          </p>
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={() => setShowForm((open) => !open)}
            className="rounded bg-lab-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-lab-700"
          >
            {showForm ? "Cancel" : "New analytics"}
          </button>
        ) : null}
      </header>

      {showForm ? (
        <CreateAnalyticsForm
          onCreated={(id) => {
            void queryClient.invalidateQueries({ queryKey: ["analytics"] });
            setShowForm(false);
            navigate(`/analytics/${id}`);
          }}
        />
      ) : null}

      <div className="rounded-lg border border-lab-200 bg-white">
        {analytics.isPending ? (
          <p className="p-5 text-sm text-slate-500">Loading…</p>
        ) : analytics.isError ? (
          <p className="p-5 text-sm text-red-800">Could not load analytics.</p>
        ) : (
          <DataTable
            columns={columns}
            rows={analytics.data.items}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/analytics/${row.id}`)}
            empty={{
              title: "No analytics yet",
              description:
                "Create one for each assay you process. Nothing is pre-loaded — the numbers on every screen come from files you upload.",
            }}
          />
        )}
      </div>
    </section>
  );
}

function CreateAnalyticsForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [analyteName, setAnalyteName] = useState("");
  const [description, setDescription] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      analyticsApi.create({
        name,
        code: code || slugify(name),
        analyte_name: analyteName || name,
        description: description || null,
      }),
    onSuccess: (created) => onCreated(created.id),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  const error = create.error instanceof ApiError ? create.error : null;

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-lab-200 bg-white p-5"
    >
      <h2 className="text-sm font-semibold text-lab-900">New analytics</h2>
      <p className="mt-1 text-sm text-slate-600">
        Creating an analytics also creates configuration version 1 from the rule catalogue.
        Every threshold is editable afterwards.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="block text-sm text-slate-600">Name</label>
          <input
            id="name"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!codeTouched) setCode(slugify(e.target.value));
            }}
            className="mt-1 w-full rounded border border-lab-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="code" className="block text-sm text-slate-600">Code</label>
          <input
            id="code"
            required
            value={code}
            onChange={(e) => {
              setCodeTouched(true);
              setCode(e.target.value);
            }}
            className="mt-1 w-full rounded border border-lab-200 px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label htmlFor="analyte_name" className="block text-sm text-slate-600">
            Analyte name
          </label>
          <input
            id="analyte_name"
            required
            value={analyteName}
            onChange={(e) => setAnalyteName(e.target.value)}
            placeholder={name || "As it appears in the file"}
            className="mt-1 w-full rounded border border-lab-200 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            Must match the file&apos;s <code>Analyte Name</code> column.
          </p>
        </div>
        <div>
          <label htmlFor="description" className="block text-sm text-slate-600">
            Description
          </label>
          <input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded border border-lab-200 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {error.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={create.isPending}
        className="mt-4 rounded bg-lab-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-lab-700 disabled:opacity-60"
      >
        {create.isPending ? "Creating…" : "Create analytics"}
      </button>
    </form>
  );
}
