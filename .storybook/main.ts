import type { StorybookConfig } from "@storybook/react-vite";

// Stories live beside the components and foundations they document, per the
// plan's "components/, each with a Storybook story" — not in a separate
// top-level stories/ folder.
const config: StorybookConfig = {
  stories: ["../app/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@chromatic-com/storybook",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {
      // Use .storybook/vite.config.ts instead of the app's root config —
      // see that file for why.
      builder: { viteConfigPath: ".storybook/vite.config.ts" },
    },
  },
};
export default config;
