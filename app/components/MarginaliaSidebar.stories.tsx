import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryRouter, RouterProvider } from "react-router";
import { MarginaliaSidebar } from "./MarginaliaSidebar";

const meta = {
  title: "Components/MarginaliaSidebar",
  component: MarginaliaSidebar,
  // useFetcher (inside HighlightNoteComposer) needs a *data* router, not just
  // a routing context — <MemoryRouter> is the declarative router and doesn't
  // satisfy it ("useFetcher must be used within a data router"). A one-route
  // memory router rendering the story as its element is the data-router
  // equivalent of what <MemoryRouter><Story /></MemoryRouter> was going for.
  decorators: [
    (Story) => {
      const router = createMemoryRouter([{ path: "/", element: <Story /> }]);
      return <RouterProvider router={router} />;
    },
  ],
  args: {
    workId: "karl-marx/capital-volume-i",
    entries: [],
    highlights: [],
    onSaved: () => {},
    optimistic: { addPendingEntry: () => "", removePending: () => {} },
    onOpenRig: () => {},
    open: true,
    onClose: () => {},
  },
} satisfies Meta<typeof MarginaliaSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithHighlightsAndEntries: Story = {
  args: {
    highlights: [
      {
        id: "h1",
        locator: "§4 ¶2",
        text: "A specter is haunting Europe.",
        anchorParagraphId: "p2",
      },
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
