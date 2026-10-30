import type { Carrier } from "@/domain/carrier/carrier";
import type { Load, LoadWithStops, Party, Stop } from "@/domain/load/load";
import type {
  CarrierRepository,
  LoadRepository,
  PartyRepository,
} from "@/domain/ports/repositories";

/**
 * In-memory stand-ins, filtered by scope like the real repositories, so a use
 * case that forgot to pass one fails here too.
 *
 * Shared rather than inline so the intake and editing use cases are tested
 * against the same stand-ins. Two copies would be two chances for a fake to
 * drift from the port it stands for, which is the one way a fake lies.
 */
export function fakeParties(seed: Party[] = []) {
  const rows = [...seed];
  let next = seed.length + 1;

  const repo: PartyRepository = {
    async create(s, input) {
      const party: Party = {
        id: `party-${next++}`,
        brokerageId: s.brokerageId,
        name: input.name,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        region: input.region ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country ?? "US",
        timeZone: input.timeZone ?? null,
        contactName: input.contactName ?? null,
        contactPhone: input.contactPhone ?? null,
        contactEmail: input.contactEmail ?? null,
        details: { ...(input.details ?? {}) },
      };
      rows.push(party);
      return party;
    },
    async findById(s, id) {
      return rows.find((r) => r.brokerageId === s.brokerageId && r.id === id) ?? null;
    },
    async findByName(s, name) {
      return (
        rows.find(
          (r) =>
            r.brokerageId === s.brokerageId &&
            r.name.toLowerCase() === name.trim().toLowerCase(),
        ) ?? null
      );
    },
    async list(s) {
      return rows.filter((r) => r.brokerageId === s.brokerageId);
    },
    async update(s, id, input) {
      const index = rows.findIndex((r) => r.brokerageId === s.brokerageId && r.id === id);
      if (index === -1) return null;
      const existing = rows[index];
      const updated: Party = {
        id: existing.id,
        brokerageId: existing.brokerageId,
        name: input.name,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        region: input.region ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country ?? "US",
        timeZone: input.timeZone ?? null,
        contactName: input.contactName ?? null,
        contactPhone: input.contactPhone ?? null,
        contactEmail: input.contactEmail ?? null,
        details: { ...(input.details ?? {}) },
      };
      rows[index] = updated;
      return updated;
    },
  };

  return { repo, rows };
}

