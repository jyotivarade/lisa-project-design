import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "@/features/auth/useAuth";

/**
 * Route guard.
 *
 * This is navigation, not security: every endpoint behind it enforces the same
 * permission server-side. Its job is to avoid showing a screen that would only
 * fill with 403s.
 */
export function ProtectedRoute({
  children,
  permission,
}: {
  children: ReactNode;
  permission?: string;
}) {
  const { user, isLoading, can } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Restoring session…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (permission && !can(permission)) {
    return (
      <div className="m-6 rounded-lg border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-sm font-semibold text-amber-900">Not available to your role</h2>
        <p className="mt-2 text-sm text-amber-800">
          This area requires the <code>{permission}</code> permission. Ask an administrator
          if you need access.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
