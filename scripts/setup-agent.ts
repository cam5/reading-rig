import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { ensureRigProvisioning } from "../app/rig/rigProvisioning";
import { createStandaloneDb } from "./lib/db";

// Converges the Rig's Managed Agent + Environment onto app/rig/agentConfig.ts
// / environmentConfig.ts's current output, creating both the first time this
// runs. Never called in the request path — see the build plan's "One agent,
// created once" invariant. `scripts/release.ts` also runs this on every
// deploy (when ANTHROPIC_API_KEY is set for that environment), so a merged
// config change converges automatically without a manual re-run.
//
// The ids/version themselves live in the RigProvisioning DB table now, not
// .env — see that model's doc comment in prisma/schema.prisma for why: a
// release container's .env write never reached Railway's persisted
// Variables, which is what caused #113. All the actual create/update/
// recover logic lives in app/rig/rigProvisioning.ts (`ensureRigProvisioning`)
// so it's shared with the request-time self-heal path in
// app/rig/anthropicSessionClient.ts, not duplicated here.
//
// `buildAgentConfig()`/`agentMatchesConfig()` and
// `buildEnvironmentConfig()`/`environmentMatchesConfig()` — the parts that
// actually encode the scope of this ticket — have real Vitest coverage in
// app/rig/agentConfig.test.ts, app/rig/agentConvergence.test.ts,
// app/rig/environmentConfig.test.ts, app/rig/environmentConvergence.test.ts,
// and app/rig/rigProvisioning.test.ts. The `agents.*`/`environments.*` calls
// themselves are checked only against the installed SDK's types — this
// script (and release.ts, which calls it on every deploy) is the only thing
// that ever runs them for real.

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example), then re-run `npm run agent:setup`.",
    );
    process.exitCode = 1;
    return;
  }

  const client = new Anthropic();
  const db = createStandaloneDb();

  try {
    const { agentId, agentVersion, environmentId } = await ensureRigProvisioning(client, db);
    console.log(`Agent ready: ${agentId} (version ${agentVersion})`);
    console.log(`Environment ready: ${environmentId}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
