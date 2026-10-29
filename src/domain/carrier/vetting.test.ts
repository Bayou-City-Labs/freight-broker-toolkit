import { describe, expect, it } from "vitest";
import type { CarrierLookup, CarrierLookupResult } from "../ports/carrier-lookup";
import type { CarrierCheckRepository, CarrierRepository } from "../ports/repositories";
import { scopeFor, type BrokerageScope } from "../tenancy";
import type { Carrier, CarrierCheck } from "./carrier";
import type { CarrierIdentifier } from "./identifier";
import { snapshotHash, type CarrierFacts } from "./snapshot";
import { createVetCarrier } from "./vetting";

const scope: BrokerageScope = scopeFor("brokerage-1");

const cleanFacts: CarrierFacts = {
  authorityStatus: "active",
  insuranceOnFile: true,
  safetyRating: "satisfactory",
  outOfService: false,
  outOfServiceDate: null,
  powerUnits: 12,
  drivers: 14,
};

/**
 * In-memory stand-ins for the repository ports. They enforce the one invariant
 * that matters here — every read is filtered by the scope it was given — so a
 * use case that forgets to pass one fails these tests too.
 */
function fakeCarriers(seed: Carrier[] = []) {
  const rows = [...seed];
  let next = seed.length + 1;

  const repo: CarrierRepository = {
    async create(s, input) {
      const carrier: Carrier = {
        id: `carrier-${next++}`,
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

function fakeChecks(seed: CarrierCheck[] = []) {
  const rows = [...seed];
  let next = seed.length + 1;

  const repo: CarrierCheckRepository = {
    async record(s, input) {
      const check: CarrierCheck = {
        id: `check-${next++}`,
        brokerageId: s.brokerageId,
        carrierId: input.carrierId,
        checkedAt: input.checkedAt ?? new Date("2026-10-28T12:00:00Z"),
        source: input.source,
        payload: input.payload,
        payloadHash: snapshotHash(input.payload),
        facts: input.facts,
        verdict: input.verdict,
      };
      rows.push(check);
      return check;
    },
    async latestFor(s, carrierId) {
      const matches = rows.filter(
        (r) => r.brokerageId === s.brokerageId && r.carrierId === carrierId,
      );
      return matches.at(-1) ?? null;
    },
    async latestForEach(s, carrierIds) {
      const latest = new Map<string, CarrierCheck>();
      for (const row of rows) {
        if (row.brokerageId !== s.brokerageId) continue;
        if (!carrierIds.includes(row.carrierId)) continue;
        latest.set(row.carrierId, row);
      }
      return latest;
    },
    async historyFor(s, carrierId) {
      return rows
        .filter((r) => r.brokerageId === s.brokerageId && r.carrierId === carrierId)
        .reverse();
    },
  };

  return { repo, rows };
}

function fakeLookup(result: CarrierLookupResult | null): CarrierLookup {
  return {
    async byIdentifier() {
      return result;
    },
  };
}

function lookupResult(overrides: Partial<CarrierLookupResult> = {}): CarrierLookupResult {
  return {
    source: "fmcsa.qcmobile",
    payload: { carrier: { dotNumber: 76830, legalName: "GULF COAST HAULING LLC" } },
    identity: {
      legalName: "GULF COAST HAULING LLC",
      dbaName: null,
      dotNumber: "76830",
      mcNumber: "123456",
    },
    facts: cleanFacts,
    ...overrides,
  };
}

const byMc: CarrierIdentifier = { kind: "mc", value: "123456" };
const byDot: CarrierIdentifier = { kind: "dot", value: "76830" };

describe("vetCarrier", () => {
  it("creates the carrier and records a check on a first lookup", async () => {
    const carriers = fakeCarriers();
    const checks = fakeChecks();
    const vet = createVetCarrier({
      carriers: carriers.repo,
      checks: checks.repo,
      lookup: fakeLookup(lookupResult()),
    });

    const outcome = await vet(scope, byMc);

    expect(outcome.status).toBe("vetted");
    if (outcome.status !== "vetted") return;

    expect(carriers.rows).toHaveLength(1);
    expect(outcome.carrier.legalName).toBe("GULF COAST HAULING LLC");
    expect(outcome.carrier.dotNumber).toBe("76830");
    expect(outcome.carrier.mcNumber).toBe("123456");

    expect(checks.rows).toHaveLength(1);
    expect(outcome.check.verdict.level).toBe("pass");
    expect(outcome.check.source).toBe("fmcsa.qcmobile");
  });

  it("saves the contact details the provider reported", async () => {
    const vet = createVetCarrier({
      carriers: fakeCarriers().repo,
      checks: fakeChecks().repo,
      lookup: fakeLookup(
        lookupResult({
          details: { phone: "713-555-0100", physicalAddress: "Houston, TX" },
        }),
      ),
    });

    const outcome = await vet(scope, byMc);

    expect(outcome.status === "vetted" && outcome.carrier.details).toEqual({
      phone: "713-555-0100",
      physicalAddress: "Houston, TX",
    });
  });

  it("reports a first-ever check as changed, not as unchanged", async () => {
    const vet = createVetCarrier({
      carriers: fakeCarriers().repo,
      checks: fakeChecks().repo,
      lookup: fakeLookup(lookupResult()),
    });

    const outcome = await vet(scope, byMc);

    // There is no prior state to be unchanged from, and "no change" would read
    // as reassurance we haven't earned.
    expect(outcome.status === "vetted" && outcome.changed).toBe(true);
  });

  it("reuses the existing carrier on a re-vet instead of duplicating it", async () => {
    const carriers = fakeCarriers();
    const checks = fakeChecks();
    const vet = createVetCarrier({
      carriers: carriers.repo,
      checks: checks.repo,
      lookup: fakeLookup(lookupResult()),
    });

    const first = await vet(scope, byMc);
    const second = await vet(scope, byMc);

    expect(carriers.rows).toHaveLength(1);
    expect(checks.rows).toHaveLength(2);
    expect(first.status === "vetted" && second.status === "vetted").toBe(true);
    if (first.status !== "vetted" || second.status !== "vetted") return;
    expect(second.carrier.id).toBe(first.carrier.id);
  });

  it("flags an unchanged re-vet, and still records it", async () => {
    const checks = fakeChecks();
    const vet = createVetCarrier({
      carriers: fakeCarriers().repo,
      checks: checks.repo,
      lookup: fakeLookup(lookupResult()),
    });

    await vet(scope, byMc);
    const second = await vet(scope, byMc);

    expect(second.status === "vetted" && second.changed).toBe(false);
    // The audit trail is "we looked on this date and saw this", so an unchanged
    // check is still a check.
    expect(checks.rows).toHaveLength(2);
  });

  it("flags a re-vet whose payload moved", async () => {
    const carriers = fakeCarriers();
    const checks = fakeChecks();
    let result = lookupResult();
    const vet = createVetCarrier({
      carriers: carriers.repo,
      checks: checks.repo,
      lookup: {
        async byIdentifier() {
          return result;
        },
      },
    });

    await vet(scope, byMc);

    result = lookupResult({
      payload: {
        carrier: {
          dotNumber: 76830,
          legalName: "GULF COAST HAULING LLC",
          oosDate: "10/20/2026",
        },
      },
      facts: { ...cleanFacts, outOfService: true, outOfServiceDate: "2026-10-20" },
    });
    const second = await vet(scope, byMc);

    expect(second.status === "vetted" && second.changed).toBe(true);
    expect(second.status === "vetted" && second.check.verdict.level).toBe("fail");
  });

  it("matches an existing carrier by DOT even when the broker searched by MC", async () => {
    const carriers = fakeCarriers([
      {
        id: "carrier-existing",
        brokerageId: "brokerage-1",
        dotNumber: "76830",
        mcNumber: null,
        legalName: "GULF COAST HAULING LLC",
        dbaName: null,
        details: {},
      },
    ]);
    const vet = createVetCarrier({
      carriers: carriers.repo,
      checks: fakeChecks().repo,
      lookup: fakeLookup(lookupResult()),
    });

    const outcome = await vet(scope, byMc);

    expect(carriers.rows).toHaveLength(1);
    expect(outcome.status === "vetted" && outcome.carrier.id).toBe("carrier-existing");
  });

  it("records the searched-for number when the provider doesn't echo it back", async () => {
    const vet = createVetCarrier({
      carriers: fakeCarriers().repo,
      checks: fakeChecks().repo,
      lookup: fakeLookup(
        lookupResult({
          identity: {
            legalName: "GULF COAST HAULING LLC",
            dbaName: null,
            dotNumber: "76830",
            mcNumber: null,
          },
        }),
      ),
    });

    const outcome = await vet(scope, byMc);

    expect(outcome.status === "vetted" && outcome.carrier.mcNumber).toBe("123456");
  });

  it("does not invent a number the broker didn't search by", async () => {
    const vet = createVetCarrier({
      carriers: fakeCarriers().repo,
      checks: fakeChecks().repo,
      lookup: fakeLookup(
        lookupResult({
          identity: {
            legalName: "GULF COAST HAULING LLC",
            dbaName: null,
            dotNumber: "76830",
            mcNumber: null,
          },
        }),
      ),
    });

    const outcome = await vet(scope, byDot);

    expect(outcome.status === "vetted" && outcome.carrier.mcNumber).toBeNull();
  });

  it("reports not_found without creating a carrier or a check", async () => {
    const carriers = fakeCarriers();
    const checks = fakeChecks();
    const vet = createVetCarrier({
      carriers: carriers.repo,
      checks: checks.repo,
      lookup: fakeLookup(null),
    });

    const outcome = await vet(scope, byMc);

    expect(outcome).toEqual({ status: "not_found", identifier: byMc });
    expect(carriers.rows).toHaveLength(0);
    expect(checks.rows).toHaveLength(0);
  });

  it("never reuses another brokerage's carrier record", async () => {
    const carriers = fakeCarriers([
      {
        id: "carrier-other-tenant",
        brokerageId: "brokerage-2",
        dotNumber: "76830",
        mcNumber: "123456",
        legalName: "GULF COAST HAULING LLC",
        dbaName: null,
        details: {},
      },
    ]);
    const vet = createVetCarrier({
      carriers: carriers.repo,
      checks: fakeChecks().repo,
      lookup: fakeLookup(lookupResult()),
    });

    const outcome = await vet(scope, byMc);

    expect(outcome.status === "vetted" && outcome.carrier.id).not.toBe(
      "carrier-other-tenant",
    );
    expect(outcome.status === "vetted" && outcome.carrier.brokerageId).toBe(
      "brokerage-1",
    );
    expect(carriers.rows).toHaveLength(2);
  });
});
