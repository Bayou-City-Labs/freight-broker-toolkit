import { z } from "zod";
import { intakeProvenanceSchema, type IntakeProvenance } from "../details";
import { parseEquipmentType } from "../load/equipment";
import type { Load, LoadStatus, NewStop, Stop, StopType } from "../load/load";
import type {
  CarrierRepository,
  LoadRepository,
  PartyRepository,
} from "../ports/repositories";
import type { BrokerageScope } from "../tenancy";
import type { TextSource } from "./document-text";
import type { StopKind } from "./load-draft";

/**
 * Turning a reviewed draft into a real load.
 *
 * The draft side of intake is all uncertainty — confidences, flags, source
 * text. This is the other side of the human: everything here has been looked
 * at by a person, so there are no confidences on it, just values. That is the
 * whole point of the review screen, and it is why the confirmed shape is a
 * separate type rather than a `LoadDraft` with the confidences ignored. A
 * function that accepted a draft here could be called without a human in the
 * loop, which is exactly the thing the module must not allow.
 *
 * Depends only on ports, so the flow is tested end to end against fakes.
 */

/** A stop as a human confirmed it. `partyName` is required: a stop is a place. */
export interface ConfirmedStop {
  readonly kind: StopKind;
  readonly partyName: string;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
  /** Local wall date, `YYYY-MM-DD`. */
  readonly date: string | null;
  /** Local wall time, `HH:MM`. */
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly referenceNumber: string | null;
  /** What the document said about timing, kept verbatim for audit. */
  readonly windowRawText: string | null;
}

/**
 * How a draft came to be, recorded on the saved load.
 *
 * Confidence calibration is an open question — what a 0.6 from a template
 * should mean next to a 0.6 from an LLM. It can only be answered from cases
 * where a parser was confident and wrong, or unsure and right, and that
 * evidence exists only at the moment a human corrects a field. Capturing it
 * here is cheap; reconstructing it later is impossible.
 *
 * The shape lives in `details.ts` with the other `jsonb` payloads, since that
 * is the column it is stored in and the schema that validates it on the way
 * back out.
 */
export type { FieldCorrection, IntakeProvenance } from "../details";

/**
 * Keeps the two lists of text sources honest. `TextSource` is the real
 * vocabulary; `intakeProvenanceSchema` has to validate the same set, and
 * nothing but a type error will remind anyone of that when OCR or an LLM stage
 * adds a third. Adding a source without widening the schema fails here.
 */
type Covers<Narrow extends Wide, Wide> = Narrow;
export type CoveredTextSource = Covers<TextSource, IntakeProvenance["textSource"]>;

export interface ConfirmedLoad {
  readonly referenceNumber: string;
  readonly carrierName: string | null;
  readonly carrierMcNumber: string | null;
  readonly carrierDotNumber: string | null;
  readonly commodity: string | null;
  readonly weightLbs: number | null;
  /** Free text, as the document wrote it. Classified below, never discarded. */
  readonly equipment: string | null;
  readonly carrierRateCents: number | null;
  readonly stops: readonly ConfirmedStop[];
  readonly provenance: IntakeProvenance;
}

// --- Validation ----------------------------------------------------------

const nullableText = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

export const confirmedStopSchema = z.object({
  kind: z.enum(["pickup", "delivery"]),
  partyName: z.string().trim().min(1, "Every stop needs a name"),
  addressLine: nullableText,
  city: nullableText,
  state: nullableText,
  postalCode: nullableText,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .nullable(),
  windowStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM")
    .nullable(),
  windowEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM")
    .nullable(),
  referenceNumber: nullableText,
  windowRawText: nullableText,
});

export const confirmedLoadSchema = z.object({
  referenceNumber: z.string().trim().min(1, "A load needs a reference number"),
  carrierName: nullableText,
  carrierMcNumber: nullableText,
  carrierDotNumber: nullableText,
  commodity: nullableText,
  weightLbs: z.number().nonnegative().nullable(),
  equipment: nullableText,
  carrierRateCents: z.number().int().nullable(),
  stops: z.array(confirmedStopSchema).min(1, "A load needs at least one stop"),
  provenance: intakeProvenanceSchema,
});

// --- The use case ---------------------------------------------------------

export interface ConfirmDraftDeps {
  readonly loads: LoadRepository;
  readonly parties: PartyRepository;
  readonly carriers: CarrierRepository;
}

export type ConfirmOutcome =
  | {
      readonly status: "saved";
      readonly load: Load;
      readonly stops: readonly Stop[];
      /**
       * Whether the named carrier matched one we already hold. False means the
       * carrier on this load has never been vetted here — which the UI says
       * out loud, because an unlinked load looks identical to a linked one.
       */
      readonly carrierLinked: boolean;
    }
  /**
   * The reference number is already in use. Reported rather than silently
   * suffixed: two loads with the same number on a broker's paperwork is a
   * problem they need to see, and the usual cause is importing the same rate
   * con twice.
   */
  | { readonly status: "duplicate_reference"; readonly existing: Load };

