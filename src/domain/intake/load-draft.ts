import { z } from "zod";
import { isLocalDateTime } from "../time-window";

/**
 * What an extractor produces and a human confirms.
 *
 * A draft is not a `Load`. Nothing here is trusted: every field carries a
 * confidence and the raw text it was read from, and a person has to accept it
 * before it becomes a record. Keeping the source text is the same principle
 * the stop windows follow — the thing the document actually said survives, so
 * a wrong reading is diagnosable rather than mysterious.
 */
export interface DraftField<T> {
  readonly value: T | null;
  /** 0 = guessed, 1 = certain. See CONFIDENT_ENOUGH for where review kicks in. */
  readonly confidence: number;
  /** The text this was read from, verbatim. Null when nothing was found. */
  readonly sourceText: string | null;
}

export function field<T>(
  value: T | null,
  confidence: number,
  sourceText: string | null = null,
): DraftField<T> {
  return {
    value,
    confidence: clampConfidence(value === null ? 0 : confidence),
    sourceText,
  };
}

/** An absent field, for extractors that found nothing. */
export function missing<T>(): DraftField<T> {
  return { value: null, confidence: 0, sourceText: null };
}

function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.min(1, Math.max(0, confidence));
}

/**
 * Below this, the review screen flags a field for attention.
 *
 * Set high on purpose. The cost of a broker glancing at a correct field is a
 * second; the cost of a wrong delivery date reaching a carrier is a missed
 * appointment and a conversation with the customer. When the two error costs
 * are this lopsided, the threshold belongs near the top of the range.
 */
export const CONFIDENT_ENOUGH = 0.85;

export type StopKind = "pickup" | "delivery";

/**
 * Deliberately mirrors `Load` → ordered `Stop[]` → `Party` rather than
 * shipper/consignee fields, so confirming a draft is a straight mapping and a
 * multi-stop rate con is more rows rather than a different shape.
 */
export interface StopDraft {
  readonly kind: StopKind;
  readonly sequence: number;
  readonly partyName: DraftField<string>;
  readonly addressLine: DraftField<string>;
  readonly city: DraftField<string>;
  readonly state: DraftField<string>;
  readonly postalCode: DraftField<string>;
  /** Local wall date, ISO `YYYY-MM-DD`. Never converted to an instant here. */
  readonly date: DraftField<string>;
  /** Local wall time, `HH:MM`, 24-hour. */
  readonly windowStart: DraftField<string>;
  readonly windowEnd: DraftField<string>;
  readonly referenceNumber: DraftField<string>;
}

export interface LoadDraft {
  readonly loadNumber: DraftField<string>;
  readonly carrierName: DraftField<string>;
  readonly carrierMcNumber: DraftField<string>;
  readonly carrierDotNumber: DraftField<string>;
  readonly commodity: DraftField<string>;
  readonly weightLbs: DraftField<number>;
  readonly equipment: DraftField<string>;
  /** Integer cents, per the money rule. Never a float. */
  readonly carrierRateCents: DraftField<number>;
  readonly stops: readonly StopDraft[];
  /** Which parser produced this, for audit and for comparing parsers. */
  readonly producedBy: string;
}

// --- Validation ----------------------------------------------------------

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

function draftField<T extends z.ZodType>(value: T) {
  return z.object({
    value: value.nullable(),
    confidence: z.number().min(0).max(1),
    sourceText: z.string().nullable(),
  });
}

export const stopDraftSchema = z.object({
  kind: z.enum(["pickup", "delivery"]),
  sequence: z.number().int().nonnegative(),
  partyName: draftField(z.string()),
  addressLine: draftField(z.string()),
  city: draftField(z.string()),
  state: draftField(z.string()),
  postalCode: draftField(z.string()),
  date: draftField(localDate),
  windowStart: draftField(localTime),
  windowEnd: draftField(localTime),
  referenceNumber: draftField(z.string()),
});

export const loadDraftSchema = z.object({
  loadNumber: draftField(z.string()),
  carrierName: draftField(z.string()),
  carrierMcNumber: draftField(z.string()),
  carrierDotNumber: draftField(z.string()),
  commodity: draftField(z.string()),
  weightLbs: draftField(z.number().nonnegative()),
  equipment: draftField(z.string()),
  carrierRateCents: draftField(z.number().int()),
  stops: z.array(stopDraftSchema),
  producedBy: z.string().min(1),
});

