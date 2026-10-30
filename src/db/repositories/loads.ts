import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import { newId } from "@/domain/ids";
import type { Load, Stop } from "@/domain/load/load";
import type { LoadRepository } from "@/domain/ports/repositories";
import { assertLocalDateTime, type LocalDateTime } from "@/domain/time-window";
import type { DbExecutor } from "../client";
import { loads, stops } from "../schema";

type LoadRow = typeof loads.$inferSelect;
type StopRow = typeof stops.$inferSelect;

function toLoad(row: LoadRow): Load {
  return {
    id: row.id,
    brokerageId: row.brokerageId,
    referenceNumber: row.referenceNumber,
    status: row.status,
    equipmentType: row.equipmentType,
    commodityDescription: row.commodityDescription,
    weightLbs: row.weightLbs,
    customerRateCents: row.customerRateCents,
    carrierPayCents: row.carrierPayCents,
    carrierId: row.carrierId,
    details: row.details,
  };
}

/**
 * Postgres renders a `timestamp` as "2026-11-02 08:00:00"; the domain's local
 * wall time is "2026-11-02T08:00". Normalizing on the way out keeps the two
 * notations from leaking into comparisons upstream.
 *
 * Seconds are dropped rather than rounded — dock windows are stated to the
 * minute, and nothing writes a non-zero seconds value. Anything the column
 * holds that does not read as a timestamp is a bug worth surfacing, not a
 * window worth silently blanking.
 */
function toLocalDateTime(value: string | null): LocalDateTime | null {
  if (value === null) return null;

  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(value);
  if (!match) {
    throw new Error(`Unreadable local timestamp from the database: "${value}"`);
  }
  return assertLocalDateTime(`${match[1]}T${match[2]}`);
}

function toStop(row: StopRow): Stop {
  return {
    id: row.id,
    brokerageId: row.brokerageId,
    loadId: row.loadId,
    sequence: row.sequence,
    type: row.type,
    partyId: row.partyId,
    opensAtLocal: toLocalDateTime(row.opensAtLocal),
    closesAtLocal: toLocalDateTime(row.closesAtLocal),
    timeZone: row.timeZone,
    appointmentType: row.appointmentType,
    windowRawText: row.windowRawText,
    details: row.details,
  };
}

