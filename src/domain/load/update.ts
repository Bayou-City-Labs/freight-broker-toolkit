import { z } from "zod";
import type { Carrier } from "../carrier/carrier";
import type { LoadEditChange } from "../details";
import { Money } from "../money";
import type {
  CarrierRepository,
  LoadRepository,
  PartyRepository,
} from "../ports/repositories";
import type { BrokerageScope } from "../tenancy";
import type {
  Load,
  LoadWithStops,
  Party,
  Stop,
  StopType,
  StopWrite,
} from "./load";
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
      //
      // `clash.id !== loadId` is defensive and currently unreachable: the
      // enclosing condition already establishes that the submitted number
      // differs from this load's stored one, so a load found *by* the new
      // number cannot be this load. Kept because it costs nothing and the day
      // the enclosing condition is relaxed — a case-insensitive comparison, a
      // normalized number — it becomes the thing standing between a reviewer
      // and "this load duplicates itself".
      if (clash && clash.id !== loadId) {
        return { status: "duplicate_reference", existing: clash };
      }
    }

    const carrier = await findCarrier(scope, carriers, edited);

    // Read for its name only, so the trail can say which carrier the link was
    // to. A repository call for one field is worth it here: this is the field
    // that separates "authority and insurance were checked" from "nobody
    // checked", and `carrierId: 01a187e8-… → null` answers nobody's question.
    const linkedBefore = current.load.carrierId
      ? await carriers.findById(scope, current.load.carrierId)
      : null;

    const before = await statedView(scope, parties, current);

    const existingById = new Map(current.stops.map((stop) => [stop.id, stop]));
    const writes: StopWrite[] = [];

    for (const [index, stop] of edited.stops.entries()) {
      const existing = stop.id ? (existingById.get(stop.id) ?? null) : null;
      const party = await resolveParty(scope, parties, stop, existing);
      writes.push({
        ...toNewStop(stated(stop, existing), index, party, carriedDetails(existing)),
        ...(existing ? { id: existing.id } : {}),
      });
    }

    const changes = diff(before, edited, {
      before: linkedBefore,
      after: carrier,
    });
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
 * The submitted stop, with the fields this form has no business restating
 * taken from the row instead.
 *
 * `windowRawText` is what the source document said about timing, kept verbatim
 * for audit. It is a fact about the document, not about the load, so it is not
 * on the form, not in the diff — and therefore an erasure would be silent.
 * Carrying it from the existing row means editing a load can never alter it. A
 * stop someone added has no row and no document text, so it takes the
 * submitted value, which is null.
 */
function stated(stop: EditedStop, existing: Stop | null): StopValues {
  if (!existing) return stop;
  return { ...stop, windowRawText: existing.windowRawText };
}

/**
 * The stored stop `details` an edit should inherit.
 *
 * `toNewStop` merges existing details so a save does not drop keys this form
 * never shows — seal numbers, dock hours. But it writes `appointmentNumber`
 * only when a value was submitted, so inheriting the old one makes a cleared
 * reference number unclearable: the number stays stored while the diff reports
 * it gone, on this save and on every save after it.
 *
 * Stripped here rather than in `toNewStop`, which intake's confirm path shares
 * and where there is no previous state to inherit anyway. `appointmentNumber`
 * is the only key this form owns; everything else is carried.
 */
function carriedDetails(existing: Stop | null): Stop["details"] {
  if (!existing) return {};
  const carried = { ...existing.details };
  delete carried.appointmentNumber;
  return carried;
}

/**
 * Resolves the facility a stop should point at.
 *
 * Name unchanged means "this is the same dock, and the address I typed is the
 * correction" — so the facility is fixed in place, for every load that touches
 * it. A different name means a different dock: resolve it by name or create
 * it, and leave the old one alone, because other loads point at it. A facility
 * is never renamed from here; the name is the identity `findByName` matches on.
 *
 * Resolving by name — which is every added stop, and every existing stop whose
 * name changed — applies the typed address too. Naming a dock the brokerage
 * already holds and typing a corrected address for it is the same act as
 * correcting one in place, and the screen draws no distinction between the
 * two; discarding the address on one of the paths while the trail reported it
 * as applied was the bug. Only the fields the submission actually stated are
 * applied, so adding a stop and typing a bare name cannot wipe a stored
 * address. The consequence, stated out loud: an address can be *cleared* only
 * through a stop that already has a row, where the submission is a full
 * statement of the facility rather than a partial one.
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
  if (byName) {
    const stated = statedAddress(stop);
    if (Object.keys(stated).length === 0) return byName;
    const corrected = await parties.update(scope, byName.id, { ...byName, ...stated });
    return corrected ?? byName;
  }

  return parties.create(scope, {
    name: stop.partyName,
    addressLine1: stop.addressLine,
    city: stop.city,
    region: stop.state,
    postalCode: stop.postalCode,
  });
}

/**
 * The address fields this submission actually stated, as party columns.
 *
 * Absent rather than null for anything blank: this is a partial correction of
 * a facility that already exists, not a restatement of it.
 */
function statedAddress(stop: EditedStop): Partial<Party> {
  return {
    ...(stop.addressLine === null ? {} : { addressLine1: stop.addressLine }),
    ...(stop.city === null ? {} : { city: stop.city }),
    ...(stop.state === null ? {} : { region: stop.state }),
    ...(stop.postalCode === null ? {} : { postalCode: stop.postalCode }),
  };
}

