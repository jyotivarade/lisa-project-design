import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileDropzone } from "@/components/FileDropzone";
import { AuthContext, type AuthState } from "@/features/auth/AuthContext";
import { UploadPanel } from "@/features/files/UploadPanel";
import { formatBytes } from "@/features/files/FilesPage";
import type { UploadResponse, User } from "@/types/api";

const USER: User = {
  id: "u-1",
  email: "analyst@lisa.local",
  full_name: "Ana Lyst",
  is_active: true,
  last_login_at: null,
  role: { id: "r-1", name: "ANALYST", description: null },
  permissions: ["files:read", "files:upload"],
};

function uploadResponse(overrides: Partial<UploadResponse["results"][number]> = {}): UploadResponse {
  return {
    results: [
      {
        file: {
          id: "f-1",
          analytics_id: "a-1",
          original_filename: "Cocaine_2026_08_01.csv",
          file_hash: "abc",
          size_bytes: 22190,
          content_type: "text/csv",
          uploaded_at: "2026-08-19T00:00:00Z",
          uploaded_by_id: null,
          status: "PARSED",
          total_rows: 129,
          empty_rows: 0,
          malformed_rows: 0,
          header_columns: [],
          detected_analytes: ["Cocaine"],
          is_duplicate: false,
          duplicate_of_id: null,
          validation_errors: null,
        },
        session: {
          id: "s-1",
          session_number: 1,
          state: "CALIBRATION_REVIEW",
          calibration_verdict: "NOT_REVIEWED",
          control_verdict: "NOT_REVIEWED",
          total_rows: 129,
          calibrator_rows: 7,
          control_rows: 4,
          patient_rows: 118,
          other_rows: 0,
          skipped_rows: 0,
          passed_count: 0,
          failed_count: 0,
          engine_version: "1.0.0",
          created_at: "2026-08-19T00:00:00Z",
          completed_at: null,
          error_code: null,
          error_message: null,
        },
        warnings: [],
        duplicate_of_id: null,
        ...overrides,
      },
    ],
  };
}

function renderUpload(options: { response?: UploadResponse; error?: unknown; permissions?: string[] } = {}) {
  const sent: FormData[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        sent.push(init.body as FormData);
        if (options.error) {
          return { ok: false, status: 413, json: async () => options.error } as Response;
        }
        return {
          ok: true,
          status: 201,
          json: async () => options.response ?? uploadResponse(),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
    }),
  );

  const permissions = options.permissions ?? USER.permissions;
  const auth = {
    user: { ...USER, permissions },
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    setUser: vi.fn(),
    can: (permission: string) => permissions.includes(permission),
  } satisfies AuthState;

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <UploadPanel analyticsId="a-1" />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { sent };
}

afterEach(() => vi.unstubAllGlobals());

describe("FileDropzone", () => {
  it("passes accepted files to the handler", async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} />);

    const input = screen.getByLabelText("Choose CSV files");
    await user.upload(input, new File(["a,b\n1,2\n"], "run.csv", { type: "text/csv" }));

    expect(onFiles).toHaveBeenCalledOnce();
    expect(onFiles.mock.calls[0]![0][0].name).toBe("run.csv");
  });

  it("filters out files the server would reject anyway", async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} />);

    await user.upload(
      screen.getByLabelText("Choose CSV files"),
      new File(["x"], "report.pdf", { type: "application/pdf" }),
    );
    // Saves a pointless round trip; the server still re-checks regardless.
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("says that nothing is overwritten", () => {
    render(<FileDropzone onFiles={vi.fn()} />);
    expect(screen.getByText(/Nothing is ever overwritten/)).toBeInTheDocument();
  });
});

describe("UploadPanel", () => {
  it("sends the file as multipart form data", async () => {
    const user = userEvent.setup();
    const { sent } = renderUpload();

    await user.upload(
      screen.getByLabelText("Choose CSV files"),
      new File(["a,b\n1,2\n"], "run.csv", { type: "text/csv" }),
    );

    await screen.findByText("Cocaine_2026_08_01.csv");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.getAll("files")).toHaveLength(1);
  });

  it("reports the classified streams the server found", async () => {
    const user = userEvent.setup();
    renderUpload();

    await user.upload(
      screen.getByLabelText("Choose CSV files"),
      new File(["a"], "run.csv", { type: "text/csv" }),
    );

    expect(await screen.findByText("129")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();   // calibrators
    expect(screen.getByText("118")).toBeInTheDocument(); // patients
  });

  it("surfaces server warnings rather than hiding them", async () => {
    const user = userEvent.setup();
    renderUpload({
      response: uploadResponse({
        warnings: ["3 completely blank row(s) were skipped.", "No column matched 'recovery'."],
      }),
    });

    await user.upload(
      screen.getByLabelText("Choose CSV files"),
      new File(["a"], "run.csv", { type: "text/csv" }),
    );

    expect(await screen.findByText(/blank row\(s\) were skipped/)).toBeInTheDocument();
    expect(screen.getByText(/No column matched/)).toBeInTheDocument();
  });

  it("shows the server's error with its detail", async () => {
    const user = userEvent.setup();
    renderUpload({
      error: {
        error_code: "FILE_TOO_LARGE",
        message: "The file is larger than the limit for this analytics.",
        details: [{ issue: "Limit is 64 bytes." }],
      },
    });

    await user.upload(
      screen.getByLabelText("Choose CSV files"),
      new File(["a"], "run.csv", { type: "text/csv" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("larger than the limit");
    expect(alert).toHaveTextContent("Limit is 64 bytes.");
  });

  it("hides uploading from a role without the permission", () => {
    renderUpload({ permissions: ["files:read"] });
    expect(screen.queryByLabelText("Choose CSV files")).not.toBeInTheDocument();
    expect(screen.getByText(/view files but not upload/)).toBeInTheDocument();
  });
});

describe("formatBytes", () => {
  it.each([
    [512, "512 B"],
    [22190, "21.7 KB"],
    [34_000_000, "32.4 MB"],
  ])("formats %i as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
