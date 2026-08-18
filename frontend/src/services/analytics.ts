import { api } from "@/services/client";
import type {
  Analytics,
  AnalyticsCreate,
  AnalyticsListItem,
  Configuration,
  ConfigurationPayload,
  ConfigurationUpdateResult,
  ConfigurationVersionSummary,
  Page,
  RuleDefinition,
} from "@/types/api";

export const analyticsApi = {
  list: () => api.get<Page<AnalyticsListItem>>("/analytics"),

  get: (id: string) => api.get<Analytics>(`/analytics/${id}`),

  create: (payload: AnalyticsCreate) => api.post<Analytics>("/analytics", payload),

  update: (id: string, payload: Partial<AnalyticsCreate> & { is_active?: boolean }) =>
    api.put<Analytics>(`/analytics/${id}`, payload),

  configuration: (id: string) => api.get<Configuration>(`/analytics/${id}/configuration`),

  saveConfiguration: (id: string, payload: ConfigurationPayload, changeNote: string | null) =>
    api.post<ConfigurationUpdateResult>(`/analytics/${id}/configuration`, {
      payload,
      change_note: changeNote,
    }),

  versions: (id: string) =>
    api.get<ConfigurationVersionSummary[]>(`/analytics/${id}/configuration/versions`),

  version: (id: string, version: number) =>
    api.get<Configuration>(`/analytics/${id}/configuration/versions/${version}`),

  /** The rule catalogue: every threshold the UI can show or edit comes from here. */
  ruleDefinitions: () => api.get<RuleDefinition[]>("/rule-definitions"),
};
