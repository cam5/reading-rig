import type { Meta, StoryObj } from "@storybook/react-vite";
import { NoteComposer } from "./NoteComposer";

const meta = {
  title: "Components/NoteComposer",
  component: NoteComposer,
  args: {
    rect: new DOMRect(120, 160, 200, 20),
    body: "",
    onChange: () => {},
    onCancel: () => {},
    onSave: () => {},
  },
} satisfies Meta<typeof NoteComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithBody: Story = {
  args: { body: "Worth returning to." },
};
