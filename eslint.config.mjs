import { defineConfig, globalIgnores } from "eslint/config"
import typeScriptPlugin from "@typescript-eslint/eslint-plugin"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypeScript from "eslint-config-next/typescript"
import reactHooksPlugin from "eslint-plugin-react-hooks"

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    plugins: {
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      // Existing client data-loading effects predate the React Compiler rules.
      // Keep them visible without making the migrated lint command unusable.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    files: ["components/features/graph/graph-view.tsx"],
    plugins: {
      "@typescript-eslint": typeScriptPlugin,
    },
    rules: {
      // react-force-graph's callback surface is currently untyped in this view.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["**/*.cjs", "tailwind.config.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "dist-electron/**",
    "next-env.d.ts",
  ]),
])
