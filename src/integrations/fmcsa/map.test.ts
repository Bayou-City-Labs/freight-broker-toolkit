import { describe, expect, it } from "vitest";
import { evaluateCarrier } from "@/domain/carrier/verdict";
import { carrierResponse, docketResponse, notFoundResponse } from "./fixtures";
import {
  mapAuthorityStatus,
  mapCarrierFacts,
  mapContactDetails,
  mapIdentity,
  mapInsuranceOnFile,
  mapSafetyRating,
  toIsoDate,
} from "./map";
import { extractCarrier, fmcsaResponseSchema, type FmcsaCarrier } from "./schema";

/** Parses a fixture the way the client does, so the tests exercise the schema too. */
function parse(response: unknown): FmcsaCarrier {
  const parsed = fmcsaResponseSchema.parse(response);
  const carrier = extractCarrier(parsed);
  if (!carrier) throw new Error("fixture carried no carrier");
  return carrier;
}

function carrier(overrides: Record<string, unknown> = {}): FmcsaCarrier {
  return parse(carrierResponse(overrides));
}

describe("schema", () => {
  it("accepts an object content (DOT lookup)", () => {
    expect(extractCarrier(fmcsaResponseSchema.parse(carrierResponse()))).not.toBeNull();
  });

  it("accepts an array content (docket lookup)", () => {
    const parsed = fmcsaResponseSchema.parse(docketResponse());
    expect(extractCarrier(parsed)?.legalName).toBe("GULF COAST HAULING LLC");
  });

  it("treats a null content as no carrier", () => {
    expect(extractCarrier(fmcsaResponseSchema.parse(notFoundResponse))).toBeNull();
  });

  it("treats an empty array as no carrier", () => {
    expect(extractCarrier(fmcsaResponseSchema.parse({ content: [] }))).toBeNull();
  });

  it("keeps fields it does not model", () => {
    const parsed = carrier({ someNewField: "value" });
    expect(parsed.someNewField).toBe("value");
  });

  it("does not throw on a payload missing every field we read", () => {
    // The whole point of the lenient schema: an upstream change should degrade
    // the verdict, not take the screen down.
    expect(() => parse({ content: { carrier: {} } })).not.toThrow();
  });
});

describe("mapAuthorityStatus", () => {
  it("is active when common authority is active", () => {
    expect(mapAuthorityStatus(carrier())).toBe("active");
  });

  it("is active when only contract authority is held", () => {
    expect(
      mapAuthorityStatus(
        carrier({ commonAuthorityStatus: "N", contractAuthorityStatus: "A" }),
      ),
    ).toBe("active");
  });

  it("ignores broker authority, which is a different business", () => {
    expect(
      mapAuthorityStatus(
        carrier({
          commonAuthorityStatus: "N",
          contractAuthorityStatus: "N",
          brokerAuthorityStatus: "A",
        }),
      ),
    ).toBe("not_authorized");
  });

  it("is inactive when authority is held but lapsed", () => {
    expect(
      mapAuthorityStatus(
        carrier({ commonAuthorityStatus: "I", contractAuthorityStatus: "N" }),
      ),
    ).toBe("inactive");
  });

  it("lets allowedToOperate=N override an authority field that still says active", () => {
    // FMCSA's computed answer accounts for revocations the per-type fields lag.
    expect(
      mapAuthorityStatus(carrier({ allowedToOperate: "N", commonAuthorityStatus: "A" })),
    ).toBe("not_authorized");
  });

  it("falls back to allowedToOperate when no authority fields are present", () => {
    expect(
      mapAuthorityStatus(
        carrier({
          allowedToOperate: "Y",
          commonAuthorityStatus: null,
          contractAuthorityStatus: null,
        }),
      ),
    ).toBe("active");
  });

  it("is unknown when the payload says nothing either way", () => {
    expect(mapAuthorityStatus(parse({ content: { carrier: {} } }))).toBe("unknown");
  });

  it("tolerates long-form values", () => {
    expect(mapAuthorityStatus(carrier({ commonAuthorityStatus: "Active" }))).toBe(
      "active",
    );
  });
});

describe("mapInsuranceOnFile", () => {
  it("is true when a BIPD filing amount is on record", () => {
    expect(mapInsuranceOnFile(carrier())).toBe(true);
  });

  it("is false when the BIPD amount is zero", () => {
    expect(mapInsuranceOnFile(carrier({ bipdInsuranceOnFile: "0" }))).toBe(false);
  });

  it("handles the amount arriving as a number", () => {
    expect(mapInsuranceOnFile(carrier({ bipdInsuranceOnFile: 1000 }))).toBe(true);
  });

  it("is null — not false — when BIPD is absent", () => {
    // Cargo and bond filings are not substitutes for liability coverage, so an
    // absent BIPD means unknown. Reporting false would be an accusation.
    expect(
      mapInsuranceOnFile(
        carrier({ bipdInsuranceOnFile: null, cargoInsuranceOnFile: "50" }),
      ),
    ).toBeNull();
  });
});

