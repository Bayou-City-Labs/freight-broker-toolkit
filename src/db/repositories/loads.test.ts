import { describe, expect, it } from "vitest";
import { seedBrokerage, withRollback } from "@/test/db";
import { createLoadRepository } from "./loads";
import { createPartyRepository } from "./parties";

describe("party repository", () => {
  it("round-trips a facility", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const parties = createPartyRepository(tx);

      const created = await parties.create(scope, {
        name: "ACME DISTRIBUTION",
        addressLine1: "4400 Navigation Blvd",
        city: "Houston",
        region: "TX",
        postalCode: "77011",
        timeZone: "America/Chicago",
      });

      expect(created.brokerageId).toBe(scope.brokerageId);
      const found = await parties.findById(scope, created.id);
      expect(found?.city).toBe("Houston");
      expect(found?.timeZone).toBe("America/Chicago");
      expect(found?.country).toBe("US");
    });
  });

  it("finds a facility whatever case the document used", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const parties = createPartyRepository(tx);

      await parties.create(scope, { name: "ACME DISTRIBUTION" });

      expect(await parties.findByName(scope, "acme distribution")).not.toBeNull();
      expect(await parties.findByName(scope, "  Acme Distribution  ")).not.toBeNull();
      expect(await parties.findByName(scope, "ACME")).toBeNull();
    });
  });

  it("does not treat a name's underscore as a wildcard", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const parties = createPartyRepository(tx);

      await parties.create(scope, { name: "DC_6094" });

      // A LIKE-based lookup would match this against "DCX6094".
      expect(await parties.findByName(scope, "DCX6094")).toBeNull();
      expect(await parties.findByName(scope, "dc_6094")).not.toBeNull();
    });
  });

  it("never returns another brokerage's facilities", async () => {
    await withRollback(async (tx) => {
      const mine = await seedBrokerage(tx, "Mine");
      const theirs = await seedBrokerage(tx, "Theirs");
      const parties = createPartyRepository(tx);

      const created = await parties.create(theirs, { name: "LONE STAR FOODS" });

      expect(await parties.findById(mine, created.id)).toBeNull();
      expect(await parties.findByName(mine, "LONE STAR FOODS")).toBeNull();
      expect(await parties.list(mine)).toHaveLength(0);
    });
  });
});

