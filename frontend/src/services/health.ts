import { api } from "@/services/client";
import type { HealthReady } from "@/types/api";

export const healthApi = {
  ready: () => api.get<HealthReady>("/health/ready"),
};
