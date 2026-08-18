import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, getAccessToken, setAccessToken, setSessionLostHandler } from "@/services/client";

function ok(body: unknown, status = 200): Response {
  return { ok: true, status, statusText: "", json: async () => body } as Response;
}
function fail(status: number, body: unknown): Response {
  return { ok: false, status, statusText: "", json: async () => body } as Response;
}

const unauthorised = {
  error_code: "NOT_AUTHENTICATED",
  message: "Authentication is required.",
  details: [],
};

beforeEach(() => setAccessToken(null));
afterEach(() => {
  vi.unstubAllGlobals();
  setSessionLostHandler(null);
});

describe("api client", () => {
  it("returns the parsed body on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ status: "ok" })));
    await expect(api.get("/health/live")).resolves.toEqual({ status: "ok" });
  });

  it("turns the error envelope into a typed ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fail(409, {
          error_code: "CONTROL_FAILED",
          message: "Patient processing is blocked: control validation failed.",
          details: [{ control_id: "WCS2", percent_diff: 73.9 }],
          request_id: "req-1",
        }),
      ),
    );
    await expect(api.post("/processing/x/process")).rejects.toMatchObject({
      errorCode: "CONTROL_FAILED",
      status: 409,
      requestId: "req-1",
    });
  });

  it("marks a 409 as a gate block so screens can explain it rather than retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fail(409, {
          error_code: "CALIBRATION_NOT_REVIEWED",
          message: "Calibration has not been validated since the last change.",
          details: [],
        }),
      ),
    );
    const error = await api.post("/processing/x/process").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isGateBlocked).toBe(true);
  });

  it("survives a non-JSON error body from a proxy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: async () => {
          throw new Error("not json");
        },
      })),
    );
    const error = (await api.get("/anything").catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(502);
    expect(error.errorCode).toBe("INTERNAL_ERROR");
  });

  it("attaches the access token when one is held", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ok({}));
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("token-abc");

    await api.get("/auth/me");

    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer token-abc");
  });

  it("sends no Authorization header when signed out", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ok({}));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/health/live");

    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("refreshes once on 401 and replays the original request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fail(401, unauthorised))
      .mockResolvedValueOnce(ok({ access_token: "fresh", user: {} }))
      .mockResolvedValueOnce(ok({ email: "analyst@lisa.local" }));
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("stale");

    await expect(api.get("/auth/me")).resolves.toEqual({ email: "analyst@lisa.local" });
    expect(getAccessToken()).toBe("fresh");
    expect(fetchMock.mock.calls[1]![0]).toContain("/auth/refresh");
  });

  it("shares a single refresh across concurrent 401s", async () => {
    // With rotation-on-use, parallel refreshes would replay a spent token and the
    // server would correctly destroy the whole family.
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/auth/refresh")) return ok({ access_token: "fresh", user: {} });
      return getAccessToken() === "fresh" ? ok({ ok: true }) : fail(401, unauthorised);
    });
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("stale");

    await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/auth/refresh"),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it("clears the token and reports a lost session when refresh fails", async () => {
    const onLost = vi.fn();
    setSessionLostHandler(onLost);
    vi.stubGlobal("fetch", vi.fn(async () => fail(401, unauthorised)));
    setAccessToken("stale");

    await expect(api.get("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(getAccessToken()).toBeNull();
    expect(onLost).toHaveBeenCalledOnce();
  });

  it("does not attempt a refresh when the caller opts out", async () => {
    // A 401 from login means the credentials are wrong; refreshing would only
    // obscure the message the user needs.
    const fetchMock = vi.fn(async () => fail(401, { ...unauthorised, error_code: "INVALID_CREDENTIALS" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api.post("/auth/login", { email: "a@b.co", password: "x" }, { retryOnUnauthorised: false }),
    ).rejects.toMatchObject({ errorCode: "INVALID_CREDENTIALS" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
