import { describe, expect, it } from "vitest";
import { loadValuesSchema, stopValuesSchema } from "./load-values";

function stop(overrides: Record<string, unknown> = {}) {
  return {
    kind: "pickup",
    partyName: "ACME DISTRIBUTION",
    addressLine: "4400 Navigation Blvd",
    city: "Houston",
    state: "TX",
    postalCode: "77011",
    date: "2026-11-02",
    windowStart: "08:00",
    windowEnd: "12:00",
    referenceNumber: "PU-4471",
    windowRawText: "PU 11/02 0800-1200",
    ...overrides,
  };
}

function values(overrides: Record<string, unknown> = {}) {
  return {
    referenceNumber: "884213",
    carrierName: "GULF COAST HAULING LLC",
    carrierMcNumber: "987654",
    carrierDotNumber: null,
    commodity: "Palletized canned goods",
    weightLbs: 42000,
    equipment: "53' Dry Van",
    carrierRateCents: 185_000,
    stops: [stop()],
    ...overrides,
  };
}

describe("loadValuesSchema", () => {
  it("accepts a stated load", () => {
    expect(loadValuesSchema.safeParse(values()).success).toBe(true);
  });

  it("refuses a load with no stops", () => {
    const parsed = loadValuesSchema.safeParse(values({ stops: [] }));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0].message).toBe("A load needs at least one stop");
  });

  it("refuses a load with no reference number", () => {
    const parsed = loadValuesSchema.safeParse(values({ referenceNumber: "  " }));
    expect(parsed.success).toBe(false);
  });

  it("turns blank optional text into null rather than an empty string", () => {
    const parsed = stopValuesSchema.parse(stop({ city: "   " }));
    expect(parsed.city).toBeNull();
  });

  it("refuses a date or time that is not wall-clock notation", () => {
    expect(stopValuesSchema.safeParse(stop({ date: "11/02/2026" })).success).toBe(false);
    expect(stopValuesSchema.safeParse(stop({ windowStart: "8am" })).success).toBe(false);
    expect(stopValuesSchema.safeParse(stop({ windowStart: "24:00" })).success).toBe(false);
  });

  it("requires a name on every stop, because a stop is a place", () => {
    const parsed = stopValuesSchema.safeParse(stop({ partyName: "" }));
    expect(parsed.success).toBe(false);
  });
});
