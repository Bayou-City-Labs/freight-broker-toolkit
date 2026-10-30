import { z } from "zod";
import type { Carrier } from "../carrier/carrier";
import type { CarrierRepository } from "../ports/repositories";
import type { BrokerageScope } from "../tenancy";
import { parseEquipmentType } from "./equipment";
import type { NewStop, Party, StopType } from "./load";

/**
 * A load as a human states it, and the translation into what gets stored.
 *
 * Shared by intake's confirm step and by editing a saved load. Both arrive at
 * the same place — a person has looked at these values and they are now
 * assertions, not guesses — so the schemas, the stop mapping and the carrier
 * lookup belong here rather than in either caller. A second copy of
 * `findCarrier` is how the "never create a carrier from a document" rule
 * quietly stops applying on one of the two paths.
 */

export const nullableText = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

/** `partyName` is required: a stop is a place. */
export const stopValuesSchema = z.object({
  kind: z.enum(["pickup", "delivery"]),
  partyName: z.string().trim().min(1, "Every stop needs a name"),
  addressLine: nullableText,
  city: nullableText,
  state: nullableText,
  postalCode: nullableText,
  /** Local wall date. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .nullable(),
  /** Local wall time. */
  windowStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM")
    .nullable(),
  windowEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM")
    .nullable(),
  referenceNumber: nullableText,
  /** What the document said about timing, kept verbatim for audit. */
  windowRawText: nullableText,
});

export const loadValuesSchema = z.object({
  referenceNumber: z.string().trim().min(1, "A load needs a reference number"),
  carrierName: nullableText,
  carrierMcNumber: nullableText,
  carrierDotNumber: nullableText,
  commodity: nullableText,
  weightLbs: z.number().nonnegative().nullable(),
  /** Free text, as stated. Classified by `classifyEquipment`, never discarded. */
  equipment: nullableText,
  carrierRateCents: z.number().int().nullable(),
  stops: z.array(stopValuesSchema).min(1, "A load needs at least one stop."),
});

export type StopValues = z.infer<typeof stopValuesSchema>;
export type LoadValues = z.infer<typeof loadValuesSchema>;

export const STOP_TYPE_FOR: Record<StopValues["kind"], StopType> = {
  pickup: "pickup",
  delivery: "delivery",
};

/**
 * A stated stop, as a row.
 *
 * `details` is merged rather than replaced so an edit does not drop keys the
 * stop already carried — seal numbers, dock hours — that this form never shows.
 */
export function toNewStop(
  stop: StopValues,
  sequence: number,
  party: Party,
  existingDetails: NewStop["details"] = {},
): NewStop {
  return {
    sequence,
    type: STOP_TYPE_FOR[stop.kind],
    partyId: party.id,
    opensAtLocal: joinLocal(stop.date, stop.windowStart),
    closesAtLocal: joinLocal(stop.date, stop.windowEnd),
    // The facility's zone, when we know it. Never inferred from the state on
    // the address: a guess here changes what every window means.
    timeZone: party.timeZone,
    appointmentType: appointmentTypeFor(stop),
    windowRawText: stop.windowRawText,
    details: {
      ...existingDetails,
      ...(stop.referenceNumber ? { appointmentNumber: stop.referenceNumber } : {}),
    },
  };
}

/**
 * A stated range is a window the facility will honour; a single time is an
 * appointment. Null when no time was given at all — saying "FCFS" because we
 * read nothing would be an invention, and drivers plan around it.
 */
function appointmentTypeFor(stop: StopValues) {
  if (stop.windowStart === null) return null;
  return stop.windowEnd === null ? "appointment" : "fcfs";
}

function joinLocal(date: string | null, time: string | null): string | null {
  return date && time ? `${date}T${time}` : null;
}

/**
 * `other` and `null` are different answers.
 *
 * `other` means equipment was stated and is not one of our types — a
 * Conestoga, a hotshot. `null` means none was stated. Collapsing them loses
 * the difference between "unusual trailer" and "nobody said", and the original
 * phrase is kept in `details.equipmentAsWritten` either way.
 */
export function classifyEquipment(equipment: string | null) {
  if (equipment === null) return null;
  return parseEquipmentType(equipment) ?? "other";
}

/**
 * Looks for a carrier we already hold, by the numbers stated.
 *
 * Deliberately does **not** create one. A carrier record is the subject of a
 * vetting history, and one conjured from a name on a PDF would sit in the
 * carrier list looking exactly like a carrier someone had actually checked.
 * Carriers enter the system through a lookup, which is the only path that can
 * tell us the name is real.
 */
export async function findCarrier(
  scope: BrokerageScope,
  carriers: CarrierRepository,
  values: Pick<LoadValues, "carrierMcNumber" | "carrierDotNumber">,
): Promise<Carrier | null> {
  if (values.carrierMcNumber) {
    const byMc = await carriers.findByMcNumber(scope, values.carrierMcNumber);
    if (byMc) return byMc;
  }
  if (values.carrierDotNumber) {
    const byDot = await carriers.findByDotNumber(scope, values.carrierDotNumber);
    if (byDot) return byDot;
  }
  return null;
}
