import { useEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryRouter, RouterProvider } from "react-router";
import { TokenComposer } from "./TokenComposer";
import { createPillElement, type PillCandidate } from "./tokenPill";

const meta = {
  title: "Components/Rig/TokenComposer",
  component: TokenComposer,
  // useMentionCandidates is a useFetcher underneath, which needs a *data*
  // router — same reason MarginaliaSidebar's stories wrap in one. The stub
  // /mention-suggestions loader below is only there so typing "@" doesn't
  // crash the story (an unmatched fetcher.load() target throws, and with no
  // errorElement that tears down the whole tree) — it always resolves to no
  // results, so paragraph/note search still isn't something these stories
  // can demonstrate (see RigLivePanel for the real, backed search path).
  // The pinned "in view" row (OnScreenPinned, below) is real regardless:
  // it's built from a prop, not this fetch.
  decorators: [
    (Story) => {
      const router = createMemoryRouter([
        { path: "/", element: <Story /> },
        { path: "/mention-suggestions", loader: () => ({ suggestions: [] }) },
      ]);
      return <RouterProvider router={router} />;
    },
  ],
  args: { workId: "story-work", onSend: () => {}, onScreenExcerpt: null },
} satisfies Meta<typeof TokenComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  render: (args) => (
    <div className="w-[420px]">
      <TokenComposer {...args} />
    </div>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <div className="w-[420px]">
      <TokenComposer {...args} disabled />
    </div>
  ),
};

// Type "@" to see the pinned row appear above the (here, empty) search
// results; selecting it inserts a real pill and the row stops offering
// itself again until that pill is deleted.
export const OnScreenPinned: Story = {
  args: {
    onScreenExcerpt: {
      text: "A commodity appears, at first sight, a very trivial thing, and easily understood.\n\nIts analysis shows that it is, in reality, a very queer thing.",
      locator: "§4 ¶3–4",
      minGlobalOrdinal: 122,
      maxGlobalOrdinal: 123,
    },
  },
  render: (args) => (
    <div className="w-[420px]">
      <TokenComposer {...args} />
    </div>
  ),
};

// Capital vol. 1, ch. 1 §4 — the passage the other Rig stories quote.
const passage: PillCandidate = {
  kind: "paragraph",
  passage: {
    paragraphId: "p1",
    workId: "capital-v1",
    workTitle: "Capital, Volume I",
    chapterOrdinal: 1,
    sectionOrdinal: 4,
    ordinal: 3,
    globalOrdinal: 122,
    text: "A commodity appears, at first sight, a very trivial thing, and easily understood.",
    html: "<p>A commodity appears, at first sight, a very trivial thing, and easily understood.</p>",
    locator: "§4 ¶3",
  },
};

/**
 * Reaches past the component to plant a pill directly, since the "@" → fetch
 * path can't run here. Enough to see how a pill sits in a line of text and
 * that one backspace behind it takes the whole thing. Sending won't quote the
 * passage — the composer only knows pills it inserted itself — so this story
 * is about the editing behaviour, not the serialised output.
 */
function WithPillStory() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = hostRef.current?.querySelector<HTMLDivElement>(
      "[contenteditable='true']",
    );
    if (!editor || editor.childNodes.length > 0) return;
    editor.append("What does ", createPillElement(passage), " mean here?");
    // The composer notices content the same way it would if you'd typed it.
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }, []);

  return (
    <div ref={hostRef} className="w-[420px]">
      <TokenComposer
        workId="story-work"
        onSend={() => {}}
        onScreenExcerpt={null}
      />
    </div>
  );
}

export const WithPill: Story = { render: () => <WithPillStory /> };
