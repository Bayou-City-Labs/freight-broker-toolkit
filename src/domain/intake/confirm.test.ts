import { describe, expect, it } from "vitest";
import type { Carrier } from "../carrier/carrier";
import type { Load, LoadWithStops, Party, Stop } from "../load/load";
import type {
  CarrierRepository,
  LoadRepository,
  PartyRepository,
} from "../ports/repositories";
import { scopeFor, type BrokerageScope } from "../tenancy";
import { createConfirmDraft, type ConfirmedLoad, type ConfirmedStop } from "./confirm";

const scope: BrokerageScope = scopeFor("brokerage-1");
const otherScope: BrokerageScope = scopeFor("brokerage-2");

/**
 * In-memory stand-ins, filtered by scope like the real repositories, so a use
 * case that forgot to pass one fails here too.
 */
function fakeParties(seed: Party[] = []) {
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
        details: input.details ?? {},
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
  };

  return { repo, rows };
}

function fakeLoads(seed: Load[] = []) {
  const rows = [...seed];
  const stopRows: Stop[] = [];
  let next = seed.length + 1;

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
        details: input.details ?? {},
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
        details: stop.details ?? {},
      }));
      stopRows.push(...saved);

      return { load, stops: saved };
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
        details: input.details ?? {},
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

      const saved = newStops.map((stop) => {
        const current = stopRows.find((row) => row.id === stop.id && row.loadId === id);
        return {
          id: stop.id ?? `stop-${id}-${next++}`,
          brokerageId: s.brokerageId,
          loadId: id,
          sequence: stop.sequence,
          type: stop.type,
          partyId: stop.partyId,
          opensAtLocal: stop.opensAtLocal ?? null,
          closesAtLocal: stop.closesAtLocal ?? null,
          timeZone: stop.timeZone ?? null,
          appointmentType: stop.appointmentType ?? null,
          windowRawText: stop.windowRawText ?? null,
          details: stop.details ?? current?.details ?? {},
        };
      });

      for (const stop of saved) {
        const position = stopRows.findIndex((row) => row.id === stop.id);
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
      return { load, stops: stopRows.filter((stop) => stop.loadId === load.id) };
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

function fakeCarriers(seed: Carrier[] = []) {
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

function stop(overrides: Partial<ConfirmedStop> = {}): ConfirmedStop {
  return {
    kind: "pickup",
    partyName: "ACME DISTRIBUTION",
    addressLine: "4400 Navigation Blvd",
    city: "Houston",
    state: "TX",
    postalCode: "77011",
    date: "2026-11-02",
    windowStart: "08:00",
    windowEnd: "12:00",
    referenceNumber: "PU-4471",
    windowRawText: "PU 11/02 0800-1200",
    ...overrides,
  };
}

function confirmed(overrides: Partial<ConfirmedLoad> = {}): ConfirmedLoad {
  return {
    referenceNumber: "884213",
    carrierName: "GULF COAST HAULING LLC",
    carrierMcNumber: "987654",
    carrierDotNumber: null,
    commodity: "Palletized canned goods",
    weightLbs: 42000,
    equipment: "53' Dry Van",
    carrierRateCents: 185_000,
    stops: [stop(), stop({ kind: "delivery", partyName: "LONE STAR FOODS" })],
    provenance: {
      producedBy: "label-proximity-v1",
      textSource: "pdf-text",
      filename: "rate-con.pdf",
      corrections: [],
      acceptedFlagged: [],
    },
    ...overrides,
  };
}

function deps(parties = fakeParties(), loads = fakeLoads(), carriers = fakeCarriers()) {
  return {
    confirm: createConfirmDraft({
      loads: loads.repo,
      parties: parties.repo,
      carriers: carriers.repo,
    }),
    parties,
    loads,
    carriers,
  };
}

describe("confirmDraft", () => {
  it("saves a load with its stops in order", async () => {
    const { confirm } = deps();

    const outcome = await confirm(scope, confirmed());

    expect(outcome.status).toBe("saved");
    if (outcome.status !== "saved") return;

    expect(outcome.load.referenceNumber).toBe("884213");
    expect(outcome.load.brokerageId).toBe(scope.brokerageId);
    expect(outcome.load.carrierPayCents).toBe(185_000);
    expect(outcome.load.weightLbs).toBe(42000);
    expect(outcome.load.equipmentType).toBe("dry_van");

    expect(outcome.stops.map((s) => [s.sequence, s.type])).toEqual([
      [0, "pickup"],
      [1, "delivery"],
    ]);
  });

  it("stores the window as local wall time, never an instant", async () => {
    const { confirm } = deps();

    const outcome = await confirm(scope, confirmed());
    if (outcome.status !== "saved") throw new Error("expected a save");

    const [pickup] = outcome.stops;
    expect(pickup.opensAtLocal).toBe("2026-11-02T08:00");
    expect(pickup.closesAtLocal).toBe("2026-11-02T12:00");
    // A range the dock will honour, not a fixed appointment.
    expect(pickup.appointmentType).toBe("fcfs");
    // No zone was stated, and none is guessed from the address.
    expect(pickup.timeZone).toBeNull();
    expect(pickup.windowRawText).toBe("PU 11/02 0800-1200");
  });

  it("treats a single stated time as an appointment", async () => {
    const { confirm } = deps();

    const outcome = await confirm(
      scope,
      confirmed({ stops: [stop({ windowEnd: null })] }),
    );
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(outcome.stops[0].appointmentType).toBe("appointment");
    expect(outcome.stops[0].closesAtLocal).toBeNull();
  });

  it("leaves the appointment type unset when the document gave no time", async () => {
    const { confirm } = deps();

    const outcome = await confirm(
      scope,
      confirmed({ stops: [stop({ windowStart: null, windowEnd: null })] }),
    );
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(outcome.stops[0].appointmentType).toBeNull();
    expect(outcome.stops[0].opensAtLocal).toBeNull();
  });

  it("reuses a facility instead of creating it twice", async () => {
    const { confirm, parties } = deps();

    await confirm(scope, confirmed({ referenceNumber: "1" }));
    await confirm(scope, confirmed({ referenceNumber: "2" }));

    expect(parties.rows.map((p) => p.name).sort()).toEqual([
      "ACME DISTRIBUTION",
      "LONE STAR FOODS",
    ]);
  });

  it("matches a facility regardless of the case the document used", async () => {
    const { confirm, parties } = deps();

    await confirm(scope, confirmed({ referenceNumber: "1" }));
    await confirm(
      scope,
      confirmed({
        referenceNumber: "2",
        stops: [stop({ partyName: "Acme Distribution" })],
      }),
    );

    expect(parties.rows.filter((p) => /acme/i.test(p.name))).toHaveLength(1);
  });

  it("refuses a reference number already in use", async () => {
    const { confirm } = deps();

    await confirm(scope, confirmed());
    const second = await confirm(scope, confirmed());

    expect(second.status).toBe("duplicate_reference");
    if (second.status !== "duplicate_reference") return;
    expect(second.existing.referenceNumber).toBe("884213");
  });

  it("does not see another brokerage's reference numbers", async () => {
    const { confirm } = deps();

    await confirm(scope, confirmed());
    const other = await confirm(otherScope, confirmed());

    // Same number, different brokerage: not a duplicate.
    expect(other.status).toBe("saved");
  });

  it("links a carrier we already hold, by MC number", async () => {
    const carriers = fakeCarriers([
      {
        id: "carrier-known",
        brokerageId: scope.brokerageId,
        dotNumber: "1234567",
        mcNumber: "987654",
        legalName: "GULF COAST HAULING LLC",
        dbaName: null,
        details: {},
      },
    ]);
    const { confirm } = deps(fakeParties(), fakeLoads(), carriers);

    const outcome = await confirm(scope, confirmed());
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(outcome.carrierLinked).toBe(true);
    expect(outcome.load.carrierId).toBe("carrier-known");
  });

  it("never creates a carrier from a name on a document", async () => {
    const { confirm, carriers } = deps();

    const outcome = await confirm(scope, confirmed());
    if (outcome.status !== "saved") throw new Error("expected a save");

    // A carrier record is the subject of a vetting history. One invented from
    // document text would sit in the list looking checked when it is not.
    expect(carriers.rows).toHaveLength(0);
    expect(outcome.carrierLinked).toBe(false);
    expect(outcome.load.carrierId).toBeNull();
    // The name is still kept, so the review screen can offer to vet it.
    expect(outcome.load.details.carrierAsWritten).toBe("GULF COAST HAULING LLC");
  });

  it("does not link a carrier belonging to another brokerage", async () => {
    const carriers = fakeCarriers([
      {
        id: "carrier-elsewhere",
        brokerageId: otherScope.brokerageId,
        dotNumber: null,
        mcNumber: "987654",
        legalName: "GULF COAST HAULING LLC",
        dbaName: null,
        details: {},
      },
    ]);
    const { confirm } = deps(fakeParties(), fakeLoads(), carriers);

    const outcome = await confirm(scope, confirmed());
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(outcome.load.carrierId).toBeNull();
  });

  it("books a load when the document names a carrier and a rate", async () => {
    const { confirm } = deps();

    const outcome = await confirm(scope, confirmed());
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(outcome.load.status).toBe("booked");
  });

  it("leaves a load a draft when no rate was agreed", async () => {
    const { confirm } = deps();

    const outcome = await confirm(scope, confirmed({ carrierRateCents: null }));
    if (outcome.status !== "saved") throw new Error("expected a save");

    // A tender, or a partial read. Either way nothing has been committed to.
    expect(outcome.load.status).toBe("draft");
  });

  it("keeps unclassifiable equipment rather than dropping it", async () => {
    const { confirm } = deps();

    const outcome = await confirm(scope, confirmed({ equipment: "Conestoga" }));
    if (outcome.status !== "saved") throw new Error("expected a save");

    // Stated, but not one of our types — which is different from unstated.
    expect(outcome.load.equipmentType).toBe("other");
    expect(outcome.load.details.equipmentAsWritten).toBe("Conestoga");
  });

  it("distinguishes equipment nobody stated from equipment we cannot type", async () => {
    const { confirm } = deps();

    const outcome = await confirm(scope, confirmed({ equipment: null }));
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(outcome.load.equipmentType).toBeNull();
    expect(outcome.load.details.equipmentAsWritten).toBeUndefined();
  });

  it("records how the load was extracted, and what the human fixed", async () => {
    const { confirm } = deps();

    const outcome = await confirm(
      scope,
      confirmed({
        provenance: {
          producedBy: "label-proximity-v1",
          textSource: "pdf-text",
          filename: "rate-con.pdf",
          corrections: [{ path: "weightLbs", confidence: 0.9 }],
          acceptedFlagged: ["stops.0.city"],
        },
      }),
    );
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(outcome.load.details.intake?.producedBy).toBe("label-proximity-v1");
    // A field the parser was sure about and a person rewrote: the evidence
    // that the confidence scale needs tightening.
    expect(outcome.load.details.intake?.corrections).toEqual([
      { path: "weightLbs", confidence: 0.9 },
    ]);
    expect(outcome.load.details.intake?.acceptedFlagged).toEqual(["stops.0.city"]);
  });

  it("carries a stop's reference number through to the stop details", async () => {
    const { confirm } = deps();

    const outcome = await confirm(scope, confirmed());
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(outcome.stops[0].details.appointmentNumber).toBe("PU-4471");
  });
});
