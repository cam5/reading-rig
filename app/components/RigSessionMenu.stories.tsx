import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RigSessionMenu } from "./RigSessionMenu";
import type { RigSessionSummary } from "~/rig/useRigSessions";

const meta = {
  title: "Components/Rig/RigSessionMenu",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const THREE_SESSIONS: RigSessionSummary[] = [
  { id: "sess_3", createdAt: "2026-08-06T14:14:00Z" },
  { id: "sess_2", createdAt: "2026-08-03T09:02:00Z" },
  { id: "sess_1", createdAt: "2026-07-28T20:41:00Z" },
];

function Controlled(props: { initialSessions: RigSessionSummary[] | null; initialActiveId: string | null }) {
  const [sessions, setSessions] = useState(props.initialSessions);
  const [activeId, setActiveId] = useState(props.initialActiveId);
  return (
    <div className="p-8">
      <RigSessionMenu
        sessions={sessions}
        activeSessionId={activeId}
        onSelect={setActiveId}
        onNewSession={() => {
          const created = { id: `sess_new_${(sessions?.length ?? 0) + 1}`, createdAt: new Date().toISOString() };
          setSessions([created, ...(sessions ?? [])]);
          setActiveId(created.id);
        }}
      />
    </div>
  );
}

export const ThreeSessions: Story = {
  render: () => <Controlled initialSessions={THREE_SESSIONS} initialActiveId="sess_3" />,
};

export const SingleSession: Story = {
  render: () => <Controlled initialSessions={[THREE_SESSIONS[0]]} initialActiveId="sess_3" />,
};

// The very first open of a book — no sessions exist yet, only "New session".
export const NoSessionsYet: Story = {
  render: () => <Controlled initialSessions={[]} initialActiveId={null} />,
};

export const Loading: Story = {
  render: () => <Controlled initialSessions={null} initialActiveId={null} />,
};
