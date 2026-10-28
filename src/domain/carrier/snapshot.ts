import { createHash } from "node:crypto";

/**
 * The facts a broker actually vets a carrier on, normalized out of whatever
 * FMCSA returned. The raw payload is always kept alongside these — this is a
 * projection for querying and rule evaluation, not the record itself.
 */
export type AuthorityStatus = "active" | "inactive" | "not_authorized" | "unknown";

/**
 * A safety rating comes from a compliance review, which most carriers have
 * never had — "unrated" is the common case, not an error. It is a different
 * thing from CSA/SMS BASIC percentiles, which are relative to peers and only
 * partly public.
 */
export type SafetyRating = "satisfactory" | "conditional" | "unsatisfactory" | "unrated";

export interface CarrierFacts {
  readonly authorityStatus: AuthorityStatus;
  /** Null when the source did not report insurance either way. */
  readonly insuranceOnFile: boolean | null;
  readonly safetyRating: SafetyRating;
  readonly outOfService: boolean;
  /** ISO date, when the source reported one. */
  readonly outOfServiceDate: string | null;
  readonly powerUnits: number | null;
  readonly drivers: number | null;
}

/**
 * Deterministic JSON with object keys sorted at every level, so two fetches of
 * unchanged data hash identically regardless of key order on the wire.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Content hash of a raw provider payload.
 *
 * Phase 3 monitoring is scheduled re-checks plus diffs: fetch, hash, and only
 * do the expensive comparison when the hash moved.
 */
export function snapshotHash(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload), "utf8").digest("hex");
}
