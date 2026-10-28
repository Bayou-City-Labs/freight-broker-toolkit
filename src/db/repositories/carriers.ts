import { and, desc, eq } from "drizzle-orm";
import type { Carrier, CarrierCheck } from "@/domain/carrier/carrier";
import { newId } from "@/domain/ids";
import { snapshotHash } from "@/domain/carrier/snapshot";
import type {
  CarrierCheckRepository,
  CarrierRepository,
} from "@/domain/ports/repositories";
import type { DbExecutor } from "../client";
import { carrierChecks, carriers } from "../schema";

type CarrierRow = typeof carriers.$inferSelect;
type CarrierCheckRow = typeof carrierChecks.$inferSelect;

function toCarrier(row: CarrierRow): Carrier {
  return {
    id: row.id,
    brokerageId: row.brokerageId,
    dotNumber: row.dotNumber,
    mcNumber: row.mcNumber,
    legalName: row.legalName,
    dbaName: row.dbaName,
    details: row.details,
  };
}

function toCarrierCheck(row: CarrierCheckRow): CarrierCheck {
  return {
    id: row.id,
    brokerageId: row.brokerageId,
    carrierId: row.carrierId,
    checkedAt: row.checkedAt,
    source: row.source,
    payload: row.payload,
    payloadHash: row.payloadHash,
    facts: {
      authorityStatus: row.authorityStatus,
      insuranceOnFile: row.insuranceOnFile,
      safetyRating: row.safetyRating,
      outOfService: row.outOfService,
      outOfServiceDate: row.outOfServiceDate,
      powerUnits: row.powerUnits,
      drivers: row.drivers,
    },
    verdict: {
      level: row.verdictLevel,
      reasons: row.verdictReasons,
      rulesetVersion: row.rulesetVersion,
    },
  };
}

export function createCarrierRepository(executor: DbExecutor): CarrierRepository {
  return {
    async create(scope, input) {
      const [row] = await executor
        .insert(carriers)
        .values({
          id: newId(),
          brokerageId: scope.brokerageId,
          dotNumber: input.dotNumber ?? null,
          mcNumber: input.mcNumber ?? null,
          legalName: input.legalName,
          dbaName: input.dbaName ?? null,
          details: input.details ?? {},
        })
        .returning();
      return toCarrier(row);
    },

    async findById(scope, id) {
      const [row] = await executor
        .select()
        .from(carriers)
        .where(and(eq(carriers.brokerageId, scope.brokerageId), eq(carriers.id, id)))
        .limit(1);
      return row ? toCarrier(row) : null;
    },

    async findByDotNumber(scope, dotNumber) {
      const [row] = await executor
        .select()
        .from(carriers)
        .where(
          and(
            eq(carriers.brokerageId, scope.brokerageId),
            eq(carriers.dotNumber, dotNumber),
          ),
        )
        .limit(1);
      return row ? toCarrier(row) : null;
    },

    async findByMcNumber(scope, mcNumber) {
      const [row] = await executor
        .select()
        .from(carriers)
        .where(
          and(
            eq(carriers.brokerageId, scope.brokerageId),
            eq(carriers.mcNumber, mcNumber),
          ),
        )
        .limit(1);
      return row ? toCarrier(row) : null;
    },

    async list(scope, limit = 100) {
      const rows = await executor
        .select()
        .from(carriers)
        .where(eq(carriers.brokerageId, scope.brokerageId))
        .orderBy(carriers.legalName)
        .limit(limit);
      return rows.map(toCarrier);
    },
  };
}

export function createCarrierCheckRepository(
  executor: DbExecutor,
): CarrierCheckRepository {
  return {
    async record(scope, input) {
      const [row] = await executor
        .insert(carrierChecks)
        .values({
          id: newId(),
          brokerageId: scope.brokerageId,
          carrierId: input.carrierId,
          checkedAt: input.checkedAt ?? new Date(),
          source: input.source,
          payload: input.payload,
          payloadHash: snapshotHash(input.payload),
          authorityStatus: input.facts.authorityStatus,
          insuranceOnFile: input.facts.insuranceOnFile,
          safetyRating: input.facts.safetyRating,
          outOfService: input.facts.outOfService,
          outOfServiceDate: input.facts.outOfServiceDate,
          powerUnits: input.facts.powerUnits,
          drivers: input.facts.drivers,
          verdictLevel: input.verdict.level,
          verdictReasons: [...input.verdict.reasons],
          rulesetVersion: input.verdict.rulesetVersion,
        })
        .returning();
      return toCarrierCheck(row);
    },

    async latestFor(scope, carrierId) {
      const [row] = await executor
        .select()
        .from(carrierChecks)
        .where(
          and(
            eq(carrierChecks.brokerageId, scope.brokerageId),
            eq(carrierChecks.carrierId, carrierId),
          ),
        )
        .orderBy(desc(carrierChecks.checkedAt))
        .limit(1);
      return row ? toCarrierCheck(row) : null;
    },

    async historyFor(scope, carrierId, limit = 50) {
      const rows = await executor
        .select()
        .from(carrierChecks)
        .where(
          and(
            eq(carrierChecks.brokerageId, scope.brokerageId),
            eq(carrierChecks.carrierId, carrierId),
          ),
        )
        .orderBy(desc(carrierChecks.checkedAt))
        .limit(limit);
      return rows.map(toCarrierCheck);
    },
  };
}
