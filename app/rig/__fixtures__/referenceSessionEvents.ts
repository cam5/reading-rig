/**
 * Reference data for shaping the conversation-primitive components' props —
 * not fixtures for a test suite (nothing here is asserted against). Two of
 * the four exports below are real event histories, pulled straight off the
 * Managed Agents API against the live `RigSession` row already sitting in
 * `dev.db` (`sesn_01QdEnDGm3aEJ4wUtDgPMj4u`, seeded against Pride and
 * Prejudice) — not authored. `qaTurnEvents` is `events.list()` on that
 * session as found; `toolUseTurnEvents` is the same session after sending
 * one more `user.message` designed to force a `web_search` call, captured
 * from `events.stream()` through to `session.status_idle`. Search-result
 * content arrays are trimmed to two entries each for readability; every
 * other field is untouched, including real event ids and token usage.
 *
 * `customToolTurnEvents` and `memoryTurnEvents` are illustrative, not
 * pulled from a live call — the Rig's agent has no custom tools registered
 * yet (`agentConfig.ts`'s `buildToolset()` only turns on `web_search` /
 * `web_fetch`; see app/rig/tools/README.md — "not wired to the agent yet"),
 * and no memory store is attached to any session (build plan M5, a later
 * milestone). Both are still typed to match the real SDK event shapes
 * (`@anthropic-ai/sdk`'s `BetaManagedAgentsSessionEvent` union in
 * `resources/beta/sessions/events.d.ts`) rather than guessed freehand:
 * `customToolTurnEvents` uses this repo's actual tool names
 * (`app/rig/tools/searchShelf.ts`, `getPassage.ts`); `memoryTurnEvents`
 * targets a path shaped like `BetaManagedAgentsMemoryStoreResource.mount_path`
 * (`/mnt/memory/<store-name>`), the one place memory concretely touches the
 * event stream — there is no dedicated `memory.*` event type. Treat these
 * two as "shaped correctly, not yet observed" and re-pull real ones once
 * either lands.
 */

import type { RigDisplayEvent } from "../toTranscriptItems";

/**
 * A full turn with no tool calls: user asks a question with no passage
 * attached, the Rig asks for one back. Shows the plain
 * running → thread_running → message → thread_idle → idle shape with
 * nothing else in it.
 */
export const qaTurnEvents: RigDisplayEvent[] = [
  {
    id: "sevt_01FBxkjb9s3J2jHrwyiZRjAm",
    processed_at: "2026-08-02T18:15:01.365587Z",
    type: "session.status_running",
  },
  {
    agent_name: "The Rig",
    id: "sevt_017dxNPxR3XpkuuNmdGbHh4o",
    processed_at: "2026-08-02T18:15:01.365588Z",
    session_thread_id: "sthr_01UB8iw6CWioAMHtJGzwr9XH",
    type: "session.thread_status_running",
  },
  {
    content: [{ text: "What's happening in this passage?", type: "text" }],
    id: "sevt_01F86SiFSaatTTPgeqbf5Ufe",
    processed_at: "2026-08-02T18:15:01.510371Z",
    type: "user.message",
  },
  {
    id: "sevt_01JcicyLhpcsDRa3fJvokiaJ",
    processed_at: "2026-08-02T18:15:01.510372Z",
    type: "span.model_request_start",
  },
  {
    content: [
      {
        text: "You haven't shared the passage yet — only the question. Paste the lines you're looking at and I'll read them with you.",
        type: "text",
      },
    ],
    id: "sevt_017U8TUzAhQKZr3i9Z6Emm14",
    processed_at: "2026-08-02T18:15:03.757938Z",
    type: "agent.message",
  },
  {
    id: "sevt_01HmimZMSsaSTjkDuQayYW12",
    is_error: false,
    model_request_start_id: "sevt_01JcicyLhpcsDRa3fJvokiaJ",
    model_usage: {
      cache_creation_input_tokens: 3914,
      cache_read_input_tokens: 0,
      input_tokens: 6,
      output_tokens: 40,
    },
    processed_at: "2026-08-02T18:15:03.757939Z",
    type: "span.model_request_end",
  },
  {
    agent_name: "The Rig",
    id: "sevt_01KdzU1GSP5KvBUp86dLsA9Q",
    processed_at: "2026-08-02T18:15:04.125855Z",
    session_thread_id: "sthr_01UB8iw6CWioAMHtJGzwr9XH",
    stop_reason: { type: "end_turn" },
    type: "session.thread_status_idle",
  },
  {
    id: "sevt_01U8ZpwsyxgVNS6UC76KW3aP",
    processed_at: "2026-08-02T18:15:04.125857Z",
    stop_reason: { type: "end_turn" },
    type: "session.status_idle",
  },
];

/**
 * A turn that reaches for the open web: `agent.thinking` (no content, ever
 * — confirmed by the SDK's own doc comment, "a progress signal, not a
 * content carrier"), then `agent.tool_use` for `web_search`, its
 * `agent.tool_result` (`search_result` content blocks with `source` /
 * `title` / `citations`, not plain text), a second thinking beat, then the
 * final `agent.message`. `span.model_request_end.model_usage` is the real
 * token/cache accounting for each of the two model calls this turn made.
 */
