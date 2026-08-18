import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfigurationTab } from "@/features/analytics/ConfigurationTab";
import { AuthContext, type AuthState } from "@/features/auth/AuthContext";
import type { Configuration, RuleDefinition, User } from "@/types/api";

const ANALYST: User = {
  id: "u-1",
  email: "analyst@lisa.local",
  full_name: "Ana Lyst",
  is_active: true,
  last_login_at: null,
  role: { id: "r-1", name: "ANALYST", description: null },
  permissions: ["configuration:read", "configuration:write"],
};

/** A rule the frontend has never heard of, described entirely by the server. */
const CATALOGUE: RuleDefinition[] = [
  {
    rule_key: "ion_ratio",
    name: "Ion Ratio",
    description: "Fails rows outside the calibrator-derived range.",
    stream: "PATIENT",
    default_enabled: true,
    default_mandatory: true,
    default_priority: 50,
    error_codes: ["ION_RATIO_OUT_OF_RANGE"],
    parameter_schema: {
      formula: {
        type: "choice",
        label: "Formula",
        help: "SPAN or MULTIPLICATIVE.",
        default: "SPAN",
        unit: null,
        minimum: null,
        maximum: null,
        choices: ["SPAN", "MULTIPLICATIVE"],
      },
      adjustment_percent: {
        type: "number",
        label: "Reference ratio adjustment",
        help: "Widens the calibrator range.",
        default: 10,
        unit: "%",
        minimum: 0,
        maximum: 100,
        choices: null,
      },
    },
  },
  {
    rule_key: "unheard_of_rule",
    name: "Freshly Invented Rule",
    description: "Added to the catalogue after this UI was written.",
    stream: "PATIENT",
    default_enabled: true,
    default_mandatory: false,
    default_priority: 80,
    error_codes: [],
    parameter_schema: {
      wobble_limit: {
        type: "number",
        label: "Wobble limit",
        help: "Nothing in the frontend knows what this means.",
        default: 3,
        unit: "mm",
        minimum: 1,
        maximum: 9,
        choices: null,
      },
      strict_mode: {
        type: "boolean",
        label: "Strict mode",
        help: "",
        default: false,
        unit: null,
        minimum: null,
        maximum: null,
        choices: null,
      },
    },
  },
];

function makeConfiguration(): Configuration {
  return {
    analytics_id: "a-1",
    version: 3,
    change_note: null,
    created_at: "2026-08-19T00:00:00Z",
    created_by_id: null,
    payload: {
      schema_version: 1,
      calibration: {
        enabled: true,
        sample_type: "Standard",
        required_calibrators: ["Cal_1", "Cal_2"],
        minimum_required: 2,
      },
      controls: {
        enabled: true,
        sample_type: "Control",
        required_controls: ["WCS1"],
        discovered_optional: ["UC"],
        minimum_required: 1,
      },
      value_tokens: { missing: ["----"], over_range: [], under_range: [] },
      classification: [],
      column_role_patterns: {},
      column_mappings: {},
      analyte_scope_policy: "STRICT",
      rules: [
        {
          rule_key: "ion_ratio",
          enabled: true,
          mandatory: true,
          priority: 50,
          parameters: { formula: "SPAN", adjustment_percent: 10 },
        },
        {
          rule_key: "unheard_of_rule",
          enabled: true,
          mandatory: false,
          priority: 80,
          parameters: { wobble_limit: 3, strict_mode: false },
        },
      ],
      corrections: {
        enabled: true,
        allowed_streams: ["CALIBRATOR", "CONTROL"],
        allowed_roles: [],
        reason_required: true,
      },
      output: { passed_includes_warnings: false, exception_includes_original_row: true },
      limits: { max_upload_bytes: 104857600 },
    },
  };
}

