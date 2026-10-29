import { describe, expect, it } from "vitest";
import {
  detectIdentifierKind,
  formatIdentifier,
  parseCarrierIdentifier,
} from "./identifier";

describe("detectIdentifierKind", () => {
  it("reads an MC prefix in the shapes brokers actually type", () => {
    for (const raw of [
      "MC-123456",
      "mc 123456",
      "MC123456",
      "#MC-123456",
      "docket 1234",
    ]) {
      expect(detectIdentifierKind(raw)).toBe("mc");
    }
  });

  it("reads the other docket prefixes FMCSA issues", () => {
    expect(detectIdentifierKind("FF-9999")).toBe("mc");
    expect(detectIdentifierKind("MX-12345")).toBe("mc");
  });

  it("reads a DOT prefix", () => {
    for (const raw of ["DOT 76830", "USDOT76830", "US DOT 76830", "usdot 76830"]) {
      expect(detectIdentifierKind(raw)).toBe("dot");
    }
  });

  it("returns null for a bare number rather than guessing", () => {
    // An MC and a DOT number are both bare digits. Guessing wrong vets a
    // different company, which is worse than asking.
    expect(detectIdentifierKind("123456")).toBeNull();
    expect(detectIdentifierKind("  76830  ")).toBeNull();
  });
});

describe("parseCarrierIdentifier", () => {
  it("falls back to the caller's kind when there is no prefix", () => {
    expect(parseCarrierIdentifier("123456", "mc")).toEqual({
      kind: "mc",
      value: "123456",
    });
    expect(parseCarrierIdentifier("123456", "dot")).toEqual({
      kind: "dot",
      value: "123456",
    });
  });

  it("lets an explicit prefix override the fallback", () => {
    // The broker picked DOT in the UI, then pasted an MC number. They meant MC.
    expect(parseCarrierIdentifier("MC-123456", "dot")).toEqual({
      kind: "mc",
      value: "123456",
    });
    expect(parseCarrierIdentifier("USDOT 76830", "mc")).toEqual({
      kind: "dot",
      value: "76830",
    });
  });

  it("strips punctuation, spacing, and leading zeros", () => {
    expect(parseCarrierIdentifier("MC - 00123,456", "mc")?.value).toBe("123456");
    expect(parseCarrierIdentifier("0076830", "dot")?.value).toBe("76830");
  });

  it("rejects input with no digits", () => {
    expect(parseCarrierIdentifier("", "mc")).toBeNull();
    expect(parseCarrierIdentifier("   ", "mc")).toBeNull();
    expect(parseCarrierIdentifier("MC-", "mc")).toBeNull();
    expect(parseCarrierIdentifier("ACME TRUCKING", "mc")).toBeNull();
  });

  it("rejects zero, which is never a valid number", () => {
    expect(parseCarrierIdentifier("0", "dot")).toBeNull();
    expect(parseCarrierIdentifier("000", "dot")).toBeNull();
  });

  it("rejects input too long to be either number", () => {
    // A pasted phone number should fail here, not upstream.
    expect(parseCarrierIdentifier("713-555-0100", "mc")).toBeNull();
    expect(parseCarrierIdentifier("123456789", "dot")).toBeNull();
  });

  it("accepts the boundary length", () => {
    expect(parseCarrierIdentifier("12345678", "dot")?.value).toBe("12345678");
  });
});

describe("formatIdentifier", () => {
  it("renders each kind the way a broker reads it", () => {
    expect(formatIdentifier({ kind: "mc", value: "123456" })).toBe("MC-123456");
    expect(formatIdentifier({ kind: "dot", value: "76830" })).toBe("DOT 76830");
  });
});
