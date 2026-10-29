import { z } from "zod";
import type { LoadEditChange } from "../details";
import { Money } from "../money";
import type {
  CarrierRepository,
  LoadRepository,
  PartyRepository,
} from "../ports/repositories";
import type { BrokerageScope } from "../tenancy";
import type { Load, LoadWithStops, Party, Stop, StopWrite } from "./load";
import {
  classifyEquipment,
  findCarrier,
  loadValuesSchema,
  stopValuesSchema,
  toNewStop,
  type StopValues,
} from "./load-values";

/**
 * Editing a load that is already saved.
 *
 * The other side of intake: nothing here carries a confidence, because
 * everything has been typed by a person looking at the record. What it adds
 * over `confirmDraft` is that there is a *previous* state, so every save both
 * rewrites the load and says what it changed.
 *
 * Depends only on ports, so the whole flow is tested against fakes.
 */

/**
 * A stop as the edit form posts it. `id` is the row it came from; null means a
 * stop someone added, which is the difference between renumbering a route and
 * reissuing it.
 */
export const editedStopSchema = stopValuesSchema.extend({
  id: z.string().nullable(),
});

// `.extend` replaces the stops field wholesale, so the "at least one" rule has
// to be restated rather than inherited.
export const editedLoadSchema = loadValuesSchema.extend({
  stops: z.array(editedStopSchema).min(1, "A load needs at least one stop"),
});

export type EditedStop = z.infer<typeof editedStopSchema>;
export type EditedLoad = z.infer<typeof editedLoadSchema>;

export interface UpdateLoadDeps {
  readonly loads: LoadRepository;
  readonly parties: PartyRepository;
  readonly carriers: CarrierRepository;
  /**
   * Injected so a test can pin the edit timestamp, the same way `checkedAt` is
   * injectable on a carrier check. Defaulted here rather than taken as a port,
   * because a clock is not a vendor.
   */
  readonly now?: () => Date;
}

export type UpdateOutcome =
  | {
      readonly status: "saved";
      readonly load: Load;
      readonly stops: readonly Stop[];
      /** Whether the stated carrier matched one we already hold. */
      readonly carrierLinked: boolean;
    }
  /** Another load in this brokerage already uses the submitted number. */
  | { readonly status: "duplicate_reference"; readonly existing: Load }
  /** Absent, or belonging to another brokerage. The two are the same answer. */
  | { readonly status: "not_found" };

export type UpdateLoad = (
  scope: BrokerageScope,
  loadId: string,
  edited: EditedLoad,
) => Promise<UpdateOutcome>;

export function createUpdateLoad({
  loads,
  parties,
  carriers,
  now = () => new Date(),
}: UpdateLoadDeps): UpdateLoad {
  return async function updateLoad(scope, loadId, edited) {
    const current = await loads.findById(scope, loadId);
    if (!current) return { status: "not_found" };

    if (edited.referenceNumber !== current.load.referenceNumber) {
      const clash = await loads.findByReferenceNumber(scope, edited.referenceNumber);
      // A load is not a duplicate of itself, which is the whole reason this
      // check is not just the one `confirmDraft` makes.
      if (clash && clash.id !== loadId) {
        return { status: "duplicate_reference", existing: clash };
      }
    }

    const carrier = await findCarrier(scope, carriers, edited);

    const before = await statedView(scope, parties, current);

    const existingById = new Map(current.stops.map((stop) => [stop.id, stop]));
    const writes: StopWrite[] = [];

    for (const [index, stop] of edited.stops.entries()) {
      const existing = stop.id ? (existingById.get(stop.id) ?? null) : null;
      const party = await resolveParty(scope, parties, stop, existing);
      writes.push({
        ...toNewStop(stop, index, party, existing?.details ?? {}),
        ...(existing ? { id: existing.id } : {}),
      });
    }

    const changes = diff(before, edited);
    const edits =
      changes.length === 0
        ? current.load.details.edits
        : [
            ...(current.load.details.edits ?? []),
            { at: now().toISOString(), changes },
          ];

    const saved = await loads.update(
      scope,
      loadId,
      {
        referenceNumber: edited.referenceNumber,
        // Carried forward, not re-derived. Both are outside this form's remit:
        // status has no workflow yet, and the customer rate is the broker's own
        // number, which no document states and no screen here collects.
        status: current.load.status,
        customerRateCents: current.load.customerRateCents,
        equipmentType: classifyEquipment(edited.equipment),
        commodityDescription: edited.commodity,
        weightLbs: edited.weightLbs,
        carrierPayCents: edited.carrierRateCents,
        carrierId: carrier?.id ?? null,
        details: {
          ...current.load.details,
          ...(edited.equipment
            ? { equipmentAsWritten: edited.equipment }
            : { equipmentAsWritten: undefined }),
          ...(edited.carrierName
            ? { carrierAsWritten: edited.carrierName }
            : { carrierAsWritten: undefined }),
          ...(edits ? { edits } : {}),
        },
      },
      writes,
    );

    // findById succeeded a moment ago in the same scope, so a null here is a
    // row vanishing mid-edit rather than a permission answer.
    if (!saved) return { status: "not_found" };

    return {
      status: "saved",
      load: saved.load,
      stops: saved.stops,
      carrierLinked: carrier !== null,
    };
  };
}

