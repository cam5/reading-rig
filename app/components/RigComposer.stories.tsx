import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RigComposer } from "./RigComposer";

const meta = {
  title: "Components/Rig/RigComposer",
  component: RigComposer,
  args: { value: "", onChange: () => {}, onSend: () => {} },
} satisfies Meta<typeof RigComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled(props: { initialValue?: string; disabled?: boolean }) {
  const [value, setValue] = useState(props.initialValue ?? "");
  return (
    <div className="w-[420px]">
      <RigComposer value={value} onChange={setValue} onSend={() => setValue("")} disabled={props.disabled} />
    </div>
  );
}

export const Empty: Story = {
  render: () => <Controlled />,
};

export const WithText: Story = {
  render: () => <Controlled initialValue="Why does Marx call this queer?" />,
};

// The composer stays visible while a turn is in flight — see the "disabled" doc comment.
export const Busy: Story = {
  render: () => <Controlled initialValue="What comes next?" disabled />,
};
