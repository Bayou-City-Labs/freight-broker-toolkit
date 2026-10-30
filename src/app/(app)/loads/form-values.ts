import {
  confirmedLoadSchema,
  type ConfirmedLoad,
  type ConfirmedStop,
} from "@/domain/intake/confirm";
import { loadDraftSchema, type LoadDraft } from "@/domain/intake/load-draft";
import { compareToDraft } from "@/domain/intake/provenance";
import { editedLoadSchema, type EditedLoad } from "@/domain/load/update";
import { Money } from "@/domain/money";

/**
 * The review form's submission, turned into a `ConfirmedLoad`.
 *
 * Its own module rather than part of the action, so it can be tested: this is
 * the boundary where a human's typing becomes a record, and it is where the
 * mistakes are. The action around it does nothing but check the session and
 * call the use case.
 */
export type FormReadResult =
  | { readonly ok: true; readonly confirmed: ConfirmedLoad }
  | { readonly ok: false; readonly message: string };

export function readConfirmedLoad(formData: FormData): FormReadResult {
  const draft = parseDraft(formData.get("draft"));
  if (!draft) {
    return {
      ok: false,
      message: "This draft could not be read. Extract the document again.",
    };
  }

  const problems: string[] = [];
  const values = readLoadValues(formData, problems);

  // A number we cannot read is reported, never quietly nulled. Saving a load
  // without the rate the broker just typed is worse than refusing to save.
  if (problems.length > 0) return { ok: false, message: problems[0] };

  const comparison = compareToDraft(draft, values);

  const parsed = confirmedLoadSchema.safeParse({
    ...values,
    provenance: {
      producedBy: draft.producedBy,
      textSource: String(formData.get("textSource") ?? "plain-text"),
      filename: optional(formData.get("filename")),
      corrections: comparison.corrections,
      acceptedFlagged: comparison.acceptedFlagged,
    },
  });

  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Some of these values could not be saved.",
    };
  }

  return { ok: true, confirmed: parsed.data };
}

export type EditReadResult =
  | { readonly ok: true; readonly edited: EditedLoad }
  | { readonly ok: false; readonly message: string };

/**
 * The edit form's submission, turned into an `EditedLoad`.
 *
 * Shares `readLoadValues` with the confirm path, so the money and weight
 * parsing — the part a human's typing actually breaks — exists once. What it
 * adds is `stop.id`: the row a stop came from, or null for one the reviewer
 * added. That distinction is what lets the route be renumbered instead of
 * reissued.
 */
export function readEditedLoad(formData: FormData): EditReadResult {
  const problems: string[] = [];
  const values = readLoadValues(formData, problems);
  if (problems.length > 0) return { ok: false, message: problems[0] };

  const ids = formData.getAll("stop.id").map((value) => optional(value));

  const parsed = editedLoadSchema.safeParse({
    ...values,
    stops: values.stops.map((stop, index) => ({ ...stop, id: ids[index] ?? null })),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Some of these values could not be saved.",
    };
  }

  return { ok: true, edited: parsed.data };
}

/**
 * The draft the extractor produced, round-tripped through the browser.
 *
 * Re-validated rather than trusted. It arrives in a hidden field, so it is
 * external input like any other — and it is the basis for the correction
 * record, so a mangled one would quietly corrupt the evidence the confidence
 * scale gets tuned from.
 */
function parseDraft(value: FormDataEntryValue | null): LoadDraft | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = loadDraftSchema.safeParse(JSON.parse(value));
    return parsed.success ? (parsed.data as LoadDraft) : null;
  } catch {
    return null;
  }
}

/**
 * Stops arrive as parallel arrays rather than indexed field names.
 *
 * Every stop row posts `stop.kind`, `stop.partyName` and so on, and `getAll`
 * returns them in document order — which is display order, which is the
 * sequence. That is what makes adding and removing rows on the review screen
 * work without renumbering every input's `name` as the list changes.
 */
export function readLoadValues(
  formData: FormData,
  problems: string[],
): Omit<ConfirmedLoad, "provenance"> {
  const kinds = formData.getAll("stop.kind").map(String);

  const column = (name: string) => formData.getAll(`stop.${name}`);
  const partyNames = column("partyName");
  const addressLines = column("addressLine");
  const cities = column("city");
  const states = column("state");
  const postalCodes = column("postalCode");
  const dates = column("date");
  const windowStarts = column("windowStart");
  const windowEnds = column("windowEnd");
  const referenceNumbers = column("referenceNumber");
  const windowRawTexts = column("windowRawText");

  const stops: ConfirmedStop[] = kinds.map((kind, index) => ({
    kind: kind === "delivery" ? "delivery" : "pickup",
    partyName: String(partyNames[index] ?? "").trim(),
    addressLine: optional(addressLines[index]),
    city: optional(cities[index]),
    state: optional(states[index])?.toUpperCase() ?? null,
    postalCode: optional(postalCodes[index]),
    date: optional(dates[index]),
    windowStart: optional(windowStarts[index]),
    windowEnd: optional(windowEnds[index]),
    referenceNumber: optional(referenceNumbers[index]),
    windowRawText: optional(windowRawTexts[index]),
  }));

  return {
    referenceNumber: String(formData.get("referenceNumber") ?? "").trim(),
    carrierName: optional(formData.get("carrierName")),
    carrierMcNumber: digits(formData.get("carrierMcNumber")),
    carrierDotNumber: digits(formData.get("carrierDotNumber")),
    commodity: optional(formData.get("commodity")),
    weightLbs: wholeNumber(formData.get("weightLbs"), problems),
    equipment: optional(formData.get("equipment")),
    carrierRateCents: cents(formData.get("carrierRateCents"), problems),
    stops,
  };
}

function optional(value: FormDataEntryValue | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Brokers type "MC-123456" as often as "123456"; both mean the same number. */
function digits(value: FormDataEntryValue | null): string | null {
  const text = optional(value);
  if (text === null) return null;

  const stripped = text.replace(/\D/g, "").replace(/^0+/, "");
  return stripped.length > 0 ? stripped : null;
}

function wholeNumber(
  value: FormDataEntryValue | null,
  problems: string[],
): number | null {
  const text = optional(value);
  if (text === null) return null;

  const parsed = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) {
    problems.push(`"${text}" is not a weight. Enter pounds, digits only.`);
    return null;
  }
  return Math.round(parsed);
}

/**
 * The rate is typed in dollars and stored in cents, parsed from the string the
 * human typed rather than via a float — see the money rule.
 */
function cents(value: FormDataEntryValue | null, problems: string[]): number | null {
  const text = optional(value);
  if (text === null) return null;

  try {
    return Money.fromDollarString(text).cents;
  } catch {
    problems.push(`"${text}" is not an amount. Enter dollars, like 1850.00.`);
    return null;
  }
}
