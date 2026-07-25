import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Storybook's own Vite config — deliberately not the app's vite.config.ts.
// @react-router/dev's Vite plugin expects to be driving Vite itself (it
// wants an SSR-shaped build) and throws ("requires the use of a Vite config
// file") when Storybook's builder-vite loads it instead. Everything
// Storybook's stories actually need — Tailwind, the `~/*` path alias — is
// here without it.
export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "~": new URL("../app", import.meta.url).pathname,
    },
  },
});
