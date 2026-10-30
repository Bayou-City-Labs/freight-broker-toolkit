import { describe, expect, it } from "vitest";
import { fakeCarriers, fakeLoads, fakeParties } from "@/test/fakes";
import { createConfirmDraft, type ConfirmedLoad } from "../intake/confirm";
import { scopeFor, type BrokerageScope } from "../tenancy";
import { createUpdateLoad, type EditedLoad, type EditedStop } from "./update";

const scope: BrokerageScope = scopeFor("brokerage-1");
const otherScope: BrokerageScope = scopeFor("brokerage-2");
const at = new Date("2026-10-29T20:15:00.000Z");

/**
 * Every case starts from a load that intake saved, because that is the only
 * way a load exists. Reusing `confirmDraft` rather than hand-building rows also
 * keeps the two use cases honest about sharing a representation.
 */
function confirmed(overrides: Partial<ConfirmedLoad> = {}): ConfirmedLoad {
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
      textSource: "pdf-text",
      filename: "rate-con.pdf",
      corrections: [{ path: "weightLbs", confidence: 0.9 }],
      acceptedFlagged: ["stops.0.city"],
    },
    ...overrides,
  };
}

async function given(carriers = fakeCarriers()) {
  const parties = fakeParties();
  const loads = fakeLoads();

  const confirm = createConfirmDraft({
    loads: loads.repo,
    parties: parties.repo,
    carriers: carriers.repo,
  });
  const update = createUpdateLoad({
    loads: loads.repo,
    parties: parties.repo,
    carriers: carriers.repo,
    now: () => at,
  });

  const saved = await confirm(scope, confirmed());
  if (saved.status !== "saved") throw new Error("fixture failed to save");

  /** The submission the edit form posts when nothing is changed. */
  const unchanged = (): EditedLoad => ({
    referenceNumber: "884213",
    carrierName: "GULF COAST HAULING LLC",
    carrierMcNumber: "987654",
    carrierDotNumber: null,
    commodity: "Canned goods",
    weightLbs: 42000,
    equipment: "53' Dry Van",
    carrierRateCents: 185_000,
    stops: saved.stops.map(
      (stop, index): EditedStop => ({
        id: stop.id,
        ...confirmed().stops[index],
      }),
    ),
  });

  return { update, loads, parties, carriers, saved, unchanged };
}