describe("load repository", () => {
  it("creates a load with its route in one call", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const parties = createPartyRepository(tx);
      const loads = createLoadRepository(tx);

      const shipper = await parties.create(scope, { name: "ACME DISTRIBUTION" });
      const consignee = await parties.create(scope, { name: "LONE STAR FOODS" });

      const { load, stops } = await loads.create(
        scope,
        {
          referenceNumber: "884213",
          status: "booked",
          equipmentType: "reefer",
          commodityDescription: "Frozen poultry",
          weightLbs: 42000,
          carrierPayCents: 185_000,
          details: { temperature: { maxF: -10 } },
        },
        [
          {
            sequence: 0,
            type: "pickup",
            partyId: shipper.id,
            opensAtLocal: "2026-11-02T08:00",
            closesAtLocal: "2026-11-02T12:00",
            timeZone: "America/Chicago",
            appointmentType: "fcfs",
            windowRawText: "PU 11/02 0800-1200",
          },
          { sequence: 1, type: "delivery", partyId: consignee.id },
        ],
      );

      expect(load.brokerageId).toBe(scope.brokerageId);
      expect(load.carrierPayCents).toBe(185_000);
      expect(load.details.temperature?.maxF).toBe(-10);
      expect(stops.map((stop) => stop.sequence)).toEqual([0, 1]);
    });
  });

  it("reads a window back as local wall time, not an instant", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const parties = createPartyRepository(tx);
      const loads = createLoadRepository(tx);

      const shipper = await parties.create(scope, { name: "ACME DISTRIBUTION" });
      const created = await loads.create(scope, { referenceNumber: "884213" }, [
        {
          sequence: 0,
          type: "pickup",
          partyId: shipper.id,
          opensAtLocal: "2026-11-02T08:00",
          closesAtLocal: "2026-11-02T12:00",
          timeZone: "America/Chicago",
          windowRawText: "PU 11/02 0800-1200",
        },
      ]);

      // Postgres hands back "2026-11-02 08:00:00"; the domain's notation is
      // the one that has to come out of the repository.
      expect(created.stops[0].opensAtLocal).toBe("2026-11-02T08:00");

      const found = await loads.findById(scope, created.load.id);
      expect(found?.stops[0].opensAtLocal).toBe("2026-11-02T08:00");
      expect(found?.stops[0].closesAtLocal).toBe("2026-11-02T12:00");
      expect(found?.stops[0].timeZone).toBe("America/Chicago");
      expect(found?.stops[0].windowRawText).toBe("PU 11/02 0800-1200");
    });
  });

  it("keeps a stop with no stated window", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const parties = createPartyRepository(tx);
      const loads = createLoadRepository(tx);

      const shipper = await parties.create(scope, { name: "ACME DISTRIBUTION" });
      const created = await loads.create(scope, { referenceNumber: "884213" }, [
        { sequence: 0, type: "pickup", partyId: shipper.id },
      ]);

      expect(created.stops[0].opensAtLocal).toBeNull();
      expect(created.stops[0].appointmentType).toBeNull();
    });
  });

  it("returns stops in sequence, however they were inserted", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const parties = createPartyRepository(tx);
      const loads = createLoadRepository(tx);

      const party = await parties.create(scope, { name: "ACME DISTRIBUTION" });
      const created = await loads.create(scope, { referenceNumber: "884213" }, [
        { sequence: 2, type: "delivery", partyId: party.id },
        { sequence: 0, type: "pickup", partyId: party.id },
        { sequence: 1, type: "delivery", partyId: party.id },
      ]);

      expect(created.stops.map((stop) => stop.sequence)).toEqual([0, 1, 2]);

      const found = await loads.findById(scope, created.load.id);
      expect(found?.stops.map((stop) => stop.sequence)).toEqual([0, 1, 2]);
    });
  });

  it("rejects a duplicate reference number within a brokerage", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const loads = createLoadRepository(tx);

      await loads.create(scope, { referenceNumber: "884213" }, []);

      expect(await loads.findByReferenceNumber(scope, "884213")).not.toBeNull();
      // The constraint is the backstop; confirmDraft checks first so a broker
      // gets a message rather than a 500.
      await expect(
        loads.create(scope, { referenceNumber: "884213" }, []),
      ).rejects.toThrow();
    });
  });

  it("lets two brokerages use the same reference number", async () => {
    await withRollback(async (tx) => {
      const mine = await seedBrokerage(tx, "Mine");
      const theirs = await seedBrokerage(tx, "Theirs");
      const loads = createLoadRepository(tx);

      await loads.create(mine, { referenceNumber: "884213" }, []);
      await loads.create(theirs, { referenceNumber: "884213" }, []);

      expect(await loads.list(mine)).toHaveLength(1);
      expect(await loads.list(theirs)).toHaveLength(1);
    });
  });

  it("never returns another brokerage's loads or their stops", async () => {
    await withRollback(async (tx) => {
      const mine = await seedBrokerage(tx, "Mine");
      const theirs = await seedBrokerage(tx, "Theirs");
      const parties = createPartyRepository(tx);
      const loads = createLoadRepository(tx);

      const party = await parties.create(theirs, { name: "ACME DISTRIBUTION" });
      const created = await loads.create(theirs, { referenceNumber: "884213" }, [
        { sequence: 0, type: "pickup", partyId: party.id },
      ]);

      expect(await loads.findById(mine, created.load.id)).toBeNull();
      expect(await loads.findByReferenceNumber(mine, "884213")).toBeNull();
      expect(await loads.list(mine)).toHaveLength(0);
    });
  });

  it("writes no load at all when a stop insert fails", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const loads = createLoadRepository(tx);

      // A party id that does not exist violates the stop's foreign key. The
      // load insert has already run at that point, so this is the test that
      // the two are one unit.
      await expect(
        loads.create(scope, { referenceNumber: "884213" }, [
          {
            sequence: 0,
            type: "pickup",
            partyId: "00000000-0000-0000-0000-000000000000",
          },
        ]),
      ).rejects.toThrow();

      expect(await loads.findByReferenceNumber(scope, "884213")).toBeNull();
    });
  });

  it("updates a load's fields and keeps the ones it was not given", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const parties = createPartyRepository(tx);
      const loads = createLoadRepository(tx);

      const party = await parties.create(scope, { name: "ACME DISTRIBUTION" });
      const created = await loads.create(
        scope,
        {
          referenceNumber: "884213",
          status: "booked",
          carrierPayCents: 185_000,
          customerRateCents: 210_000,
        },
        [{ sequence: 0, type: "pickup", partyId: party.id }],
      );

      const updated = await loads.update(
        scope,
        created.load.id,
        {
          referenceNumber: "884213",
          status: created.load.status,
          carrierPayCents: 190_000,
          customerRateCents: created.load.customerRateCents,
        },
        [{ id: created.stops[0].id, sequence: 0, type: "pickup", partyId: party.id }],
      );

      expect(updated?.load.carrierPayCents).toBe(190_000);
      // Status is not this feature's to change, and the customer rate is not on
      // the edit form at all. Both have to survive a save that omits them.
      expect(updated?.load.status).toBe("booked");
      expect(updated?.load.customerRateCents).toBe(210_000);
    });
  });

  it("keeps a stop's id and creation time across an edit", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const parties = createPartyRepository(tx);
      const loads = createLoadRepository(tx);

      const party = await parties.create(scope, { name: "ACME DISTRIBUTION" });
      const created = await loads.create(scope, { referenceNumber: "884213" }, [
        { sequence: 0, type: "pickup", partyId: party.id, windowRawText: "PU 0800" },
      ]);

      const updated = await loads.update(
        scope,
        created.load.id,
        { referenceNumber: "884213", status: "draft" },
        [
          {
            id: created.stops[0].id,
            sequence: 0,
            type: "pickup",
            partyId: party.id,
            opensAtLocal: "2026-11-02T09:00",
            windowRawText: "PU 0800",
          },
        ],
      );

      expect(updated?.stops[0].id).toBe(created.stops[0].id);
      expect(updated?.stops[0].opensAtLocal).toBe("2026-11-02T09:00");
      // What the document said survives an edit to the parsed window.
      expect(updated?.stops[0].windowRawText).toBe("PU 0800");
    });
  });

  it("swaps two stops without tripping the sequence constraint", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const parties = createPartyRepository(tx);
      const loads = createLoadRepository(tx);

      const first = await parties.create(scope, { name: "ACME DISTRIBUTION" });
      const second = await parties.create(scope, { name: "LONE STAR FOODS" });
      const created = await loads.create(scope, { referenceNumber: "884213" }, [
        { sequence: 0, type: "pickup", partyId: first.id },
        { sequence: 1, type: "delivery", partyId: second.id },
      ]);
      const [a, b] = created.stops;

      // stops_load_sequence_key is unique on (load_id, sequence): assigning
      // final sequences directly collides on the first write.
      const updated = await loads.update(
        scope,
        created.load.id,
        { referenceNumber: "884213", status: "draft" },
        [
          { id: b.id, sequence: 0, type: "delivery", partyId: second.id },
          { id: a.id, sequence: 1, type: "pickup", partyId: first.id },
        ],
      );

      expect(updated?.stops.map((stop) => stop.id)).toEqual([b.id, a.id]);
      expect(updated?.stops.map((stop) => stop.sequence)).toEqual([0, 1]);

      const found = await loads.findById(scope, created.load.id);
      expect(found?.stops.map((stop) => stop.id)).toEqual([b.id, a.id]);
    });
  });

  it("deletes the stops an edit left out and inserts the ones it added", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const parties = createPartyRepository(tx);
      const loads = createLoadRepository(tx);

      const party = await parties.create(scope, { name: "ACME DISTRIBUTION" });
      const created = await loads.create(scope, { referenceNumber: "884213" }, [
        { sequence: 0, type: "pickup", partyId: party.id },
        { sequence: 1, type: "delivery", partyId: party.id },
      ]);

      const updated = await loads.update(
        scope,
        created.load.id,
        { referenceNumber: "884213", status: "draft" },
        [
          { id: created.stops[1].id, sequence: 0, type: "delivery", partyId: party.id },
          { sequence: 1, type: "delivery", partyId: party.id },
        ],
      );

      expect(updated?.stops).toHaveLength(2);
      expect(updated?.stops[0].id).toBe(created.stops[1].id);
      expect(updated?.stops[1].id).not.toBe(created.stops[0].id);
    });
  });

  it("will not update another brokerage's load", async () => {
    await withRollback(async (tx) => {
      const mine = await seedBrokerage(tx, "Mine");
      const theirs = await seedBrokerage(tx, "Theirs");
      const loads = createLoadRepository(tx);

      const created = await loads.create(theirs, { referenceNumber: "884213" }, []);

      expect(
        await loads.update(
          mine,
          created.load.id,
          { referenceNumber: "hijacked", status: "cancelled" },
          [],
        ),
      ).toBeNull();

      const found = await loads.findById(theirs, created.load.id);
      expect(found?.load.referenceNumber).toBe("884213");
    });
  });
});
