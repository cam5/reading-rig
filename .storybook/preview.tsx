import type { Preview } from "@storybook/react-vite";

// The whole point of standing Storybook up here: stories render against the
// real stylesheet — Bop's tokens and component classes via Tailwind's
// @theme — not a mocked or partial copy. If this import ever drifts from
// app/root.tsx's, Storybook stops being a trustworthy preview of the app.
import "../app/app.css";
// app/root.tsx's own preload links (same #89 reasoning) are rendered by
// react-router's <Links />, which Storybook's preview iframe never renders
// — so without this, fonts.css's `font-display: optional` never gets its
// real face loaded in time and every story permanently shows the fallback
// font instead of Figtree/Literata. `?url` gets Vite to resolve the same
// content-hashed asset root.tsx preloads, not a path that only works here.
import figtreeLatin400Woff2 from "@fontsource/figtree/files/figtree-latin-400-normal.woff2?url";
import literataLatin400Woff2 from "@fontsource/literata/files/literata-latin-400-normal.woff2?url";

// root.tsx deliberately skips preloading Baloo 2 (see its own comment,
// #89) to keep it from competing with Figtree/Literata for cold-load
// bandwidth. Storybook's static build has no such bandwidth budget to
// protect, and the Button/Typography stories set real DisplayText through
// it — so here it gets the same preload treatment regardless, straight
// from its @fontsource package like Figtree/Literata above.
import baloo2Latin700Woff2 from "@fontsource/baloo-2/files/baloo-2-latin-700-normal.woff2?url";

for (const href of [figtreeLatin400Woff2, literataLatin400Woff2, baloo2Latin700Woff2]) {
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "font";
  link.type = "font/woff2";
  link.href = href;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

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