export function fakeLoads(seed: Load[] = []) {
  const rows = [...seed];
  const stopRows: Stop[] = [];
  let next = seed.length + 1;
  /**
   * Stops get their own counter, in a namespace `create` cannot produce.
   * Minting them from the load counter collided with `create`'s positional
   * `stop-<load>-<index>` ids as soon as a load had three stops: adding one to
   * such a route handed the new stop an id a kept stop already held, and the
   * write loop below silently overwrote that stop. The real repository mints a
   * fresh uuid, so the red would have been the fake's, pointing at production
   * code that is correct.
   */
  let nextStop = 1;

  const repo: LoadRepository = {
    async create(s, input, stops) {
      const load: Load = {
        id: `load-${next++}`,
        brokerageId: s.brokerageId,
        referenceNumber: input.referenceNumber,
        status: input.status ?? "draft",
        equipmentType: input.equipmentType ?? null,
        commodityDescription: input.commodityDescription ?? null,
        weightLbs: input.weightLbs ?? null,
        customerRateCents: input.customerRateCents ?? null,
        carrierPayCents: input.carrierPayCents ?? null,
        carrierId: input.carrierId ?? null,
        details: { ...(input.details ?? {}) },
      };
      rows.push(load);

      const saved = stops.map((stop, index) => ({
        id: `stop-${load.id}-${index}`,
        brokerageId: s.brokerageId,
        loadId: load.id,
        sequence: stop.sequence,
        type: stop.type,
        partyId: stop.partyId,
        opensAtLocal: stop.opensAtLocal ?? null,
        closesAtLocal: stop.closesAtLocal ?? null,
        timeZone: stop.timeZone ?? null,
        appointmentType: stop.appointmentType ?? null,
        windowRawText: stop.windowRawText ?? null,
        details: { ...(stop.details ?? {}) },
      }));
      stopRows.push(...saved);

      // `create` honours the caller's sequence and hands the route back in it,
      // like the real repository — which `loads.test.ts` pins by inserting
      // stops out of order.
      return { load, stops: [...saved].sort((a, b) => a.sequence - b.sequence) };
    },
    async update(s, id, input, newStops) {
      const index = rows.findIndex((r) => r.brokerageId === s.brokerageId && r.id === id);
      if (index === -1) return null;

      const existing = rows[index];
      const load: Load = {
        ...existing,
        referenceNumber: input.referenceNumber,
        status: input.status,
        equipmentType: input.equipmentType ?? null,
        commodityDescription: input.commodityDescription ?? null,
        weightLbs: input.weightLbs ?? null,
        customerRateCents: input.customerRateCents ?? null,
        carrierPayCents: input.carrierPayCents ?? null,
        carrierId: input.carrierId ?? null,
        details: { ...(input.details ?? {}) },
      };
      rows[index] = load;

      const kept = newStops
        .map((stop) => stop.id)
        .filter((stopId): stopId is string => typeof stopId === "string");
      const remaining = stopRows.filter(
        (stop) => stop.loadId !== id || kept.includes(stop.id),
      );
      stopRows.length = 0;
      stopRows.push(...remaining);

      const saved = newStops.map((stop, index) => {
        return {
          id: stop.id ?? `stop-new-${nextStop++}`,
          brokerageId: s.brokerageId,
          loadId: id,
          sequence: index,
          type: stop.type,
          partyId: stop.partyId,
          opensAtLocal: stop.opensAtLocal ?? null,
          closesAtLocal: stop.closesAtLocal ?? null,
          timeZone: stop.timeZone ?? null,
          appointmentType: stop.appointmentType ?? null,
          windowRawText: stop.windowRawText ?? null,
          // Not `?? current?.details`: the real repository writes `{}` for an
          // omitted details object rather than inheriting the stored one, and a
          // fake that inherits would make a future caller look safe.
          details: { ...(stop.details ?? {}) },
        };
      });

      for (const stop of saved) {
        // Scoped to this load, like the real `where loadId = id`. Unscoped, a
        // stop id belonging to another load re-parented that load's row.
        const position = stopRows.findIndex(
          (row) => row.id === stop.id && row.loadId === id,
        );
        if (position === -1) stopRows.push(stop);
        else stopRows[position] = stop;
      }

      return {
        load,
        stops: stopRows
          .filter((stop) => stop.loadId === id)
          .sort((a, b) => a.sequence - b.sequence),
      };
    },
    async findById(s, id): Promise<LoadWithStops | null> {
      const load = rows.find((r) => r.brokerageId === s.brokerageId && r.id === id);
      if (!load) return null;
      return {
        load,
        // By sequence, like the real `order by sequence asc`. Array order left
        // the stops stale after a reorder, and the edit diff pairs before with
        // after by position among the survivors — so an unsorted read made a
        // second save after a reorder report every field of both stops as
        // rewritten, and append a trail entry for a save that changed nothing.
        stops: stopRows
          .filter((stop) => stop.loadId === load.id)
          .sort((a, b) => a.sequence - b.sequence),
      };
    },
    async findByReferenceNumber(s, referenceNumber) {
      return (
        rows.find(
          (r) => r.brokerageId === s.brokerageId && r.referenceNumber === referenceNumber,
        ) ?? null
      );
    },
    async list(s) {
      return rows.filter((r) => r.brokerageId === s.brokerageId);
    },
  };

  return { repo, rows, stopRows };
}

export function fakeCarriers(seed: Carrier[] = []) {
  const rows = [...seed];

  const repo: CarrierRepository = {
    async create(s, input) {
      const carrier: Carrier = {
        id: `carrier-${rows.length + 1}`,
        brokerageId: s.brokerageId,
        dotNumber: input.dotNumber ?? null,
        mcNumber: input.mcNumber ?? null,
        legalName: input.legalName,
        dbaName: input.dbaName ?? null,
        details: input.details ?? {},
      };
      rows.push(carrier);
      return carrier;
    },
    async findById(s, id) {
      return rows.find((r) => r.brokerageId === s.brokerageId && r.id === id) ?? null;
    },
    async findByDotNumber(s, dotNumber) {
      return (
        rows.find((r) => r.brokerageId === s.brokerageId && r.dotNumber === dotNumber) ??
        null
      );
    },
    async findByMcNumber(s, mcNumber) {
      return (
        rows.find((r) => r.brokerageId === s.brokerageId && r.mcNumber === mcNumber) ??
        null
      );
    },
    async list(s) {
      return rows.filter((r) => r.brokerageId === s.brokerageId);
    },
  };

  return { repo, rows };
}
