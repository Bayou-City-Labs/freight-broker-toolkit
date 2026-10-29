import { z } from "zod";
import { parseEnv } from "./parse";

/**
 * The FMCSA QCMobile webKey, obtained through login.gov (see README).
 *
 * Optional on purpose. A missing key must not stop the app from booting or
 * take down unrelated screens — the carrier lookup adapter raises a typed
 * `not_configured` error instead, which the vetting UI renders as a setup
 * notice. An empty string in a deployed environment is treated as absent.
 */
const schema = z.object({
  FMCSA_WEB_KEY: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  /** Point at a stub to exercise the vetting flow without burning a real key. */
  FMCSA_BASE_URL: z
    .url()
    .optional()
    .transform((value) => value?.replace(/\/$/, "")),
});

export const fmcsaEnv = parseEnv(schema, "fmcsa");
