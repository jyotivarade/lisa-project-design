import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/features/auth/AuthContext";
import { LoginPage } from "@/features/auth/LoginPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { setAccessToken } from "@/services/client";
import type { User } from "@/types/api";

const ANALYST: User = {
  id: "u-1",
  email: "analyst@lisa.local",
  full_name: "Ana Lyst",
  is_active: true,
  last_login_at: null,
  role: { id: "r-1", name: "ANALYST", description: null },
  permissions: ["analytics:read", "processing:execute"],
};

function ok(body: unknown): Response {
  return { ok: true, status: 200, statusText: "", json: async () => body } as Response;
}
function fail(status: number, body: unknown): Response {
  return { ok: false, status, statusText: "", json: async () => body } as Response;
}

function renderApp(initialPath = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter
          initialEntries={[initialPath]}
          future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        >
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <div>Dashboard content</div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/administration"
              element={
                <ProtectedRoute permission="users:read">
                  <div>Administration content</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => setAccessToken(null));
afterEach(() => vi.unstubAllGlobals());

describe("session restore", () => {
  it("restores a session from the refresh cookie on load", async () => {
    // The access token is in memory only, so a reload starts with none — the
    // HttpOnly cookie is what carries the session across a page load.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ access_token: "fresh", expires_in: 900, user: ANALYST })),
    );
    renderApp("/");
    expect(await screen.findByText("Dashboard content")).toBeInTheDocument();
  });

  it("sends the user to login when there is no session to restore", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fail(401, { error_code: "INVALID_CREDENTIALS", message: "no", details: [] })),
    );
    renderApp("/");
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });

  it("shows a restoring state rather than flashing the login form", async () => {
    // Rendering login for a split second to a user who is signed in reads as a
    // session loss that did not happen.
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    renderApp("/");
    expect(screen.getByText("Restoring session…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();

    release(ok({ access_token: "fresh", expires_in: 900, user: ANALYST }));
    expect(await screen.findByText("Dashboard content")).toBeInTheDocument();
  });
});

describe("login form", () => {
  it("signs in and reveals the protected content", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/auth/refresh")) {
          return fail(401, { error_code: "INVALID_CREDENTIALS", message: "no", details: [] });
        }
        return ok({ access_token: "token", expires_in: 900, user: ANALYST });
      }),
    );

    renderApp("/login");
    await screen.findByLabelText("Email");
    await user.type(screen.getByLabelText("Email"), "analyst@lisa.local");
    await user.type(screen.getByLabelText("Password"), "Str0ngTestPassw0rd");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByText("Dashboard content")).toBeInTheDocument());
  });

  it("shows the server's message on bad credentials and stays on the form", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        fail(401, {
          error_code: "INVALID_CREDENTIALS",
          message: url.includes("login") ? "Email or password is incorrect." : "no session",
          details: [],
        }),
      ),
    );

    renderApp("/login");
    await screen.findByLabelText("Email");
    await user.type(screen.getByLabelText("Email"), "analyst@lisa.local");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("explains a lockout with the wait time the server reported", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("login")
          ? fail(423, {
              error_code: "ACCOUNT_LOCKED",
              message: "This account is temporarily locked after repeated failed sign-in attempts.",
              details: [{ retry_after_seconds: 900 }],
            })
          : fail(401, { error_code: "INVALID_CREDENTIALS", message: "no", details: [] }),
      ),
    );

    renderApp("/login");
    await screen.findByLabelText("Email");
    await user.type(screen.getByLabelText("Email"), "analyst@lisa.local");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("temporarily locked");
    expect(alert).toHaveTextContent("15 minute");
  });
});

describe("permission guard", () => {
  function restoreAs(user: User) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ access_token: "fresh", expires_in: 900, user })),
    );
  }

  it("refuses a route the user lacks the permission for", async () => {
    restoreAs(ANALYST); // no users:read
    renderApp("/administration");
    expect(await screen.findByText("Not available to your role")).toBeInTheDocument();
    expect(screen.queryByText("Administration content")).not.toBeInTheDocument();
  });

  it("allows the route when the permission is granted", async () => {
    restoreAs({ ...ANALYST, permissions: [...ANALYST.permissions, "users:read"] });
    renderApp("/administration");
    expect(await screen.findByText("Administration content")).toBeInTheDocument();
  });

  it("reads permissions from the server rather than inferring them from the role", async () => {
    // A role named ADMIN with no granted permissions must still be refused: the
    // grants are the authority, and the server is where they live.
    restoreAs({
      ...ANALYST,
      role: { id: "r-0", name: "ADMIN", description: null },
      permissions: [],
    });
    renderApp("/administration");
    expect(await screen.findByText("Not available to your role")).toBeInTheDocument();
  });
});
