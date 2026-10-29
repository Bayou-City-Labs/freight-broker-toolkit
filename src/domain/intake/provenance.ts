import type { ConfirmedLoad, ConfirmedStop, FieldCorrection } from "./confirm";
import type { DraftField, LoadDraft, StopDraft } from "./load-draft";
import { flaggedFields } from "./load-draft";

/**
 * What the human changed, and what they let stand.
 *
 * This is the only moment the module can learn whether a confidence meant
 * anything: a field the parser scored 0.9 and a person rewrote is evidence the
 * scoring is wrong, and a field scored 0.55 and accepted unchanged is evidence
 * it is too harsh. Nobody can reconstruct that afterwards from the saved load,
 * so it is recorded as the draft is confirmed.
 */

/**
 * Draft field → confirmed field. The names differ in one place: a document's
 * "load number" becomes the load's `referenceNumber`, because that is what the
 * column means to every other module.
 */
const LOAD_FIELDS: ReadonlyArray<
  readonly [keyof LoadDraft & string, keyof Omit<ConfirmedLoad, "provenance"> & string]
> = [
  ["loadNumber", "referenceNumber"],
  ["carrierName", "carrierName"],
  ["carrierMcNumber", "carrierMcNumber"],
  ["carrierDotNumber", "carrierDotNumber"],
  ["commodity", "commodity"],
  ["weightLbs", "weightLbs"],
  ["equipment", "equipment"],
  ["carrierRateCents", "carrierRateCents"],
];

const STOP_FIELDS: ReadonlyArray<
  readonly [keyof StopDraft & string, keyof ConfirmedStop & string]
> = [
  ["partyName", "partyName"],
  ["addressLine", "addressLine"],
  ["city", "city"],
  ["state", "state"],
  ["postalCode", "postalCode"],
  ["date", "date"],
  ["windowStart", "windowStart"],
  ["windowEnd", "windowEnd"],
  ["referenceNumber", "referenceNumber"],
];

export interface DraftComparison {
  readonly corrections: readonly FieldCorrection[];
  readonly acceptedFlagged: readonly string[];
}

export function compareToDraft(
  draft: LoadDraft,
  confirmed: Omit<ConfirmedLoad, "provenance">,
): DraftComparison {
  const corrections: FieldCorrection[] = [];

  for (const [draftKey, confirmedKey] of LOAD_FIELDS) {
    const before = draft[draftKey] as DraftField<unknown>;
    if (changed(before.value, confirmed[confirmedKey])) {
      corrections.push({ path: draftKey, confidence: before.confidence });
    }
  }

  // A human adding or removing a stop is a correction the parser can't be
  // scored on — it had no confidence in the number of stops it found.
  if (draft.stops.length !== confirmed.stops.length) {
    corrections.push({ path: "stops", confidence: 0 });
  }

  draft.stops.forEach((stop, index) => {
    const after = confirmed.stops[index];
    if (!after) return;

    for (const [draftKey, confirmedKey] of STOP_FIELDS) {
      const before = stop[draftKey] as DraftField<unknown>;
      if (changed(before.value, after[confirmedKey])) {
        corrections.push({
          path: `stops.${index}.${draftKey}`,
          confidence: before.confidence,
        });
      }
    }
  });

  const correctedPaths = new Set(corrections.map((correction) => correction.path));
  const acceptedFlagged = flaggedFields(draft)
    .map((flag) => flag.path)
    .filter((path) => !correctedPaths.has(path));

  return { corrections, acceptedFlagged };
}

/**
 * Trimmed string comparison, because the review form round-trips values
 * through HTML inputs: whitespace the browser adds is not a human correction,
 * and counting it as one would bury the real edits in noise.
 */
function changed(before: unknown, after: unknown): boolean {
  return normalize(before) !== normalize(after);
}

function normalize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return String(value);
}