/**
 * Resolves the facility a stop should point at.
 *
 * Name unchanged means "this is the same dock, and the address I typed is the
 * correction" — so the facility is fixed in place, for every load that touches
 * it. A different name means a different dock: resolve it by name or create
 * it, and leave the old one alone, because other loads point at it. A facility
 * is never renamed from here; the name is the identity `findByName` matches on.
 */
async function resolveParty(
  scope: BrokerageScope,
  parties: PartyRepository,
  stop: EditedStop,
  existing: Stop | null,
): Promise<Party> {
  if (existing) {
    const held = await parties.findById(scope, existing.partyId);
    if (held && held.name.trim().toLowerCase() === stop.partyName.trim().toLowerCase()) {
      const updated = await parties.update(scope, held.id, {
        ...held,
        addressLine1: stop.addressLine,
        city: stop.city,
        region: stop.state,
        postalCode: stop.postalCode,
      });
      if (updated) return updated;
    }
  }

  const byName = await parties.findByName(scope, stop.partyName);
  if (byName) return byName;

  return parties.create(scope, {
    name: stop.partyName,
    addressLine1: stop.addressLine,
    city: stop.city,
    region: stop.state,
    postalCode: stop.postalCode,
  });
}

/**
 * The saved load expressed the way a human states it, so a diff compares like
 * with like.
 *
 * Only what a saved load can actually give back. The MC and DOT numbers are
 * not among them — a load stores a carrier *link*, not the numbers someone
 * typed — so a changed linkage is reported as `carrierId` rather than
 * pretending to know which number moved.
 */
interface StatedView {
  readonly referenceNumber: string;
  readonly carrierName: string | null;
  readonly carrierId: string | null;
  readonly commodity: string | null;
  readonly weightLbs: number | null;
  readonly equipment: string | null;
  readonly carrierRateCents: number | null;
  readonly stops: readonly StopValues[];
}

async function statedView(
  scope: BrokerageScope,
  parties: PartyRepository,
  current: LoadWithStops,
): Promise<StatedView> {
  const stops: StopValues[] = [];

  for (const stop of current.stops) {
    const party = await parties.findById(scope, stop.partyId);
    stops.push({
      kind: stop.type === "delivery" ? "delivery" : "pickup",
      partyName: party?.name ?? "",
      addressLine: party?.addressLine1 ?? null,
      city: party?.city ?? null,
      state: party?.region ?? null,
      postalCode: party?.postalCode ?? null,
      date: stop.opensAtLocal?.slice(0, 10) ?? stop.closesAtLocal?.slice(0, 10) ?? null,
      windowStart: stop.opensAtLocal?.slice(11, 16) ?? null,
      windowEnd: stop.closesAtLocal?.slice(11, 16) ?? null,
      referenceNumber: stop.details.appointmentNumber ?? null,
      windowRawText: stop.windowRawText,
    });
  }

  return {
    referenceNumber: current.load.referenceNumber,
    carrierName: current.load.details.carrierAsWritten ?? null,
    carrierId: current.load.carrierId,
    commodity: current.load.commodityDescription,
    weightLbs: current.load.weightLbs,
    equipment: current.load.details.equipmentAsWritten ?? null,
    carrierRateCents: current.load.carrierPayCents,
    stops,
  };
}

/** Load-level paths, in the order the form shows them. */
const LOAD_PATHS = [
  ["referenceNumber", "referenceNumber"],
  ["carrierName", "carrierName"],
  ["commodityDescription", "commodity"],
  ["weightLbs", "weightLbs"],
  ["equipmentAsWritten", "equipment"],
  ["carrierPayCents", "carrierRateCents"],
] as const;

/** Stop-level paths, likewise. `windowRawText` is not shown and never diffed. */
const STOP_PATHS = [
  "kind",
  "partyName",
  "addressLine",
  "city",
  "state",
  "postalCode",
  "date",
  "windowStart",
  "windowEnd",
  "referenceNumber",
] as const;

function diff(before: StatedView, after: EditedLoad): LoadEditChange[] {
  const changes: LoadEditChange[] = [];

  for (const [path, key] of LOAD_PATHS) {
    const from = before[key];
    const to = after[key];
    if (from !== to) {
      changes.push({ path, from: display(path, from), to: display(path, to) });
    }
  }

  if (before.stops.length !== after.stops.length) {
    changes.push({
      path: "stops",
      from: `${before.stops.length} stop${before.stops.length === 1 ? "" : "s"}`,
      to: `${after.stops.length} stop${after.stops.length === 1 ? "" : "s"}`,
    });
  }

  // Compared by position, because position is what the route means. A stop
  // moved from second to first reads as two changed stops, which is what a
  // person looking at the trail would want to see.
  const shared = Math.min(before.stops.length, after.stops.length);
  for (let index = 0; index < shared; index += 1) {
    for (const key of STOP_PATHS) {
      const from = before.stops[index][key];
      const to = after.stops[index][key];
      if (from !== to) {
        changes.push({
          path: `stops.${index}.${key}`,
          from: display(key, from),
          to: display(key, to),
        });
      }
    }
  }

  return changes;
}

/**
 * Formatted at write time, so the screen reading the trail does not have to
 * know what type a path holds.
 */
function display(path: string, value: string | number | null): string | null {
  if (value === null) return null;
  if (typeof value === "number") {
    return path === "carrierPayCents" || path === "carrierRateCents"
      ? `$${Money.fromCents(value).toDollarString()}`
      : String(value);
  }
  return value;
}
