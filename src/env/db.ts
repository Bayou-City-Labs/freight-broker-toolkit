import { z } from "zod";
import { parseEnv } from "./parse";

const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export const dbEnv = parseEnv(schema, "database");
