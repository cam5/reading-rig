import type { Meta, StoryObj } from "@storybook/react-vite";
import { RigToolUsage } from "./RigToolUsage";

const meta = {
  title: "Components/Rig/RigToolUsage",
  component: RigToolUsage,
  args: {
    name: "web_search",
    kind: "builtin",
    input: { query: "placeholder" },
    status: "success",
  },
} satisfies Meta<typeof RigToolUsage>;

export default meta;
type Story = StoryObj<typeof meta>;

// The real agent.tool_use / agent.tool_result pair from referenceSessionEvents.ts.
export const BuiltinSuccess: Story = {
  args: {
    name: "web_search",
    kind: "builtin",
    input: {
      query: "when did Marx write commodity fetishism chapter Capital Volume 1",
    },
    status: "success",
    resultSummary:
      "Karl Marx. Capital Volume One Part I: Commodities and Money",
  },
};

export const Pending: Story = {
  args: {
    name: "web_search",
    kind: "builtin",
    input: {
      query: "when did Marx write commodity fetishism chapter Capital Volume 1",
    },
    status: "pending",
  },
};

export const Error: Story = {
  args: {
    name: "web_fetch",
    kind: "builtin",
    input: { url: "https://example.com/unreachable" },
    status: "error",
    resultSummary: "The page could not be reached.",
  },
};

// Illustrative — app/rig/tools/searchShelf.ts once it's a registered custom_tool.
export const CustomReadingTool: Story = {
  args: {
    name: "search_shelf",
    kind: "custom",
    input: { query: "commodity fetishism", bookmarkGlobalOrdinal: 412 },
    status: "success",
    resultSummary:
      "3 matches in Capital, Volume I, all before your bookmark (§4).",
  },
};
