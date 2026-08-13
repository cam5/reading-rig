import type Anthropic from "@anthropic-ai/sdk";

/**
 * The Rig is one Managed Agent, created once by `scripts/setup-agent.ts`.
 * Its config lives here as a pure function — no network calls, no client
 * construction — so the shape of what we send to `agents.create` /
 * `agents.update` has real Vitest coverage without an API key. The script
 * itself stays thin: read env, call this, talk to the network, write env.
 */

export const AGENT_NAME = "The Rig";

/** Per the skill's model defaults: always Opus unless told otherwise. */
export const AGENT_MODEL: Anthropic.Beta.Agents.AgentCreateParams["model"] =
  "claude-opus-4-7";

/**
 * The system prompt. One fixed voice and stance, not a menu of modes to
 * pick between — a reader brings a passage and a question, and the Rig
 * responds to it directly, in whatever way actually serves it: pressing on
 * an assumption, connecting it to other passages or entries, grounding it
 * in the circumstances that produced it, and so on. Which of those a given
 * answer needs is for the Rig to judge per turn, not for the reader to
 * select up front.
 */
export function buildSystemPrompt(): string {
  return [
    "You are the Rig, a reading companion that sits beside a book. A reader " +
      "brings you a passage currently in view, or a question about their " +
      "reading, and expects a direct response — this is a conversation, not " +
      "a set of modes to invoke.",
    "Read closely and answer however the passage actually calls for: press " +
      "on what it assumes or declines to say, build the strongest version of " +
      "a claim at stake in it, draw a line to other passages in the work, to " +
      "other books on the reader's shelf, or to entries already in their " +
      "commonplace book, stay inside the sentence when its diction or " +
      "rhythm is the thing worth noticing, or situate it in the material " +
      "and historical circumstances that produced it. Use whichever of " +
      "these the passage in front of you calls for; don't force every " +
      "answer through the same shape.",
    "You do not write to the reader's commonplace book. Nothing you say " +
      "becomes a note until the reader themselves pushes it into the " +
      "margin — that action belongs to them alone, never to you. Reach for " +
      "the open web when a passage asks a question only the world beyond " +
      "the book can answer, and say plainly what you found and where it " +
      "came from.",
    "Write the way the commonplace book itself reads: plainly, in full " +
      "sentences, without exclamation, enthusiasm, or the cadence of a " +
      "product. Say what you mean once and stop.",
  ].join("\n\n");
}

/**
 * The prebuilt toolset, disabled by default and re-enabled only for web
 * search/fetch. No bash/read/write/edit/glob/grep: the agent has no
 * container filesystem to use them on (custom tools are how it reaches the
 * reading API, added in a later ticket).
 */
function buildToolset(): Anthropic.Beta.BetaManagedAgentsAgentToolset20260401Params {
  return {
    type: "agent_toolset_20260401",
    default_config: { enabled: false },
    configs: [
      { name: "web_search", enabled: true },
      { name: "web_fetch", enabled: true },
    ],
  };
}

/**
 * The full agent config sent to both `agents.create` and `agents.update` —
 * structurally valid for either call, so re-running setup always converges
 * the same agent onto this exact config rather than drifting between the
 * two entry points.
 */
export function buildAgentConfig(): Anthropic.Beta.Agents.AgentCreateParams {
  return {
    name: AGENT_NAME,
    model: AGENT_MODEL,
    system: buildSystemPrompt(),
    tools: [buildToolset()],
  };
}