export function createLoadRepository(executor: DbExecutor): LoadRepository {
  return {
    async create(scope, input, newStops) {
      // One transaction for the load and its route. Under the test harness this
      // nests as a savepoint inside the rollback transaction, which is why the
      // repository takes an executor rather than reaching for `db`.
      return executor.transaction(async (tx) => {
        const [loadRow] = await tx
          .insert(loads)
          .values({
            id: newId(),
            brokerageId: scope.brokerageId,
            referenceNumber: input.referenceNumber,
            status: input.status ?? "draft",
            equipmentType: input.equipmentType ?? null,
            commodityDescription: input.commodityDescription ?? null,
            weightLbs: input.weightLbs ?? null,
            customerRateCents: input.customerRateCents ?? null,
            carrierPayCents: input.carrierPayCents ?? null,
            carrierId: input.carrierId ?? null,
            details: input.details ?? {},
          })
          .returning();

        if (newStops.length === 0) {
          return { load: toLoad(loadRow), stops: [] };
        }

        const stopRows = await tx
          .insert(stops)
          .values(
            newStops.map((stop) => ({
              id: newId(),
              brokerageId: scope.brokerageId,
              loadId: loadRow.id,
              sequence: stop.sequence,
              type: stop.type,
              partyId: stop.partyId,
              opensAtLocal: stop.opensAtLocal ?? null,
              closesAtLocal: stop.closesAtLocal ?? null,
              timeZone: stop.timeZone ?? null,
              appointmentType: stop.appointmentType ?? null,
              windowRawText: stop.windowRawText ?? null,
              details: stop.details ?? {},
            })),
          )
          .returning();

        return {
          load: toLoad(loadRow),
          stops: stopRows.map(toStop).sort((a, b) => a.sequence - b.sequence),
        };
      });
    },

    async update(scope, id, input, newStops) {
      return executor.transaction(async (tx) => {
        const [loadRow] = await tx
          .update(loads)
          .set({
            referenceNumber: input.referenceNumber,
            // No `?? "draft"` here, unlike `create`: see LoadUpdate.
            status: input.status,
            equipmentType: input.equipmentType ?? null,
            commodityDescription: input.commodityDescription ?? null,
            weightLbs: input.weightLbs ?? null,
            customerRateCents: input.customerRateCents ?? null,
            carrierPayCents: input.carrierPayCents ?? null,
            carrierId: input.carrierId ?? null,
            details: input.details ?? {},
          })
          .where(and(eq(loads.brokerageId, scope.brokerageId), eq(loads.id, id)))
          .returning();

        // Out of scope is indistinguishable from absent, and the transaction
        // has written nothing else yet.
        if (!loadRow) return null;

        const kept = newStops
          .map((stop) => stop.id)
          .filter((stopId): stopId is string => typeof stopId === "string");

        await tx
          .delete(stops)
          .where(
            kept.length === 0
              ? eq(stops.loadId, id)
              : and(eq(stops.loadId, id), notInArray(stops.id, kept)),
          );

        // Sequences land in a negative range first. `stops_load_sequence_key`
        // is unique on (load_id, sequence), so writing final sequences
        // directly collides the moment two stops swap places. Nothing real
        // occupies the negative range, so the intermediate state is safe.
        for (const [index, stop] of newStops.entries()) {
          const row = {
            sequence: -1 - index,
            type: stop.type,
            partyId: stop.partyId,
            opensAtLocal: stop.opensAtLocal ?? null,
            closesAtLocal: stop.closesAtLocal ?? null,
            timeZone: stop.timeZone ?? null,
            appointmentType: stop.appointmentType ?? null,
            windowRawText: stop.windowRawText ?? null,
            details: stop.details ?? {},
          };

          if (stop.id) {
            await tx
              .update(stops)
              .set(row)
              .where(and(eq(stops.loadId, id), eq(stops.id, stop.id)));
          } else {
            await tx.insert(stops).values({
              id: newId(),
              brokerageId: scope.brokerageId,
              loadId: id,
              ...row,
            });
          }
        }

        await tx
          .update(stops)
          .set({ sequence: sql`-1 - ${stops.sequence}` })
          .where(and(eq(stops.loadId, id), sql`${stops.sequence} < 0`));

        const stopRows = await tx
          .select()
          .from(stops)
          .where(and(eq(stops.brokerageId, scope.brokerageId), eq(stops.loadId, id)))
          .orderBy(asc(stops.sequence));

        return { load: toLoad(loadRow), stops: stopRows.map(toStop) };
      });
    },

    async findById(scope, id) {
      const [loadRow] = await executor
        .select()
        .from(loads)
        .where(and(eq(loads.brokerageId, scope.brokerageId), eq(loads.id, id)))
        .limit(1);
      if (!loadRow) return null;

      const stopRows = await executor
        .select()
        .from(stops)
        .where(
          and(eq(stops.brokerageId, scope.brokerageId), eq(stops.loadId, loadRow.id)),
        )
        .orderBy(asc(stops.sequence));

      return { load: toLoad(loadRow), stops: stopRows.map(toStop) };
    },

    async findByReferenceNumber(scope, referenceNumber) {
      const [row] = await executor
        .select()
        .from(loads)
        .where(
          and(
            eq(loads.brokerageId, scope.brokerageId),
            eq(loads.referenceNumber, referenceNumber),
          ),
        )
        .limit(1);
      return row ? toLoad(row) : null;
    },

    async list(scope, limit = 100) {
      const rows = await executor
        .select()
        .from(loads)
        .where(eq(loads.brokerageId, scope.brokerageId))
        .orderBy(desc(loads.createdAt))
        .limit(limit);
      return rows.map(toLoad);
    },
  };
}
