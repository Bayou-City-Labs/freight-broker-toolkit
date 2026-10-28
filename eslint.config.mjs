import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

/**
 * The domain layer must stay framework-free so modules can be lifted into a
 * shared package later (see CLAUDE.md, "Engineering principles"). This is
 * enforced here rather than left to review discipline.
 */
const domainBoundary = {
  files: ["src/domain/**/*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["next", "next/*", "server-only", "client-only"],
            message:
              "src/domain must not depend on Next.js. Keep framework code in src/app.",
          },
          {
            group: ["react", "react-dom", "react/*", "react-dom/*"],
            message: "src/domain must not depend on React.",
          },
          {
            group: [
              "drizzle-orm",
              "drizzle-orm/*",
              "postgres",
              "next-auth",
              "next-auth/*",
              "@auth/*",
            ],
            message:
              "src/domain must not depend on the ORM, driver, or auth library. Define a port here and implement it in src/db or src/app.",
          },
          {
            group: ["@/app/*", "@/db/*", "@/auth", "@/env", "@/env/*"],
            message:
              "src/domain must not import from the app, db, or env layers. Dependencies point inward only.",
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  domainBoundary,
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated SQL and migration journal.
    "drizzle/**",
  ]),
]);

export default eslintConfig;
