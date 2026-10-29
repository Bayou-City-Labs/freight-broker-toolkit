import { describe, expect, it } from "vitest";
import { carrierNameMatches, normalizeCarrierName } from "./carrier-name";

const schneider = { legalName: "SCHNEIDER NATIONAL CARRIERS INC", dbaName: null };

describe("carrierNameMatches", () => {
  it("catches a document naming a different company than the number resolves to", () => {
    // The case that found this: a rate con for "GULF COAST HAULING LLC" under
    // MC-133655, which belongs to Schneider. Either a typo or double
    // brokering, and the screen must not quietly show Schneider's name.
    expect(carrierNameMatches("GULF COAST HAULING LLC", schneider)).toBe(false);
  });

  it("does not flag the same company written differently", () => {
    const gulf = { legalName: "GULF COAST HAULING LLC", dbaName: null };

    for (const written of [
      "GULF COAST HAULING LLC",
      "Gulf Coast Hauling, L.L.C.",
      "gulf coast hauling llc",
      "GULF COAST HAULING, INC.",
      "  GULF   COAST   HAULING  ",
    ]) {
      expect(carrierNameMatches(written, gulf)).toBe(true);
    }
  });

  it("accepts a shortened or extended form of the registered name", () => {
    expect(carrierNameMatches("SCHNEIDER NATIONAL", schneider)).toBe(true);
    expect(carrierNameMatches("SCHNEIDER NATIONAL CARRIERS INC", schneider)).toBe(true);
  });

  it("matches a trade name as well as the legal name", () => {
    const held = { legalName: "J B HUNT TRANSPORT INC", dbaName: "JB HUNT" };

    expect(carrierNameMatches("JB HUNT", held)).toBe(true);
    expect(carrierNameMatches("J.B. Hunt Transport", held)).toBe(true);
    expect(carrierNameMatches("SWIFT TRANSPORTATION", held)).toBe(false);
  });

  it("treats a missing name as nothing to disagree with", () => {
    // The parser could not read the carrier block. Flagging that would cry
    // wolf on every document with an unreadable carrier line.
    expect(carrierNameMatches(null, schneider)).toBe(true);
    expect(carrierNameMatches("   ", schneider)).toBe(true);
  });

  it("does not let a single short word match by containment", () => {
    expect(
      carrierNameMatches("GULF", { legalName: "GULF COAST HAULING", dbaName: null }),
    ).toBe(false);
  });
});

describe("normalizeCarrierName", () => {
  it("strips corporate form and punctuation", () => {
    expect(normalizeCarrierName("Gulf Coast Hauling, L.L.C.")).toBe("GULF COAST HAULING");
    expect(normalizeCarrierName("The Werner Company")).toBe("WERNER");
    expect(normalizeCarrierName("A&B Trucking Co.")).toBe("A B TRUCKING");
  });
});
