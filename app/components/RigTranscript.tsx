import type { TranscriptItem } from "~/rig/toTranscriptItems";
import { RigMemoryActivity } from "./RigMemoryActivity";
import { RigMessage } from "./RigMessage";
import { RigStatus } from "./RigStatus";
import { RigThinking } from "./RigThinking";
import { RigToolUsage } from "./RigToolUsage";

type Props = {
  items: TranscriptItem[];
};

/**
 * Stacks a session's `TranscriptItem`s (see `app/rig/toTranscriptItems.ts`)
 * in order, dispatching each to the primitive that renders it. This is the
 * composition the other five components exist to be assembled into — the
 * shape a real `/rig/*` page would feed from the SSE stream once one
 * exists; today it's exercised only against the reference fixtures in
 * Storybook.
 */
export function RigTranscript({ items }: Props) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => {
        switch (item.kind) {
          case "message":
            return (
              <RigMessage
                key={item.id}
                role={item.role}
                text={item.text}
                streaming={item.streaming}
                simulateReveal={item.simulateReveal}
                pending={item.pending}
              />
            );
          case "thinking":
            return <RigThinking key={item.id} />;
          case "tool":
            return (
              <RigToolUsage
                key={item.id}
                name={item.name}
                kind={item.toolKind}
                input={item.input}
                status={item.status}
                resultSummary={item.resultSummary}
              />
            );
          case "memory":
            return (
              <RigMemoryActivity
                key={item.id}
                action={item.action}
                path={item.path}
                status={item.status}
                preview={item.preview}
              />
            );
          case "status":
            return <RigStatus key={item.id} status={item.status} message={item.message} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
