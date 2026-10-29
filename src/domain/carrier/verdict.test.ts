import { describe, expect, it } from "vitest";
import type { CarrierFacts } from "./snapshot";
import { CARRIER_RULESET_VERSION, evaluateCarrier } from "./verdict";

function facts(overrides: Partial<CarrierFacts> = {}): CarrierFacts {
  return {
    authorityStatus: "active",
    insuranceOnFile: true,
    safetyRating: "satisfactory",
    outOfService: false,
    outOfServiceDate: null,
    powerUnits: 12,
    drivers: 14,
    ...overrides,
  };
}

const codes = (f: CarrierFacts) => evaluateCarrier(f).reasons.map((r) => r.code);

describe("evaluateCarrier", () => {
  it("passes a carrier with active authority, insurance, and a clean rating", () => {
    const verdict = evaluateCarrier(facts());
    expect(verdict.level).toBe("pass");
    expect(verdict.reasons).toEqual([]);
  });

  it("stamps the ruleset version so a stored verdict stays interpretable", () => {
    expect(evaluateCarrier(facts()).rulesetVersion).toBe(CARRIER_RULESET_VERSION);
  });

  it("fails a carrier without active authority", () => {
    expect(evaluateCarrier(facts({ authorityStatus: "inactive" })).level).toBe("fail");
    expect(evaluateCarrier(facts({ authorityStatus: "not_authorized" })).level).toBe(
      "fail",
    );
    expect(codes(facts({ authorityStatus: "inactive" }))).toContain(
      "authority_not_active",
    );
  });

  it("fails a carrier that is out of service and names the date", () => {
    const verdict = evaluateCarrier(
      facts({ outOfService: true, outOfServiceDate: "2026-09-14" }),
    );
    expect(verdict.level).toBe("fail");
    expect(verdict.reasons[0].message).toContain("2026-09-14");
  });

  it("fails a carrier with no insurance filing", () => {
    expect(evaluateCarrier(facts({ insuranceOnFile: false })).level).toBe("fail");
  });

  it("warns, rather than fails, when insurance was not reported", () => {
    const verdict = evaluateCarrier(facts({ insuranceOnFile: null }));
    expect(verdict.level).toBe("warn");
    expect(codes(facts({ insuranceOnFile: null }))).toContain("insurance_unknown");
  });

  it("fails an unsatisfactory rating and warns on a conditional one", () => {
    expect(evaluateCarrier(facts({ safetyRating: "unsatisfactory" })).level).toBe("fail");
    expect(evaluateCarrier(facts({ safetyRating: "conditional" })).level).toBe("warn");
  });

  it("warns on an unrated carrier, because no rating is not a clean record", () => {
    const verdict = evaluateCarrier(facts({ safetyRating: "unrated" }));
    expect(verdict.level).toBe("warn");
    expect(codes(facts({ safetyRating: "unrated" }))).toContain("safety_rating_unrated");
  });

  it("warns when authority status could not be determined", () => {
    expect(evaluateCarrier(facts({ authorityStatus: "unknown" })).level).toBe("warn");
  });

  it("reports the worst level but keeps every reason", () => {
    const verdict = evaluateCarrier(
      facts({
        authorityStatus: "inactive",
        safetyRating: "conditional",
        insuranceOnFile: null,
      }),
    );
    expect(verdict.level).toBe("fail");
    expect(verdict.reasons).toHaveLength(3);
    expect(verdict.reasons.map((r) => r.level).sort()).toEqual(["fail", "warn", "warn"]);
  });
});
