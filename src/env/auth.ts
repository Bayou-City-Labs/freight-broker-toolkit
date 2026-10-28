import { z } from "zod";
import { parseEnv } from "./parse";

const schema = z.object({
  AUTH_SECRET: z.string().min(1),
  AUTH_RESEND_KEY: z.string().min(1),
  AUTH_EMAIL_FROM: z.email(),
});

export const authEnv = parseEnv(schema, "auth");
