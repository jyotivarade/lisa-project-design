import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyticsListPage } from "@/features/analytics/AnalyticsListPage";
import { AuthContext, type AuthState } from "@/features/auth/AuthContext";
import type { AnalyticsListItem, User } from "@/types/api";

const USER: User = {
  id: "u-1",
  email: "analyst@lisa.local",
  full_name: "Ana Lyst",
  is_active: true,
  last_login_at: null,
  role: { id: "r-1", name: "ANALYST", description: null },
  permissions: ["analytics:read", "analytics:write"],
};

function item(overrides: Partial<AnalyticsListItem> = {}): AnalyticsListItem {
  return {
    id: "a-1",
    name: "Cocaine",
    code: "cocaine",
    description: null,
    analyte_name: "Cocaine",
    is_active: true,
    created_at: "2026-08-19T00:00:00Z",
    updated_at: "2026-08-19T00:00:00Z",
    created_by_id: null,
    updated_by_id: null,
    configuration_version: 1,
    file_count: 0,
    session_count: 0,
    last_uploaded_at: null,
    last_session_state: null,
    calibration_status: null,
    control_status: null,
    patient_processing_status: null,
    ...overrides,
  };
}

function renderPage(items: AnalyticsListItem[], permissions = USER.permissions) {
  const created: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        created.push(JSON.parse(String(init.body)));
        return { ok: true, status: 201, json: async () => item({ id: "a-new" }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items,
          page: 1,
          page_size: 50,
          total: items.length,
          total_pages: 1,
        }),
      } as Response;
    }),
  );

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
          <AnalyticsListPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { created };
}

afterEach(() => vi.unstubAllGlobals());

describe("AnalyticsListPage", () => {
  it("lists analytics with their real counts", async () => {
    renderPage([item({ file_count: 4, session_count: 6 })]);
    // The name and the analyte both read "Cocaine" here, as they usually do.
    expect(await screen.findAllByText("Cocaine")).toHaveLength(2);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("says a run has never happened rather than showing a fabricated status", async () => {
    renderPage([item()]);
    expect(await screen.findByText("Never")).toBeInTheDocument();
  });

  it("shows an honest empty state", async () => {
    renderPage([]);
    expect(await screen.findByText("No analytics yet")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is pre-loaded/)).toBeInTheDocument();
  });

  it("hides creation from a role that cannot write", async () => {
    renderPage([item()], ["analytics:read"]);
    await screen.findAllByText("Cocaine");
    expect(screen.queryByRole("button", { name: "New analytics" })).not.toBeInTheDocument();
  });

  it("derives a code from the name but lets it be overridden", async () => {
    const user = userEvent.setup();
    const { created } = renderPage([]);

    await user.click(await screen.findByRole("button", { name: "New analytics" }));
    await user.type(screen.getByLabelText("Name"), "Temazepam Confirmation");
    expect(screen.getByLabelText("Code")).toHaveValue("temazepam_confirmation");

    await user.clear(screen.getByLabelText("Code"));
    await user.type(screen.getByLabelText("Code"), "tmz");
    await user.type(screen.getByLabelText("Analyte name"), "Temazepam");
    await user.click(screen.getByRole("button", { name: "Create analytics" }));

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ code: "tmz", analyte_name: "Temazepam" });
  });
});
