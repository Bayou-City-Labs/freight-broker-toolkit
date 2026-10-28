import type { z } from "zod";

/**
 * Parses a slice of `process.env` and throws a readable error listing every
 * missing or malformed variable at once.
 *
 * Env is split by concern (db, auth) rather than parsed as one object so each
 * entry point only requires what it actually uses — running a migration
 * shouldn't demand an email provider key.
 */
export function parseEnv<T extends z.ZodType>(schema: T, label: string): z.infer<T> {
  const result = schema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid ${label} environment variables:\n${issues}\n\n` +
        "Copy .env.example to .env.local and fill in the missing values.",
    );
  }

  return result.data;
}
