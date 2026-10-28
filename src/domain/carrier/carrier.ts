import type { CarrierDetails } from "../details";
import type { CarrierFacts } from "./snapshot";
import type { Verdict } from "./verdict";

/**
 * Domain shapes for carriers and their vetting history. These are deliberately
 * independent of the database row types: the ORM stays on the other side of
 * the repository boundary so this layer can move into a shared package later.
 */
export interface Carrier {
  readonly id: string;
  readonly brokerageId: string;
  readonly dotNumber: string | null;
  readonly mcNumber: string | null;
  readonly legalName: string;
  readonly dbaName: string | null;
  readonly details: CarrierDetails;
}

export interface NewCarrier {
  readonly dotNumber?: string | null;
  readonly mcNumber?: string | null;
  readonly legalName: string;
  readonly dbaName?: string | null;
  readonly details?: CarrierDetails;
}

/** A single timestamped vetting result, with the raw payload that produced it. */
export interface CarrierCheck {
  readonly id: string;
  readonly brokerageId: string;
  readonly carrierId: string;
  readonly checkedAt: Date;
  /** Which upstream produced this, e.g. "fmcsa.qcmobile". */
  readonly source: string;
  readonly payload: Record<string, unknown>;
  readonly payloadHash: string;
  readonly facts: CarrierFacts;
  readonly verdict: Verdict;
}

export interface NewCarrierCheck {
  readonly carrierId: string;
  readonly source: string;
  readonly payload: Record<string, unknown>;
  readonly facts: CarrierFacts;
  readonly verdict: Verdict;
  readonly checkedAt?: Date;
}
