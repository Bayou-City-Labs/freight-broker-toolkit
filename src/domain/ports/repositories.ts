import type {
  Carrier,
  CarrierCheck,
  NewCarrier,
  NewCarrierCheck,
} from "../carrier/carrier";
import type { BrokerageScope } from "../tenancy";

/**
 * Persistence boundary.
 *
 * Every method takes a BrokerageScope as its first argument. This is the
 * mechanism behind "brokerageId on every table": scoping isn't something a
 * caller can forget to apply, because there is no way to call these without
 * supplying it.
 *
 * Repositories for Load, Party, Stop, and Document are intentionally absent —
 * those tables exist, but their access patterns should be designed against a
 * real module rather than guessed at now.
 */
export interface CarrierRepository {
  create(scope: BrokerageScope, input: NewCarrier): Promise<Carrier>;
  findById(scope: BrokerageScope, id: string): Promise<Carrier | null>;
  findByDotNumber(scope: BrokerageScope, dotNumber: string): Promise<Carrier | null>;
  findByMcNumber(scope: BrokerageScope, mcNumber: string): Promise<Carrier | null>;
  list(scope: BrokerageScope, limit?: number): Promise<Carrier[]>;
}

export interface CarrierCheckRepository {
  record(scope: BrokerageScope, input: NewCarrierCheck): Promise<CarrierCheck>;
  /** Most recent check for a carrier, or null if it has never been vetted. */
  latestFor(scope: BrokerageScope, carrierId: string): Promise<CarrierCheck | null>;
  /**
   * Most recent check for each of the given carriers, keyed by carrier id.
   * Carriers that have never been vetted are absent from the map.
   *
   * Exists so a list view showing every carrier's current verdict is one query
   * rather than one per row.
   */
  latestForEach(
    scope: BrokerageScope,
    carrierIds: readonly string[],
  ): Promise<Map<string, CarrierCheck>>;
  /** Newest first. The basis for Phase 3 monitoring diffs. */
  historyFor(
    scope: BrokerageScope,
    carrierId: string,
    limit?: number,
  ): Promise<CarrierCheck[]>;
}
