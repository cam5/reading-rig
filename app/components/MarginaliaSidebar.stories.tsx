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
    entries: [],
    highlights: [],
    threads: [],
    heldPosture: "interrogate",
    onAsk: () => {},
    pendingAnswer: null,
    savingAnswer: false,
    onSaveToMargin: () => {},
    onDiscardAnswer: () => {},
    turnStatus: "idle",
    onDismissNoAnswer: () => {},
    passageLabel: "§4 ¶1–8",
    contextItems: [],
    onAddContextItem: () => {},
    onRemoveContextItem: () => {},
    statement: "In view: this passage (§4 ¶1–8). Nothing past your bookmark.",
  },
} satisfies Meta<typeof MarginaliaSidebar>;

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
        threads: [{ id: "t1", title: "Alienation" }],
        origin: "hand",
        posture: null,
      },
      {
        id: "e2",
        body: "A standalone thought, not tied to a highlight.",
        highlightId: null,
        locator: "§4 ¶3",
        threads: [],
        origin: "hand",
        posture: null,
      },
    ],
    threads: [{ id: "t1", title: "Alienation" }],
  },
};

export const WithPendingAnswer: Story = {
  args: {
    pendingAnswer: {
      body: "The commodity form treats a social relation as if it were a property of the thing itself.",
      posture: "interrogate",
    },
  },
};

export const WithRigEntry: Story = {
  args: {
    entries: [
      {
        id: "e3",
        body: "Kept from the Rig, in the Interrogate posture.",
        highlightId: null,
        locator: "§4 ¶5",
        threads: [],
        origin: "rig",
        posture: "interrogate",
      },
    ],
  },
};
