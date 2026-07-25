import type { Preview } from "@storybook/react-vite";

// The whole point of standing Storybook up here: stories render against the
// real stylesheet — Organic's tokens and component classes via Tailwind's
// @theme — not a mocked or partial copy. If this import ever drifts from
// app/root.tsx's, Storybook stops being a trustworthy preview of the app.
import "../app/app.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "todo",
    },
  },
};

export default preview;