describe("updateLoad", () => {
  it("changes a field and records what it was", async () => {
    const { update, saved, unchanged } = await given();

    const outcome = await update(scope, saved.load.id, {
      ...unchanged(),
      carrierRateCents: 190_000,
    });

    expect(outcome.status).toBe("saved");
    if (outcome.status !== "saved") return;

    expect(outcome.load.carrierPayCents).toBe(190_000);
    expect(outcome.load.details.edits).toEqual([
      {
        at: at.toISOString(),
        changes: [
          // `Money.toDollarString()` emits "1850.00" — no separators, no sign.
          { path: "carrierPayCents", from: "$1850.00", to: "$1900.00" },
        ],
      },
    ]);
  });

  it("records nothing when a save changed nothing", async () => {
    const { update, saved, unchanged } = await given();

    const outcome = await update(scope, saved.load.id, unchanged());
    if (outcome.status !== "saved") throw new Error("expected a save");

    // An empty entry would make the trail noise and hide the real edits.
    expect(outcome.load.details.edits).toBeUndefined();
  });

  it("keeps the intake record, the status, and the customer rate", async () => {
    const { update, loads, saved, unchanged } = await given();

    // A number only a human can know, set outside this form.
    const row = loads.rows.find((load) => load.id === saved.load.id);
    if (row) loads.rows[loads.rows.indexOf(row)] = { ...row, customerRateCents: 210_000 };

    const outcome = await update(scope, saved.load.id, {
      ...unchanged(),
      commodity: "Frozen poultry",
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    // Evidence about the parser is not an edit and must survive one.
    expect(outcome.load.details.intake?.corrections).toEqual([
      { path: "weightLbs", confidence: 0.9 },
    ]);
    // Status is not this feature's to change.
    expect(outcome.load.status).toBe("booked");
    // Not on the form, so not nulled by a save.
    expect(outcome.load.customerRateCents).toBe(210_000);
  });

  it("does not re-infer the status when a rate is filled in", async () => {
    const parties = fakeParties();
    const loads = fakeLoads();
    const carriers = fakeCarriers();
    const confirm = createConfirmDraft({
      loads: loads.repo,
      parties: parties.repo,
      carriers: carriers.repo,
    });
    const update = createUpdateLoad({
      loads: loads.repo,
      parties: parties.repo,
      carriers: carriers.repo,
      now: () => at,
    });

    const saved = await confirm(scope, confirmed({ carrierRateCents: null }));
    if (saved.status !== "saved") throw new Error("expected a save");
    expect(saved.load.status).toBe("draft");

    const outcome = await update(scope, saved.load.id, {
      referenceNumber: "884213",
      carrierName: "GULF COAST HAULING LLC",
      carrierMcNumber: "987654",
      carrierDotNumber: null,
      commodity: "Canned goods",
      weightLbs: 42000,
      equipment: "53' Dry Van",
      carrierRateCents: 185_000,
      stops: saved.stops.map((stop, index) => ({
        id: stop.id,
        ...confirmed().stops[index],
      })),
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    // Re-inferring would also silently flip a status someone had set on
    // purpose. A real lifecycle needs discovery, not inference.
    expect(outcome.load.status).toBe("draft");
  });

  it("corrects the facility in place when the name is unchanged", async () => {
    const { update, parties, saved, unchanged } = await given();
    const edit = unchanged();

    const outcome = await update(scope, saved.load.id, {
      ...edit,
      stops: [{ ...edit.stops[0], postalCode: "77012" }, edit.stops[1]],
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    const acme = parties.rows.filter((party) => party.name === "ACME DISTRIBUTION");
    expect(acme).toHaveLength(1);
    expect(acme[0].postalCode).toBe("77012");
    expect(outcome.load.details.edits?.[0].changes).toEqual([
      { path: "stops.0.postalCode", from: "77011", to: "77012" },
    ]);
  });

  it("points the stop at a different facility when the name changes", async () => {
    const { update, parties, saved, unchanged } = await given();
    const edit = unchanged();

    const outcome = await update(scope, saved.load.id, {
      ...edit,
      stops: [
        { ...edit.stops[0], partyName: "HOUSTON TERMINAL WAREHOUSE" },
        edit.stops[1],
      ],
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    // The old facility is untouched — other loads point at it.
    expect(parties.rows.map((party) => party.name).sort()).toEqual([
      "ACME DISTRIBUTION",
      "HOUSTON TERMINAL WAREHOUSE",
      "LONE STAR FOODS",
    ]);
    const stop = outcome.stops[0];
    expect(stop.partyId).toBe(
      parties.rows.find((p) => p.name === "HOUSTON TERMINAL WAREHOUSE")?.id,
    );
  });

  it("reuses a facility that already exists under the new name", async () => {
    const { update, parties, saved, unchanged } = await given();
    const edit = unchanged();

    const outcome = await update(scope, saved.load.id, {
      ...edit,
      stops: [{ ...edit.stops[0], partyName: "lone star foods" }, edit.stops[1]],
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(parties.rows).toHaveLength(2);
    const loneStar = parties.rows.find((p) => p.name === "LONE STAR FOODS");
    expect(outcome.stops[0].partyId).toBe(loneStar?.id);
  });

  it("applies an added stop's address to the facility it names", async () => {
    const { update, parties, saved, unchanged } = await given();
    const edit = unchanged();

    // Removing a stop and re-adding it is how the route gets reordered, so a
    // re-added row carrying a corrected address is an ordinary edit, not an
    // exotic one.
    const outcome = await update(scope, saved.load.id, {
      ...edit,
      stops: [
        edit.stops[1],
        {
          ...edit.stops[0],
          id: null,
          addressLine: "2100 Navigation Blvd",
          postalCode: "77003",
        },
      ],
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    // Re-read, not the returned value: the trail's claim is about what is
    // stored, and the returned stop would be just as happy with a stale row.
    const acme = await parties.repo.findByName(scope, "ACME DISTRIBUTION");
    expect(acme?.addressLine1).toBe("2100 Navigation Blvd");
    expect(acme?.postalCode).toBe("77003");
    // Corrected in place, not duplicated.
    expect(parties.rows).toHaveLength(2);
  });

  it("does not blank a facility's address through a stop that stated only a name", async () => {
    const { update, parties, saved, unchanged } = await given();
    const edit = unchanged();

    const outcome = await update(scope, saved.load.id, {
      ...edit,
      stops: [
        edit.stops[1],
        {
          ...edit.stops[0],
          id: null,
          addressLine: null,
          city: null,
          state: null,
          postalCode: null,
        },
      ],
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    const acme = await parties.repo.findByName(scope, "ACME DISTRIBUTION");
    expect(acme?.addressLine1).toBe("4400 Navigation Blvd");
    expect(acme?.city).toBe("Houston");
    expect(acme?.region).toBe("TX");
    expect(acme?.postalCode).toBe("77011");
  });

  it("applies the submitted address when a renamed stop resolves to a held facility", async () => {
    const { update, parties, saved, unchanged } = await given();
    const edit = unchanged();

    // A one-stop route, so the facility is resolved exactly once: pointing two
    // stops at one dock and typing different addresses into each is a
    // last-write-wins question this test is not about.
    const outcome = await update(scope, saved.load.id, {
      ...edit,
      stops: [
        {
          ...edit.stops[0],
          partyName: "LONE STAR FOODS",
          addressLine: "900 Industrial Way",
          city: "Dallas",
          state: "TX",
          postalCode: "75202",
        },
      ],
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    const loneStar = await parties.repo.findByName(scope, "LONE STAR FOODS");
    expect(loneStar?.postalCode).toBe("75202");
    expect(parties.rows).toHaveLength(2);
  });

  it("adds a stop", async () => {
    const { update, saved, unchanged } = await given();
    const edit = unchanged();

    const outcome = await update(scope, saved.load.id, {
      ...edit,
      stops: [
        ...edit.stops,
        {
          id: null,
          kind: "delivery",
          partyName: "EL PASO CROSSDOCK",
          addressLine: null,
          city: "El Paso",
          state: "TX",
          postalCode: null,
          date: "2026-11-04",
          windowStart: "10:00",
          windowEnd: null,
          referenceNumber: null,
          windowRawText: null,
        },
      ],
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(outcome.stops).toHaveLength(3);
    expect(outcome.stops.map((stop) => stop.sequence)).toEqual([0, 1, 2]);
    expect(outcome.load.details.edits?.[0].changes).toEqual([
      { path: "stops", from: "2 stops", to: "3 stops" },
    ]);
  });

  it("removes a stop", async () => {
    const { update, saved, unchanged } = await given();
    const edit = unchanged();

    const outcome = await update(scope, saved.load.id, {
      ...edit,
      stops: [edit.stops[1]],
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(outcome.stops).toHaveLength(1);
    expect(outcome.stops[0].id).toBe(saved.stops[1].id);
    expect(outcome.stops[0].sequence).toBe(0);
  });

  it("reorders stops, keeping their ids", async () => {
    const { update, saved, unchanged } = await given();
    const edit = unchanged();

    const outcome = await update(scope, saved.load.id, {
      ...edit,
      stops: [edit.stops[1], edit.stops[0]],
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(outcome.stops.map((stop) => stop.id)).toEqual([
      saved.stops[1].id,
      saved.stops[0].id,
    ]);
  });

  it("saves when the reference number is unchanged", async () => {
    const { update, saved, unchanged } = await given();

    // The clash lookup is skipped entirely in this case, which is the point:
    // re-saving a load under its own number is not a duplicate.
    const outcome = await update(scope, saved.load.id, unchanged());
    expect(outcome.status).toBe("saved");
  });

  it("clears a stop's reference number, and reports it exactly once", async () => {
    const { update, saved, unchanged } = await given();
    const edit = unchanged();
    const cleared: EditedLoad = {
      ...edit,
      stops: [{ ...edit.stops[0], referenceNumber: null }, edit.stops[1]],
    };

    const first = await update(scope, saved.load.id, cleared);
    if (first.status !== "saved") throw new Error("expected a save");

    // The stored value has to actually go, or the trail is describing a save
    // that did not happen.
    expect(first.stops[0].details.appointmentNumber).toBeUndefined();
    expect(first.load.details.edits?.[0].changes).toEqual([
      { path: "stops.0.referenceNumber", from: "PU-4471", to: null },
    ]);

    // Re-submitting the same form changes nothing, so the trail must not grow.
    const second = await update(scope, saved.load.id, cleared);
    if (second.status !== "saved") throw new Error("expected a save");
    expect(second.load.details.edits).toHaveLength(1);
  });

  it("keeps keys on a stop that this form does not show", async () => {
    const { update, loads, saved, unchanged } = await given();
    const row = loads.stopRows.find((stop) => stop.id === saved.stops[0].id);
    if (!row) throw new Error("fixture failed");
    loads.stopRows[loads.stopRows.indexOf(row)] = {
      ...row,
      details: { ...row.details, sealNumber: "SL-99" },
    };

    const edit = unchanged();
    const outcome = await update(scope, saved.load.id, {
      ...edit,
      stops: [{ ...edit.stops[0], referenceNumber: null }, edit.stops[1]],
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    // Clearing the one key the form owns must not take the others with it.
    expect(outcome.stops[0].details.sealNumber).toBe("SL-99");
  });

  it("keeps the document's window text when the form omits it", async () => {
    const { update, saved, unchanged } = await given();
    const edit = unchanged();

    const outcome = await update(scope, saved.load.id, {
      ...edit,
      stops: [
        { ...edit.stops[0], windowRawText: null },
        edit.stops[1],
        {
          id: null,
          kind: "delivery",
          partyName: "EL PASO CROSSDOCK",
          addressLine: null,
          city: "El Paso",
          state: "TX",
          postalCode: null,
          date: "2026-11-04",
          windowStart: "10:00",
          windowEnd: null,
          referenceNumber: null,
          windowRawText: null,
        },
      ],
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    // What the document said is not the reviewer's to retype, and it is not
    // diffed — so an erasure here would be silent.
    expect(outcome.stops[0].windowRawText).toBe("PU 11/02 0800-1200");
    // A stop nobody has saved before has no document text to keep.
    expect(outcome.stops[2].windowRawText).toBeNull();
  });

  it("stays silent about a date it cannot store without a time", async () => {
    const { update, saved, unchanged } = await given();
    const edit = unchanged();
    const dateOnly: EditedLoad = {
      ...edit,
      stops: [{ ...edit.stops[0], windowStart: null, windowEnd: null }, edit.stops[1]],
    };

    const first = await update(scope, saved.load.id, dateOnly);
    if (first.status !== "saved") throw new Error("expected a save");

    // Storage needs a date *and* a time, so the date went nowhere.
    expect(first.stops[0].opensAtLocal).toBeNull();
    expect(first.stops[0].closesAtLocal).toBeNull();
    expect(first.load.details.edits?.[0].changes).toEqual([
      { path: "stops.0.windowStart", from: "08:00", to: null },
      { path: "stops.0.windowEnd", from: "12:00", to: null },
    ]);

    // The date is still on the form and still unstorable. Reporting it as a
    // change on every subsequent save is the lie this guards against.
    const second = await update(scope, saved.load.id, dateOnly);
    if (second.status !== "saved") throw new Error("expected a save");
    expect(second.load.details.edits).toHaveLength(1);
  });

  it("refuses to restate a stop type the form cannot express", async () => {
    const { update, loads, saved, unchanged } = await given();
    const row = loads.stopRows.find((stop) => stop.id === saved.stops[0].id);
    if (!row) throw new Error("fixture failed");
    loads.stopRows[loads.stopRows.indexOf(row)] = { ...row, type: "empty_return" };

    // Nothing creates an empty_return stop today. If something starts to,
    // editing the load must not quietly turn it into a pickup.
    await expect(update(scope, saved.load.id, unchanged())).rejects.toThrow(
      /empty_return/,
    );
  });

  it("refuses a reference number another load already uses", async () => {
    const { update, loads, parties, carriers, saved, unchanged } = await given();

    const confirm = createConfirmDraft({
      loads: loads.repo,
      parties: parties.repo,
      carriers: carriers.repo,
    });
    await confirm(scope, confirmed({ referenceNumber: "999999" }));

    const outcome = await update(scope, saved.load.id, {
      ...unchanged(),
      referenceNumber: "999999",
    });

    expect(outcome.status).toBe("duplicate_reference");
    if (outcome.status !== "duplicate_reference") return;
    expect(outcome.existing.referenceNumber).toBe("999999");
  });

  it("links a carrier we hold, and never creates one", async () => {
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
    const { update, saved, unchanged } = await given(carriers);

    const outcome = await update(scope, saved.load.id, {
      ...unchanged(),
      carrierMcNumber: "987654",
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(outcome.load.carrierId).toBe("carrier-known");
    expect(outcome.carrierLinked).toBe(true);
    expect(carriers.rows).toHaveLength(1);
  });

  it("records the carrier link being broken, and being made again", async () => {
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
    const { update, saved, unchanged } = await given(carriers);
    expect(saved.load.carrierId).toBe("carrier-known");

    // Clearing both number boxes is the *only* change on this save, which is
    // the case that used to leave no trace a save had happened at all.
    const unlinked = await update(scope, saved.load.id, {
      ...unchanged(),
      carrierMcNumber: null,
      carrierDotNumber: null,
    });
    if (unlinked.status !== "saved") throw new Error("expected a save");

    expect(unlinked.load.carrierId).toBeNull();
    expect(unlinked.carrierLinked).toBe(false);
    expect(unlinked.load.details.edits).toEqual([
      {
        at: at.toISOString(),
        changes: [
          // The carrier is named, not identified by UUID, and the empty side
          // says so in words — a dash would read as "unknown".
          {
            path: "carrierId",
            from: "GULF COAST HAULING LLC",
            to: "no vetted carrier",
          },
        ],
      },
    ]);

    // Relinking is equally consequential and equally recorded.
    const relinked = await update(scope, saved.load.id, unchanged());
    if (relinked.status !== "saved") throw new Error("expected a save");

    expect(relinked.load.carrierId).toBe("carrier-known");
    expect(relinked.load.details.edits).toHaveLength(2);
    expect(relinked.load.details.edits?.[1].changes).toEqual([
      { path: "carrierId", from: "no vetted carrier", to: "GULF COAST HAULING LLC" },
    ]);
  });

  it("does not invent a carrier for a number nobody has vetted", async () => {
    const { update, carriers, saved, unchanged } = await given();

    const outcome = await update(scope, saved.load.id, {
      ...unchanged(),
      carrierMcNumber: "111111",
    });
    if (outcome.status !== "saved") throw new Error("expected a save");

    expect(carriers.rows).toHaveLength(0);
    expect(outcome.load.carrierId).toBeNull();
    expect(outcome.carrierLinked).toBe(false);
  });

  it("will not touch another brokerage's load", async () => {
    const { update, saved, unchanged } = await given();

    const outcome = await update(otherScope, saved.load.id, unchanged());
    expect(outcome.status).toBe("not_found");
  });

  it("reports a load that does not exist", async () => {
    const { update, unchanged } = await given();

    const outcome = await update(scope, "load-nope", unchanged());
    expect(outcome.status).toBe("not_found");
  });
});
