import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { SectionNav } from "./SectionNav";

const meta = {
  title: "Components/SectionNav",
  component: SectionNav,
  // SectionNav renders react-router Links — needs a router context even
  // outside the app shell.
  decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>],
  args: {
    previousHref: "/read/karl-marx/capital-volume-i?section=ch1-s1",
    nextHref: "/read/karl-marx/capital-volume-i?section=ch1-s3",
  },
} satisfies Meta<typeof SectionNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MidWork: Story = {};

export const AtStart: Story = {
  args: { previousHref: null },
};

export const AtEnd: Story = {
  args: { nextHref: null },
};
