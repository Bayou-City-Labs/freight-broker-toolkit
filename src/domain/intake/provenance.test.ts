import { describe, expect, it } from "vitest";
import type { ConfirmedLoad, ConfirmedStop } from "./confirm";
import { emptyDraft, emptyStop, field, type LoadDraft } from "./load-draft";
import { compareToDraft } from "./provenance";

function draft(): LoadDraft {
  return {
    ...emptyDraft("label-proximity-v1"),
    loadNumber: field("884213", 0.9, "Load #: 884213"),
    carrierName: field("GULF COAST HAULING LLC", 0.9, "Carrier: GULF COAST HAULING LLC"),
    weightLbs: field(42000, 0.9, "Weight: 42,000 lbs"),
    // Read off the page by shape, not by label — the parser is unsure.
    equipment: field("53 Dry Van", 0.55, "53 Dry Van"),
    carrierRateCents: field(185_000, 0.9, "Total Rate: $1,850.00"),
    stops: [
      {
        ...emptyStop("pickup", 0),
        partyName: field("ACME DISTRIBUTION", 0.7, "ACME DISTRIBUTION"),
        city: field("Houston", 0.55, "Houston, TX 77011"),
        date: field("2026-11-02", 0.9, "Date: 11/02/2026"),
      },
    ],
  };
}

function stop(overrides: Partial<ConfirmedStop> = {}): ConfirmedStop {
  return {
    kind: "pickup",
    partyName: "ACME DISTRIBUTION",
    addressLine: null,
    city: "Houston",
    state: null,
    postalCode: null,
    date: "2026-11-02",
    windowStart: null,
    windowEnd: null,
    referenceNumber: null,
    windowRawText: null,
    ...overrides,
  };
}

function confirmed(
  overrides: Partial<Omit<ConfirmedLoad, "provenance">> = {},
): Omit<ConfirmedLoad, "provenance"> {
  return {
    referenceNumber: "884213",
    carrierName: "GULF COAST HAULING LLC",
    carrierMcNumber: null,
    carrierDotNumber: null,
    commodity: null,
    weightLbs: 42000,
    equipment: "53 Dry Van",
    carrierRateCents: 185_000,
    stops: [stop()],
    ...overrides,
  };
}

describe("compareToDraft", () => {
  it("reports nothing corrected when the human accepted the draft", () => {
    const result = compareToDraft(draft(), confirmed());
    expect(result.corrections).toEqual([]);
  });

  it("records a correction with the confidence the parser had claimed", () => {
    const result = compareToDraft(draft(), confirmed({ weightLbs: 44000 }));

    // 0.9 and wrong. This is the case that says the scale is too generous.
    expect(result.corrections).toEqual([{ path: "weightLbs", confidence: 0.9 }]);
  });

  it("maps the document's load number onto the load's reference number", () => {
    const result = compareToDraft(draft(), confirmed({ referenceNumber: "884214" }));
    expect(result.corrections).toEqual([{ path: "loadNumber", confidence: 0.9 }]);
  });

  it("records corrections inside a stop by path", () => {
    const result = compareToDraft(
      draft(),
      confirmed({ stops: [stop({ date: "2026-11-03" })] }),
    );
    expect(result.corrections).toEqual([{ path: "stops.0.date", confidence: 0.9 }]);
  });

  it("notes a changed stop count, which no confidence covers", () => {
    const result = compareToDraft(
      draft(),
      confirmed({ stops: [stop(), stop({ kind: "delivery", partyName: "LONE STAR" })] }),
    );
    expect(result.corrections).toContainEqual({ path: "stops", confidence: 0 });
  });

  it("lists flagged fields the human accepted unchanged", () => {
    const result = compareToDraft(draft(), confirmed());

    // Both were below the review threshold and both were right.
    expect(result.acceptedFlagged).toContain("equipment");
    expect(result.acceptedFlagged).toContain("stops.0.city");
  });

  it("does not count an accepted field as corrected, or the reverse", () => {
    const result = compareToDraft(draft(), confirmed({ equipment: "53' Reefer" }));

    expect(result.corrections).toEqual([{ path: "equipment", confidence: 0.55 }]);
    expect(result.acceptedFlagged).not.toContain("equipment");
  });

  it("ignores whitespace a form round-trip introduced", () => {
    const result = compareToDraft(
      draft(),
      confirmed({ carrierName: "  GULF COAST HAULING LLC  " }),
    );
    expect(result.corrections).toEqual([]);
  });

  it("treats clearing a field as a correction", () => {
    const result = compareToDraft(draft(), confirmed({ carrierName: null }));
    expect(result.corrections).toEqual([{ path: "carrierName", confidence: 0.9 }]);
  });
});
