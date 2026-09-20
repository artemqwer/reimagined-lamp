import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Advisory here, not a build gate. Every occurrence in this codebase is
      // one of two patterns the rule cannot distinguish from the mistake it
      // targets:
      //
      //   1. Reading browser-only state (sessionStorage, localStorage, "am I
      //      mounted yet") in an effect *on purpose*, because doing it during
      //      render would make the server and first client render disagree.
      //      ExtendedAnalytics and Sidebar both carry comments saying exactly
      //      that, and `useEffect(() => setMounted(true), [])` is the standard
      //      guard before portalling into document.body.
      //   2. Resetting local state when a dependency changes — a new connector
      //      clearing its cached presets, a "clear all" signal resetting a
      //      dropdown.
      //
      // What the rule is actually for — cascading renders from state derivable
      // during render — none of these are. Rewriting them to satisfy it would
      // reintroduce hydration mismatches. Left at "warn" so new ones are still
      // visible in CI output rather than silently accepted.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Must stay last — turns off any stylistic ESLint rule that would fight
  // with Prettier's own formatting.
  prettierConfig,
]);

export default eslintConfig;
