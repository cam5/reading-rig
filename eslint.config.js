import tsParser from "@typescript-eslint/parser";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default [
  {
    linterOptions: {
      // The react-hooks stub below intentionally implements nothing, which
      // would otherwise surface as "unused eslint-disable directive" noise.
      reportUnusedDisableDirectives: "off",
    },
  },
  {
    ignores: [
      "build/**",
      "storybook-static/**",
      "generated/**",
      "ios/**",
      "app/**/*.stories.tsx",
    ],
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "jsx-a11y": jsxA11y,
      // Stub so pre-existing `eslint-disable-next-line react-hooks/exhaustive-deps`
      // comments (written for a hooks linter this repo doesn't run) don't fail
      // this a11y-only config with "Definition for rule ... was not found".
      "react-hooks": {
        rules: {
          "exhaustive-deps": { create: () => ({}) },
        },
      },
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
];
