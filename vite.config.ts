import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { FontaineTransform } from "fontaine";
import { defineConfig } from "vite";

// Real per-OS stand-ins for the generic `system-ui` keyword in
// organic.css's font tokens — `system-ui` itself can't be a fontaine
// fallback target, since it isn't a real installed font's name and so
// can't be found via `local()`. These are exactly the concrete faces
// `system-ui` resolves to per platform (fontaine's own default
// sans-serif/display category fallback stack), so using them here keeps
// the size-adjusted "... fallback" face true to what `system-ui` already
// meant. Georgia is listed explicitly for EB Garamond per #85's plan, ahead
// of its own category defaults.
const SYSTEM_UI_STACK = ["BlinkMacSystemFont", "Segoe UI", "Helvetica Neue", "Arial", "Noto Sans"];

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    // Generates metric-matched "<Family> fallback" @font-face rules (see
    // organic.css's font tokens) for Figtree/EB Garamond/Caprasimo, computed
    // from each font's real ascent/descent/lineGap/unitsPerEm — the actual
    // CLS fix from #85, not just self-hosting. Metrics for all three (and
    // their fallbacks below) come from fontaine's bundled capsize dataset,
    // keyed by family name, so nothing here is hand-guessed.
    FontaineTransform.vite({
      fallbacks: {
        Figtree: SYSTEM_UI_STACK,
        Caprasimo: SYSTEM_UI_STACK,
        "EB Garamond": ["Georgia", "Times New Roman", "Noto Serif"],
      },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
