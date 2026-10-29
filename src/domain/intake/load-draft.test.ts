import { describe, expect, it } from "vitest";
import {
  CONFIDENT_ENOUGH,
  emptyDraft,
  emptyStop,
  field,
  flaggedFields,
  isReadyToConfirm,
  loadDraftSchema,
  missing,
  stopWindowEnd,
  stopWindowStart,
  type LoadDraft,
  type StopDraft,
} from "./load-draft";

function completeStop(overrides: Partial<StopDraft> = {}): StopDraft {
  return {
    ...emptyStop("pickup", 0),
    partyName: field("HOUSTON TERMINAL WAREHOUSE", 1, "HOUSTON TERMINAL WAREHOUSE"),
    addressLine: field("2100 Navigation Blvd", 1),
    city: field("Houston", 1),
    state: field("TX", 1),
    postalCode: field("77003", 1),
    date: field("2026-10-30", 1),
    windowStart: field("08:00", 1),
    windowEnd: field("12:00", 1),
    referenceNumber: field("PU-4821", 1),
    ...overrides,
  };
}

function completeDraft(overrides: Partial<LoadDraft> = {}): LoadDraft {
  return {
    ...emptyDraft("test-parser"),
    loadNumber: field("884213", 1),
    carrierName: field("GULF COAST HAULING LLC", 1),
    carrierMcNumber: field("133655", 1),
    carrierDotNumber: field("264184", 1),
    commodity: field("Canned goods", 1),
    weightLbs: field(42000, 1),
    equipment: field("53' Dry Van", 1),
    carrierRateCents: field(245000, 1),
    stops: [completeStop(), completeStop({ kind: "delivery", sequence: 1 })],
    ...overrides,
  };
}

describe("field", () => {
  it("keeps value, confidence, and source text together", () => {
    expect(field("42000", 0.9, "Weight: 42000 lbs")).toEqual({
      value: "42000",
      confidence: 0.9,
      sourceText: "Weight: 42000 lbs",
    });
  });

  it("forces confidence to zero when there is no value", () => {
    // A confident null is a contradiction, and would skip review.
    expect(field(null, 0.99).confidence).toBe(0);
  });

  it("clamps out-of-range confidence", () => {
    expect(field("x", 5).confidence).toBe(1);
    expect(field("x", -1).confidence).toBe(0);
    expect(field("x", Number.NaN).confidence).toBe(0);
  });

  it("defaults source text to null", () => {
    expect(field("x", 1).sourceText).toBeNull();
  });
});

describe("missing", () => {
  it("is an absent, zero-confidence field", () => {
    expect(missing()).toEqual({ value: null, confidence: 0, sourceText: null });
  });
});

describe("loadDraftSchema", () => {
  it("accepts a complete draft", () => {
    expect(loadDraftSchema.safeParse(completeDraft()).success).toBe(true);
  });

  it("accepts an empty draft", () => {
    expect(loadDraftSchema.safeParse(emptyDraft("test-parser")).success).toBe(true);
  });

  it("rejects a malformed date", () => {
    const draft = completeDraft({
      stops: [completeStop({ date: field("10/30/2026", 1) })],
    });
    expect(loadDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects a malformed time", () => {
    const draft = completeDraft({
      stops: [completeStop({ windowStart: field("8am", 1) })],
    });
    expect(loadDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects a 24-hour time that isn't one", () => {
    const draft = completeDraft({
      stops: [completeStop({ windowStart: field("25:00", 1) })],
    });
    expect(loadDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects fractional cents", () => {
    // The money rule: integer cents or nothing.
    const draft = completeDraft({ carrierRateCents: field(245000.5, 1) });
    expect(loadDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects confidence outside 0..1", () => {
    const draft = completeDraft({
      carrierName: { value: "X", confidence: 1.5, sourceText: null },
    });
    expect(loadDraftSchema.safeParse(draft).success).toBe(false);
  });
});

describe("flaggedFields", () => {
  it("flags nothing when everything is present and certain", () => {
    expect(flaggedFields(completeDraft())).toEqual([]);
  });

  it("flags a required field that is missing", () => {
    const flags = flaggedFields(completeDraft({ carrierRateCents: missing() }));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      path: "carrierRateCents",
      label: "Carrier rate",
      reason: "missing",
    });
  });

  it("does not nag about an optional field the document genuinely lacks", () => {
    // Plenty of rate cons carry no reference number. Flagging it trains people
    // to ignore flags.
    const draft = completeDraft({
      stops: [completeStop({ referenceNumber: missing() })],
    });
    expect(flaggedFields(draft)).toEqual([]);
  });

  it("flags an optional field that was read but is uncertain", () => {
    const draft = completeDraft({
      stops: [completeStop({ referenceNumber: field("PU-4821", 0.4) })],
    });
    const flags = flaggedFields(draft);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ reason: "low_confidence", confidence: 0.4 });
  });

  it("flags at the threshold boundary but not above it", () => {
    const below = completeDraft({
      carrierName: field("GULF COAST", CONFIDENT_ENOUGH - 0.01),
    });
    const at = completeDraft({ carrierName: field("GULF COAST", CONFIDENT_ENOUGH) });

    expect(flaggedFields(below)).toHaveLength(1);
    expect(flaggedFields(at)).toEqual([]);
  });

  it("labels stop fields by kind and position", () => {
    const draft = completeDraft({
      stops: [completeStop({ date: missing() }), completeStop({ kind: "delivery" })],
    });
    expect(flaggedFields(draft)[0].label).toBe("Pickup 1 — Date");
  });

  it("uses a dotted path so the UI can target the field", () => {
    const draft = completeDraft({
      stops: [completeStop(), completeStop({ kind: "delivery", date: missing() })],
    });
    expect(flaggedFields(draft)[0].path).toBe("stops.1.date");
  });

  it("flags everything required on an empty draft", () => {
    const flags = flaggedFields(emptyDraft("test-parser"));
    expect(flags.map((f) => f.path)).toEqual(["carrierName", "carrierRateCents"]);
  });
});

describe("isReadyToConfirm", () => {
  it("is true for a complete draft", () => {
    expect(isReadyToConfirm(completeDraft())).toBe(true);
  });

  it("is false when a field is flagged", () => {
    expect(isReadyToConfirm(completeDraft({ carrierName: missing() }))).toBe(false);
  });

  it("is false with no stops, even if every other field is certain", () => {
    // A load that goes nowhere is not a load.
    expect(isReadyToConfirm(completeDraft({ stops: [] }))).toBe(false);
  });
});

describe("stop windows", () => {
  it("joins date and time into naive local wall time", () => {
    const stop = completeStop();
    expect(stopWindowStart(stop)).toBe("2026-10-30T08:00");
    expect(stopWindowEnd(stop)).toBe("2026-10-30T12:00");
  });

  it("is null when either half is missing", () => {
    expect(stopWindowStart(completeStop({ date: missing() }))).toBeNull();
    expect(stopWindowStart(completeStop({ windowStart: missing() }))).toBeNull();
  });

  it("is null rather than malformed when the parts don't combine", () => {
    expect(stopWindowStart(completeStop({ date: field("2026-13-45", 1) }))).toBeNull();
  });
});
