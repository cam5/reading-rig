import { reactRouter } from "@react-router/dev/vite";
import posthog from "@posthog/rollup-plugin";
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
// meant. Georgia is listed explicitly for Literata per #85's plan, ahead
// of its own category defaults.
const SYSTEM_UI_STACK = [
  "BlinkMacSystemFont",
  "Segoe UI",
  "Helvetica Neue",
  "Arial",
  "Noto Sans",
];

// A stack trace `captureException` (analytics.server.ts) sends PostHog is
// only as readable as the bundle it points into — without this, every
// frame names a minified server chunk instead of the source line that
// actually threw. `POSTHOG_CLI_API_KEY` is a *personal* API key
// (`error tracking write` + `organization read` scopes), a different
// secret than `POSTHOG_PROJECT_API_KEY`'s project key: this uploads build
// artifacts, that one only ever writes events.
//
// Same "no key, no-op" shape as `analyticsEnabled()`: the plugin itself
// throws if enabled without a key, so the guard has to happen out here,
// at whether the plugin is even in the array — a local build or a PR
// preview with no key configured just builds without it.
const posthogApiKey = process.env.POSTHOG_CLI_API_KEY;
const posthogProjectId = process.env.POSTHOG_CLI_PROJECT_ID;

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    ...(posthogApiKey && posthogProjectId
      ? [
          posthog({
            personalApiKey: posthogApiKey,
            projectId: posthogProjectId,
            host: process.env.POSTHOG_HOST || undefined,
            // Sourcemaps are uploaded, then stripped from the served bundle
            // (`sourcemaps.deleteAfterUpload`'s default) — PostHog gets the
            // real source, a reader's Network tab never does.
          }),
        ]
      : []),
    // Generates metric-matched "<Family> fallback" @font-face rules (see
    // organic.css's font tokens) for Figtree/Fraunces/Caprasimo, computed
    // from each font's real ascent/descent/lineGap/unitsPerEm — the actual
    // CLS fix from #85, not just self-hosting. Metrics for all three (and
    // their fallbacks below) come from fontaine's bundled capsize dataset,
    // keyed by family name, so nothing here is hand-guessed. Fraunces
    // replaced Literata as the reading voice (#135) — same fallback chain,
    // since the rationale (a real serif already on most systems) didn't
    // change with the font.
    FontaineTransform.vite({
      fallbacks: {
        Figtree: SYSTEM_UI_STACK,
        Caprasimo: SYSTEM_UI_STACK,
        Fraunces: ["Georgia", "Times New Roman", "Noto Serif"],
      },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