function renderTab(options: { permissions?: string[]; onSave?: (body: unknown) => unknown } = {}) {
  let configuration = makeConfiguration();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/rule-definitions")) {
      return { ok: true, status: 200, json: async () => CATALOGUE } as Response;
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const result = options.onSave?.(body) ?? { version: 4, diff: [], affected_sessions: 0 };
      if (result && typeof result === "object" && "__error" in result) {
        return {
          ok: false,
          status: 422,
          json: async () => (result as { __error: unknown }).__error,
        } as Response;
      }
      // The server now holds what was saved, so the refetch the component triggers
      // returns the new version — as it does in production.
      configuration = {
        ...configuration,
        version: (result as { version: number }).version,
        payload: body.payload,
      };
      return { ok: true, status: 201, json: async () => result } as Response;
    }
    return { ok: true, status: 200, json: async () => configuration } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);

  const auth = {
    user: { ...ANALYST, permissions: options.permissions ?? ANALYST.permissions },
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    setUser: vi.fn(),
    can: (permission: string) =>
      (options.permissions ?? ANALYST.permissions).includes(permission),
  } satisfies AuthState;

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <ConfigurationTab analyticsId="a-1" />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe("configuration is rendered from the server's catalogue", () => {
  it("renders a rule the frontend has never heard of", async () => {
    // The proof that no rule knowledge is baked into this codebase: adding a rule
    // to the catalogue is enough to make it configurable.
    renderTab();
    expect(await screen.findByText("Freshly Invented Rule")).toBeInTheDocument();
    expect(screen.getByLabelText(/Wobble limit/)).toBeInTheDocument();
    expect(screen.getByLabelText("Strict mode")).toBeInTheDocument();
  });

  it("takes the bounds and unit from the catalogue, not from code", async () => {
    renderTab();
    const field = await screen.findByLabelText(/Reference ratio adjustment/);
    expect(field).toHaveAttribute("min", "0");
    expect(field).toHaveAttribute("max", "100");
    expect(screen.getByText(/Allowed: 0 to 100/)).toBeInTheDocument();

    const wobble = screen.getByLabelText(/Wobble limit/);
    expect(wobble).toHaveAttribute("min", "1");
    expect(wobble).toHaveAttribute("max", "9");
  });

  it("renders choices from the catalogue rather than a hard-coded list", async () => {
    renderTab();
    const select = await screen.findByLabelText("Formula");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "SPAN",
      "MULTIPLICATIVE",
    ]);
  });

  it("shows the current values the server sent", async () => {
    renderTab();
    expect(await screen.findByLabelText(/Reference ratio adjustment/)).toHaveValue(10);
    expect(screen.getByText(/version 3/)).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("is disabled until something changes, then posts the edited payload", async () => {
    const user = userEvent.setup();
    let saved: unknown = null;
    renderTab({
      onSave: (body) => {
        saved = body;
        return { version: 4, diff: [], affected_sessions: 0 };
      },
    });

    const save = await screen.findByRole("button", { name: /Save as new version/ });
    expect(save).toBeDisabled();

    const field = screen.getByLabelText(/Reference ratio adjustment/);
    await user.clear(field);
    await user.type(field, "25");
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => expect(saved).not.toBeNull());
    const payload = (saved as { payload: { rules: Array<{ rule_key: string; parameters: Record<string, unknown> }> } }).payload;
    const ionRatio = payload.rules.find((r) => r.rule_key === "ion_ratio");
    expect(ionRatio?.parameters["adjustment_percent"]).toBe(25);
  });

  it("warns that there are unsaved changes", async () => {
    const user = userEvent.setup();
    renderTab();
    const field = await screen.findByLabelText(/Wobble limit/);
    await user.clear(field);
    await user.type(field, "5");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("shows the server's per-field validation detail", async () => {
    const user = userEvent.setup();
    renderTab({
      onSave: () => ({
        __error: {
          error_code: "INVALID_CONFIGURATION",
          message: "The configuration is not valid.",
          details: [
            {
              field: "rules.ion_ratio.parameters.adjustment_percent",
              issue: "Must be at most 100.",
            },
          ],
        },
      }),
    });

    const field = await screen.findByLabelText(/Reference ratio adjustment/);
    await user.clear(field);
    await user.type(field, "150");
    await user.click(screen.getByRole("button", { name: /Save as new version/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("rules.ion_ratio.parameters.adjustment_percent");
    expect(alert).toHaveTextContent("Must be at most 100.");
  });

  it("says that saving affects no existing run", async () => {
    const user = userEvent.setup();
    renderTab({ onSave: () => ({ version: 4, diff: [], affected_sessions: 0 }) });

    const field = await screen.findByLabelText(/Wobble limit/);
    await user.clear(field);
    await user.type(field, "4");
    await user.click(screen.getByRole("button", { name: /Save as new version/ }));

    expect(await screen.findByText(/0 existing runs were affected/)).toBeInTheDocument();
  });

  it("discards changes back to the server's values", async () => {
    const user = userEvent.setup();
    renderTab();
    const field = await screen.findByLabelText(/Reference ratio adjustment/);
    await user.clear(field);
    await user.type(field, "99");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText(/Reference ratio adjustment/)).toHaveValue(10);
  });
});

describe("permissions", () => {
  it("a read-only role sees values but cannot edit them", async () => {
    renderTab({ permissions: ["configuration:read"] });
    expect(await screen.findByLabelText(/Reference ratio adjustment/)).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Save as new version/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/view this configuration but not change it/)).toBeInTheDocument();
  });
});
