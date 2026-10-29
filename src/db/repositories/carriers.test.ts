import { describe, expect, it } from "vitest";
import type { CarrierFacts } from "@/domain/carrier/snapshot";
import { snapshotHash } from "@/domain/carrier/snapshot";
import { evaluateCarrier } from "@/domain/carrier/verdict";
import { seedBrokerage, withRollback } from "@/test/db";
import { createCarrierCheckRepository, createCarrierRepository } from "./carriers";

const cleanFacts: CarrierFacts = {
  authorityStatus: "active",
  insuranceOnFile: true,
  safetyRating: "satisfactory",
  outOfService: false,
  outOfServiceDate: null,
  powerUnits: 12,
  drivers: 14,
};

describe("carrier repository", () => {
  it("round-trips a carrier", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const carriers = createCarrierRepository(tx);

      const created = await carriers.create(scope, {
        dotNumber: "1234567",
        mcNumber: "MC-987654",
        legalName: "GULF COAST HAULING LLC",
        details: { phone: "713-555-0142" },
      });

      expect(created.brokerageId).toBe(scope.brokerageId);
      const found = await carriers.findById(scope, created.id);
      expect(found?.legalName).toBe("GULF COAST HAULING LLC");
      expect(found?.details.phone).toBe("713-555-0142");
    });
  });

  it("finds carriers by DOT and MC number", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const carriers = createCarrierRepository(tx);
      await carriers.create(scope, {
        dotNumber: "1234567",
        mcNumber: "MC-987654",
        legalName: "GULF COAST HAULING LLC",
      });

      expect((await carriers.findByDotNumber(scope, "1234567"))?.mcNumber).toBe(
        "MC-987654",
      );
      expect((await carriers.findByMcNumber(scope, "MC-987654"))?.dotNumber).toBe(
        "1234567",
      );
      expect(await carriers.findByDotNumber(scope, "7654321")).toBeNull();
    });
  });

  // The invariant the whole tenancy design exists to guarantee.
  it("never returns another brokerage's carrier", async () => {
    await withRollback(async (tx) => {
      const acme = await seedBrokerage(tx, "Acme Logistics");
      const rival = await seedBrokerage(tx, "Rival Freight");
      const carriers = createCarrierRepository(tx);

      const acmeCarrier = await carriers.create(acme, {
        dotNumber: "1234567",
        legalName: "GULF COAST HAULING LLC",
      });

      expect(await carriers.findById(rival, acmeCarrier.id)).toBeNull();
      expect(await carriers.findByDotNumber(rival, "1234567")).toBeNull();
      expect(await carriers.list(rival)).toEqual([]);
      expect(await carriers.list(acme)).toHaveLength(1);
    });
  });

  it("allows two brokerages to vet the same DOT number independently", async () => {
    await withRollback(async (tx) => {
      const acme = await seedBrokerage(tx, "Acme Logistics");
      const rival = await seedBrokerage(tx, "Rival Freight");
      const carriers = createCarrierRepository(tx);

      await carriers.create(acme, { dotNumber: "1234567", legalName: "GULF COAST" });
      await carriers.create(rival, { dotNumber: "1234567", legalName: "GULF COAST" });

      expect((await carriers.findByDotNumber(acme, "1234567"))?.brokerageId).toBe(
        acme.brokerageId,
      );
      expect((await carriers.findByDotNumber(rival, "1234567"))?.brokerageId).toBe(
        rival.brokerageId,
      );
    });
  });
});

describe("carrier check repository", () => {
  it("stores the raw payload, derived facts, and verdict together", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const carrier = await createCarrierRepository(tx).create(scope, {
        dotNumber: "1234567",
        legalName: "GULF COAST HAULING LLC",
      });
      const checks = createCarrierCheckRepository(tx);

      const payload = { allowedToOperate: "Y", safetyRating: "S", dotNumber: "1234567" };
      const recorded = await checks.record(scope, {
        carrierId: carrier.id,
        source: "fmcsa.qcmobile",
        payload,
        facts: cleanFacts,
        verdict: evaluateCarrier(cleanFacts),
      });

      expect(recorded.payload).toEqual(payload);
      expect(recorded.payloadHash).toBe(snapshotHash(payload));
      expect(recorded.facts).toEqual(cleanFacts);
      expect(recorded.verdict.level).toBe("pass");
      expect(recorded.verdict.rulesetVersion).toBeTruthy();
    });
  });

  it("returns the newest check and keeps the history in order", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const carrier = await createCarrierRepository(tx).create(scope, {
        dotNumber: "1234567",
        legalName: "GULF COAST HAULING LLC",
      });
      const checks = createCarrierCheckRepository(tx);

      await checks.record(scope, {
        carrierId: carrier.id,
        source: "fmcsa.qcmobile",
        payload: { allowedToOperate: "Y" },
        facts: cleanFacts,
        verdict: evaluateCarrier(cleanFacts),
        checkedAt: new Date("2026-09-01T12:00:00Z"),
      });

      const revoked: CarrierFacts = { ...cleanFacts, authorityStatus: "inactive" };
      await checks.record(scope, {
        carrierId: carrier.id,
        source: "fmcsa.qcmobile",
        payload: { allowedToOperate: "N" },
        facts: revoked,
        verdict: evaluateCarrier(revoked),
        checkedAt: new Date("2026-10-01T12:00:00Z"),
      });

      const latest = await checks.latestFor(scope, carrier.id);
      expect(latest?.verdict.level).toBe("fail");
      expect(latest?.facts.authorityStatus).toBe("inactive");

      const history = await checks.historyFor(scope, carrier.id);
      expect(history).toHaveLength(2);
      expect(history[0].checkedAt.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    });
  });

  it("produces an unchanged hash when the upstream data has not moved", async () => {
    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const carrier = await createCarrierRepository(tx).create(scope, {
        dotNumber: "1234567",
        legalName: "GULF COAST HAULING LLC",
      });
      const checks = createCarrierCheckRepository(tx);

      const first = await checks.record(scope, {
        carrierId: carrier.id,
        source: "fmcsa.qcmobile",
        payload: { allowedToOperate: "Y", safetyRating: "S" },
        facts: cleanFacts,
        verdict: evaluateCarrier(cleanFacts),
      });
      // Same data, different key order on the wire.
      const second = await checks.record(scope, {
        carrierId: carrier.id,
        source: "fmcsa.qcmobile",
        payload: { safetyRating: "S", allowedToOperate: "Y" },
        facts: cleanFacts,
        verdict: evaluateCarrier(cleanFacts),
      });

      expect(second.payloadHash).toBe(first.payloadHash);
    });
  });

  it("never returns another brokerage's checks", async () => {
    await withRollback(async (tx) => {
      const acme = await seedBrokerage(tx, "Acme Logistics");
      const rival = await seedBrokerage(tx, "Rival Freight");
      const carrier = await createCarrierRepository(tx).create(acme, {
        dotNumber: "1234567",
        legalName: "GULF COAST HAULING LLC",
      });
      const checks = createCarrierCheckRepository(tx);

      await checks.record(acme, {
        carrierId: carrier.id,
        source: "fmcsa.qcmobile",
        payload: { allowedToOperate: "Y" },
        facts: cleanFacts,
        verdict: evaluateCarrier(cleanFacts),
      });

      expect(await checks.latestFor(rival, carrier.id)).toBeNull();
      expect(await checks.historyFor(rival, carrier.id)).toEqual([]);
    });
  });
});
