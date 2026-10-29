import { intakeProvenanceSchema, type IntakeProvenance } from "../details";
import type { Load, LoadStatus, NewStop, Stop } from "../load/load";
import {
  classifyEquipment,
  findCarrier,
  loadValuesSchema,
  stopValuesSchema,
  toNewStop,
  type LoadValues,
  type StopValues,
} from "../load/load-values";
import type {
  CarrierRepository,
  LoadRepository,
  PartyRepository,
} from "../ports/repositories";
import type { BrokerageScope } from "../tenancy";
import type { TextSource } from "./document-text";

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

/** A stop as a human confirmed it. */
export type ConfirmedStop = StopValues;
export const confirmedStopSchema = stopValuesSchema;

export type ConfirmedLoad = LoadValues & { readonly provenance: IntakeProvenance };

export const confirmedLoadSchema = loadValuesSchema.extend({
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
      stops.push(toNewStop(stop, index, party));
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
 * A document naming a carrier and a rate is an agreement — a rate con — and
 * the load is booked. Anything else is a tender or a partial read, and stays a
 * draft. Intake does not know which document it was handed, so the status is
 * inferred from what the document committed to rather than asserted.
 */
function inferStatus(confirmed: ConfirmedLoad): LoadStatus {
  const agreed = confirmed.carrierName !== null && confirmed.carrierRateCents !== null;
  return agreed ? "booked" : "draft";
}
