import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      reportUnusedDisableDirectives: "error",
    },
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "warn",
    },
    plugins: ["react", "typescript", "import", "vitest"],
    jsPlugins: ["./tools/oxlint/index.js"],
    rules: {
      "react/exhaustive-deps": "warn",
      "react/rules-of-hooks": "error",
      "react/react-in-jsx-scope": "off",
      "typescript/consistent-type-imports": "error",
      "typescript/no-base-to-string": "warn",
      "typescript/no-floating-promises": "warn",
      "typescript/no-misused-spread": "warn",
      "typescript/no-unsafe-type-assertion": "error",
      "oxc/no-accumulating-spread": "error",
      "import/no-unassigned-import": "off",
      "vitest/no-conditional-expect": "off",
      "vitest/no-standalone-expect": [
        "error",
        { additionalTestBlockFunctions: ["it.effect", "it.live"] },
      ],
      "vitest/require-to-throw-message": "off",
      "no-await-in-loop": "off",
      "require-yield": "off",
      "starter/suppression-reason": "error",
    },
    overrides: [
      {
        files: ["apps/worker/src/**/*.ts"],
        rules: { "starter/runtime-boundary": "error" },
      },
      {
        files: [
          "apps/worker/src/index.ts",
          "apps/worker/src/**/*.test.ts",
          "apps/worker/src/**/*.spec.ts",
          "scripts/**/*.ts",
        ],
        rules: { "starter/runtime-boundary": "off" },
      },
    ],
    ignorePatterns: [
      "**/dist/**",
      "**/node_modules/**",
      "apps/web/src/routeTree.gen.ts",
      "apps/worker/.wrangler/**",
    ],
  },
  fmt: {
    ignorePatterns: ["apps/web/src/routeTree.gen.ts", "**/dist/**", "**/.wrangler/**"],
  },
});
