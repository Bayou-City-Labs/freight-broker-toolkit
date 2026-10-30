import type {
  Carrier,
  CarrierCheck,
  NewCarrier,
  NewCarrierCheck,
} from "../carrier/carrier";
import type {
  Load,
  LoadUpdate,
  LoadWithStops,
  NewLoad,
  NewParty,
  NewStop,
  Party,
  StopWrite,
} from "../load/load";
import type { BrokerageScope } from "../tenancy";

/**
 * Persistence boundary.
 *
 * Every method takes a BrokerageScope as its first argument. This is the
 * mechanism behind "brokerageId on every table": scoping isn't something a
 * caller can forget to apply, because there is no way to call these without
 * supplying it.
 *
 * A Document repository is still absent — that table exists, but its access
 * patterns belong to document generation, which is not built. Load and Party
 * are here now because load intake is the real module they were waiting for.
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

export interface PartyRepository {
  create(scope: BrokerageScope, input: NewParty): Promise<Party>;
  findById(scope: BrokerageScope, id: string): Promise<Party | null>;
  /**
   * Case-insensitive exact name match.
   *
   * Intake reuses a facility rather than creating "WALMART DC 6094" four times
   * from four rate cons. Exact-match only on purpose: fuzzy matching here would
   * eventually merge two genuinely different docks, and a duplicate party is a
   * tidiness problem where a wrongly merged one puts freight at the wrong
   * address.
   */
  findByName(scope: BrokerageScope, name: string): Promise<Party | null>;
  list(scope: BrokerageScope, limit?: number): Promise<Party[]>;
  /**
   * Corrects a facility in place, which changes it for every load that touches
   * it. That is the intended behaviour: an address is a property of the dock,
   * not of one load, so a wrong ZIP is wrong everywhere. Renaming is a
   * different act — a stop that should point at a different facility is
   * re-resolved by name instead. Null when the facility is not in scope.
   *
   * `input` is a **full statement of the facility, not a patch**: every column
   * is written, so a field the caller omits is blanked — `country` back to
   * "US", `details` to `{}`, the contact fields and `addressLine2` to null.
   * Both callers spread the held record for that reason. `id`, `brokerageId`
   * and `createdAt` cannot be written through it.
   */
  update(scope: BrokerageScope, id: string, input: NewParty): Promise<Party | null>;
}

export interface LoadRepository {
  /**
   * Creates a load and its stops as one unit.
   *
   * Not two methods: a load with no stops has no route, and a half-written
   * route is worse than a failed import. The implementation wraps both inserts
   * in a transaction.
   */
  create(
    scope: BrokerageScope,
    input: NewLoad,
    stops: readonly NewStop[],
  ): Promise<LoadWithStops>;
  findById(scope: BrokerageScope, id: string): Promise<LoadWithStops | null>;
  /**
   * Rewrites a load and its whole route as one unit.
   *
   * The route is replaced rather than patched: stops carrying an id are kept
   * and renumbered, stops without one are inserted, and any stop of this load
   * absent from the list is deleted. Null when the load is not in scope.
   *
   * **Array order is the route order.** `sequence` on each `StopWrite` is
   * ignored here — it is derived from the position in the list — where
   * `create` honours it. And `input` is a total write: see `LoadUpdate` for
   * why `status` and `details` are required when `NewLoad` has both optional.
   *
   * Two stops stating the same id is not a case this answers well: both writes
   * carry it, the last one wins on the single surviving row, and the route
   * comes back shorter than it was written. Nothing reachable does it — the
   * form renders one id per row and only ever attaches an id it read back —
   * and a caller that can should dedupe before it gets here.
   */
  update(
    scope: BrokerageScope,
    id: string,
    input: LoadUpdate,
    stops: readonly StopWrite[],
  ): Promise<LoadWithStops | null>;
  /**
   * Reference numbers are unique per brokerage, so intake has to know whether
   * the number it read off a document is already taken before it saves.
   */
  findByReferenceNumber(
    scope: BrokerageScope,
    referenceNumber: string,
  ): Promise<Load | null>;
  /** Newest first. */
  list(scope: BrokerageScope, limit?: number): Promise<Load[]>;
}
