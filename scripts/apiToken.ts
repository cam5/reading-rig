import "dotenv/config";
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "../app/auth/apiToken.server";
import { createStandaloneDb } from "./lib/db";

// Bearer credentials have no sign-in flow (see ApiToken's schema.prisma
// comment) — this is that flow's stand-in until one exists. Usage:
//   tsx scripts/apiToken.ts create <email> [label]
//   tsx scripts/apiToken.ts list <email>
//   tsx scripts/apiToken.ts revoke <email> <tokenId>

function usageError(reason?: string): never {
  if (reason) console.error(`${reason}\n`);
  console.error(
    "Usage:\n" +
      "  tsx scripts/apiToken.ts create <email> [label]\n" +
      "  tsx scripts/apiToken.ts list <email>\n" +
      "  tsx scripts/apiToken.ts revoke <email> <tokenId>",
  );
  process.exit(1);
}

const COMMANDS = ["create", "list", "revoke"];

async function main() {
  const [command, email, ...rest] = process.argv.slice(2);
  if (!command) usageError();
  if (!COMMANDS.includes(command)) {
    usageError(
      `Unknown command "${command}" — expected one of: ${COMMANDS.join(", ")}.`,
    );
  }
  if (!email) usageError(`\`${command}\` needs an <email>.`);

  const db = createStandaloneDb();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(
      `No user with email "${email}" in this database (DATABASE_URL=${process.env.DATABASE_URL}). ` +
        "They need to sign in once before a token can be created.",
    );
    process.exit(1);
  }

  switch (command) {
    case "create": {
      const { id, token } = await createApiToken(db, user.id, rest[0]);
      console.log(`Created token ${id}${rest[0] ? ` (${rest[0]})` : ""}.`);
      console.log(`This is the only time the token itself is shown:\n`);
      console.log(token);
      break;
    }
    case "list": {
      const tokens = await listApiTokens(db, user.id);
      if (tokens.length === 0) {
        console.log(`No tokens for ${email}.`);
        break;
      }
      for (const t of tokens) {
        const status = t.revokedAt
          ? `revoked ${t.revokedAt.toISOString()}`
          : t.lastUsedAt
            ? `last used ${t.lastUsedAt.toISOString()}`
            : "never used";
        console.log(
          `${t.id}  ${(t.label ?? "(no label)").padEnd(24)}  created ${t.createdAt.toISOString()}  ${status}`,
        );
      }
      break;
    }
    case "revoke": {
      const tokenId = rest[0];
      if (!tokenId) {
        usageError(
          `\`revoke\` needs a <tokenId> — run \`list ${email}\` to find it.`,
        );
      }
      await revokeApiToken(db, user.id, tokenId);
      console.log(
        `Revoked ${tokenId} (if it existed and belonged to ${email}).`,
      );
      break;
    }
    default:
      usageError();
  }

  await db.$disconnect();
}

main();
