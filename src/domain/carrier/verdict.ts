import type { CarrierFacts } from "./snapshot";

/**
 * Pass / warn / fail summary for a carrier check.
 *
 * The verdict is a pure function of the facts plus a versioned ruleset, and
 * the raw payload is always stored, so verdicts can be re-derived when the
 * rules change. Bump CARRIER_RULESET_VERSION whenever the rules below change
 * — a stored verdict is only meaningful next to the version that produced it.
 *
 * Known limits of the public data, which the rules cannot work around:
 *  - Most carriers are "unrated"; absence of a bad rating is not a good sign.
 *  - CSA Crash Indicator and HazMat percentiles are not public, so a carrier
 *    can look clean here and still be flagged in FMCSA's own screening.
 *  - Insurance "on file" means a filing exists, not that coverage is adequate
 *    for a given load.
 */
export const CARRIER_RULESET_VERSION = "2026-10-28.1";

export type VerdictLevel = "pass" | "warn" | "fail";

export interface VerdictReason {
  /** Stable identifier, safe to key UI copy or alerting off. */
  readonly code: string;
  readonly level: VerdictLevel;
  readonly message: string;
}

export interface Verdict {
  readonly level: VerdictLevel;
  readonly reasons: readonly VerdictReason[];
  readonly rulesetVersion: string;
}

const SEVERITY: Record<VerdictLevel, number> = { pass: 0, warn: 1, fail: 2 };

export function evaluateCarrier(facts: CarrierFacts): Verdict {
  const reasons: VerdictReason[] = [];

  if (facts.outOfService) {
    reasons.push({
      code: "out_of_service",
      level: "fail",
      message: facts.outOfServiceDate
        ? `Carrier is out of service as of ${facts.outOfServiceDate}.`
        : "Carrier is out of service.",
    });
  }

  switch (facts.authorityStatus) {
    case "active":
      break;
    case "inactive":
    case "not_authorized":
      reasons.push({
        code: "authority_not_active",
        level: "fail",
        message: "Carrier does not hold active operating authority.",
      });
      break;
    case "unknown":
      reasons.push({
        code: "authority_unknown",
        level: "warn",
        message: "Operating authority status could not be determined.",
      });
      break;
  }

  if (facts.insuranceOnFile === false) {
    reasons.push({
      code: "no_insurance_on_file",
      level: "fail",
      message: "No active insurance filing on record.",
    });
  } else if (facts.insuranceOnFile === null) {
    reasons.push({
      code: "insurance_unknown",
      level: "warn",
      message: "Insurance status was not reported; verify the certificate directly.",
    });
  }

  switch (facts.safetyRating) {
    case "unsatisfactory":
      reasons.push({
        code: "safety_rating_unsatisfactory",
        level: "fail",
        message: "FMCSA safety rating is Unsatisfactory.",
      });
      break;
    case "conditional":
      reasons.push({
        code: "safety_rating_conditional",
        level: "warn",
        message: "FMCSA safety rating is Conditional.",
      });
      break;
    case "unrated":
      reasons.push({
        code: "safety_rating_unrated",
        level: "warn",
        message:
          "Carrier has never been rated; absence of a rating is not a clean record.",
      });
      break;
    case "satisfactory":
      break;
  }

  const level = reasons.reduce<VerdictLevel>(
    (worst, reason) => (SEVERITY[reason.level] > SEVERITY[worst] ? reason.level : worst),
    "pass",
  );

  return { level, reasons, rulesetVersion: CARRIER_RULESET_VERSION };
}
