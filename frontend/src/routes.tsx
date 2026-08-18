import { createBrowserRouter } from "react-router-dom";

import { UsersPage } from "@/features/administration/UsersPage";
import { AnalyticsDetailPage } from "@/features/analytics/AnalyticsDetailPage";
import { AnalyticsListPage } from "@/features/analytics/AnalyticsListPage";
import { FileDetailPage } from "@/features/files/FileDetailPage";
import { FilesPage } from "@/features/files/FilesPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { AppShell } from "@/layouts/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";

/** Routes per docs/04-FRONTEND.md. Each becomes a real screen in its own phase. */
export const router = createBrowserRouter(
  [
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "analytics", element: <AnalyticsListPage /> },
      { path: "analytics/:analyticsId", element: <AnalyticsDetailPage /> },
      { path: "files", element: <FilesPage /> },
      { path: "files/:fileId", element: <FileDetailPage /> },
      {
        path: "processing",
        element: (
          <PlaceholderPage
            title="Processing"
            phase="Phase 6"
            description="Calibration and control review, the readiness gate, and patient processing."
          />
        ),
      },
      {
        path: "results",
        element: (
          <PlaceholderPage
            title="Results"
            phase="Phase 7"
            description="Patient results with the full per-rule evaluation behind every verdict."
          />
        ),
      },
      { path: "profile", element: <ProfilePage /> },
      {
        path: "administration",
        element: (
          <ProtectedRoute permission="users:read">
            <UsersPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
  ],
  // Opt in early to the v7 behaviour so the upgrade is not a surprise later.
  { future: { v7_relativeSplatPath: true } },
);