export const toolUseTurnEvents: RigDisplayEvent[] = [
  {
    id: "sevt_01NxFkDBmdbhHBB2Zt4wtLHY",
    processed_at: "2026-08-02T23:37:41.938187Z",
    type: "session.status_running",
  },
  {
    agent_name: "The Rig",
    id: "sevt_017ZRL5jg4ppJtzTUgNKawbC",
    processed_at: "2026-08-02T23:37:41.938188Z",
    session_thread_id: "sthr_01UB8iw6CWioAMHtJGzwr9XH",
    type: "session.thread_status_running",
  },
  {
    content: [
      {
        text:
          'Here is the passage: "A commodity appears, at first sight, a very trivial thing, and easily understood." ' +
          "Search the web for when Marx wrote this chapter and give me one sentence of historical context, citing where you found it.",
        type: "text",
      },
    ],
    id: "sevt_01D2cX6mpaa5a6Yu1AZKZFt7",
    processed_at: "2026-08-02T23:37:42.076318Z",
    type: "user.message",
  },
  {
    id: "sevt_01Sv27CsvSwiC76wWGPNfo9n",
    processed_at: "2026-08-02T23:37:42.076319Z",
    type: "span.model_request_start",
  },
  {
    id: "sevt_016QE1WbnnxACJBvrN4eGRZX",
    processed_at: "2026-08-02T23:37:44.118246Z",
    type: "agent.thinking",
  },
  {
    evaluated_permission: "allow",
    id: "sevt_015yZf2Nmnqh9dZdge98qQHQ",
    input: {
      query: "when did Marx write commodity fetishism chapter Capital Volume 1",
    },
    name: "web_search",
    processed_at: "2026-08-02T23:37:44.746214Z",
    type: "agent.tool_use",
  },
  {
    id: "sevt_01T4aVRNNQYU71msLTfeqwMe",
    is_error: false,
    model_request_start_id: "sevt_01Sv27CsvSwiC76wWGPNfo9n",
    model_usage: {
      cache_creation_input_tokens: 4029,
      cache_read_input_tokens: 0,
      input_tokens: 6,
      output_tokens: 137,
    },
    processed_at: "2026-08-02T23:37:44.746215Z",
    type: "span.model_request_end",
  },
  {
    content: [
      {
        citations: { enabled: true },
        content: [
          {
            text:
              "Karl Marx. Capital Volume One … A commodity appears, at first sight, a very trivial thing, and easily " +
              "understood. Its analysis shows that it is, in reality, a very queer thing, abounding in metaphysical " +
              "subtleties and theological niceties.",
            type: "text",
          },
        ],
        source:
          "https://web.stanford.edu/~davies/Symbsys100-Spring0708/Marx-Commodity-Fetishism.pdf",
        title: "Karl Marx. Capital Volume One Part I: Commodities and Money",
        type: "search_result",
      },
      {
        citations: { enabled: true },
        content: [
          {
            text:
              "Section 4 - The Fetishism of Commodities and the Secret thereof … The utility of a thing makes it a use " +
              "value. But this utility is not a thing of air.",
            type: "text",
          },
        ],
        source: "https://www.marxists.org/archive/marx/works/1867-c1/ch01.htm",
        title: "Economic Manuscripts: Capital Vol. I - Chapter One",
        type: "search_result",
      },
    ],
    id: "sevt_018bTcoRLM6JCD8Yug8BT6Fs",
    is_error: false,
    processed_at: "2026-08-02T23:37:45.520693Z",
    tool_use_id: "sevt_015yZf2Nmnqh9dZdge98qQHQ",
    type: "agent.tool_result",
  },
  {
    id: "sevt_01SU9nBAQjc4WJ1ANn9dH5Gc",
    processed_at: "2026-08-02T23:37:45.638435Z",
    type: "span.model_request_start",
  },
  {
    id: "sevt_01WLRMAf52KUWmi2HHGMSLQk",
    processed_at: "2026-08-02T23:37:50.132129Z",
    type: "agent.thinking",
  },
  {
    content: [
      {
        text:
          'The line opens Section 4 of Chapter 1, "The Fetishism of Commodities and the Secret Thereof" — the hinge ' +
          "where Marx pivots from the dry analytics of use-value and exchange-value into something stranger.",
        type: "text",
      },
      {
        text:
          "Marx spent around seventeen years working on the first volume, roughly from 1850, following the defeat " +
          "of the 1848 revolutions and his exile in London, until the book was published in Hamburg in 1867 in its " +
          "first German edition.",
        type: "text",
      },
    ],
    id: "sevt_019ECzKtKzNtcFdZBkwwLubB",
    processed_at: "2026-08-02T23:38:01.310264Z",
    type: "agent.message",
  },
  {
    id: "sevt_01Lifvk76Es7GRr1Jw9nNsqB",
    is_error: false,
    model_request_start_id: "sevt_01SU9nBAQjc4WJ1ANn9dH5Gc",
    model_usage: {
      cache_creation_input_tokens: 18823,
      cache_read_input_tokens: 0,
      input_tokens: 1,
      output_tokens: 816,
    },
    processed_at: "2026-08-02T23:38:01.310265Z",
    type: "span.model_request_end",
  },
  {
    agent_name: "The Rig",
    id: "sevt_018SMs92KJdXcpj5uUY7xELB",
    processed_at: "2026-08-02T23:38:01.678828Z",
    session_thread_id: "sthr_01UB8iw6CWioAMHtJGzwr9XH",
    stop_reason: { type: "end_turn" },
    type: "session.thread_status_idle",
  },
  {
    id: "sevt_01Qm5kVT1XiPx1PebqyVjvBX",
    processed_at: "2026-08-02T23:38:01.678830Z",
    stop_reason: { type: "end_turn" },
    type: "session.status_idle",
  },
];

