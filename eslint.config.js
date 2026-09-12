import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Legacy modules still contain explicit any. Critical application/domain/
      // repository paths are independently blocked by the architecture gate.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
  {
    // Formatting debt predates this architecture pass. Keep it visible without
    // turning thousands of safe formatting differences into a merge blocker.
    // Semantic ESLint errors, typecheck and architecture boundaries still fail CI.
    rules: {
      "prettier/prettier": "warn",
    },
  },
  {
    // Lovable owns this generated preview-auth bridge. Its timer declaration is
    // intentionally assigned after the finish closure that references it.
    files: ["src/integrations/supabase/previewAuthStorage.ts"],
    rules: {
      "prefer-const": "off",
    },
  },
  {
    // The CSV sanitizer deliberately matches ASCII control bytes and formula prefixes.
    files: ["src/lib/csv.ts"],
    rules: {
      "no-control-regex": "off",
    },
  },
  {
    // This named interface is kept as the public opportunity-evaluation contract.
    files: ["src/lib/engine/opportunity.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    // Privacy redaction regexes escape URL delimiters intentionally for readability.
    files: ["src/lib/lovable-error-reporting.ts"],
    rules: {
      "no-useless-escape": "off",
    },
  },
  {
    // Worker RPC results are runtime-shaped; explicit truthiness normalization is intentional.
    files: ["src/routes/api.analysis-worker.ts"],
    rules: {
      "no-extra-boolean-cast": "off",
    },
  },
);
