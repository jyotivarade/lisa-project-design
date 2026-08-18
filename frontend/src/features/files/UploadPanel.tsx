import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { FileDropzone } from "@/components/FileDropzone";
import { StatusBadge } from "@/components/StatusBadge";
import { usePermission } from "@/features/auth/useAuth";
import { filesApi } from "@/services/files";
import { ApiError } from "@/services/client";
import type { UploadResult } from "@/types/api";

export function UploadPanel({ analyticsId }: { analyticsId: string }) {
  const queryClient = useQueryClient();
  const canUpload = usePermission("files:upload");
  const [results, setResults] = useState<UploadResult[]>([]);

  const upload = useMutation({
    mutationFn: (files: File[]) => filesApi.upload(analyticsId, files),
    onSuccess: async (response) => {
      setResults(response.results);
      await queryClient.invalidateQueries({ queryKey: ["files"] });
      await queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
  });

  if (!canUpload) {
    return (
      <p className="text-sm text-slate-500">Your role can view files but not upload them.</p>
    );
  }

  const error = upload.error instanceof ApiError ? upload.error : null;

  return (
    <div className="space-y-4">
      <FileDropzone onFiles={(files) => upload.mutate(files)} busy={upload.isPending} />

      {error ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">{error.message}</p>
          {error.details.length ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-red-800">
              {error.details.map((detail, index) => (
                <li key={index}>{String(detail["issue"] ?? JSON.stringify(detail))}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {results.map((result) => (
        <article
          key={result.file.id}
          className="rounded-lg border border-lab-200 bg-white p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-lab-900">
              {result.file.original_filename}
            </span>
            <StatusBadge
              status={result.file.status === "PARSED" ? "PASS" : "WARNING"}
              label={result.file.status}
            />
          </div>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Rows", result.file.total_rows],
              ["Calibrators", result.session.calibrator_rows],
              ["Controls", result.session.control_rows],
              ["Patients", result.session.patient_rows],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between gap-2">
                <dt className="text-slate-600">{label}</dt>
                <dd className="font-medium">{String(value)}</dd>
              </div>
            ))}
          </dl>
          {result.warnings.length ? (
            <ul className="mt-3 list-disc rounded border border-amber-200 bg-amber-50 p-3 pl-8 text-sm text-amber-900">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  );
}
