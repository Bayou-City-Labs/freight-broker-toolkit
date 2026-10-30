import { describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/client";
import { createCarrierRepository } from "@/db/repositories/carriers";
import { createLoadRepository } from "@/db/repositories/loads";
import { createPartyRepository } from "@/db/repositories/parties";
import { createConfirmDraft, type ConfirmedLoad } from "@/domain/intake/confirm";
import { createUpdateLoad } from "@/domain/load/update";
import type { BrokerageScope } from "@/domain/tenancy";
import { seedBrokerage, withRollback } from "@/test/db";
import { readEditedLoad } from "./form-values";

/**
 * Intake a load, then edit it, through the real form boundary and into real
 * Postgres. The only substitution is the database executor, so the test can
 * roll back.
 */
const RATE_CON = {
  referenceNumber: "884213",
  carrierName: "GULF COAST HAULING LLC",
  carrierMcNumber: "987654",
  commodity: "Canned goods",
  weightLbs: "42000",
  equipment: "53' Dry Van",
  carrierRateCents: "1850.00",
};

function wire(tx: DbExecutor) {
  const loads = createLoadRepository(tx);
  const parties = createPartyRepository(tx);
  const carriers = createCarrierRepository(tx);

  return {
    loads,
    parties,
    carriers,
    confirm: createConfirmDraft({ loads, parties, carriers }),
    update: createUpdateLoad({ loads, parties, carriers }),
  };
}

/**
 * The load this test edits, as intake saved it.
 *
 * Built as a `ConfirmedLoad` rather than pushed through `readConfirmedLoad`: a
 * hand-written `draft` field would have to satisfy `loadDraftSchema` to get
 * past the form reader, which makes the fixture fragile and tests the intake
 * boundary all over again. `intake-flow.test.ts` already covers that side from
 * a real PDF. What is under test here is the edit path.
 */
function confirmedLoad(): ConfirmedLoad {
  return {
    referenceNumber: "884213",
    carrierName: "GULF COAST HAULING LLC",
    carrierMcNumber: "987654",
    carrierDotNumber: null,
    commodity: "Canned goods",
    weightLbs: 42000,
    equipment: "53' Dry Van",
    carrierRateCents: 185_000,
    stops: [
      {
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
      },
      {
        kind: "delivery",
        partyName: "LONE STAR FOODS",
        addressLine: "900 Industrial Way",
        city: "Dallas",
        state: "TX",
        postalCode: "75201",
        date: "2026-11-03",
        windowStart: "14:00",
        windowEnd: null,
        referenceNumber: null,
        windowRawText: "DEL 11/03 1400",
      },
    ],
    provenance: {
      producedBy: "label-proximity-v1",
      textSource: "plain-text",
      filename: null,
      corrections: [{ path: "weightLbs", confidence: 0.9 }],
      acceptedFlagged: [],
    },
  };
}

/** The second stop, as the edit form reposts it unchanged. */
const DELIVERY_ROW: Record<string, string> = {
  kind: "delivery",
  partyName: "LONE STAR FOODS",
  addressLine: "900 Industrial Way",
  city: "Dallas",
  state: "TX",
  postalCode: "75201",
  date: "2026-11-03",
  windowStart: "14:00",
  windowEnd: "",
  referenceNumber: "",
  windowRawText: "DEL 11/03 1400",
};

/** What the edit form posts. `stops` is a list of [id, overrides]. */
function editForm(
  stops: readonly (readonly [string | null, Record<string, string>])[],
  overrides: Record<string, string> = {},
): FormData {
  const formData = new FormData();
  formData.set("loadId", "ignored-by-the-reader");
  for (const [key, value] of Object.entries({ ...RATE_CON, ...overrides })) {
    formData.set(key, value);
  }
  formData.set("carrierDotNumber", "");

  for (const [id, fields] of stops) {
    const row: Record<string, string> = {
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
      ...fields,
    };
    formData.append("stop.id", id ?? "");
    for (const [key, value] of Object.entries(row)) {
      formData.append(`stop.${key}`, value);
    }
  }

  return formData;
}

async function savedLoad(tx: DbExecutor, scope: BrokerageScope) {
  const outcome = await wire(tx).confirm(scope, confirmedLoad());
  if (outcome.status !== "saved")
    throw new Error(`expected a save, got ${outcome.status}`);
  return outcome;
}

describe("editing a load, end to end", () => {
  it("rewrites the load and records what changed", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const saved = await savedLoad(tx, scope);
      const { update, loads } = wire(tx);

      const read = readEditedLoad(
        editForm(
          [
            [saved.stops[0].id, {}],
            [saved.stops[1].id, DELIVERY_ROW],
          ],
          { carrierRateCents: "1900.00", commodity: "Frozen poultry" },
        ),
      );
      if (!read.ok) throw new Error(read.message);

      const outcome = await update(scope, saved.load.id, read.edited);
      expect(outcome.status).toBe("saved");

      const found = await loads.findById(scope, saved.load.id);
      expect(found?.load.carrierPayCents).toBe(190_000);
      expect(found?.load.commodityDescription).toBe("Frozen poultry");
      // Status is not this screen's to change.
      expect(found?.load.status).toBe("booked");
      // Stop ids survive an edit.
      expect(found?.stops.map((stop) => stop.id)).toEqual(
        saved.stops.map((stop) => stop.id),
      );

      const trail = found?.load.details.edits;
      expect(trail).toHaveLength(1);
      expect(trail?.[0].changes.map((change) => change.path).sort()).toEqual([
        "carrierPayCents",
        "commodityDescription",
      ]);
      // Evidence about the parser survives an edit made later.
      expect(found?.load.details.intake?.producedBy).toBe("label-proximity-v1");
    });
  });

  it("corrects a facility for every load that uses it", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const saved = await savedLoad(tx, scope);
      const { update, parties } = wire(tx);

      const read = readEditedLoad(
        editForm([
          [saved.stops[0].id, { postalCode: "77012" }],
          [saved.stops[1].id, DELIVERY_ROW],
        ]),
      );
      if (!read.ok) throw new Error(read.message);

      const outcome = await update(scope, saved.load.id, read.edited);
      if (outcome.status !== "saved") throw new Error("expected a save");

      const acme = await parties.findByName(scope, "ACME DISTRIBUTION");
      expect(acme?.postalCode).toBe("77012");
      // Fixed in place, not duplicated.
      expect(await parties.list(scope)).toHaveLength(2);
      // The facility's zone is not re-guessed by an edit.
      expect(acme?.timeZone).toBeNull();
    });
  });

  it("drops a stop and renumbers what is left", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const saved = await savedLoad(tx, scope);
      const { update, loads } = wire(tx);

      const read = readEditedLoad(editForm([[saved.stops[1].id, DELIVERY_ROW]]));
      if (!read.ok) throw new Error(read.message);

      const outcome = await update(scope, saved.load.id, read.edited);
      if (outcome.status !== "saved") throw new Error("expected a save");

      const found = await loads.findById(scope, saved.load.id);
      expect(found?.stops).toHaveLength(1);
      expect(found?.stops[0].id).toBe(saved.stops[1].id);
      expect(found?.stops[0].sequence).toBe(0);
    });
  });

  it("refuses a load number another load already holds", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const saved = await savedLoad(tx, scope);
      const { update, loads } = wire(tx);

      await loads.create(scope, { referenceNumber: "999999", status: "draft" }, []);

      const read = readEditedLoad(
        editForm(
          [
            [saved.stops[0].id, {}],
            [saved.stops[1].id, DELIVERY_ROW],
          ],
          { referenceNumber: "999999" },
        ),
      );
      if (!read.ok) throw new Error(read.message);

      const outcome = await update(scope, saved.load.id, read.edited);
      expect(outcome.status).toBe("duplicate_reference");

      // Nothing was written.
      const found = await loads.findById(scope, saved.load.id);
      expect(found?.load.referenceNumber).toBe("884213");
    });
  });

  it("clears a stop's reference number, and does not report it as changed again", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const saved = await savedLoad(tx, scope);
      const { update, loads } = wire(tx);

      const clearedPickup: [string | null, Record<string, string>][] = [
        [saved.stops[0].id, { referenceNumber: "" }],
        [saved.stops[1].id, DELIVERY_ROW],
      ];

      const read = readEditedLoad(editForm(clearedPickup));
      if (!read.ok) throw new Error(read.message);

      const outcome = await update(scope, saved.load.id, read.edited);
      if (outcome.status !== "saved") throw new Error("expected a save");

      const found = await loads.findById(scope, saved.load.id);
      expect(found?.stops[0].details.appointmentNumber).toBeUndefined();

      const trail = found?.load.details.edits;
      expect(trail).toHaveLength(1);
      expect(trail?.[0].changes.map((change) => change.path)).toContain(
        "stops.0.referenceNumber",
      );

      // Saving the same cleared value again reports nothing further: the
      // field is already gone, so the trail does not grow.
      const again = readEditedLoad(editForm(clearedPickup));
      if (!again.ok) throw new Error(again.message);

      const secondOutcome = await update(scope, saved.load.id, again.edited);
      if (secondOutcome.status !== "saved") throw new Error("expected a save");

      const refound = await loads.findById(scope, saved.load.id);
      expect(refound?.stops[0].details.appointmentNumber).toBeUndefined();
      expect(refound?.load.details.edits).toHaveLength(1);
    });
  });

  it("never lets an edit alter what the document said about timing", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const saved = await savedLoad(tx, scope);
      const { update, loads } = wire(tx);

      const read = readEditedLoad(
        editForm([
          [saved.stops[0].id, { windowRawText: "TAMPERED" }],
          [saved.stops[1].id, DELIVERY_ROW],
        ]),
      );
      if (!read.ok) throw new Error(read.message);

      const outcome = await update(scope, saved.load.id, read.edited);
      if (outcome.status !== "saved") throw new Error("expected a save");

      const found = await loads.findById(scope, saved.load.id);
      expect(found?.stops[0].windowRawText).toBe("PU 11/02 0800-1200");
      // Not a reportable change: it is a fact about the document, not the load.
      expect(found?.load.details.edits).toBeUndefined();
    });
  });

  it("never renames a facility; a different name links or creates a different one", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const saved = await savedLoad(tx, scope);
      const { update, parties, loads } = wire(tx);

      const read = readEditedLoad(
        editForm([
          [saved.stops[0].id, { partyName: "NORTH HOUSTON DC" }],
          [saved.stops[1].id, DELIVERY_ROW],
        ]),
      );
      if (!read.ok) throw new Error(read.message);

      const outcome = await update(scope, saved.load.id, read.edited);
      if (outcome.status !== "saved") throw new Error("expected a save");

      // The old dock is untouched, for every other load that points at it.
      const original = await parties.findByName(scope, "ACME DISTRIBUTION");
      expect(original?.addressLine1).toBe("4400 Navigation Blvd");
      expect(original?.postalCode).toBe("77011");

      const renamed = await parties.findByName(scope, "NORTH HOUSTON DC");
      expect(renamed).not.toBeNull();

      const found = await loads.findById(scope, saved.load.id);
      expect(found?.stops[0].partyId).toBe(renamed?.id);

      // Relinked, not renamed: a new row, not two names on one.
      expect(await parties.list(scope)).toHaveLength(3);
    });
  });

  it("records the carrier link being broken, which is a real column write", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const { carriers } = wire(tx);

      // The carrier has to exist before intake saves, because that is the only
      // way the load gets linked: intake never creates one.
      const carrier = await carriers.create(scope, {
        mcNumber: "987654",
        dotNumber: "1234567",
        legalName: "GULF COAST HAULING LLC",
      });

      const saved = await savedLoad(tx, scope);
      const { update, loads } = wire(tx);
      expect(saved.load.carrierId).toBe(carrier.id);

      // Both number boxes cleared, nothing else touched.
      const read = readEditedLoad(
        editForm(
          [
            [saved.stops[0].id, {}],
            [saved.stops[1].id, DELIVERY_ROW],
          ],
          { carrierMcNumber: "" },
        ),
      );
      if (!read.ok) throw new Error(read.message);

      const outcome = await update(scope, saved.load.id, read.edited);
      if (outcome.status !== "saved") throw new Error("expected a save");

      const found = await loads.findById(scope, saved.load.id);
      // The column really moved: this load no longer has a vetting history
      // behind it.
      expect(found?.load.carrierId).toBeNull();
      expect(found?.load.details.edits).toHaveLength(1);
      expect(found?.load.details.edits?.[0].changes).toEqual([
        {
          path: "carrierId",
          from: "GULF COAST HAULING LLC",
          to: "no vetted carrier",
        },
      ]);
    });
  });

  it("carries forward customerRateCents and status, which this form does not collect", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const saved = await savedLoad(tx, scope);
      const { update, loads } = wire(tx);

      // Set a non-default status and a customer rate using only real code:
      // the repository's own `update`, not a hand-built row.
      const seeded = await loads.update(
        scope,
        saved.load.id,
        { ...saved.load, status: "dispatched", customerRateCents: 210_000 },
        saved.stops,
      );
      if (!seeded) throw new Error("expected the seed write to succeed");

      const read = readEditedLoad(
        editForm([
          [saved.stops[0].id, {}],
          [saved.stops[1].id, DELIVERY_ROW],
        ]),
      );
      if (!read.ok) throw new Error(read.message);

      const outcome = await update(scope, saved.load.id, read.edited);
      if (outcome.status !== "saved") throw new Error("expected a save");

      const found = await loads.findById(scope, saved.load.id);
      expect(found?.load.customerRateCents).toBe(210_000);
      expect(found?.load.status).toBe("dispatched");
    });
  });
});
