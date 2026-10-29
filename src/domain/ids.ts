import { v7 as uuidv7 } from "uuid";

/**
 * UUIDv7 — time-ordered, so primary-key inserts stay append-friendly and
 * B-tree index locality holds up as tables grow. Generated in the application
 * rather than the database so a record can be constructed, validated, and
 * referenced before it is persisted.
 */
export function newId(): string {
  return uuidv7();
}
