import { randomBytes, createHash } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import { db } from "../db.server";

// A prefix, not just an opaque hex string — makes a token recognizable at
// a glance (in a log line, a leaked commit, a support screenshot) the same
// way GitHub's ghp_ or Stripe's sk_live_ are, without needing to look it
// up to know what kind of secret you're looking at.
const TOKEN_PREFIX = "rig_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Same reasoning as magicLink.server.ts's generateToken: only the hash is
// ever persisted (see ApiToken.tokenHash's schema.prisma comment), so a
// leaked database dump can't be replayed as a working credential.
function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export type ApiTokenSummary = {
  id: string;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

// `db` is a parameter on these three (not the module-level singleton) so
// scripts/apiToken.ts — a one-off CLI process, not a request in this app's
// own lifecycle — can pass its own createStandaloneDb() client, the same
// reasoning fetchShelf.server.ts and friends already take `db` rather than
// importing it. resolveBearerToken is the exception: every call to it is
// already inside this app's own request lifecycle (requireApiUserId), so
// it uses the singleton directly, matching getUserId right above it in
// session.server.ts.

/**
 * Mints a new bearer credential for `userId` and returns the raw token —
 * the one and only time it's ever available in full; only its hash is
 * stored. `label` is a human note ("laptop", "iOS TestFlight build") shown
 * back by listApiTokens, never used to look the token up.
 */
export async function createApiToken(
  db: Pick<PrismaClient, "apiToken">,
  userId: string,
  label?: string,
): Promise<{ id: string; token: string }> {
  const token = generateToken();
  const created = await db.apiToken.create({
    data: { userId, tokenHash: hashToken(token), label },
  });
  return { id: created.id, token };
}

/**
 * Resolves an `Authorization: Bearer <token>` header to a userId, or null
 * if the header is missing, malformed, doesn't match a live token, or
 * names one that's been revoked. Touches lastUsedAt on success (fire-and-
 * forget — a stale lastUsedAt on a failed write isn't worth failing the
 * request over) so a token list can show which credentials are actually
 * in use versus dormant.
 */
export async function resolveBearerToken(
  request: Request,
): Promise<string | null> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const record = await db.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record || record.revokedAt) return null;

  db.apiToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch((error: unknown) => {
      console.error("apiToken: failed to record lastUsedAt", error);
    });

  return record.userId;
}

export async function listApiTokens(
  db: Pick<PrismaClient, "apiToken">,
  userId: string,
): Promise<ApiTokenSummary[]> {
  return db.apiToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
}

// Idempotent and scoped to `userId` — revoking a token id that doesn't
// exist or belongs to someone else is a silent no-op rather than a 404/403
// a CLI script would need to handle specially; the caller can always
// re-list to confirm.
export async function revokeApiToken(
  db: Pick<PrismaClient, "apiToken">,
  userId: string,
  tokenId: string,
): Promise<void> {
  await db.apiToken.updateMany({
    where: { id: tokenId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
