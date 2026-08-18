import "dotenv/config";
import { createStandaloneDb } from "../scripts/lib/db";

const db = createStandaloneDb();

// A fixed id, not a fresh cuid every run: this makes the seed idempotent —
// re-running it (a second `prisma db seed`, a reset dev.db) upserts the
// same row rather than accumulating users.
const LOCAL_USER_ID = "local-user";

// Just needs to be a real-looking address you can sign in with locally via
// the magic-link flow (app/routes/auth.login.tsx) — override with your own
// inbox if you want the dev-fallback link (app/email.server.ts, printed to
// the console when RESEND_API_KEY is unset) addressed to you specifically.
const LOCAL_USER_EMAIL = process.env.DEV_USER_EMAIL ?? "dev@localhost";

async function main() {
  const user = await db.user.upsert({
    where: { id: LOCAL_USER_ID },
    update: {},
    create: { id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL },
  });
  console.log(`Seeded user ${user.id} <${user.email}>`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
