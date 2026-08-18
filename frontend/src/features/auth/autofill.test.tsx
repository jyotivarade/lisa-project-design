import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The autofill button is read from `import.meta.env` at module load, so each
 * case has to stub the environment and re-import the module rather than reuse a
 * top-level import.
 *
 * The provider is imported in the same batch deliberately: `resetModules` hands
 * `LoginPage` a fresh `AuthContext`, and a statically imported provider would be
 * publishing to the previous one.
 */
async function renderLogin() {
  const { LoginPage } = await import("@/features/auth/LoginPage");
  const { AuthProvider } = await import("@/features/auth/AuthContext");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter
          initialEntries={["/login"]}
          future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        >
          <LoginPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** No session to restore — the form renders rather than the redirect. */
function noSession() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "",
      json: async () => ({ error_code: "INVALID_CREDENTIALS", message: "no", details: [] }),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("development autofill", () => {
  it("fills both fields from the environment when the button is used", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_DEV_LOGIN_EMAIL", "admin@lisa.local");
    vi.stubEnv("VITE_DEV_LOGIN_PASSWORD", "Str0ngDevPassw0rd!");
    vi.resetModules();
    noSession();

    const user = userEvent.setup();
    await renderLogin();
    await screen.findByLabelText("Email");
    await user.click(screen.getByRole("button", { name: "Autofill" }));

    expect(screen.getByLabelText("Email")).toHaveValue("admin@lisa.local");
    expect(screen.getByLabelText("Password")).toHaveValue("Str0ngDevPassw0rd!");
  });

  it("offers nothing when the credentials are not configured", async () => {
    // An unset password must not produce a button that fills half the form.
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_DEV_LOGIN_EMAIL", "admin@lisa.local");
    vi.stubEnv("VITE_DEV_LOGIN_PASSWORD", "");
    vi.resetModules();
    noSession();

    await renderLogin();
    await screen.findByLabelText("Email");
    expect(screen.queryByRole("button", { name: "Autofill" })).not.toBeInTheDocument();
  });

  it("is absent outside development even if the variables are set", async () => {
    // The guard that matters: a deployed build must never render credentials.
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_DEV_LOGIN_EMAIL", "admin@lisa.local");
    vi.stubEnv("VITE_DEV_LOGIN_PASSWORD", "Str0ngDevPassw0rd!");
    vi.resetModules();
    noSession();

    await renderLogin();
    await screen.findByLabelText("Email");
    expect(screen.queryByRole("button", { name: "Autofill" })).not.toBeInTheDocument();
    expect(screen.queryByText("admin@lisa.local")).not.toBeInTheDocument();
  });
});
