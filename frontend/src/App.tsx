import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";

import { AuthProvider } from "@/features/auth/AuthContext";
import { router } from "@/routes";
import { ApiError } from "@/services/client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Laboratory data is authoritative on the server; a stale cached verdict is
      // worse than a refetch.
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Retrying an authentication or permission failure just repeats it, and
        // retrying a blocked processing gate would hammer a deliberate refusal.
        if (error instanceof ApiError && [401, 403, 409].includes(error.status)) {
          return false;
        }
        return failureCount < 1;
      },
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