/**
 * Illustrative, not observed — shaped to match the SDK's `event_start` /
 * `event_delta` / reconciling `agent.message` sequence
 * (`BetaManagedAgentsStartEvent` / `BetaManagedAgentsDeltaEvent` in
 * `resources/beta/sessions/sessions.d.ts`) for a connection that opted into
 * `event_deltas: ["agent.message"]` (see anthropicSessionSource.ts). Note
 * `event_start` and `event_delta` carry no top-level `id` on the real wire
 * frame — only the nested `event.id` / `event_id`, which is all
 * toTranscriptItems.ts reads. The `id` set below on each exists only to
 * satisfy `RigDisplayEvent`'s structural type and is otherwise unused.
 */
export const streamingTurnEvents: RigDisplayEvent[] = [
  {
    id: "sevt_fixture_stream1_start",
    processed_at: "2026-08-02T19:10:00.000000Z",
    type: "event_start",
    event: { type: "agent.message", id: "sevt_fixture_stream1" },
  },
  {
    id: "sevt_fixture_stream1_delta1",
    processed_at: "2026-08-02T19:10:00.400000Z",
    type: "event_delta",
    event_id: "sevt_fixture_stream1",
    delta: {
      type: "content_delta",
      content: { type: "text", text: "Marx spent around" },
    },
  },
  {
    id: "sevt_fixture_stream1_delta2",
    processed_at: "2026-08-02T19:10:00.800000Z",
    type: "event_delta",
    event_id: "sevt_fixture_stream1",
    delta: {
      type: "content_delta",
      content: { type: "text", text: " seventeen years on the first volume." },
    },
  },
  {
    content: [
      {
        text: "Marx spent around seventeen years on the first volume.",
        type: "text",
      },
    ],
    id: "sevt_fixture_stream1",
    processed_at: "2026-08-02T19:10:01.200000Z",
    type: "agent.message",
  },
];

/**
 * Illustrative, not observed — see the file-level note. Shaped for the day
 * `app/rig/tools/searchShelf.ts` is registered as a real `custom_tool` on
 * the agent: `agent.custom_tool_use` (same fields as `agent.tool_use` plus
 * `name`) answered by a `user.custom_tool_result` the app sends back, per
 * `dispatchTool.ts` / `sessionLoop.ts`'s dispatch loop.
 */
export const customToolTurnEvents: RigDisplayEvent[] = [
  {
    id: "sevt_fixture_ctu1",
    processed_at: "2026-08-02T19:02:11.000000Z",
    type: "agent.custom_tool_use",
    name: "search_shelf",
    input: { query: "commodity fetishism", bookmarkGlobalOrdinal: 412 },
  },
  {
    id: "sevt_fixture_ctr1",
    processed_at: "2026-08-02T19:02:11.400000Z",
    type: "user.custom_tool_result",
    custom_tool_use_id: "sevt_fixture_ctu1",
    is_error: false,
    content: [
      {
        type: "text",
        text: "3 matches in Capital, Volume I, all before your bookmark (§4).",
      },
    ],
  },
];

/**
 * Illustrative, not observed — no memory store is attached to any session
 * yet (build plan M5). The one place memory would touch the event stream:
 * a tool call whose path falls under the store's `mount_path`
 * (`BetaManagedAgentsMemoryStoreResource`, `/mnt/memory/<store-name>` by
 * default). `RigMemoryActivity` is a specialized read of exactly this
 * shape, keyed on the path prefix — there is no `memory.read` /
 * `memory.write` event type to build against instead.
 */
export const memoryTurnEvents: RigDisplayEvent[] = [
  {
    id: "sevt_fixture_mem_read1",
    processed_at: "2026-08-02T19:04:02.000000Z",
    type: "agent.tool_use",
    name: "read",
    input: { path: "/mnt/memory/reader-preferences/cameron.md" },
  },
  {
    id: "sevt_fixture_mem_read1_result",
    processed_at: "2026-08-02T19:04:02.220000Z",
    type: "agent.tool_result",
    tool_use_id: "sevt_fixture_mem_read1",
    is_error: false,
    content: [
      {
        type: "text",
        text: "- Prefers close-reading over historical context unless asked.\n- Reading Capital slowly, one section per session.",
      },
    ],
  },
];
