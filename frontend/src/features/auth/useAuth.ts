import { useContext } from "react";

import { AuthContext, type AuthState } from "@/features/auth/AuthContext";

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}

/** Permission check for conditional UI. Convenience only — the API enforces. */
export function usePermission(permission: string): boolean {
  return useAuth().can(permission);
}
