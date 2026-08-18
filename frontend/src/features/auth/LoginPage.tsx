import { type FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "@/features/auth/useAuth";
import { ApiError } from "@/services/client";

/**
 * Development convenience: prefill the form instead of retyping the operator
 * account on every reload.
 *
 * Two properties keep this out of a deployed build. `import.meta.env.DEV` is
 * statically replaced by Vite, so the whole block is dead code a production
 * bundle drops. And the values come from `frontend/.env`, which is gitignored —
 * no credential is committed, and an environment that does not set them simply
 * renders no button.
 */
const devCredentials =
  import.meta.env.DEV &&
  import.meta.env.VITE_DEV_LOGIN_EMAIL &&
  import.meta.env.VITE_DEV_LOGIN_PASSWORD
    ? {
        email: import.meta.env.VITE_DEV_LOGIN_EMAIL,
        password: import.meta.env.VITE_DEV_LOGIN_PASSWORD,
      }
    : null;

export function LoginPage() {
  const { user, isLoading, signIn } = useAuth();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Restoring session…
      </div>
    );
  }
  if (user) {
    return <Navigate to={location.state?.from ?? "/"} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, {
              error_code: "NETWORK_ERROR",
              message: "Could not reach the server.",
              details: [],
            }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const lockedSeconds =
    error?.errorCode === "ACCOUNT_LOCKED"
      ? Number(error.details[0]?.["retry_after_seconds"] ?? 0)
      : 0;

  return (
    <div className="flex min-h-full items-center justify-center bg-lab-900 p-6">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
        <h1 className="text-lg font-semibold text-lab-900">LISA</h1>
        <p className="mt-1 text-sm text-slate-600">
          Laboratory Information System Analysis
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-lab-900">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded border border-lab-200 px-3 py-2 text-sm focus:border-lab-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-lab-900">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded border border-lab-200 px-3 py-2 text-sm focus:border-lab-500 focus:outline-none"
            />
          </div>

          {error ? (
            <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error.message}
              {lockedSeconds > 0 ? (
                <span> Try again in about {Math.ceil(lockedSeconds / 60)} minute(s).</span>
              ) : null}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-lab-600 px-3 py-2 text-sm font-medium text-white hover:bg-lab-700 disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>

          {devCredentials ? (
            <p className="text-center text-xs text-slate-500">
              Development only —{" "}
              <button
                type="button"
                onClick={() => {
                  setEmail(devCredentials.email);
                  setPassword(devCredentials.password);
                  setError(null);
                }}
                className="font-medium text-lab-600 underline underline-offset-2 hover:text-lab-700"
              >
                Autofill
              </button>{" "}
              {devCredentials.email}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
