import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

/**
 * Tests run against TEST_DATABASE_URL, never DATABASE_URL. Redirecting here —
 * before any module that reads env is imported — means repository code under
 * test is the same code that runs in production, with no test-only branch.
 */
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Copy .env.example to .env.local and run `npm run db:up`.",
  );
}
process.env.DATABASE_URL = testUrl;