/** An empty draft. The honest starting point when nothing could be read. */
export function emptyDraft(producedBy: string): LoadDraft {
  return {
    loadNumber: missing(),
    carrierName: missing(),
    carrierMcNumber: missing(),
    carrierDotNumber: missing(),
    commodity: missing(),
    weightLbs: missing(),
    equipment: missing(),
    carrierRateCents: missing(),
    stops: [],
    producedBy,
  };
}

export function emptyStop(kind: StopKind, sequence: number): StopDraft {
  return {
    kind,
    sequence,
    partyName: missing(),
    addressLine: missing(),
    city: missing(),
    state: missing(),
    postalCode: missing(),
    date: missing(),
    windowStart: missing(),
    windowEnd: missing(),
    referenceNumber: missing(),
  };
}

// --- Review ---------------------------------------------------------------

export interface FlaggedField {
  /** Dotted path, e.g. "carrierRateCents" or "stops.0.date". */
  readonly path: string;
  readonly label: string;
  readonly reason: "missing" | "low_confidence";
  readonly confidence: number;
}

const LOAD_FIELD_LABELS: Record<string, string> = {
  loadNumber: "Load number",
  carrierName: "Carrier",
  carrierMcNumber: "Carrier MC number",
  carrierDotNumber: "Carrier DOT number",
  commodity: "Commodity",
  weightLbs: "Weight",
  equipment: "Equipment",
  carrierRateCents: "Carrier rate",
};

const STOP_FIELD_LABELS: Record<string, string> = {
  partyName: "Name",
  addressLine: "Address",
  city: "City",
  state: "State",
  postalCode: "ZIP",
  date: "Date",
  windowStart: "Window opens",
  windowEnd: "Window closes",
  referenceNumber: "Reference number",
};

/**
 * Fields a human should look at before this becomes a load.
 *
 * Required fields are reported when missing; optional ones only when present
 * and uncertain. A rate con that genuinely has no reference number should not
 * nag — but a rate with no value is always worth stopping for.
 */
const REQUIRED_LOAD_FIELDS = ["carrierName", "carrierRateCents"] as const;
const REQUIRED_STOP_FIELDS = ["partyName", "date"] as const;

export function flaggedFields(draft: LoadDraft): FlaggedField[] {
  const flags: FlaggedField[] = [];

  for (const [key, label] of Object.entries(LOAD_FIELD_LABELS)) {
    const value = draft[key as keyof LoadDraft] as DraftField<unknown>;
    const required = (REQUIRED_LOAD_FIELDS as readonly string[]).includes(key);
    pushFlag(flags, key, label, value, required);
  }

  draft.stops.forEach((stop, index) => {
    const stopLabel = stop.kind === "pickup" ? "Pickup" : "Delivery";
    for (const [key, label] of Object.entries(STOP_FIELD_LABELS)) {
      const value = stop[key as keyof StopDraft] as DraftField<unknown>;
      const required = (REQUIRED_STOP_FIELDS as readonly string[]).includes(key);
      pushFlag(
        flags,
        `stops.${index}.${key}`,
        `${stopLabel} ${index + 1} — ${label}`,
        value,
        required,
      );
    }
  });

  return flags;
}

function pushFlag(
  flags: FlaggedField[],
  path: string,
  label: string,
  value: DraftField<unknown>,
  required: boolean,
): void {
  if (value.value === null) {
    if (required) {
      flags.push({ path, label, reason: "missing", confidence: 0 });
    }
    return;
  }
  if (value.confidence < CONFIDENT_ENOUGH) {
    flags.push({ path, label, reason: "low_confidence", confidence: value.confidence });
  }
}

/** Nothing missing and nothing uncertain — safe to accept without edits. */
export function isReadyToConfirm(draft: LoadDraft): boolean {
  return flaggedFields(draft).length === 0 && draft.stops.length > 0;
}

/**
 * Combines a stop's date and window into the naive local wall time the domain
 * stores. Null when either half is missing — a window needs both.
 */
export function stopWindowStart(stop: StopDraft): string | null {
  return joinLocal(stop.date.value, stop.windowStart.value);
}

export function stopWindowEnd(stop: StopDraft): string | null {
  return joinLocal(stop.date.value, stop.windowEnd.value);
}

function joinLocal(date: string | null, time: string | null): string | null {
  if (!date || !time) return null;
  const candidate = `${date}T${time}`;
  return isLocalDateTime(candidate) ? candidate : null;
}
