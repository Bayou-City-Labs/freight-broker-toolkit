import { describe, expect, it } from "vitest";
import { fakeCarriers, fakeLoads, fakeParties } from "@/test/fakes";
import { scopeFor, type BrokerageScope } from "../tenancy";
import { createConfirmDraft, type ConfirmedLoad, type ConfirmedStop } from "./confirm";

const scope: BrokerageScope = scopeFor("brokerage-1");
const otherScope: BrokerageScope = scopeFor("brokerage-2");

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
