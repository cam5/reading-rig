import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Passage } from "~/rig/tools/shared";
import { MentionSuggestions } from "./MentionSuggestions";

// Capital vol. 1, ch. 1 §4 — the same passage the Rig stories quote.
const paragraphs = [
  "A commodity appears, at first sight, a very trivial thing, and easily understood.",
  "Its analysis shows that it is, in reality, a very queer thing, abounding in metaphysical subtleties and theological niceties.",
  "So far as it is a value in use, there is nothing mysterious about it, whether we consider it from the point of view that by its properties it is capable of satisfying human wants.",
  "The form of wood, for instance, is altered, by making a table out of it.",
  "Yet, for all that, the table continues to be that common, every-day thing, wood.",
  "But, so soon as it steps forth as a commodity, it is changed into something transcendent.",
  "It not only stands with its feet on the ground, but, in relation to all other commodities, it stands on its head.",
  "Whence, then, arises the enigmatical character of the product of labour, so soon as it assumes the form of commodities?",
];

function passage(index: number): Passage {
  return {
    paragraphId: `p${index + 1}`,
    workId: "capital-v1",
    workTitle: "Capital, Volume I",
    chapterOrdinal: 1,
    sectionOrdinal: 4,
    ordinal: index + 1,
    globalOrdinal: 120 + index,
    text: paragraphs[index],
    html: `<p>${paragraphs[index]}</p>`,
    locator: `§4 ¶${index + 1}`,
  };
}

const meta = {
  title: "Components/Rig/MentionSuggestions",
  component: MentionSuggestions,
  args: {
    suggestions: [],
    activeIndex: 0,
    loading: false,
    onSelect: () => {},
    listboxId: "mention-listbox",
    // Overrides the component's own `fixed` positioning so the popup sits in
    // the story canvas instead of pinning itself to the viewport corner.
    style: { position: "static", width: 340 },
  },
} satisfies Meta<typeof MentionSuggestions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = {};

export const FewResults: Story = {
  args: { suggestions: [passage(0), passage(1), passage(2)] },
};

// The endpoint's cap — deliberately more rows than the popup's max-height,
// so this story is where the list's own scrolling gets checked.
export const ManyResults: Story = {
  args: { suggestions: paragraphs.map((_, index) => passage(index)) },
};

export const ActiveIndexHighlighted: Story = {
  args: { suggestions: [passage(0), passage(1), passage(2)], activeIndex: 1 },
};
