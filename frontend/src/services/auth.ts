import { api, request } from "@/services/client";
import type { TokenResponse, User } from "@/types/api";

export const authApi = {
  login: (email: string, password: string) =>
    // No retry: a 401 here means the credentials are wrong, and attempting a
    // refresh would only muddy the error the user needs to see.
    api.post<TokenResponse>("/auth/login", { email, password }, { retryOnUnauthorised: false }),

  /** Restore a session from the HttpOnly refresh cookie on page load. */
  restore: () =>
    request<TokenResponse>(
      "/auth/refresh",
      { method: "POST" },
      { retryOnUnauthorised: false },
    ),

  logout: () => api.post<void>("/auth/logout"),

  me: () => api.get<User>("/auth/me"),

  updateProfile: (fullName: string) => api.patch<User>("/auth/me", { full_name: fullName }),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<void>("/auth/change-password", {
      current_password: currentPassword,
      new_password: newPassword,
    }),
};
