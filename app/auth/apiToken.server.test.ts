import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApiToken,
  resolveBearerToken,
  revokeApiToken,
} from "./apiToken.server";

// resolveBearerToken alone uses the module-level db singleton (see its own
// doc comment) — createApiToken/revokeApiToken take `db` as a parameter,
// so they're tested against a plain fake object instead of this mock.
vi.mock("../db.server", () => ({
  db: { apiToken: { findUnique: vi.fn(), update: vi.fn() } },
}));

describe("createApiToken", () => {
  it("returns a rig_-prefixed raw token, and stores a hash rather than the token itself", async () => {
    const create = vi.fn().mockResolvedValue({ id: "token-1" });
    const fakeDb = { apiToken: { create } };

    const { id, token } = await createApiToken(
      fakeDb as never,
      "user-1",
      "laptop",
    );

    expect(id).toBe("token-1");
    expect(token).toMatch(/^rig_[0-9a-f]{64}$/);
    const [[{ data }]] = create.mock.calls as [
      [{ data: { userId: string; tokenHash: string; label?: string } }],
    ];
    expect(data.userId).toBe("user-1");
    expect(data.label).toBe("laptop");
    expect(data.tokenHash).not.toBe(token);
  });
});

describe("resolveBearerToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when there's no Authorization header", async () => {
    const userId = await resolveBearerToken(new Request("http://localhost/"));
    expect(userId).toBeNull();
  });

  it("returns null for a non-Bearer Authorization header", async () => {
    const userId = await resolveBearerToken(
      new Request("http://localhost/", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      }),
    );
    expect(userId).toBeNull();
  });

  it("resolves a live token to its owning userId and records lastUsedAt", async () => {
    const { db } = await import("../db.server");
    vi.mocked(db.apiToken.findUnique).mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      revokedAt: null,
    } as never);
    vi.mocked(db.apiToken.update).mockResolvedValue({} as never);

    const userId = await resolveBearerToken(
      new Request("http://localhost/", {
        headers: { Authorization: "Bearer rig_whatever" },
      }),
    );

    expect(userId).toBe("user-1");
    expect(db.apiToken.update).toHaveBeenCalledWith({
      where: { id: "token-1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("returns null for a revoked token", async () => {
    const { db } = await import("../db.server");
    vi.mocked(db.apiToken.findUnique).mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      revokedAt: new Date(),
    } as never);

    const userId = await resolveBearerToken(
      new Request("http://localhost/", {
        headers: { Authorization: "Bearer rig_whatever" },
      }),
    );

    expect(userId).toBeNull();
  });

  it("returns null for a token that doesn't match any row", async () => {
    const { db } = await import("../db.server");
    vi.mocked(db.apiToken.findUnique).mockResolvedValue(null);

    const userId = await resolveBearerToken(
      new Request("http://localhost/", {
        headers: { Authorization: "Bearer rig_nope" },
      }),
    );

    expect(userId).toBeNull();
  });
});

describe("revokeApiToken", () => {
  it("scopes the update to the given userId and a not-yet-revoked token", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const fakeDb = { apiToken: { updateMany } };

    await revokeApiToken(fakeDb as never, "user-1", "token-1");

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "token-1", userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