/**
 * The saved load expressed the way a human states it, so a diff compares like
 * with like.
 *
 * Only what a saved load can actually give back. The MC and DOT numbers are
 * not among them — a load stores a carrier *link*, not the numbers someone
 * typed — so a changed linkage is reported as `carrierId` rather than
 * pretending to know which number moved. `carrierId` is therefore compared
 * separately from `LOAD_PATHS`; see `diff`.
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

/**
 * A stored stop type as the form states it.
 *
 * Enumerated rather than "anything that is not a delivery is a pickup". The
 * `StopType` vocabulary also holds `empty_return`, which the form cannot
 * express, so collapsing it would rewrite such a stop as a pickup on the next
 * save — and the diff, comparing pickup with pickup, would have nothing to
 * report. Nothing creates one today; refusing loudly keeps that true on
 * purpose rather than by luck.
 */
function statedKind(type: StopType): StopValues["kind"] {
  switch (type) {
    case "pickup":
      return "pickup";
    case "delivery":
      return "delivery";
    default:
      throw new Error(
        `Cannot edit a load with a "${type}" stop: the edit form has no way to ` +
          `state that type, and saving would silently rewrite it as a pickup.`,
      );
  }
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
      kind: statedKind(stop.type),
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

/**
 * The vetting link, before and after, resolved to records so the trail can
 * name the carrier instead of printing a UUID.
 *
 * Which *number* moved is not knowable — a load stores the link, not the MC
 * and DOT numbers someone typed — and is not the interesting question anyway.
 * The interesting question is whether this load still has a carrier whose
 * authority and insurance were checked.
 */
interface CarrierLink {
  readonly before: Carrier | null;
  readonly after: Carrier | null;
}

/** Said in words, because a dash in this column would read as "unknown". */
const NO_CARRIER_LINK = "no vetted carrier";

function carrierLinkName(id: string | null, carrier: Carrier | null): string {
  if (id === null) return NO_CARRIER_LINK;
  // The id is the fallback for a link pointing at a row that is gone or out of
  // scope, which should not happen; printing it beats printing nothing.
  return carrier?.legalName ?? id;
}

/**
 * A whole stop on one line, for a position the positional diff cannot reach.
 *
 * Kind and facility always; the date and window only when the stop has them.
 * Padding the line with a dash for an unstated window would read as a fact
 * about the dock rather than an absence of one.
 */
function statedStop(stop: StopValues): string {
  const kind = stop.kind === "pickup" ? "Pickup" : "Delivery";
  const window =
    stop.windowStart && stop.windowEnd
      ? `${stop.windowStart}–${stop.windowEnd}`
      : (stop.windowStart ?? stop.windowEnd ?? null);
  const when = [stop.date, window].filter((part) => part !== null).join(" ");
  return when ? `${kind} — ${stop.partyName}, ${when}` : `${kind} — ${stop.partyName}`;
}

function diff(before: StatedView, after: EditedLoad, link: CarrierLink): LoadEditChange[] {
  const changes: LoadEditChange[] = [];

  for (const [path, key] of LOAD_PATHS) {
    const from = before[key];
    const to = after[key];
    if (from !== to) {
      changes.push({ path, from: display(path, from), to: display(path, to) });
    }
  }

  // Not in LOAD_PATHS, because it is not a field on the form: two number boxes
  // resolve to one link, and the link is what gets stored. It is compared on
  // the stored id rather than on the resolved record, so a carrier row that
  // has become unreadable does not read as an unlink.
  const linkedTo = link.after?.id ?? null;
  if (before.carrierId !== linkedTo) {
    changes.push({
      path: "carrierId",
      from: carrierLinkName(before.carrierId, link.before),
      to: carrierLinkName(linkedTo, link.after),
    });
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

  // Positions past the shorter route have nothing to compare against, so a
  // field-by-field diff cannot see them at all: the count entry above was
  // once the whole record of a stop being added or dropped. For a route
  // change on a booked load, *which* stop moved is the thing most worth
  // having written down.
  for (let index = shared; index < after.stops.length; index += 1) {
    changes.push({
      path: `stops.${index}`,
      from: "not on the route",
      to: statedStop(after.stops[index]),
    });
  }
  for (let index = shared; index < before.stops.length; index += 1) {
    changes.push({
      path: `stops.${index}`,
      from: statedStop(before.stops[index]),
      to: "taken off the route",
    });
  }

  for (let index = 0; index < shared; index += 1) {
    for (const key of STOP_PATHS) {
      // A date with no time is not currently storable: a stop's date lives
      // only inside `opensAtLocal`/`closesAtLocal`, and `toNewStop` writes
      // neither without a time, so the date is discarded by the very save this
      // diff describes. Reconstructing it then reads back as null and the next
      // save reports the same change again, forever. The trail stays silent
      // rather than claiming a save that did not happen — the storage
      // limitation is intake's too, and fixing it is a schema change, not a
      // trail change.
      const stored =
        after.stops[index].windowStart !== null || after.stops[index].windowEnd !== null;
      if (key === "date" && !stored) continue;

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
 *
 * `path` is the storage-side name from `LOAD_PATHS`, which is why only
 * `carrierPayCents` is tested for and not the stated `carrierRateCents`.
 */
function display(path: string, value: string | number | null): string | null {
  if (value === null) return null;
  if (typeof value === "number") {
    return path === "carrierPayCents"
      ? `$${Money.fromCents(value).toDollarString()}`
      : String(value);
  }
  return value;
}
