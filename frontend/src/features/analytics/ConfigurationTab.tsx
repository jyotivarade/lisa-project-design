import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { StatusBadge } from "@/components/StatusBadge";
import { ParameterField } from "@/features/analytics/ParameterField";
import { usePermission } from "@/features/auth/useAuth";
import { analyticsApi } from "@/services/analytics";
import { ApiError } from "@/services/client";
import type { ConfigurationPayload, RuleDefinition } from "@/types/api";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function ConfigurationTab({ analyticsId }: { analyticsId: string }) {
  const queryClient = useQueryClient();
  const canWrite = usePermission("configuration:write");

  const configuration = useQuery({
    queryKey: ["analytics", analyticsId, "configuration"],
    queryFn: () => analyticsApi.configuration(analyticsId),
  });
  const catalogue = useQuery({
    queryKey: ["rule-definitions"],
    queryFn: analyticsApi.ruleDefinitions,
  });

  const [draft, setDraft] = useState<ConfigurationPayload | null>(null);
  const [changeNote, setChangeNote] = useState("");

  useEffect(() => {
    if (configuration.data) setDraft(clone(configuration.data.payload));
  }, [configuration.data]);

  const save = useMutation({
    mutationFn: () => analyticsApi.saveConfiguration(analyticsId, draft!, changeNote || null),
    onSuccess: async () => {
      setChangeNote("");
      await queryClient.invalidateQueries({ queryKey: ["analytics", analyticsId] });
    },
  });

  if (configuration.isPending || catalogue.isPending) {
    return <p className="text-sm text-slate-500">Loading configuration…</p>;
  }
  if (configuration.isError || catalogue.isError || !draft) {
    return <p className="text-sm text-red-800">Could not load the configuration.</p>;
  }

  const definitions = new Map(catalogue.data.map((d: RuleDefinition) => [d.rule_key, d]));
  const dirty = JSON.stringify(draft) !== JSON.stringify(configuration.data.payload);
  const error = save.error instanceof ApiError ? save.error : null;

  function updateRule(ruleKey: string, update: (rule: ConfigurationPayload["rules"][number]) => void) {
    setDraft((current) => {
      if (!current) return current;
      const next = clone(current);
      const rule = next.rules.find((r) => r.rule_key === ruleKey);
      if (rule) update(rule);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-lab-900">
            Configuration · version {configuration.data.version}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-slate-600">
            Saving creates a new version. Runs already processed keep the configuration they
            used, so nothing you change here can alter a historical result.
          </p>
        </div>
        {dirty ? <StatusBadge status="WARNING" label="Unsaved changes" /> : null}
      </header>

      {/* --- calibration and controls --- */}
      <section className="rounded-lg border border-lab-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-lab-900">Calibration</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            <span className="block text-slate-700">Sample type</span>
            <input
              value={draft.calibration.sample_type}
              disabled={!canWrite}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  calibration: { ...draft.calibration, sample_type: e.target.value },
                })
              }
              className="mt-1 w-full rounded border border-lab-200 px-3 py-1.5 text-sm disabled:bg-slate-50"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="block text-slate-700">Required calibrators</span>
            <input
              value={draft.calibration.required_calibrators.join(", ")}
              disabled={!canWrite}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  calibration: {
                    ...draft.calibration,
                    required_calibrators: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              className="mt-1 w-full rounded border border-lab-200 px-3 py-1.5 font-mono text-sm disabled:bg-slate-50"
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-700">Minimum required</span>
            <input
              type="number"
              min={0}
              value={draft.calibration.minimum_required}
              disabled={!canWrite}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  calibration: {
                    ...draft.calibration,
                    minimum_required: Number(e.target.value),
                  },
                })
              }
              className="mt-1 w-full rounded border border-lab-200 px-3 py-1.5 text-sm disabled:bg-slate-50"
            />
          </label>
        </div>

        <h3 className="mt-6 text-sm font-semibold text-lab-900">Controls</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <label className="text-sm sm:col-span-2">
            <span className="block text-slate-700">Required controls</span>
            <input
              value={draft.controls.required_controls.join(", ")}
              disabled={!canWrite}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  controls: {
                    ...draft.controls,
                    required_controls: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              className="mt-1 w-full rounded border border-lab-200 px-3 py-1.5 font-mono text-sm disabled:bg-slate-50"
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-700">Minimum required</span>
            <input
              type="number"
              min={0}
              value={draft.controls.minimum_required}
              disabled={!canWrite}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  controls: { ...draft.controls, minimum_required: Number(e.target.value) },
                })
              }
              className="mt-1 w-full rounded border border-lab-200 px-3 py-1.5 text-sm disabled:bg-slate-50"
            />
          </label>
          <label className="text-sm sm:col-span-3">
            <span className="block text-slate-700">
              Discovered but not required (listed, never gates a run)
            </span>
            <input
              value={draft.controls.discovered_optional.join(", ")}
              disabled={!canWrite}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  controls: {
                    ...draft.controls,
                    discovered_optional: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              className="mt-1 w-full rounded border border-lab-200 px-3 py-1.5 font-mono text-sm disabled:bg-slate-50"
            />
          </label>
        </div>
      </section>

      {/* --- rules, rendered entirely from the catalogue --- */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-lab-900">Criteria rules</h3>
        {[...draft.rules]
          .sort((a, b) => a.priority - b.priority)
          .map((rule) => {
            const definition = definitions.get(rule.rule_key);
            if (!definition) return null;
            return (
              <article
                key={rule.rule_key}
                className="rounded-lg border border-lab-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-lab-900">
                      {definition.name}
                      <span className="ml-2 rounded bg-lab-100 px-1.5 py-0.5 text-xs font-normal text-lab-700">
                        {definition.stream}
                      </span>
                    </h4>
                    <p className="mt-1 max-w-prose text-sm text-slate-600">
                      {definition.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={!canWrite}
                        onChange={(e) =>
                          updateRule(rule.rule_key, (r) => {
                            r.enabled = e.target.checked;
                          })
                        }
                      />
                      Enabled
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={rule.mandatory}
                        disabled={!canWrite}
                        onChange={(e) =>
                          updateRule(rule.rule_key, (r) => {
                            r.mandatory = e.target.checked;
                          })
                        }
                      />
                      Mandatory
                    </label>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(definition.parameter_schema).map(([name, spec]) => (
                    <ParameterField
                      key={name}
                      name={`${rule.rule_key}-${name}`}
                      spec={spec}
                      value={rule.parameters[name]}
                      disabled={!canWrite || !rule.enabled}
                      onChange={(value) =>
                        updateRule(rule.rule_key, (r) => {
                          r.parameters[name] = value;
                        })
                      }
                    />
                  ))}
                </div>
              </article>
            );
          })}
      </section>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">{error.message}</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-red-800">
            {error.details.map((detail, index) => (
              <li key={index}>
                <code>{String(detail["field"] ?? "")}</code> — {String(detail["issue"] ?? "")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {save.isSuccess && !dirty ? (
        <p className="text-sm text-green-800">
          Saved as version {save.data.version}. {save.data.affected_sessions} existing runs were
          affected.
        </p>
      ) : null}

      {canWrite ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            aria-label="Change note"
            placeholder="Why is this changing?"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            className="min-w-64 flex-1 rounded border border-lab-200 px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
            className="rounded bg-lab-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-lab-700 disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save as new version"}
          </button>
          {dirty ? (
            <button
              type="button"
              onClick={() => setDraft(clone(configuration.data.payload))}
              className="rounded border border-lab-200 px-3 py-1.5 text-sm text-lab-700"
            >
              Discard changes
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Your role can view this configuration but not change it.
        </p>
      )}
    </div>
  );
}
