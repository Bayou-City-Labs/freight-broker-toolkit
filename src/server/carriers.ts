import { createVetCarrier } from "@/domain/carrier/vetting";
import { db } from "@/db/client";
import {
  createCarrierCheckRepository,
  createCarrierRepository,
} from "@/db/repositories/carriers";
import { fmcsaEnv } from "@/env/fmcsa";
import { createFmcsaCarrierLookup } from "@/integrations/fmcsa/client";

/**
 * Where the carrier-vetting use case meets its real adapters.
 *
 * Everything above this line is ports and pure logic; everything below is
 * Postgres and FMCSA. Keeping the wiring in one small module is what makes the
 * use case testable with fakes and the adapters swappable.
 *
 * Deliberately not `server-only`, unlike tenant.ts. Nothing here touches a
 * request — the scheduled re-checks in Phase 3 are a plain Node process that
 * needs exactly this composition root, and `server-only` resolves to its
 * client-error entry outside a bundler, which would block that for no gain.
 * The guard belongs on modules that read cookies or a session, not on wiring.
 */
export const carrierRepository = createCarrierRepository(db);
export const carrierCheckRepository = createCarrierCheckRepository(db);

export const carrierLookup = createFmcsaCarrierLookup({
  webKey: fmcsaEnv.FMCSA_WEB_KEY,
  baseUrl: fmcsaEnv.FMCSA_BASE_URL,
});

export const vetCarrier = createVetCarrier({
  carriers: carrierRepository,
  checks: carrierCheckRepository,
  lookup: carrierLookup,
});

/** Lets the UI show a setup notice instead of failing a lookup it can't run. */
export const isCarrierLookupConfigured = fmcsaEnv.FMCSA_WEB_KEY !== undefined;
