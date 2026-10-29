import type {
  AuthorityStatus,
  CarrierFacts,
  SafetyRating,
} from "@/domain/carrier/snapshot";
import type { CarrierIdentity } from "@/domain/ports/carrier-lookup";
import type { FmcsaCarrier } from "./schema";

/** Stored on every check so a later provider is distinguishable in the history. */
export const FMCSA_SOURCE = "fmcsa.qcmobile";

function text(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(raw: number | string | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const value = text(raw);
  if (value === null) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function digits(raw: number | string | null | undefined): string | null {
  const value = num(raw);
  return value === null ? null : String(Math.trunc(value));
}

/** "Y"/"N", tolerating the long forms in case the upstream ever sends them. */
function yesNo(raw: string | null | undefined): "Y" | "N" | null {
  const value = text(raw)?.toUpperCase();
  if (value === "Y" || value === "YES" || value === "TRUE") return "Y";
  if (value === "N" || value === "NO" || value === "FALSE") return "N";
  return null;
}

/** Authority is reported as A (active), I (inactive), or N (none held). */
type AuthorityFlag = "A" | "I" | "N";

function authorityFlag(raw: string | null | undefined): AuthorityFlag | null {
  const value = text(raw)?.toUpperCase();
  if (value === "A" || value === "ACTIVE") return "A";
  if (value === "I" || value === "INACTIVE") return "I";
  if (value === "N" || value === "NONE") return "N";
  return null;
}

/**
 * FMCSA sends MM/DD/YYYY in most places and an ISO timestamp in others.
 * Returns null rather than a guess when it is neither — the raw payload is
 * stored whole, so nothing is lost by declining to parse.
 */
export function toIsoDate(raw: string | null | undefined): string | null {
  const value = text(raw);
  if (value === null) return null;

  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (mdy) {
    const [, month, day, year] = mdy;
    const m = Number(month);
    const d = Number(day);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/.exec(value);
  if (iso) {
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  return null;
}

/**
 * A carrier hauling freight needs common or contract authority. Broker
 * authority is a different business and says nothing about whether this
 * company can legally pull a trailer, so it is not consulted.
 *
 * `allowedToOperate` is checked first because it is FMCSA's own computed
 * answer to "may this carrier run today" — it accounts for out-of-service
 * orders and revocations that the per-type authority fields lag behind.
 *
 * Known gap: a carrier with no interstate authority on file but
 * `allowedToOperate: "Y"` is reported active. That is right for an intrastate
 * move and wrong for an interstate one, and the payload does not say which the
 * broker is booking. The verdict cannot close this; the UI has to.
 */
export function mapAuthorityStatus(carrier: FmcsaCarrier): AuthorityStatus {
  if (yesNo(carrier.allowedToOperate) === "N") return "not_authorized";

  const held = [
    authorityFlag(carrier.commonAuthorityStatus),
    authorityFlag(carrier.contractAuthorityStatus),
  ];

  if (held.includes("A")) return "active";
  if (held.includes("I")) return "inactive";
  if (held.includes("N")) return "not_authorized";

  if (yesNo(carrier.allowedToOperate) === "Y") return "active";
  return "unknown";
}

/**
 * BIPD — bodily injury and property damage liability — is the filing that is
 * legally required, reported as an amount in thousands of dollars. Cargo and
 * bond filings are not substitutes for it, so when BIPD is absent the honest
 * answer is null (unknown), not false.
 *
 * A true here means a filing exists, not that the coverage suits the load.
 */
export function mapInsuranceOnFile(carrier: FmcsaCarrier): boolean | null {
  const bipd = num(carrier.bipdInsuranceOnFile);
  return bipd === null ? null : bipd > 0;
}

/**
 * A rating comes from a compliance review, and most carriers have never had
 * one. Anything unrecognised maps to "unrated" — the verdict already treats
 * that as a warning, which is the right posture for a value we don't
 * understand.
 */
export function mapSafetyRating(carrier: FmcsaCarrier): SafetyRating {
  const value = text(carrier.safetyRating)?.toUpperCase();
  switch (value) {
    case "S":
    case "SATISFACTORY":
      return "satisfactory";
    case "C":
    case "CONDITIONAL":
      return "conditional";
    case "U":
    case "UNSATISFACTORY":
      return "unsatisfactory";
    default:
      return "unrated";
  }
}

export function mapCarrierFacts(carrier: FmcsaCarrier): CarrierFacts {
  // An out-of-service order is reported by the presence of a date. A date we
  // can't parse still means the order exists, so the flag reads the raw field
  // and only the date itself is allowed to come back null.
  const outOfService = text(carrier.oosDate) !== null;

  return {
    authorityStatus: mapAuthorityStatus(carrier),
    insuranceOnFile: mapInsuranceOnFile(carrier),
    safetyRating: mapSafetyRating(carrier),
    outOfService,
    outOfServiceDate: toIsoDate(carrier.oosDate),
    powerUnits: num(carrier.totalPowerUnits),
    drivers: num(carrier.totalDrivers),
  };
}

/**
 * The QCMobile carrier payload carries a DOT number but generally not an MC
 * number — docket numbers live on a separate endpoint. `mcNumber` is read
 * anyway in case it appears, and the caller fills in whatever was searched for.
 */
export function mapIdentity(carrier: FmcsaCarrier): CarrierIdentity {
  const dotNumber = digits(carrier.dotNumber);
  const legalName =
    text(carrier.legalName) ??
    (dotNumber ? `Unnamed carrier (DOT ${dotNumber})` : "Unnamed carrier");

  return {
    legalName,
    dbaName: text(carrier.dbaName),
    dotNumber,
    mcNumber: digits(carrier.mcNumber),
  };
}

/** Address and phone, for the carrier `details` jsonb column. */
export function mapContactDetails(carrier: FmcsaCarrier) {
  const street = text(carrier.phyStreet);
  const city = text(carrier.phyCity);
  const state = text(carrier.phyState);
  const zip = text(carrier.phyZipcode);
  const cityLine = [city, state].filter(Boolean).join(", ");
  const physicalAddress =
    [street, [cityLine, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") ||
    undefined;

  return {
    phone: text(carrier.telephone) ?? undefined,
    physicalAddress,
  };
}
