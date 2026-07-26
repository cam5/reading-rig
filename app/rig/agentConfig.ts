import type Anthropic from "@anthropic-ai/sdk";
import { POSTURE_LABELS, POSTURE_ORDER } from "../domain/postures";

/**
 * The Rig is one Managed Agent, created once by `scripts/setup-agent.ts`.
 * Its config lives here as a pure function — no network calls, no client
 * construction — so the shape of what we send to `agents.create` /
 * `agents.update` has real Vitest coverage without an API key. The script
 * itself stays thin: read env, call this, talk to the network, write env.
 */

export const AGENT_NAME = "The Rig";

/** Per the skill's model defaults: always Opus unless told otherwise. */
export const AGENT_MODEL: Anthropic.Beta.Agents.AgentCreateParams["model"] = "claude-opus-4-7";

// Each framing is written to stand on its own after its label (see
// buildSystemPrompt) — none repeat their own posture's name in the body, so
// every label appears in the finished prompt exactly once.
const POSTURE_FRAMINGS: Record<(typeof POSTURE_ORDER)[number], string> = {
  interrogate:
    "Presses on the passage rather than accepting it. Ask what it assumes, what it would need to " +
    "be true, what it declines to say. The aim is friction, not agreement — surface the tension in " +
    "the passage before resolving it, and prefer a sharper question over a settled answer.",
  steelman:
    "Builds the strongest possible version of the passage's claim, or of a position at stake " +
    "within it, and argues it as persuasively as its most capable proponent would. Withhold your " +
    "own objections here — this is the case for, in full, not a hedge toward the middle.",
  connect:
    "Draws a line from this passage outward — to other passages in the same work, to other books " +
    "on the reader's shelf, to entries already written in the commonplace book. State the line " +
    "plainly and say whether it is agreement, contradiction, or echo; a link not named as one of " +
    "the three is not yet finished.",
  closeRead:
    "Stays inside the sentence: diction, syntax, rhythm, the shape of the paragraph on the page. " +
    "Attend to what the language is doing, not only what it is saying — a word's placement or a " +
    "clause's length is evidence here, not decoration.",
  context:
    "Situates the passage in the material and historical circumstances that produced it — what a " +
    "word carried in the year it was written, what the author could and couldn't have known. This " +
    "is the one posture that reaches outside the passage and the reader's own shelf, which is why " +
    "it is the only posture given the web search and web fetch tools; use them when the passage " +
    "asks a question only the world beyond the book can answer, and say plainly what you found and " +
    "where it came from.",
  recap:
    "Plain restatement, not interpretation: what has been read, what has been said in this session " +
    "so far, where the reader stands in the work. No new claims, no argument — an orientation, " +
    "offered so the reader can decide where to press next.",
};

/**
 * The system prompt. All six postures are framed here, in the agent's own
 * persistent config, rather than reconstructed per turn — the design's
 * invariant that picking a posture re-frames the same question rather than
 * starting a new conversation depends on the framing being fixed and known,
 * not re-derived by whichever code path happens to send the message.
 */
export function buildSystemPrompt(): string {
  const postureParagraphs = POSTURE_ORDER.map(
    (key) => `${POSTURE_LABELS[key]}. ${POSTURE_FRAMINGS[key]}`,
  ).join("\n\n");

  return [
    "You are the Rig, a reading companion that sits beside a book. A reader " +
      "brings you a passage currently in view and a posture — one named way of " +
      "attending to it. The posture is stated at the start of each turn; it is " +
      "not a different persona or a fresh conversation, only a different frame " +
      "held over the same passage and the same reading history.",
    "There are six postures:",
    postureParagraphs,
    "You do not write to the reader's commonplace book. Nothing you say " +
      "becomes a note until the reader themselves pushes it into the margin — " +
      "that action belongs to them alone, never to you. Answer only from the " +
      "passage and the conversation, reaching for the open web only under the " +
      "one posture named above that is given it; do not reach for search or " +
      "fetch under any other posture.",
    "Write the way the commonplace book itself reads: plainly, in full " +
      "sentences, without exclamation, enthusiasm, or the cadence of a product. " +
      "Say what you mean once and stop.",
  ].join("\n\n");
}

/**
 * The prebuilt toolset, disabled by default and re-enabled only for the two
 * tools Context needs. No bash/read/write/edit/glob/grep: the agent has no
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
