import type { Meta, StoryObj } from "@storybook/react-vite";
import { PostureRail } from "./PostureRail";

const meta = {
  title: "Components/PostureRail",
  component: PostureRail,
} satisfies Meta<typeof PostureRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
