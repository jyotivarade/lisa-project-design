import { ApiError, getAccessToken } from "@/services/client";
import { api } from "@/services/client";
import type {
  FilePreview,
  Page,
  UploadedFile,
  UploadedFileDetail,
  UploadResponse,
} from "@/types/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export const filesApi = {
  listAll: () => api.get<Page<UploadedFileDetail>>("/files"),

  listForAnalytics: (analyticsId: string) =>
    api.get<Page<UploadedFile>>(`/analytics/${analyticsId}/files`),

  get: (fileId: string) => api.get<UploadedFileDetail>(`/files/${fileId}`),

  preview: (fileId: string, limit = 50, stream?: string) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (stream) query.set("stream", stream);
    return api.get<FilePreview>(`/files/${fileId}/preview?${query.toString()}`);
  },

  /** The browser hands the file to the API and never reads it (spec section 32). */
  upload: async (analyticsId: string, files: File[]): Promise<UploadResponse> => {
    const body = new FormData();
    for (const file of files) body.append("files", file);

    const token = getAccessToken();
    const response = await fetch(`${API_BASE}/analytics/${analyticsId}/files`, {
      method: "POST",
      // No Content-Type: the browser must set the multipart boundary itself.
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
      body,
    });

    if (!response.ok) {
      let payload = {
        error_code: "INTERNAL_ERROR",
        message: "Upload failed.",
        details: [] as Array<Record<string, unknown>>,
      };
      try {
        payload = { ...payload, ...(await response.json()) };
      } catch {
        // A gateway error page keeps the default above.
      }
      throw new ApiError(response.status, payload);
    }
    return (await response.json()) as UploadResponse;
  },

  downloadUrl: (fileId: string) => `${API_BASE}/files/${fileId}/download`,
};
