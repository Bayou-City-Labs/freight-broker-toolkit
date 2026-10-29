import { and, eq, sql } from "drizzle-orm";
import { newId } from "@/domain/ids";
import type { Party } from "@/domain/load/load";
import type { PartyRepository } from "@/domain/ports/repositories";
import type { DbExecutor } from "../client";
import { parties } from "../schema";

type PartyRow = typeof parties.$inferSelect;

function toParty(row: PartyRow): Party {
  return {
    id: row.id,
    brokerageId: row.brokerageId,
    name: row.name,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    country: row.country,
    timeZone: row.timeZone,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    details: row.details,
  };
}

export function createPartyRepository(executor: DbExecutor): PartyRepository {
  return {
    async create(scope, input) {
      const [row] = await executor
        .insert(parties)
        .values({
          id: newId(),
          brokerageId: scope.brokerageId,
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
        })
        .returning();
      return toParty(row);
    },

    async findById(scope, id) {
      const [row] = await executor
        .select()
        .from(parties)
        .where(and(eq(parties.brokerageId, scope.brokerageId), eq(parties.id, id)))
        .limit(1);
      return row ? toParty(row) : null;
    },

    async findByName(scope, name) {
      // `lower()` rather than ILIKE: a facility called "DC_6094" would have its
      // underscore read as a wildcard by a LIKE pattern and match the wrong
      // dock. This comparison is exact, just case-blind.
      const [row] = await executor
        .select()
        .from(parties)
        .where(
          and(
            eq(parties.brokerageId, scope.brokerageId),
            sql`lower(${parties.name}) = lower(${name.trim()})`,
          ),
        )
        .limit(1);
      return row ? toParty(row) : null;
    },

    async list(scope, limit = 100) {
      const rows = await executor
        .select()
        .from(parties)
        .where(eq(parties.brokerageId, scope.brokerageId))
        .orderBy(parties.name)
        .limit(limit);
      return rows.map(toParty);
    },
  };
}
