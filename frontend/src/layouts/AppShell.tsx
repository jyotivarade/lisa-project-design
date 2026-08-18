import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/features/auth/useAuth";

/**
 * Navigation per spec section 17.
 *
 * Entries are filtered by the permissions the server reported for this user.
 * Hiding a link is courtesy, not access control — every endpoint behind it
 * enforces the same permission itself.
 */
const NAV = [
  { to: "/", label: "Dashboard", end: true, permission: "analytics:read" },
  { to: "/analytics", label: "Analytics", permission: "analytics:read" },
  { to: "/files", label: "Files", permission: "files:read" },
  { to: "/processing", label: "Processing", permission: "processing:read" },
  { to: "/results", label: "Results", permission: "results:read" },
  { to: "/profile", label: "Profile" },
  { to: "/administration", label: "Administration", permission: "users:read" },
];

export function AppShell() {
  const { user, signOut, can } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  const items = NAV.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col bg-lab-900 text-lab-100 md:flex">
        <div className="px-5 py-5">
          <div className="text-lg font-semibold tracking-wide text-white">LISA</div>
          <div className="text-xs text-lab-200">
            Laboratory Information System Analysis
          </div>
        </div>
        <nav className="flex-1 px-3 py-2">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) =>
                `block rounded px-3 py-2 text-sm ${
                  isActive ? "bg-lab-700 text-white" : "text-lab-200 hover:bg-lab-700/50"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 text-xs text-lab-200">v0.1.0 · Phase 2</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-lab-200 bg-white px-6">
          <div className="text-sm font-medium text-lab-700">Laboratory Data Processing</div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-700">
              {user?.full_name}
              <span className="ml-2 rounded bg-lab-100 px-1.5 py-0.5 text-xs text-lab-700">
                {user?.role.name}
              </span>
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded border border-lab-200 px-2.5 py-1 text-sm text-lab-700 hover:bg-lab-50"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