describe("mapSafetyRating", () => {
  it("maps the single-letter codes", () => {
    expect(mapSafetyRating(carrier({ safetyRating: "S" }))).toBe("satisfactory");
    expect(mapSafetyRating(carrier({ safetyRating: "C" }))).toBe("conditional");
    expect(mapSafetyRating(carrier({ safetyRating: "U" }))).toBe("unsatisfactory");
  });

  it("maps the long forms", () => {
    expect(mapSafetyRating(carrier({ safetyRating: "Conditional" }))).toBe("conditional");
  });

  it("treats null as unrated, which is the common case", () => {
    expect(mapSafetyRating(carrier({ safetyRating: null }))).toBe("unrated");
    expect(mapSafetyRating(carrier({ safetyRating: "  " }))).toBe("unrated");
  });

  it("treats an unrecognised code as unrated rather than guessing", () => {
    expect(mapSafetyRating(carrier({ safetyRating: "X" }))).toBe("unrated");
  });
});

describe("toIsoDate", () => {
  it("converts the MM/DD/YYYY form FMCSA usually sends", () => {
    expect(toIsoDate("10/20/2026")).toBe("2026-10-20");
    expect(toIsoDate("1/5/2026")).toBe("2026-01-05");
  });

  it("takes the date part of an ISO timestamp", () => {
    expect(toIsoDate("2026-10-20T00:00:00Z")).toBe("2026-10-20");
    expect(toIsoDate("2026-10-20")).toBe("2026-10-20");
  });

  it("returns null for nonsense rather than storing a malformed date", () => {
    expect(toIsoDate("13/45/2026")).toBeNull();
    expect(toIsoDate("sometime last year")).toBeNull();
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });
});

describe("mapCarrierFacts", () => {
  it("reads a clean carrier", () => {
    expect(mapCarrierFacts(carrier())).toEqual({
      authorityStatus: "active",
      insuranceOnFile: true,
      safetyRating: "unrated",
      outOfService: false,
      outOfServiceDate: null,
      powerUnits: 12,
      drivers: 14,
    });
  });

  it("flags out of service from the presence of a date", () => {
    const facts = mapCarrierFacts(carrier({ oosDate: "10/20/2026" }));
    expect(facts.outOfService).toBe(true);
    expect(facts.outOfServiceDate).toBe("2026-10-20");
  });

  it("still flags out of service when the date is unparseable", () => {
    // The order exists even if we can't read the date off it.
    const facts = mapCarrierFacts(carrier({ oosDate: "last tuesday" }));
    expect(facts.outOfService).toBe(true);
    expect(facts.outOfServiceDate).toBeNull();
  });

  it("coerces counts sent as strings", () => {
    const facts = mapCarrierFacts(carrier({ totalPowerUnits: "12", totalDrivers: "14" }));
    expect(facts.powerUnits).toBe(12);
    expect(facts.drivers).toBe(14);
  });

  it("degrades an empty payload to unknowns instead of throwing", () => {
    expect(mapCarrierFacts(parse({ content: { carrier: {} } }))).toEqual({
      authorityStatus: "unknown",
      insuranceOnFile: null,
      safetyRating: "unrated",
      outOfService: false,
      outOfServiceDate: null,
      powerUnits: null,
      drivers: null,
    });
  });
});

describe("mapIdentity", () => {
  it("reads name and DOT number", () => {
    expect(mapIdentity(carrier())).toEqual({
      legalName: "GULF COAST HAULING LLC",
      dbaName: null,
      dotNumber: "4100001",
      mcNumber: null,
    });
  });

  it("keeps a DBA when there is one", () => {
    expect(mapIdentity(carrier({ dbaName: "GULF COAST EXPRESS" })).dbaName).toBe(
      "GULF COAST EXPRESS",
    );
  });

  it("falls back to a name derived from the DOT number", () => {
    expect(mapIdentity(carrier({ legalName: null })).legalName).toBe(
      "Unnamed carrier (DOT 4100001)",
    );
  });
});

describe("mapContactDetails", () => {
  it("assembles a one-line address", () => {
    expect(mapContactDetails(carrier())).toEqual({
      phone: "7135550100",
      physicalAddress: "1200 NAVIGATION BLVD, HOUSTON, TX 77002",
    });
  });

  it("omits what the payload doesn't carry", () => {
    expect(mapContactDetails(parse({ content: { carrier: {} } }))).toEqual({
      phone: undefined,
      physicalAddress: undefined,
    });
  });
});

describe("facts feed the verdict rules", () => {
  it("passes an active, insured, satisfactory carrier", () => {
    const verdict = evaluateCarrier(mapCarrierFacts(carrier({ safetyRating: "S" })));
    expect(verdict.level).toBe("pass");
  });

  it("warns on the common case of an unrated carrier", () => {
    const verdict = evaluateCarrier(mapCarrierFacts(carrier()));
    expect(verdict.level).toBe("warn");
    expect(verdict.reasons.map((r) => r.code)).toEqual(["safety_rating_unrated"]);
  });

  it("fails a carrier under an out-of-service order", () => {
    const verdict = evaluateCarrier(
      mapCarrierFacts(carrier({ oosDate: "10/20/2026", allowedToOperate: "N" })),
    );
    expect(verdict.level).toBe("fail");
    expect(verdict.reasons.map((r) => r.code)).toContain("out_of_service");
    expect(verdict.reasons.map((r) => r.code)).toContain("authority_not_active");
  });

  it("fails a carrier with no liability filing", () => {
    const verdict = evaluateCarrier(
      mapCarrierFacts(carrier({ bipdInsuranceOnFile: "0" })),
    );
    expect(verdict.level).toBe("fail");
    expect(verdict.reasons.map((r) => r.code)).toContain("no_insurance_on_file");
  });
});
