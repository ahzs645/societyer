import convexPlugin from "@convex-dev/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "convex/_generated/**",
    ],
  },
  {
    files: ["convex/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@convex-dev": convexPlugin,
    },
    rules: {
      "@convex-dev/no-old-registered-function-syntax": "error",
      "@convex-dev/require-args-validator": "error",
      "@convex-dev/explicit-table-ids": "warn",
      "@convex-dev/no-filter-in-query": "warn",
    },
  },

  // --- Frontend structure guardrails (warn-only for now) ---------------------
  // The "where does this go?" rule + rollout plan live in docs/frontend-structure.md.
  // Flip these from "warn" to "error" once the misfiled files listed there are moved.
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      // No ecmaFeatures.jsx here — the TS parser enables JSX for .tsx by extension,
      // and forcing it on .ts breaks `<T>` type-assertion syntax.
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      // The repo already had `// eslint-disable react-hooks/*` directives but never
      // wired up the plugin. Registered here (warn) so those resolve and real hook
      // bugs surface. Flip to "error" in a follow-up once the current warnings clear.
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
      // God-file guardrail: keep a unit small enough to hold in your head.
      // Data/definition files (fixtures, metadata catalogs) are expected exceptions.
      "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // components/ must stay GENERIC — no knowledge of a domain feature.
    // Patterns match both alias (@/features/...) and relative (../features/...) imports.
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["warn", {
        patterns: [
          {
            group: ["**/features", "**/features/**"],
            message: "components/ must be generic — move domain-aware UI into features/<x>/. See docs/frontend-structure.md.",
          },
          {
            group: ["**/pages", "**/pages/**"],
            message: "components/ must not depend on pages/.",
          },
          {
            group: ["**/platform", "**/platform/**"],
            message: "components/ must not depend on platform/ engines — the dependency goes the other way.",
          },
        ],
      }],
    },
  },
  {
    // lib/ is domain-agnostic utilities + app/runtime infra — not feature logic.
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["warn", {
        patterns: [
          {
            group: ["**/features", "**/features/**"],
            message: "lib/ must be domain-agnostic — move feature logic into features/<x>/. See docs/frontend-structure.md.",
          },
          {
            group: ["**/pages", "**/pages/**"],
            message: "lib/ must not depend on pages/.",
          },
        ],
      }],
    },
  },
];

