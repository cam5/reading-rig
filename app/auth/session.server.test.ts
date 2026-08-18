import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireApiUserId } from "./session.server";

// db.server.ts's singleton talks to a real SQLite file at import time —
// stubbed here rather than pointed at a real database, since this test
// only cares about requireApiUserId's own branching (cookie vs. dev
// fallback vs. 401), not anything Prisma actually returns.
vi.mock("../db.server", () => ({
  db: {
    user: { findFirst: vi.fn() },
    apiToken: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

describe("requireApiUserId", () => {
  // requiresRealAuth() (env.server.ts) reads this fresh on every call —
  // pinned to unset before each test and cleared after, so neither the
  // ambient environment nor a prior test's "production" leaks in.
  beforeEach(() => {
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    // Each test's own mock call counts, not the previous test's — matters
    // here specifically because one test asserts a mock was *not* called.
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
  });

  it("resolves the dev-fallback user for a cookie-less request when real auth isn't required", async () => {
    const { db } = await import("../db.server");
    vi.mocked(db.user.findFirst).mockResolvedValue({
      id: "seeded-user-id",
    } as never);

    const userId = await requireApiUserId(new Request("http://localhost/"));

    expect(userId).toBe("seeded-user-id");
  });

  it("resolves a valid Bearer token even when real auth is required, without touching the dev fallback", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    const { db } = await import("../db.server");
    vi.mocked(db.apiToken.findUnique).mockResolvedValue({
      id: "token-1",
      userId: "bearer-user-id",
      revokedAt: null,
    } as never);
    vi.mocked(db.apiToken.update).mockResolvedValue({} as never);

    const userId = await requireApiUserId(
      new Request("http://localhost/", {
        headers: { Authorization: "Bearer rig_whatever" },
      }),
    );

    expect(userId).toBe("bearer-user-id");
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it("throws a JSON 401 for a cookie-less request when real auth is required", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";

    // A JSON client has nowhere useful to follow requireUserId's login-page
    // redirect to — this is the whole reason requireApiUserId exists
    // rather than reusing requireUserId (see session.server.ts's comment).
    let thrown: unknown;
    try {
      await requireApiUserId(new Request("http://localhost/"));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
