import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

// A fixed id, not a fresh cuid every run: this makes the seed idempotent —
// re-running it (a second `prisma db seed`, a reset dev.db) upserts the
// same row rather than accumulating users. requireUser() never sees or
// depends on this id; it just asks for the oldest row.
const LOCAL_USER_ID = "local-user";

async function main() {
  const user = await db.user.upsert({
    where: { id: LOCAL_USER_ID },
    update: {},
    create: { id: LOCAL_USER_ID },
  });
  console.log(`Seeded user ${user.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
