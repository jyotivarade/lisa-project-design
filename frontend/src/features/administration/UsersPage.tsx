import { useQuery } from "@tanstack/react-query";

import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/services/client";
import type { Page, RoleDetail, User } from "@/types/api";

export function UsersPage() {
  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<Page<User>>("/admin/users"),
  });
  const roles = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => api.get<RoleDetail[]>("/admin/roles"),
  });

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-lab-900">Administration</h1>
        <p className="mt-1 text-sm text-slate-600">Users, roles and their permissions.</p>
      </header>

      <div className="rounded-lg border border-lab-200 bg-white">
        <h2 className="border-b border-lab-200 px-5 py-3 text-sm font-semibold text-lab-900">
          Users
        </h2>
        {users.isPending ? (
          <p className="p-5 text-sm text-slate-500">Loading…</p>
        ) : users.isError ? (
          <p className="p-5 text-sm text-red-800">Could not load users.</p>
        ) : users.data.items.length === 0 ? (
          <EmptyState title="No users" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-lab-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-5 py-2 font-medium">Email</th>
                <th className="px-5 py-2 font-medium">Name</th>
                <th className="px-5 py-2 font-medium">Role</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {users.data.items.map((user) => (
                <tr key={user.id} className="border-t border-lab-100">
                  <td className="px-5 py-2 font-medium">{user.email}</td>
                  <td className="px-5 py-2">{user.full_name}</td>
                  <td className="px-5 py-2">{user.role.name}</td>
                  <td className="px-5 py-2">
                    <StatusBadge
                      status={user.is_active ? "PASS" : "BLOCKED"}
                      label={user.is_active ? "Active" : "Deactivated"}
                    />
                  </td>
                  <td className="px-5 py-2 text-slate-600">
                    {user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border border-lab-200 bg-white">
        <h2 className="border-b border-lab-200 px-5 py-3 text-sm font-semibold text-lab-900">
          Roles
        </h2>
        {roles.data ? (
          <ul className="divide-y divide-lab-100">
            {roles.data.map((role) => (
              <li key={role.id} className="px-5 py-3">
                <div className="text-sm font-medium text-lab-900">{role.name}</div>
                <p className="text-sm text-slate-600">{role.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {role.permissions.map((permission) => (
                    <code
                      key={permission}
                      className="rounded bg-lab-100 px-1.5 py-0.5 text-xs text-lab-700"
                    >
                      {permission}
                    </code>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-5 text-sm text-slate-500">Loading…</p>
        )}
      </div>
    </section>
  );
}
