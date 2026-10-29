import type { CarrierIdentifier } from "../carrier/identifier";
import type { CarrierFacts } from "../carrier/snapshot";
import type { CarrierDetails } from "../details";

/**
 * What a lookup provider returns for one carrier.
 *
 * `payload` is the provider's response verbatim. It is stored alongside the
 * derived `facts` so a verdict can be re-derived when the rules change, and so
 * a field we haven't modelled yet is still on record when we want it.
 */
export interface CarrierLookupResult {
  /** Which upstream produced this, e.g. "fmcsa.qcmobile". Stored on the check. */
  readonly source: string;
  readonly payload: Record<string, unknown>;
  readonly identity: CarrierIdentity;
  readonly facts: CarrierFacts;
  /** Contact information, when the provider reports any. */
  readonly details?: CarrierDetails;
}

/** Enough to create a carrier record we didn't already have. */
export interface CarrierIdentity {
  readonly legalName: string;
  readonly dbaName: string | null;
  readonly dotNumber: string | null;
  readonly mcNumber: string | null;
}

export interface CarrierLookup {
  /** Resolves to null when the provider has no such carrier. */
  byIdentifier(identifier: CarrierIdentifier): Promise<CarrierLookupResult | null>;
}

/**
 * The provider could not answer — network, timeout, bad credentials, rate
 * limit, upstream outage.
 *
 * Deliberately distinct from a null result: "FMCSA has never heard of MC-1"
 * and "FMCSA is down" must not look the same to a broker about to book a load.
 * One is a finding; the other means we know nothing.
 */
export class CarrierLookupError extends Error {
  readonly kind: CarrierLookupErrorKind;

  constructor(kind: CarrierLookupErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CarrierLookupError";
    this.kind = kind;
  }
}

export type CarrierLookupErrorKind =
  /** No API key configured, or the provider rejected it. */
  | "not_configured"
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  /** A 200 whose body wasn't the shape we parse. */
  | "malformed_response";