export type ConfirmDraft = (
  scope: BrokerageScope,
  confirmed: ConfirmedLoad,
) => Promise<ConfirmOutcome>;

export function createConfirmDraft({
  loads,
  parties,
  carriers,
}: ConfirmDraftDeps): ConfirmDraft {
  return async function confirmDraft(scope, confirmed) {
    const duplicate = await loads.findByReferenceNumber(scope, confirmed.referenceNumber);
    if (duplicate) return { status: "duplicate_reference", existing: duplicate };

    const carrier = await findCarrier(scope, carriers, confirmed);

    const stops: NewStop[] = [];
    for (const [index, stop] of confirmed.stops.entries()) {
      const party = await resolveParty(scope, parties, stop);

      stops.push({
        sequence: index,
        type: STOP_TYPE_FOR[stop.kind],
        partyId: party.id,
        opensAtLocal: joinLocal(stop.date, stop.windowStart),
        closesAtLocal: joinLocal(stop.date, stop.windowEnd),
        // The facility's zone, when we know it. Never inferred from the state
        // on the address: a guess here changes what every window means.
        timeZone: party.timeZone,
        appointmentType: appointmentTypeFor(stop),
        windowRawText: stop.windowRawText,
        details: stop.referenceNumber ? { appointmentNumber: stop.referenceNumber } : {},
      });
    }

    const { load, stops: saved } = await loads.create(
      scope,
      {
        referenceNumber: confirmed.referenceNumber,
        status: inferStatus(confirmed),
        equipmentType: classifyEquipment(confirmed.equipment),
        commodityDescription: confirmed.commodity,
        weightLbs: confirmed.weightLbs,
        // Only the carrier side is known from a rate con. The customer rate is
        // the broker's own number and never appears on the carrier's copy, so
        // leaving it null is correct rather than incomplete.
        carrierPayCents: confirmed.carrierRateCents,
        carrierId: carrier?.id ?? null,
        details: {
          ...(confirmed.equipment ? { equipmentAsWritten: confirmed.equipment } : {}),
          ...(confirmed.carrierName ? { carrierAsWritten: confirmed.carrierName } : {}),
          intake: confirmed.provenance,
        },
      },
      stops,
    );

    return { status: "saved", load, stops: saved, carrierLinked: carrier !== null };
  };
}

const STOP_TYPE_FOR: Record<StopKind, StopType> = {
  pickup: "pickup",
  delivery: "delivery",
};

/**
 * Looks for a carrier we already hold, by the numbers on the document.
 *
 * Deliberately does **not** create one. A carrier record here is the subject of
 * a vetting history, and one conjured from a name on a PDF would sit in the
 * carrier list looking exactly like a carrier someone had actually checked.
 * Carriers enter the system through a lookup, which is the only path that can
 * tell us the name is real.
 */
async function findCarrier(
  scope: BrokerageScope,
  carriers: CarrierRepository,
  confirmed: ConfirmedLoad,
) {
  if (confirmed.carrierMcNumber) {
    const byMc = await carriers.findByMcNumber(scope, confirmed.carrierMcNumber);
    if (byMc) return byMc;
  }
  if (confirmed.carrierDotNumber) {
    const byDot = await carriers.findByDotNumber(scope, confirmed.carrierDotNumber);
    if (byDot) return byDot;
  }
  return null;
}

async function resolveParty(
  scope: BrokerageScope,
  parties: PartyRepository,
  stop: ConfirmedStop,
) {
  const existing = await parties.findByName(scope, stop.partyName);
  if (existing) return existing;

  return parties.create(scope, {
    name: stop.partyName,
    addressLine1: stop.addressLine,
    city: stop.city,
    region: stop.state,
    postalCode: stop.postalCode,
  });
}

/**
 * A stated range is a window the facility will honour; a single time is an
 * appointment. Null when the document gave no time at all — saying "FCFS"
 * because we read nothing would be an invention, and drivers plan around it.
 */
function appointmentTypeFor(stop: ConfirmedStop) {
  if (stop.windowStart === null) return null;
  return stop.windowEnd === null ? "appointment" : "fcfs";
}

/**
 * `other` and `null` are different answers.
 *
 * `other` means the document stated equipment that is not one of our types —
 * a Conestoga, a hotshot. `null` means it stated none. Collapsing them would
 * lose the difference between "unusual trailer" and "nobody said", and the
 * original phrase is kept in `details.equipmentAsWritten` either way.
 */
function classifyEquipment(equipment: string | null) {
  if (equipment === null) return null;
  return parseEquipmentType(equipment) ?? "other";
}

/**
 * A document naming a carrier and a rate is an agreement — a rate con — and
 * the load is booked. Anything else is a tender or a partial read, and stays a
 * draft. Intake does not know which document it was handed, so the status is
 * inferred from what the document committed to rather than asserted.
 */
function inferStatus(confirmed: ConfirmedLoad): LoadStatus {
  const agreed = confirmed.carrierName !== null && confirmed.carrierRateCents !== null;
  return agreed ? "booked" : "draft";
}

function joinLocal(date: string | null, time: string | null): string | null {
  return date && time ? `${date}T${time}` : null;
}
