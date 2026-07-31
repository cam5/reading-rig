import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { TodaysPageSidebar } from "./TodaysPageSidebar";

const meta = {
  title: "Components/TodaysPageSidebar",
  component: TodaysPageSidebar,
  // Renders a fetcher.Form — needs a router context even outside the app shell.
  decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>],
  args: {
    entries: [],
    highlights: [],
  },
} satisfies Meta<typeof TodaysPageSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithHighlightsAndEntries: Story = {
  args: {
    highlights: [
      { id: "h1", locator: "§4 ¶2", text: "A specter is haunting Europe.", anchorParagraphId: "p2" },
    ],
    entries: [
      {
        id: "e1",
        body: "Worth returning to.",
        highlightId: "h1",
        locator: "§4 ¶2",
        excerpt: "A specter is haunting Europe.",
      },
      {
        id: "e2",
        body: "A standalone thought, not tied to a highlight.",
        highlightId: null,
        locator: "§4 ¶3",
      },
    ],
  },
};
