import type Anthropic from "@anthropic-ai/sdk";

/**
 * The Rig's Managed Agents environment — the container workspace every
 * session provisions (`sessions.create`'s `environment_id`), created once by
 * `scripts/setup-agent.ts` alongside the agent itself. Its config lives here
 * as a pure function for the same reason agentConfig.ts's does: no network
 * calls, so the shape sent to `environments.create` / `environments.update`
 * has real Vitest coverage without an API key.
 */

export const ENVIRONMENT_NAME = "The Rig";

/**
 * No network access: the agent's toolset (see agentConfig.ts's
 * buildToolset()) has no bash/read/write/edit/glob/grep enabled yet, so
 * nothing running in this container needs to reach anywhere. Locked down by
 * default rather than left unrestricted, same disabled-by-default posture
 * as the toolset — widen it when a later ticket's custom tools actually
 * need container egress.
 */
export function buildEnvironmentConfig(): Anthropic.Beta.Environments.EnvironmentCreateParams {
  return {
    name: ENVIRONMENT_NAME,
    description: "Container workspace for the Rig's Managed Agents sessions.",
    config: {
      type: "cloud",
      networking: {
        type: "limited",
        allow_mcp_servers: false,
        allow_package_managers: false,
        allowed_hosts: [],
      },
      packages: { apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] },
    },
  };
}
