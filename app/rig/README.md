# app/rig

The Rig: one Managed Agent beside the book, and everything that connects a
reader's question to it. Anthropic's Managed Agents API owns the actual agent
loop; this directory provisions the agent, runs the UI side of a session —
replaying history, dispatching custom tools, reconnecting a dropped stream —
and turns the resulting events into a transcript.

The agent's reading API lives one level down, in [tools/](./tools/README.md).

## Provisioning

- `agentConfig.ts` — the agent's name, model, system prompt and toolset, as a
  pure function, so the shape sent to `agents.create`/`agents.update` is tested
  without an API key.
- `environmentConfig.ts` — the same for the container environment every
  session provisions. Networking is limited by default.
- `agentConvergence.ts`, `environmentConvergence.ts` — whether a live agent or
  environment already matches its config, so an unchanged one is not
  updated. Best-effort, and errs toward reporting a change.
- `rigProvisioning.ts` — `ensureRigProvisioning` creates, updates or
  recovers both, and records their ids in the singleton `RigProvisioning`
  row; `getRigProvisioning` reads it back.

[`scripts/setup-agent.ts`](../../scripts/setup-agent.ts) (`npm run
agent:setup`) is the thin network shell around these, and
`scripts/release.ts` runs it on every deploy where `ANTHROPIC_API_KEY` is set.

## Session lifecycle

- `rigSession.ts` — the `RigSession` rows for a (user, work): listing,
  starting a new one, finding the active one, and recovering when a stored
  session has gone stale.
- `anthropicSessionClient.ts` — the client, current agent version and
  session factory the routes use. `rigUnavailableReason()` reports when there
  is no API key, as on PR-preview environments.
- `sessionSource.ts` — the narrow event interface the loop depends on, its
  field names mirroring the SDK's events.
- `anthropicSessionSource.ts` — the real network implementation of that
  interface, kept thin; verified by typecheck only.
- `sessionLoop.ts` — stream-first ordering, the custom-tool dispatch loop,
  and reconnect-with-dedupe, tested against a fake source.
- `dispatchTool.ts` — the one place an `agent.custom_tool_use` becomes a call
  into `tools/`. `userId` and `workId` come from the session, never from the
  model's input.
- `buildLaunchContext.ts` — the plain-text framing sent ahead of a reader's
  first question: which work, and which excerpt prompted it.

## Transcript

- `toTranscriptItems.ts` — folds session events into the items the
  conversation components render.
- `transcriptMarkers.ts` — splits message text on its `⟦pill⟧` and
  `⟦context⟧` markers.
- `simulateReveal.ts` — word-boundary offsets for revealing a message a word
  at a time.
- `__fixtures__/` — reference event histories for shaping component props,
  not test fixtures.

## Client hooks

- `useRigLiveSession.ts` — the browser half of `api.v1.rig.tsx`: an
  EventSource on its stream, POSTs to send, events folded through
  `toTranscriptItems`.
- `useRigSessions.ts` — the session picker's data, from
  `api.v1.rig-sessions.tsx`.
- `useMentionCandidates.ts` — debounced "@"-mention suggestions for the
  composer.

## What holds

- **One agent, created once.** `npm run agent:setup` and the release step
  create and converge it; a request never does so routinely. The one
  exception is a self-heal: when the `RigProvisioning` row is missing, or
  `sessions.create` reports the agent or environment no longer exists,
  `anthropicSessionClient.ts` runs the same `ensureRigProvisioning` once and
  carries on.
- **Ids live in the database, not `.env`.** A release container's `.env`
  write never reached Railway's persisted variables, which is what caused
  #113. The routes read the `RigProvisioning` row.
- **The tools only read.** They are plain functions over Prisma, with no SDK
  types, and nothing in them knows which transport called them.
- **The bookmark is a query, not an instruction.** A paragraph past the
  reader's bookmark is never returned by a tool, so the agent cannot see past
  it whatever it is asked.

Most of this has Vitest coverage alongside it (`*.test.ts`). The calls that
actually reach Anthropic — in `scripts/setup-agent.ts` and
`anthropicSessionSource.ts` — are checked against the SDK's types only.
