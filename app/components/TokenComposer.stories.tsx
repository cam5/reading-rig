import { useEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { Passage } from "~/rig/tools/shared";
import { TokenComposer } from "./TokenComposer";
import { createPillElement } from "./tokenPill";

const meta = {
  title: "Components/Rig/TokenComposer",
  component: TokenComposer,
  // useParagraphMentions is a useFetcher underneath, which needs a *data*
  // router — same reason MarginaliaSidebar's stories wrap in one. Typing "@"
  // still won't suggest anything here: there's no backend behind Storybook,
  // which is why the live mention path has no story (see RigLivePanel).
  decorators: [
    (Story) => {
      const router = createMemoryRouter([{ path: "/", element: <Story /> }]);
      return <RouterProvider router={router} />;
    },
  ],
  args: { workId: "story-work", onSend: () => {} },
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

// Capital vol. 1, ch. 1 §4 — the passage the other Rig stories quote.
const passage: Passage = {
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
    const editor = hostRef.current?.querySelector<HTMLDivElement>("[contenteditable='true']");
    if (!editor || editor.childNodes.length > 0) return;
    editor.append("What does ", createPillElement(passage), " mean here?");
    // The composer notices content the same way it would if you'd typed it.
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }, []);

  return (
    <div ref={hostRef} className="w-[420px]">
      <TokenComposer workId="story-work" onSend={() => {}} />
    </div>
  );
}

export const WithPill: Story = { render: () => <WithPillStory /> };
