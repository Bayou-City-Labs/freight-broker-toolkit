/**
 * Synthetic QCMobile responses, shaped like the real thing but with invented
 * carriers. No real carrier data lives in the repo.
 *
 * The field spellings here are the ones the API actually sends, which are not
 * always the ones FMCSA documents — see the note in schema.ts.
 */

export function carrierResponse(overrides: Record<string, unknown> = {}) {
  return {
    content: {
      carrier: {
        allowedToOperate: "Y",
        bipdInsuranceOnFile: "1000",
        bipdInsuranceRequired: "Y",
        bipdRequiredAmount: "750",
        bondInsuranceOnFile: "0",
        cargoInsuranceOnFile: "0",
        commonAuthorityStatus: "A",
        contractAuthorityStatus: "N",
        brokerAuthorityStatus: "N",
        crashTotal: 1,
        dbaName: null,
        dotNumber: 4100001,
        legalName: "GULF COAST HAULING LLC",
        oosDate: null,
        phyCity: "HOUSTON",
        phyCountry: "US",
        phyState: "TX",
        phyStreet: "1200 NAVIGATION BLVD",
        phyZipcode: "77002",
        safetyRating: null,
        safetyRatingDate: null,
        statusCode: "A",
        telephone: "7135550100",
        totalDrivers: 14,
        totalPowerUnits: 12,
        ...overrides,
      },
      _links: { self: { href: "https://example.invalid/qc/services/carriers/4100001" } },
    },
    retrievalDate: "2026-10-28",
  };
}

/** The docket-number endpoint has been observed returning an array. */
export function docketResponse(overrides: Record<string, unknown> = {}) {
  const single = carrierResponse(overrides);
  return {
    content: [single.content],
    retrievalDate: single.retrievalDate,
  };
}

export const notFoundResponse = { content: null, retrievalDate: "2026-10-28" };

/**
 * Captured verbatim from the live API on 2026-10-28. Both are served with HTTP
 * **404**, with `content` as a plain string rather than a carrier object —
 * which is why the client reads the body before trusting the status.
 */
export const missingKeyResponse = {
  content: "Must provide Webkey",
  retrievalDate: "2026-10-29T01:55:21.240+0000",
  _links: { self: { href: "https://mobile.fmcsa.dot.gov/qc" } },
};

export const badKeyResponse = {
  content: "Webkey not found",
  retrievalDate: "2026-10-29T01:55:21.429+0000",
  _links: { self: { href: "https://mobile.fmcsa.dot.gov/qc" } },
};
