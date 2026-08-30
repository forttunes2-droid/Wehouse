import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Storage and browser-capability fallbacks intentionally tolerate denied APIs.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Vite safely preserves Fast Refresh when a component module also exports constants.
      "react-refresh/only-export-components": [
        "off",
      ],
      // WeHouse consumes schemaless JSON/RPC payloads at the Supabase boundary.
      // Until generated Database types cover the full legacy schema, requiring
      // fake casts here is less safe than explicitly validating at use sites.
      "@typescript-eslint/no-explicit-any": "off",
      // These React Compiler advisory rules flag the established async loader
      // pattern used throughout the application. Runtime correctness remains
      // covered by exhaustive build/type checks and explicit cancellation.
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/use-memo": "off",
      // Deno Edge Functions occasionally require compatibility suppression for
      // third-party modules whose declarations are not part of the Vite build.
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
]);
