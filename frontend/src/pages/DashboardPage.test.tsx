import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardPage } from "@/pages/DashboardPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("DashboardPage", () => {
  it("says there is no data instead of showing fabricated totals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: "ready", environment: "test", checks: { database: "ok" } }),
      })),
    );

    renderPage();

    // Spec section 27: an empty system must say so, not render a plausible zero.
    expect(await screen.findByText("No analytics data available")).toBeInTheDocument();
    expect(screen.queryByText(/^0%$/)).not.toBeInTheDocument();
  });

  it("reports the API being unreachable rather than rendering as healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({
          error_code: "INTERNAL_ERROR",
          message: "Database unavailable.",
          details: [],
        }),
      })),
    );

    renderPage();
    expect(await screen.findByText("Unreachable")).toBeInTheDocument();
  });
});
