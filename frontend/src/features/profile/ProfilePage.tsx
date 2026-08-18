import { type FormEvent, useState } from "react";

import { useAuth } from "@/features/auth/useAuth";
import { authApi } from "@/services/auth";
import { ApiError } from "@/services/client";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

export function ProfilePage() {
  const { user, setUser, signOut } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  if (!user) return null;

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setProfileError(null);
    setProfileMessage(null);
    try {
      setUser(await authApi.updateProfile(fullName));
      setProfileMessage("Profile updated.");
    } catch (caught) {
      setProfileError(caught instanceof ApiError ? caught.message : "Could not save.");
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordErrors([]);
    if (newPassword !== confirmPassword) {
      setPasswordErrors(["The new passwords do not match."]);
      return;
    }
    try {
      await authApi.changePassword(currentPassword, newPassword);
      // The server revoked every session, this one included — signing out is the
      // honest outcome rather than leaving a shell whose next request will 401.
      await signOut();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const detail = caught.details
          .map((d) => String(d["issue"] ?? ""))
          .filter(Boolean);
        setPasswordErrors(detail.length ? detail : [caught.message]);
      } else {
        setPasswordErrors(["Could not change the password."]);
      }
    }
  }

  return (
    <section className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-lab-900">Profile</h1>
      </header>

      <div className="rounded-lg border border-lab-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-lab-900">Account</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Email</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Role</dt>
            <dd className="font-medium">{user.role.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Last sign-in</dt>
            <dd className="font-medium">{formatDate(user.last_login_at)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Permissions</dt>
            <dd className="font-medium">{user.permissions.length}</dd>
          </div>
        </dl>
      </div>

      <form onSubmit={saveProfile} className="rounded-lg border border-lab-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-lab-900">Your details</h2>
        <label htmlFor="full_name" className="mt-3 block text-sm text-slate-600">
          Full name
        </label>
        <input
          id="full_name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          className="mt-1 w-full rounded border border-lab-200 px-3 py-2 text-sm"
        />
        {profileError ? <p role="alert" className="mt-2 text-sm text-red-800">{profileError}</p> : null}
        {profileMessage ? <p className="mt-2 text-sm text-green-800">{profileMessage}</p> : null}
        <button
          type="submit"
          className="mt-3 rounded bg-lab-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-lab-700"
        >
          Save
        </button>
      </form>

      <form onSubmit={changePassword} className="rounded-lg border border-lab-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-lab-900">Change password</h2>
        <p className="mt-1 text-sm text-slate-600">
          Changing your password signs you out everywhere, including here.
        </p>

        {[
          { id: "current_password", label: "Current password", value: currentPassword, set: setCurrentPassword, autoComplete: "current-password" },
          { id: "new_password", label: "New password", value: newPassword, set: setNewPassword, autoComplete: "new-password" },
          { id: "confirm_password", label: "Confirm new password", value: confirmPassword, set: setConfirmPassword, autoComplete: "new-password" },
        ].map((field) => (
          <div key={field.id} className="mt-3">
            <label htmlFor={field.id} className="block text-sm text-slate-600">
              {field.label}
            </label>
            <input
              id={field.id}
              type="password"
              autoComplete={field.autoComplete}
              required
              value={field.value}
              onChange={(e) => field.set(e.target.value)}
              className="mt-1 w-full rounded border border-lab-200 px-3 py-2 text-sm"
            />
          </div>
        ))}

        {passwordErrors.length ? (
          <ul role="alert" className="mt-3 list-disc rounded border border-red-200 bg-red-50 p-3 pl-8 text-sm text-red-800">
            {passwordErrors.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}

        <button
          type="submit"
          className="mt-3 rounded bg-lab-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-lab-700"
        >
          Change password
        </button>
      </form>
    </section>
  );
}
