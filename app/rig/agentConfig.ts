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
    "When a passage turns on a word, image, or motif that might recur " +
      "elsewhere in the book, use search_shelf to check rather than assume " +
      "— call it on your own, without waiting to be asked, whenever " +
      "confirming a recurrence would ground your answer in the text " +
      "itself rather than in a guess. A search only reaches as far as the " +
      "reader's bookmark, so no results is never proof a motif doesn't " +
      "appear in the book at all — it only means it hasn't shown up yet " +
      "in what they've read.",
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
 * container filesystem to use them on — `buildSearchShelfTool` below is how
 * it reaches the reading API instead.
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
 * The first of #25's reading-API handlers wired up as a custom tool — see
 * dispatchTool.ts's `search_shelf` case, which already has a live branch
 * for this name and has had nothing to call it since #25 closed. `query`
 * is the only field: `userId`/`workId` are resolved by dispatchTool.ts from
 * the session's own `RigSession`, never accepted from the model, so they
 * have no business being in the schema the model fills in.
 */
function buildSearchShelfTool(): Anthropic.Beta.Agents.BetaManagedAgentsCustomToolParams {
  return {
    type: "custom",
    name: "search_shelf",
    description:
      "Search the full text of the book currently being read for a word, " +
      "phrase, or motif. Bounded by the reader's own bookmark — a match " +
      "past where they've read is never returned, so an empty result " +
      "means 'not yet, as far as you've read,' not 'never in this book.' " +
      "Returns matching passages with a locator (e.g. '§4 ¶3') the reader " +
      "can be pointed to. Call this on your own initiative whenever " +
      "checking for a recurrence would ground an answer, not only when " +
      "asked to search.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The word or phrase to search for.",
        },
      },
      required: ["query"],
    },
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
    tools: [buildToolset(), buildSearchShelfTool()],
  };
}
