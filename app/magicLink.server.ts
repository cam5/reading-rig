import { randomBytes, createHash } from "node:crypto";
import { db } from "./db.server";

const TOKEN_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// The value that goes in the emailed URL. Only its hash (see hashToken)
// is ever written to MagicLinkToken — a leaked database dump can't be
// replayed as a working link, same reasoning as hashing a password.
function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// Emails are stored/looked-up lowercased so "Cam@x.com" and "cam@x.com"
// don't create two accounts or fail to match an existing one.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createMagicLinkToken(email: string): Promise<string> {
  const token = generateToken();
  await db.magicLinkToken.create({
    data: {
      email: normalizeEmail(email),
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  return token;
}

type ConsumeResult =
  { email: string } | { error: "invalid" | "expired" | "used" };

// Single-use: consumedAt is set the moment a token is accepted, so a link
// opened twice (a forwarded email, a mail client's link-prefetch scanner)
// only ever grants a session once. Expiry and used-ness are reported
// separately so app/routes/auth.verify.tsx can show a specific reason
// rather than one generic "bad link" message.
export async function consumeMagicLinkToken(
  token: string,
): Promise<ConsumeResult> {
  const record = await db.magicLinkToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record) return { error: "invalid" };
  if (record.consumedAt) return { error: "used" };
  if (record.expiresAt < new Date()) return { error: "expired" };

  await db.magicLinkToken.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });
  return { email: record.email };
}
