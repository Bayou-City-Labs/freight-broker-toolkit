import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    // Repository tests share one Postgres database and isolate via
    // transaction rollback, so they must not run concurrently.
    fileParallelism: false,
  },
});
