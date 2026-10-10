import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

// Accessibility only. This is deliberately not a general lint setup:
// Prettier owns formatting and tsc owns correctness (see package.json's
// format:check and typecheck), so the only rules enabled here are
// eslint-plugin-jsx-a11y's recommended set — the static half of what
// Storybook's addon-a11y checks at runtime, caught at PR time instead.
// typescript-eslint is here for its parser alone (ESLint can't read TSX
// without one); none of its own rules are turned on.

// The codebase already carries `eslint-disable-next-line
// react-hooks/exhaustive-deps` comments from before any ESLint config
// existed, and ESLint errors on a disable comment naming a rule it can't
// find. This registers that name as a rule that never reports, so those
// comments stay valid without pulling in eslint-plugin-react-hooks — whose
// rules are correctness, not accessibility, and out of scope here.
const reactHooksStub = {
  rules: { "exhaustive-deps": { create: () => ({}) } },
};

export default [
  {
    ignores: [
      "build/",
      "generated/",
      "storybook-static/",
      "node_modules/",
      "ios/",
      "public/",
    ],
  },
  {
    files: ["app/**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "jsx-a11y": jsxA11y, "react-hooks": reactHooksStub },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // `role` is also a plain component prop here (RigMessage's
      // role="agent" | "user") — only check it on real DOM elements.
      "jsx-a11y/aria-role": ["error", { ignoreNonDOM: true }],
    },
    linterOptions: {
      // The other half of reactHooksStub above: its rule never reports, so
      // every existing disable comment for it would otherwise be flagged
      // as unused.
      reportUnusedDisableDirectives: "off",
    },
  },
];
