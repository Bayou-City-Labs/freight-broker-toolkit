import { z } from "zod";

/**
 * Shape of the FMCSA QCMobile responses we read.
 *
 * Deliberately permissive. FMCSA's published element list disagrees with what
 * the API actually sends — the docs name `allowToOperate` and `outOfService`,
 * the wire sends `allowedToOperate` and `oosDate` — and numeric fields come
 * back sometimes as numbers and sometimes as strings. A strict schema would
 * turn a cosmetic upstream change into an outage on a screen a broker is using
 * to decide whether to hand someone a $3,000 load.
 *
 * So: every field is optional, every field is nullable, and interpretation
 * happens in map.ts where an unrecognised value degrades to "unknown" rather
 * than throwing. The raw payload is stored whole regardless, so nothing we
 * failed to model here is lost.
 */

/** FMCSA sends counts and amounts as either a JSON number or a decimal string. */
const numberish = z.union([z.number(), z.string()]).nullish();
const stringish = z.string().nullish();

export const fmcsaCarrierSchema = z
  .object({
    dotNumber: numberish,
    // The carrier payload generally omits this — docket numbers live on a
    // separate endpoint — but the published element list claims it, so read it
    // if it ever shows up.
    mcNumber: numberish,
    legalName: stringish,
    dbaName: stringish,

    // FMCSA's own computed answer to "may this carrier legally run today".
    allowedToOperate: stringish,
    // Status of the DOT registration itself: "A" active, "I" inactive.
    statusCode: stringish,

    // Authority is held per type. A carrier hauling freight needs common or
    // contract; broker authority is a different business and irrelevant here.
    commonAuthorityStatus: stringish,
    contractAuthorityStatus: stringish,
    brokerAuthorityStatus: stringish,

    // Present only when an out-of-service order exists.
    oosDate: stringish,

    // Comes from a compliance review, which most carriers have never had.
    safetyRating: stringish,
    safetyRatingDate: stringish,

    // BIPD is the legally required liability filing, reported in $thousands.
    bipdInsuranceOnFile: numberish,
    bipdInsuranceRequired: stringish,
    bipdRequiredAmount: numberish,
    cargoInsuranceOnFile: numberish,
    bondInsuranceOnFile: numberish,

    totalPowerUnits: numberish,
    totalDrivers: numberish,

    phyStreet: stringish,
    phyCity: stringish,
    phyState: stringish,
    phyZipcode: stringish,
    phyCountry: stringish,
    telephone: stringish,
  })
  .loose();

export type FmcsaCarrier = z.infer<typeof fmcsaCarrierSchema>;

const carrierEnvelope = z.object({ carrier: fmcsaCarrierSchema }).loose();

/**
 * `content` is an object for a DOT lookup. The docs claim the same for a
 * docket-number lookup, but a docket number is not guaranteed unique across
 * carrier types, and the endpoint has been observed returning an array. Both
 * are accepted rather than discovering which is true in production.
 *
 * It is also sometimes a bare **string**, which is how FMCSA reports a problem
 * with the request itself — `{"content": "Webkey not found"}`, served with a
 * 404. That is not a missing carrier, and the client must not read it as one.
 */
export const fmcsaResponseSchema = z
  .object({
    content: z
      .union([carrierEnvelope, z.array(carrierEnvelope), z.string(), z.null()])
      .nullish(),
    retrievalDate: stringish,
  })
  .loose();

export type FmcsaResponse = z.infer<typeof fmcsaResponseSchema>;

/**
 * Null when the response carried no carrier. A string `content` is a
 * diagnostic, not a carrier, and is handled by the caller before this runs.
 */
export function extractCarrier(response: FmcsaResponse): FmcsaCarrier | null {
  const { content } = response;
  if (!content || typeof content === "string") return null;
  if (Array.isArray(content)) return content[0]?.carrier ?? null;
  return content.carrier;
}
