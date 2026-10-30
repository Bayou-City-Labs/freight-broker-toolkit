# Load Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A broker can open a saved load, change any of its data fields, correct a facility's address, add, remove or reorder its stops, and see what each save changed.

**Architecture:** A new `/loads/[id]/edit` screen with its own form, sharing the value schemas, the FormData reader and the `Field` component with the intake review screen but none of its confidence chrome. A new framework-free use case `src/domain/load/update.ts` diffs the submission against the stored load, writes the changes through two new repository methods, and appends a `{at, changes}` entry to the load's `jsonb` `details` column.

**Tech Stack:** TypeScript strict, Next.js 16 App Router (server actions), React 19, Drizzle + postgres.js, zod 4, Vitest against real Postgres with per-test transaction rollback.

**Spec:** `docs/superpowers/specs/2026-10-29-load-editing-design.md`

## Global Constraints

- `src/domain/**` must not import Next.js, React, Drizzle, postgres.js, Auth.js, or `@/app/*`, `@/db/*`, `@/env/*`. Enforced by `eslint.config.mjs` (`domainBoundary`). `@/test/*` is permitted.
- Every repository method takes a `BrokerageScope` as its first argument. A row outside the scope is indistinguishable from one that does not exist: return `null`.
- Money is integer cents. Parse from the string a human typed via `Money.fromDollarString`, never through a float.
- Windows are naive local wall time (`YYYY-MM-DDTHH:MM`) plus the facility's IANA zone plus the raw source text. Never convert to an instant. Never infer a zone from an address.
- A `"use server"` file may export **only** async functions. State shapes and `initial*` constants live in a sibling `form-state.ts`.
- Server actions and route handlers check the session themselves — the `(app)` route group's layout does not run for them.
- Intake and editing never create a `Carrier`. A carrier enters the system only through an FMCSA lookup.
- Status is neither editable nor re-inferred by this feature.
- Verification commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. All four must pass before the final commit.
- Branch: `feat/load-editing`, already created off `main` at `34a3586`.

---

## File Structure

**Created**

| File                                               | Responsibility                                                                                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/load/load-values.ts`                   | The fields of a load as a human states them: zod schemas, plus the shared translation from stated values into stored shapes (`toNewStop`, `classifyEquipment`, `findCarrier`). Imported by both intake and editing. |
| `src/domain/load/load-values.test.ts`              | Schema boundaries: a load needs a stop, a date must be `YYYY-MM-DD`, a time must be `HH:MM`.                                                                                                                        |
| `src/domain/load/update.ts`                        | The edit use case. Ports only.                                                                                                                                                                                      |
| `src/domain/load/update.test.ts`                   | The use case against in-memory fakes.                                                                                                                                                                               |
| `src/test/fakes.ts`                                | In-memory `LoadRepository`, `PartyRepository`, `CarrierRepository`, lifted out of `confirm.test.ts` so two test files cannot drift from the ports.                                                                  |
| `src/app/(app)/loads/field.tsx`                    | The editable field, with no opinion about confidence.                                                                                                                                                               |
| `src/app/(app)/loads/[id]/edit/page.tsx`           | Server component: guard, read, resolve parties and carrier, render.                                                                                                                                                 |
| `src/app/(app)/loads/[id]/edit/edit-form.tsx`      | Client component: the form.                                                                                                                                                                                         |
| `src/app/(app)/loads/[id]/edit/actions.ts`         | `editLoadAction`.                                                                                                                                                                                                   |
| `src/app/(app)/loads/[id]/edit/form-state.ts`      | `EditState`, `initialEditState`.                                                                                                                                                                                    |
| `src/app/(app)/loads/[id]/edit/edit-form.test.tsx` | Render test pinning every `name` the action reads.                                                                                                                                                                  |
| `src/app/(app)/loads/edit-flow.test.ts`            | Intake a fixture, then edit it, against real adapters and real Postgres.                                                                                                                                            |

**Modified**

| File                                      | Change                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `src/domain/details.ts`                   | `loadEditChangeSchema`, `loadEditSchema`, and `edits` on `loadDetailsSchema`.     |
| `src/domain/load/load.ts`                 | `LoadUpdate` (a `NewLoad` with `status` required) and `StopWrite`.                |
| `src/domain/ports/repositories.ts`        | `LoadRepository.update`, `PartyRepository.update`.                                |
| `src/db/repositories/loads.ts`            | Implement `update`.                                                               |
| `src/db/repositories/parties.ts`          | Implement `update`.                                                               |
| `src/db/repositories/loads.test.ts`       | Cases for both new methods.                                                       |
| `src/domain/intake/confirm.ts`            | Build `confirmedLoadSchema` from `loadValuesSchema`; drop the duplicated helpers. |
| `src/domain/intake/confirm.test.ts`       | Import the fakes from `@/test/fakes`.                                             |
| `src/app/(app)/loads/review-form.tsx`     | Use the extracted `Field`.                                                        |
| `src/app/(app)/loads/form-values.ts`      | Extract `readLoadValues`; add `readEditedLoad`.                                   |
| `src/app/(app)/loads/form-values.test.ts` | Cases for `readEditedLoad`.                                                       |
| `src/app/(app)/loads/[id]/page.tsx`       | "Edit load" link and the `EditNote` trail.                                        |
| `src/server/intake.ts`                    | Export `updateLoad`.                                                              |
| `docs/load-intake.md`                     | The edit screen.                                                                  |
| `CLAUDE.md`                               | Replace the "editing is not built" entry with what is now true.                   |

---

### Task 1: Shared value schemas

Lift the stated-value schemas and the value-to-storage translation out of `src/domain/intake/confirm.ts` so the edit use case shares them instead of copying them. No behaviour changes; the existing suite is the regression test.

**Files:**

- Create: `src/domain/load/load-values.ts`
- Create: `src/domain/load/load-values.test.ts`
- Modify: `src/domain/intake/confirm.ts`

**Interfaces:**

- Consumes: `Party`, `NewStop`, `StopType` from `../load/load`; `parseEquipmentType` from `../load/equipment`; `CarrierRepository` from `../ports/repositories`; `BrokerageScope` from `../tenancy`.
- Produces: `stopValuesSchema`, `loadValuesSchema`, `StopValues`, `LoadValues`, `nullableText`, `STOP_TYPE_FOR`, `toNewStop(stop, sequence, party)`, `classifyEquipment(equipment)`, `findCarrier(scope, carriers, values)`. `confirm.ts` keeps exporting `confirmedStopSchema`, `confirmedLoadSchema`, `ConfirmedStop`, `ConfirmedLoad` under the same names.

- [ ] **Step 1: Write the failing test**

Create `src/domain/load/load-values.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadValuesSchema, stopValuesSchema } from "./load-values";

function stop(overrides: Record<string, unknown> = {}) {
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

function values(overrides: Record<string, unknown> = {}) {
  return {
    referenceNumber: "884213",
    carrierName: "GULF COAST HAULING LLC",
    carrierMcNumber: "987654",
    carrierDotNumber: null,
    commodity: "Palletized canned goods",
    weightLbs: 42000,
    equipment: "53' Dry Van",
    carrierRateCents: 185_000,
    stops: [stop()],
    ...overrides,
  };
}

describe("loadValuesSchema", () => {
  it("accepts a stated load", () => {
    expect(loadValuesSchema.safeParse(values()).success).toBe(true);
  });

  it("refuses a load with no stops", () => {
    const parsed = loadValuesSchema.safeParse(values({ stops: [] }));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0].message).toBe("A load needs at least one stop");
  });

  it("refuses a load with no reference number", () => {
    const parsed = loadValuesSchema.safeParse(values({ referenceNumber: "  " }));
    expect(parsed.success).toBe(false);
  });

  it("turns blank optional text into null rather than an empty string", () => {
    const parsed = stopValuesSchema.parse(stop({ city: "   " }));
    expect(parsed.city).toBeNull();
  });

  it("refuses a date or time that is not wall-clock notation", () => {
    expect(stopValuesSchema.safeParse(stop({ date: "11/02/2026" })).success).toBe(false);
    expect(stopValuesSchema.safeParse(stop({ windowStart: "8am" })).success).toBe(false);
    expect(stopValuesSchema.safeParse(stop({ windowStart: "24:00" })).success).toBe(
      false,
    );
  });

  it("requires a name on every stop, because a stop is a place", () => {
    const parsed = stopValuesSchema.safeParse(stop({ partyName: "" }));
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/domain/load/load-values.test.ts`
Expected: FAIL — `Failed to resolve import "./load-values"`.

- [ ] **Step 3: Create the module**

Create `src/domain/load/load-values.ts`:

```ts
import { z } from "zod";
import type { Carrier } from "../carrier/carrier";
import type { CarrierRepository } from "../ports/repositories";
import type { BrokerageScope } from "../tenancy";
import { parseEquipmentType } from "./equipment";
import type { NewStop, Party, StopType } from "./load";

/**
 * A load as a human states it, and the translation into what gets stored.
 *
 * Shared by intake's confirm step and by editing a saved load. Both arrive at
 * the same place — a person has looked at these values and they are now
 * assertions, not guesses — so the schemas, the stop mapping and the carrier
 * lookup belong here rather than in either caller. A second copy of
 * `findCarrier` is how the "never create a carrier from a document" rule
 * quietly stops applying on one of the two paths.
 */

export const nullableText = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

/** `partyName` is required: a stop is a place. */
export const stopValuesSchema = z.object({
  kind: z.enum(["pickup", "delivery"]),
  partyName: z.string().trim().min(1, "Every stop needs a name"),
  addressLine: nullableText,
  city: nullableText,
  state: nullableText,
  postalCode: nullableText,
  /** Local wall date. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .nullable(),
  /** Local wall time. */
  windowStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM")
    .nullable(),
  windowEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM")
    .nullable(),
  referenceNumber: nullableText,
  /** What the document said about timing, kept verbatim for audit. */
  windowRawText: nullableText,
});

export const loadValuesSchema = z.object({
  referenceNumber: z.string().trim().min(1, "A load needs a reference number"),
  carrierName: nullableText,
  carrierMcNumber: nullableText,
  carrierDotNumber: nullableText,
  commodity: nullableText,
  weightLbs: z.number().nonnegative().nullable(),
  /** Free text, as stated. Classified by `classifyEquipment`, never discarded. */
  equipment: nullableText,
  carrierRateCents: z.number().int().nullable(),
  stops: z.array(stopValuesSchema).min(1, "A load needs at least one stop"),
});

export type StopValues = z.infer<typeof stopValuesSchema>;
export type LoadValues = z.infer<typeof loadValuesSchema>;

export const STOP_TYPE_FOR: Record<StopValues["kind"], StopType> = {
  pickup: "pickup",
  delivery: "delivery",
};

/**
 * A stated stop, as a row.
 *
 * `details` is merged rather than replaced so an edit does not drop keys the
 * stop already carried — seal numbers, dock hours — that this form never shows.
 */
export function toNewStop(
  stop: StopValues,
  sequence: number,
  party: Party,
  existingDetails: NewStop["details"] = {},
): NewStop {
  return {
    sequence,
    type: STOP_TYPE_FOR[stop.kind],
    partyId: party.id,
    opensAtLocal: joinLocal(stop.date, stop.windowStart),
    closesAtLocal: joinLocal(stop.date, stop.windowEnd),
    // The facility's zone, when we know it. Never inferred from the state on
    // the address: a guess here changes what every window means.
    timeZone: party.timeZone,
    appointmentType: appointmentTypeFor(stop),
    windowRawText: stop.windowRawText,
    details: {
      ...existingDetails,
      ...(stop.referenceNumber ? { appointmentNumber: stop.referenceNumber } : {}),
    },
  };
}

/**
 * A stated range is a window the facility will honour; a single time is an
 * appointment. Null when no time was given at all — saying "FCFS" because we
 * read nothing would be an invention, and drivers plan around it.
 */
function appointmentTypeFor(stop: StopValues) {
  if (stop.windowStart === null) return null;
  return stop.windowEnd === null ? "appointment" : "fcfs";
}

function joinLocal(date: string | null, time: string | null): string | null {
  return date && time ? `${date}T${time}` : null;
}

/**
 * `other` and `null` are different answers.
 *
 * `other` means equipment was stated and is not one of our types — a
 * Conestoga, a hotshot. `null` means none was stated. Collapsing them loses
 * the difference between "unusual trailer" and "nobody said", and the original
 * phrase is kept in `details.equipmentAsWritten` either way.
 */
export function classifyEquipment(equipment: string | null) {
  if (equipment === null) return null;
  return parseEquipmentType(equipment) ?? "other";
}

/**
 * Looks for a carrier we already hold, by the numbers stated.
 *
 * Deliberately does **not** create one. A carrier record is the subject of a
 * vetting history, and one conjured from a name on a PDF would sit in the
 * carrier list looking exactly like a carrier someone had actually checked.
 * Carriers enter the system through a lookup, which is the only path that can
 * tell us the name is real.
 */
export async function findCarrier(
  scope: BrokerageScope,
  carriers: CarrierRepository,
  values: Pick<LoadValues, "carrierMcNumber" | "carrierDotNumber">,
): Promise<Carrier | null> {
  if (values.carrierMcNumber) {
    const byMc = await carriers.findByMcNumber(scope, values.carrierMcNumber);
    if (byMc) return byMc;
  }
  if (values.carrierDotNumber) {
    const byDot = await carriers.findByDotNumber(scope, values.carrierDotNumber);
    if (byDot) return byDot;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/load/load-values.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Rewrite `confirm.ts` on top of it**

In `src/domain/intake/confirm.ts`: delete the local `nullableText`, `confirmedStopSchema` body, the `ConfirmedStop` and `ConfirmedLoad` interfaces, `STOP_TYPE_FOR`, `findCarrier`, `resolveParty`'s stop mapping, `appointmentTypeFor`, `classifyEquipment` and `joinLocal`. Replace the schema and type block with:

```ts
import {
  classifyEquipment,
  findCarrier,
  loadValuesSchema,
  stopValuesSchema,
  toNewStop,
  type LoadValues,
  type StopValues,
} from "../load/load-values";

/** A stop as a human confirmed it. */
export type ConfirmedStop = StopValues;
export const confirmedStopSchema = stopValuesSchema;

export type ConfirmedLoad = LoadValues & { readonly provenance: IntakeProvenance };

export const confirmedLoadSchema = loadValuesSchema.extend({
  provenance: intakeProvenanceSchema,
});
```

and replace the stop loop inside `createConfirmDraft` with:

```ts
const stops: NewStop[] = [];
for (const [index, stop] of confirmed.stops.entries()) {
  const party = await resolveParty(scope, parties, stop);
  stops.push(toNewStop(stop, index, party));
}
```

Keep `resolveParty`, `inferStatus` and the `loads.create` call exactly as they are. Keep the module's doc comment and the `CoveredTextSource` check.

Then prune the imports the move orphaned, or lint will fail on them: `parseEquipmentType` from `../load/equipment`, `StopType` from `../load/load`, `StopKind` from `./load-draft`, and the `Carrier` type if `findCarrier` was the only user.

- [ ] **Step 6: Run the full suite and the typechecker**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS. 372 tests (366 + 6).

If `tsc` reports an assignability error where a `readonly` array met a mutable one, wrap the inferred types rather than reverting: `export type ConfirmedLoad = Readonly<LoadValues> & { readonly provenance: IntakeProvenance }`.

- [ ] **Step 7: Commit**

```bash
git add src/domain/load/load-values.ts src/domain/load/load-values.test.ts src/domain/intake/confirm.ts
git commit -m "refactor: share the stated-value schemas between intake and editing"
```

---

### Task 2: The edit record on `details`

**Files:**

- Modify: `src/domain/details.ts`
- Create: `src/domain/details.test.ts`

**Interfaces:**

- Produces: `loadEditChangeSchema`, `loadEditSchema`, `LoadEditChange`, `LoadEdit`, and `edits?: LoadEdit[]` on `LoadDetails`.

- [ ] **Step 1: Write the failing test**

Create `src/domain/details.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadDetailsSchema } from "./details";

describe("loadDetailsSchema", () => {
  it("validates an edit trail", () => {
    const parsed = loadDetailsSchema.safeParse({
      edits: [
        {
          at: "2026-10-29T20:15:00.000Z",
          changes: [{ path: "carrierPayCents", from: "$1750.00", to: "$1850.00" }],
        },
      ],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.edits?.[0].changes[0].path).toBe("carrierPayCents");
  });

  it("keeps the intake record and the edit trail apart", () => {
    const parsed = loadDetailsSchema.parse({
      intake: {
        producedBy: "label-proximity-v1",
        textSource: "pdf-text",
        filename: null,
        corrections: [{ path: "weightLbs", confidence: 0.9 }],
        acceptedFlagged: [],
      },
      edits: [{ at: "2026-10-29T20:15:00.000Z", changes: [] }],
    });

    // Evidence about the parser and evidence about a later human are different
    // facts; mixing them would corrupt the confidence calibration data.
    expect(parsed.intake?.corrections).toHaveLength(1);
    expect(parsed.edits).toHaveLength(1);
  });

  it("accepts a field that was or became unset", () => {
    const parsed = loadDetailsSchema.safeParse({
      edits: [
        {
          at: "2026-10-29T20:15:00.000Z",
          changes: [{ path: "commodity", from: null, to: "Canned goods" }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an edit with no timestamp", () => {
    const parsed = loadDetailsSchema.safeParse({ edits: [{ changes: [] }] });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/domain/details.test.ts`
Expected: FAIL — the first test fails because `parsed.data.edits` does not exist on the type, and the last passes for the wrong reason (`.loose()` keeps unknown keys without validating them).

- [ ] **Step 3: Add the schemas**

In `src/domain/details.ts`, insert after `intakeProvenanceSchema` and before `loadDetailsSchema`:

```ts
/**
 * What one save of the edit screen changed.
 *
 * A sibling of `intake`, never part of it. `intake.corrections` is evidence
 * about the *parser*, captured at the one moment a human overruled it; an edit
 * made three days later is a different fact, and folding it in would corrupt
 * the only data the confidence scale can be calibrated from.
 *
 * `from` and `to` are strings rather than a `number | string | null` union
 * because this trail is read by a person on a screen and never computed on.
 * Formatting at write time means the renderer does not have to know a path's
 * type. The columns still hold current truth; nothing is derived from here.
 */
export const loadEditChangeSchema = z.object({
  /** Dotted path, matching the correction paths: "carrierPayCents", "stops.1.city". */
  path: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
});

export const loadEditSchema = z.object({
  /** ISO instant. */
  at: z.string().min(1),
  changes: z.array(loadEditChangeSchema),
});
```

Add to `loadDetailsSchema`'s object, directly below `intake`:

```ts
    /** Newest last. Appended by the edit use case; never rewritten. */
    edits: z.array(loadEditSchema).optional(),
```

Add to the exported types at the bottom:

```ts
export type LoadEditChange = z.infer<typeof loadEditChangeSchema>;
export type LoadEdit = z.infer<typeof loadEditSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/details.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/details.ts src/domain/details.test.ts
git commit -m "feat: validate an edit trail on a load's details column"
```

---

### Task 3: Shared repository fakes

The fakes are currently inline in `confirm.test.ts`. The edit use case needs the same three, plus the two new methods. Lifting them out is what stops a second copy drifting from the ports.

**Files:**

- Create: `src/test/fakes.ts`
- Modify: `src/domain/intake/confirm.test.ts`

**Interfaces:**

- Produces: `fakeParties(seed?)`, `fakeLoads(seed?)`, `fakeCarriers(seed?)`, each returning `{ repo, rows }` (`fakeLoads` also returns `stopRows`).

- [ ] **Step 1: Create the module**

Create `src/test/fakes.ts` by moving `fakeParties`, `fakeLoads` and `fakeCarriers` verbatim out of `src/domain/intake/confirm.test.ts`, with these changes: `export` each function, import the types from `@/domain/...` instead of relative paths, and keep the shared doc comment:

```ts
import type { Carrier } from "@/domain/carrier/carrier";
import type { Load, LoadWithStops, Party, Stop } from "@/domain/load/load";
import type {
  CarrierRepository,
  LoadRepository,
  PartyRepository,
} from "@/domain/ports/repositories";

/**
 * In-memory stand-ins, filtered by scope like the real repositories, so a use
 * case that forgot to pass one fails here too.
 *
 * Shared rather than inline so the intake and editing use cases are tested
 * against the same stand-ins. Two copies would be two chances for a fake to
 * drift from the port it stands for, which is the one way a fake lies.
 */
```

Then add `update` to the two repositories whose ports gain it in tasks 4 and 5 — without this the file will not typecheck once the ports change, so write it now:

```ts
// inside fakeParties' repo object
    async update(s, id, input) {
      const index = rows.findIndex((r) => r.brokerageId === s.brokerageId && r.id === id);
      if (index === -1) return null;

      const updated: Party = {
        ...rows[index],
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
      };
      rows[index] = updated;
      return updated;
    },
```

```ts
// inside fakeLoads' repo object
    async update(s, id, input, stops): Promise<LoadWithStops | null> {
      const index = rows.findIndex((r) => r.brokerageId === s.brokerageId && r.id === id);
      if (index === -1) return null;

      const updated: Load = {
        ...rows[index],
        referenceNumber: input.referenceNumber,
        status: input.status,
        equipmentType: input.equipmentType ?? null,
        commodityDescription: input.commodityDescription ?? null,
        weightLbs: input.weightLbs ?? null,
        customerRateCents: input.customerRateCents ?? null,
        carrierPayCents: input.carrierPayCents ?? null,
        carrierId: input.carrierId ?? null,
        details: input.details ?? {},
      };
      rows[index] = updated;

      // Mirrors the real repository: rows absent from the submission are gone,
      // rows carrying an id keep it, and the rest are new.
      const kept = new Set(stops.map((stop) => stop.id).filter(Boolean));
      for (let i = stopRows.length - 1; i >= 0; i -= 1) {
        if (stopRows[i].loadId === id && !kept.has(stopRows[i].id)) stopRows.splice(i, 1);
      }

      const saved: Stop[] = stops.map((stop, sequence) => {
        const existing = stop.id
          ? stopRows.find((row) => row.id === stop.id) ?? null
          : null;
        const row: Stop = {
          id: existing?.id ?? `stop-${id}-new-${sequence}`,
          brokerageId: s.brokerageId,
          loadId: id,
          sequence,
          type: stop.type,
          partyId: stop.partyId,
          opensAtLocal: stop.opensAtLocal ?? null,
          closesAtLocal: stop.closesAtLocal ?? null,
          timeZone: stop.timeZone ?? null,
          appointmentType: stop.appointmentType ?? null,
          windowRawText: stop.windowRawText ?? null,
          details: stop.details ?? {},
        };
        if (existing) {
          stopRows[stopRows.indexOf(existing)] = row;
        } else {
          stopRows.push(row);
        }
        return row;
      });

      return { load: updated, stops: saved };
    },
```

Note `status: input.status` with no `?? "draft"` — the update input requires it, which is the point of `LoadUpdate` in task 4.

- [ ] **Step 2: Point `confirm.test.ts` at the shared fakes**

Delete the three functions from `src/domain/intake/confirm.test.ts` and add:

```ts
import { fakeCarriers, fakeLoads, fakeParties } from "@/test/fakes";
```

Leave `stop()`, `confirmed()`, `deps()` and every `it(...)` untouched.

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: FAIL — `src/test/fakes.ts` declares `update` on objects typed `PartyRepository` / `LoadRepository`, which do not have it yet. `tsc` under Vitest reports an excess-property error.

This is the expected intermediate state; tasks 4 and 5 resolve it. If you prefer a green commit here, do tasks 4 and 5 first and return to this step.

- [ ] **Step 4: Commit (after task 5's step 4 is green)**

```bash
git add src/test/fakes.ts src/domain/intake/confirm.test.ts
git commit -m "test: share the in-memory repository fakes"
```

---

### Task 4: `LoadRepository.update`

**Files:**

- Modify: `src/domain/load/load.ts`
- Modify: `src/domain/ports/repositories.ts`
- Modify: `src/db/repositories/loads.ts`
- Test: `src/db/repositories/loads.test.ts`

**Interfaces:**

- Produces: `LoadUpdate`, `StopWrite` in `src/domain/load/load.ts`; `LoadRepository.update(scope, id, input: LoadUpdate, stops: readonly StopWrite[]): Promise<LoadWithStops | null>`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe("load repository")` block in `src/db/repositories/loads.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/db/repositories/loads.test.ts`
Expected: FAIL — `loads.update is not a function`, and `tsc` reports `Property 'update' does not exist on type 'LoadRepository'`.

- [ ] **Step 3: Add the types**

Append to `src/domain/load/load.ts`:

```ts
/**
 * The input to an update, as distinct from a create.
 *
 * `status` is required here where it is optional on `NewLoad`, and that is
 * deliberate rather than tidy. `create` resolves an absent status with
 * `input.status ?? "draft"`; an `update` doing the same would silently demote
 * a booked load to a draft every time a caller omitted the field. Making it
 * required means the compiler asks the question instead.
 */
export interface LoadUpdate extends NewLoad {
  readonly status: LoadStatus;
}

/**
 * A stop on its way into the database. An `id` means "this row already exists,
 * keep it"; its absence means a stop someone added.
 */
export type StopWrite = NewStop & { readonly id?: string };
```

- [ ] **Step 4: Add the port**

In `src/domain/ports/repositories.ts`, add to the `LoadRepository` interface (and widen the import from `../load/load` to include `LoadUpdate` and `StopWrite`):

```ts
  /**
   * Rewrites a load and its whole route as one unit.
   *
   * The route is replaced rather than patched: stops carrying an id are kept
   * and renumbered, stops without one are inserted, and any stop of this load
   * absent from the list is deleted. Null when the load is not in scope.
   */
  update(
    scope: BrokerageScope,
    id: string,
    input: LoadUpdate,
    stops: readonly StopWrite[],
  ): Promise<LoadWithStops | null>;
```

- [ ] **Step 5: Implement it**

In `src/db/repositories/loads.ts`, widen the drizzle import to `import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";` and add the method after `create`:

```ts
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
            await tx
              .insert(stops)
              .values({ id: newId(), brokerageId: scope.brokerageId, loadId: id, ...row });
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
```

`inArray` is imported for symmetry with `notInArray` but unused — drop it from the import if lint flags it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/db/repositories/loads.test.ts`
Expected: PASS, 18 tests (13 existing + 5 new).

If the sequence-swap test fails with `duplicate key value violates unique constraint "stops_load_sequence_key"`, the negative-range pass is wrong: check that the final `UPDATE` matches only rows with `sequence < 0`, and that an _inserted_ row also lands negative.

- [ ] **Step 7: Commit**

```bash
git add src/domain/load/load.ts src/domain/ports/repositories.ts src/db/repositories/loads.ts src/db/repositories/loads.test.ts
git commit -m "feat: let a load's fields and route be rewritten"
```

---

### Task 5: `PartyRepository.update`

**Files:**

- Modify: `src/domain/ports/repositories.ts`
- Modify: `src/db/repositories/parties.ts`
- Test: `src/db/repositories/loads.test.ts` (the `describe("party repository")` block)

**Interfaces:**

- Produces: `PartyRepository.update(scope, id, input: NewParty): Promise<Party | null>`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe("party repository")` block in `src/db/repositories/loads.test.ts`:

```ts
it("corrects a facility in place, for every load that touches it", async () => {
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

    const updated = await parties.update(scope, created.id, {
      name: "ACME DISTRIBUTION",
      addressLine1: "4400 Navigation Blvd",
      city: "Houston",
      region: "TX",
      postalCode: "77012",
      timeZone: created.timeZone,
    });

    expect(updated?.id).toBe(created.id);
    expect(updated?.postalCode).toBe("77012");
    // The facility's zone is not the edit screen's to guess at, so a caller
    // that passes it back unchanged must get it back unchanged.
    expect(updated?.timeZone).toBe("America/Chicago");

    const found = await parties.findById(scope, created.id);
    expect(found?.postalCode).toBe("77012");
  });
});

it("will not update another brokerage's facility", async () => {
  await withRollback(async (tx) => {
    const mine = await seedBrokerage(tx, "Mine");
    const theirs = await seedBrokerage(tx, "Theirs");
    const parties = createPartyRepository(tx);

    const created = await parties.create(theirs, { name: "LONE STAR FOODS" });

    expect(await parties.update(mine, created.id, { name: "HIJACKED" })).toBeNull();
    expect((await parties.findById(theirs, created.id))?.name).toBe("LONE STAR FOODS");
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/db/repositories/loads.test.ts -t "facility"`
Expected: FAIL — `parties.update is not a function`.

- [ ] **Step 3: Add the port**

In `src/domain/ports/repositories.ts`, add to `PartyRepository`:

```ts
  /**
   * Corrects a facility in place, which changes it for every load that touches
   * it. That is the intended behaviour: an address is a property of the dock,
   * not of one load, so a wrong ZIP is wrong everywhere. Renaming is a
   * different act — a stop that should point at a different facility is
   * re-resolved by name instead. Null when the facility is not in scope.
   */
  update(scope: BrokerageScope, id: string, input: NewParty): Promise<Party | null>;
```

- [ ] **Step 4: Implement it**

In `src/db/repositories/parties.ts`, add after `create`:

```ts
    async update(scope, id, input) {
      const [row] = await executor
        .update(parties)
        .set({
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
        .where(and(eq(parties.brokerageId, scope.brokerageId), eq(parties.id, id)))
        .returning();
      return row ? toParty(row) : null;
    },
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS. Task 3's fakes now satisfy both widened ports.

- [ ] **Step 6: Commit both this and task 3**

```bash
git add src/domain/ports/repositories.ts src/db/repositories/parties.ts src/db/repositories/loads.test.ts src/test/fakes.ts src/domain/intake/confirm.test.ts
git commit -m "feat: let a facility be corrected in place"
```

---

### Task 6: The edit use case

**Files:**

- Create: `src/domain/load/update.ts`
- Create: `src/domain/load/update.test.ts`

**Interfaces:**

- Consumes: `fakeCarriers`, `fakeLoads`, `fakeParties` from `@/test/fakes`; everything Task 1 produced; `LoadEdit`, `LoadEditChange` from `../details`.
- Produces: `editedStopSchema`, `editedLoadSchema`, `EditedStop`, `EditedLoad`, `UpdateLoadDeps`, `UpdateOutcome`, `UpdateLoad`, `createUpdateLoad`.

- [ ] **Step 1: Write the failing test**

Create `src/domain/load/update.test.ts`:

```ts
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
    stops: saved.stops.map((stop, index): EditedStop => ({
      id: stop.id,
      ...confirmed().stops[index],
    })),
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

  it("is not a duplicate of itself", async () => {
    const { update, saved, unchanged } = await given();

    const outcome = await update(scope, saved.load.id, unchanged());
    expect(outcome.status).toBe("saved");
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/domain/load/update.test.ts`
Expected: FAIL — `Failed to resolve import "./update"`.

- [ ] **Step 3: Write the use case**

Create `src/domain/load/update.ts`:

```ts
import { z } from "zod";
import type { LoadEditChange } from "../details";
import { Money } from "../money";
import type {
  CarrierRepository,
  LoadRepository,
  PartyRepository,
} from "../ports/repositories";
import type { BrokerageScope } from "../tenancy";
import type { Load, LoadWithStops, Party, Stop, StopWrite } from "./load";
import {
  classifyEquipment,
  findCarrier,
  loadValuesSchema,
  stopValuesSchema,
  toNewStop,
  type StopValues,
} from "./load-values";

/**
 * Editing a load that is already saved.
 *
 * The other side of intake: nothing here carries a confidence, because
 * everything has been typed by a person looking at the record. What it adds
 * over `confirmDraft` is that there is a *previous* state, so every save both
 * rewrites the load and says what it changed.
 *
 * Depends only on ports, so the whole flow is tested against fakes.
 */

/**
 * A stop as the edit form posts it. `id` is the row it came from; null means a
 * stop someone added, which is the difference between renumbering a route and
 * reissuing it.
 */
export const editedStopSchema = stopValuesSchema.extend({
  id: z.string().nullable(),
});

// `.extend` replaces the stops field wholesale, so the "at least one" rule has
// to be restated rather than inherited.
export const editedLoadSchema = loadValuesSchema.extend({
  stops: z.array(editedStopSchema).min(1, "A load needs at least one stop"),
});

export type EditedStop = z.infer<typeof editedStopSchema>;
export type EditedLoad = z.infer<typeof editedLoadSchema>;

export interface UpdateLoadDeps {
  readonly loads: LoadRepository;
  readonly parties: PartyRepository;
  readonly carriers: CarrierRepository;
  /**
   * Injected so a test can pin the edit timestamp, the same way `checkedAt` is
   * injectable on a carrier check. Defaulted here rather than taken as a port,
   * because a clock is not a vendor.
   */
  readonly now?: () => Date;
}

export type UpdateOutcome =
  | {
      readonly status: "saved";
      readonly load: Load;
      readonly stops: readonly Stop[];
      /** Whether the stated carrier matched one we already hold. */
      readonly carrierLinked: boolean;
    }
  /** Another load in this brokerage already uses the submitted number. */
  | { readonly status: "duplicate_reference"; readonly existing: Load }
  /** Absent, or belonging to another brokerage. The two are the same answer. */
  | { readonly status: "not_found" };

export type UpdateLoad = (
  scope: BrokerageScope,
  loadId: string,
  edited: EditedLoad,
) => Promise<UpdateOutcome>;

export function createUpdateLoad({
  loads,
  parties,
  carriers,
  now = () => new Date(),
}: UpdateLoadDeps): UpdateLoad {
  return async function updateLoad(scope, loadId, edited) {
    const current = await loads.findById(scope, loadId);
    if (!current) return { status: "not_found" };

    if (edited.referenceNumber !== current.load.referenceNumber) {
      const clash = await loads.findByReferenceNumber(scope, edited.referenceNumber);
      // A load is not a duplicate of itself, which is the whole reason this
      // check is not just the one `confirmDraft` makes.
      if (clash && clash.id !== loadId) {
        return { status: "duplicate_reference", existing: clash };
      }
    }

    const carrier = await findCarrier(scope, carriers, edited);

    const before = await statedView(scope, parties, current);

    const existingById = new Map(current.stops.map((stop) => [stop.id, stop]));
    const writes: StopWrite[] = [];

    for (const [index, stop] of edited.stops.entries()) {
      const existing = stop.id ? (existingById.get(stop.id) ?? null) : null;
      const party = await resolveParty(scope, parties, stop, existing);
      writes.push({
        ...toNewStop(stop, index, party, existing?.details ?? {}),
        ...(existing ? { id: existing.id } : {}),
      });
    }

    const changes = diff(before, edited);
    const edits =
      changes.length === 0
        ? current.load.details.edits
        : [...(current.load.details.edits ?? []), { at: now().toISOString(), changes }];

    const saved = await loads.update(
      scope,
      loadId,
      {
        referenceNumber: edited.referenceNumber,
        // Carried forward, not re-derived. Both are outside this form's remit:
        // status has no workflow yet, and the customer rate is the broker's own
        // number, which no document states and no screen here collects.
        status: current.load.status,
        customerRateCents: current.load.customerRateCents,
        equipmentType: classifyEquipment(edited.equipment),
        commodityDescription: edited.commodity,
        weightLbs: edited.weightLbs,
        carrierPayCents: edited.carrierRateCents,
        carrierId: carrier?.id ?? null,
        details: {
          ...current.load.details,
          ...(edited.equipment
            ? { equipmentAsWritten: edited.equipment }
            : { equipmentAsWritten: undefined }),
          ...(edited.carrierName
            ? { carrierAsWritten: edited.carrierName }
            : { carrierAsWritten: undefined }),
          ...(edits ? { edits } : {}),
        },
      },
      writes,
    );

    // findById succeeded a moment ago in the same scope, so a null here is a
    // row vanishing mid-edit rather than a permission answer.
    if (!saved) return { status: "not_found" };

    return {
      status: "saved",
      load: saved.load,
      stops: saved.stops,
      carrierLinked: carrier !== null,
    };
  };
}

/**
 * Resolves the facility a stop should point at.
 *
 * Name unchanged means "this is the same dock, and the address I typed is the
 * correction" — so the facility is fixed in place, for every load that touches
 * it. A different name means a different dock: resolve it by name or create
 * it, and leave the old one alone, because other loads point at it. A facility
 * is never renamed from here; the name is the identity `findByName` matches on.
 */
async function resolveParty(
  scope: BrokerageScope,
  parties: PartyRepository,
  stop: EditedStop,
  existing: Stop | null,
): Promise<Party> {
  if (existing) {
    const held = await parties.findById(scope, existing.partyId);
    if (held && held.name.trim().toLowerCase() === stop.partyName.trim().toLowerCase()) {
      const updated = await parties.update(scope, held.id, {
        ...held,
        addressLine1: stop.addressLine,
        city: stop.city,
        region: stop.state,
        postalCode: stop.postalCode,
      });
      if (updated) return updated;
    }
  }

  const byName = await parties.findByName(scope, stop.partyName);
  if (byName) return byName;

  return parties.create(scope, {
    name: stop.partyName,
    addressLine1: stop.addressLine,
    city: stop.city,
    region: stop.state,
    postalCode: stop.postalCode,
  });
}

/**
 * The saved load expressed the way a human states it, so a diff compares like
 * with like.
 *
 * Only what a saved load can actually give back. The MC and DOT numbers are
 * not among them — a load stores a carrier *link*, not the numbers someone
 * typed — so a changed linkage is reported as `carrierId` rather than
 * pretending to know which number moved.
 */
interface StatedView {
  readonly referenceNumber: string;
  readonly carrierName: string | null;
  readonly carrierId: string | null;
  readonly commodity: string | null;
  readonly weightLbs: number | null;
  readonly equipment: string | null;
  readonly carrierRateCents: number | null;
  readonly stops: readonly StopValues[];
}

async function statedView(
  scope: BrokerageScope,
  parties: PartyRepository,
  current: LoadWithStops,
): Promise<StatedView> {
  const stops: StopValues[] = [];

  for (const stop of current.stops) {
    const party = await parties.findById(scope, stop.partyId);
    stops.push({
      kind: stop.type === "delivery" ? "delivery" : "pickup",
      partyName: party?.name ?? "",
      addressLine: party?.addressLine1 ?? null,
      city: party?.city ?? null,
      state: party?.region ?? null,
      postalCode: party?.postalCode ?? null,
      date: stop.opensAtLocal?.slice(0, 10) ?? stop.closesAtLocal?.slice(0, 10) ?? null,
      windowStart: stop.opensAtLocal?.slice(11, 16) ?? null,
      windowEnd: stop.closesAtLocal?.slice(11, 16) ?? null,
      referenceNumber: stop.details.appointmentNumber ?? null,
      windowRawText: stop.windowRawText,
    });
  }

  return {
    referenceNumber: current.load.referenceNumber,
    carrierName: current.load.details.carrierAsWritten ?? null,
    carrierId: current.load.carrierId,
    commodity: current.load.commodityDescription,
    weightLbs: current.load.weightLbs,
    equipment: current.load.details.equipmentAsWritten ?? null,
    carrierRateCents: current.load.carrierPayCents,
    stops,
  };
}

/** Load-level paths, in the order the form shows them. */
const LOAD_PATHS = [
  ["referenceNumber", "referenceNumber"],
  ["carrierName", "carrierName"],
  ["commodityDescription", "commodity"],
  ["weightLbs", "weightLbs"],
  ["equipmentAsWritten", "equipment"],
  ["carrierPayCents", "carrierRateCents"],
] as const;

/** Stop-level paths, likewise. `windowRawText` is not shown and never diffed. */
const STOP_PATHS = [
  "kind",
  "partyName",
  "addressLine",
  "city",
  "state",
  "postalCode",
  "date",
  "windowStart",
  "windowEnd",
  "referenceNumber",
] as const;

function diff(before: StatedView, after: EditedLoad): LoadEditChange[] {
  const changes: LoadEditChange[] = [];

  for (const [path, key] of LOAD_PATHS) {
    const from = before[key];
    const to = after[key];
    if (from !== to) {
      changes.push({ path, from: display(path, from), to: display(path, to) });
    }
  }

  if (before.stops.length !== after.stops.length) {
    changes.push({
      path: "stops",
      from: `${before.stops.length} stop${before.stops.length === 1 ? "" : "s"}`,
      to: `${after.stops.length} stop${after.stops.length === 1 ? "" : "s"}`,
    });
  }

  // Compared by position, because position is what the route means. A stop
  // moved from second to first reads as two changed stops, which is what a
  // person looking at the trail would want to see.
  const shared = Math.min(before.stops.length, after.stops.length);
  for (let index = 0; index < shared; index += 1) {
    for (const key of STOP_PATHS) {
      const from = before.stops[index][key];
      const to = after.stops[index][key];
      if (from !== to) {
        changes.push({
          path: `stops.${index}.${key}`,
          from: display(key, from),
          to: display(key, to),
        });
      }
    }
  }

  return changes;
}

/**
 * Formatted at write time, so the screen reading the trail does not have to
 * know what type a path holds.
 */
function display(path: string, value: string | number | null): string | null {
  if (value === null) return null;
  if (typeof value === "number") {
    return path === "carrierPayCents" || path === "carrierRateCents"
      ? `$${Money.fromCents(value).toDollarString()}`
      : String(value);
  }
  return value;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/load/update.test.ts`
Expected: PASS, 16 tests.

Two likely failures and their causes:

- A money mismatch — `Money.toDollarString()` emits `"1850.00"`, so `display` yields `"$1850.00"`. If `src/domain/money.ts` says otherwise, change the expectation or `display`, not both.
- `carrierId` appearing in a diff where the test expects only one change — the carrier lookup returns null in `given()` because no carrier is seeded, and `before.carrierId` is also null, so the paths must agree. If `carrierId` shows up, `statedView` is reading the wrong field.

`carrierId` is deliberately absent from `LOAD_PATHS` for the common case; add it only if you also write the test that pins what a relink should read as.

- [ ] **Step 5: Run the whole suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/load/update.ts src/domain/load/update.test.ts
git commit -m "feat: edit a saved load, recording what each save changed"
```

---

### Task 7: Extract the field component

**Files:**

- Create: `src/app/(app)/loads/field.tsx`
- Modify: `src/app/(app)/loads/review-form.tsx`

**Interfaces:**

- Produces: `Field({ name, label, defaultValue, type?, required?, hint?, flag?, sourceText? })` and `truncate(text, limit?)`.

The review screen's render tests are the regression check: the markup must not change.

- [ ] **Step 1: Create the component**

Create `src/app/(app)/loads/field.tsx`:

```ts
"use client";

import { useId } from "react";
import styles from "../../ui.module.css";

/**
 * One editable field on a load.
 *
 * Shared by the intake review screen and the edit screen, and deliberately
 * ignorant of confidence. Review translates a parser's confidence into words
 * before it gets here, because "0.55" means nothing to a dispatcher and
 * showing it would imply a precision the scale does not have — and an edit
 * screen has no confidence to translate at all.
 */
export function Field({
  name,
  label,
  defaultValue,
  type = "text",
  required = false,
  hint,
  flag,
  sourceText,
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: "text" | "date" | "time";
  required?: boolean;
  hint?: string;
  /** Shown in place of the hint when set: why this field needs a look. */
  flag?: string;
  /** What the value was read from, so a flag can be judged. */
  sourceText?: string | null;
}) {
  const id = useId();

  return (
    <div className={`${styles.field} ${flag ? styles.fieldFlagged : ""}`}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        className={styles.input}
        defaultValue={defaultValue}
        required={required}
        autoComplete="off"
      />
      {flag && <span className={styles.fieldFlag}>{flag}</span>}
      {sourceText && (
        <span className={styles.sourceText} title={sourceText}>
          read from “{truncate(sourceText)}”
        </span>
      )}
      {hint && !flag && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

export function truncate(text: string, limit = 60): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
```

- [ ] **Step 2: Rewire the review form**

In `src/app/(app)/loads/review-form.tsx`: delete the local `Field` and `truncate`, keep `describeConfidence`, and add a local adapter that keeps every call site unchanged:

```ts
import { Field as FieldInput } from "./field";

/**
 * The review screen's field: the shared input, plus the parser's opinion of it.
 */
function Field({
  name,
  label,
  field,
  flagged,
  required = false,
  type = "text",
  hint,
  format,
}: {
  name: string;
  label: string;
  field: DraftField<unknown> | undefined;
  flagged: boolean;
  required?: boolean;
  type?: "text" | "date" | "time";
  hint?: string;
  format?: (value: unknown) => string;
}) {
  const value = field?.value ?? null;

  return (
    <FieldInput
      name={name}
      label={label}
      defaultValue={value === null ? "" : format ? format(value) : String(value)}
      type={type}
      required={required}
      hint={hint}
      flag={
        flagged
          ? value === null
            ? "Not found — enter it"
            : `Low confidence (${describeConfidence(field?.confidence ?? 0)}) — check it`
          : undefined
      }
      sourceText={field?.sourceText}
    />
  );
}
```

- [ ] **Step 3: Run the render tests**

Run: `npx vitest run "src/app/(app)/loads/review-form.test.tsx"`
Expected: PASS, 11 tests, unchanged. Every assertion about `name="..."`, `value="..."`, "Low confidence" and "read from" still holds, which is what makes this a safe extraction.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/loads/field.tsx" "src/app/(app)/loads/review-form.tsx"
git commit -m "refactor: share the editable field between review and editing"
```

---

### Task 8: Read the edit form's submission

**Files:**

- Modify: `src/app/(app)/loads/form-values.ts`
- Test: `src/app/(app)/loads/form-values.test.ts`

**Interfaces:**

- Produces: `readEditedLoad(formData): EditReadResult` where `EditReadResult = { ok: true; edited: EditedLoad } | { ok: false; message: string }`.

- [ ] **Step 1: Write the failing test**

Append to `src/app/(app)/loads/form-values.test.ts`:

```ts
describe("readEditedLoad", () => {
  function editForm(overrides: Record<string, string> = {}): FormData {
    const formData = new FormData();
    formData.set("referenceNumber", "884213");
    formData.set("carrierName", "GULF COAST HAULING LLC");
    formData.set("carrierMcNumber", "MC-987654");
    formData.set("carrierDotNumber", "");
    formData.set("commodity", "Canned goods");
    formData.set("weightLbs", "42,000");
    formData.set("equipment", "53' Dry Van");
    formData.set("carrierRateCents", "1850.00");
    for (const [key, value] of Object.entries(overrides)) formData.set(key, value);

    formData.append("stop.id", "stop-1");
    formData.append("stop.kind", "pickup");
    formData.append("stop.partyName", "ACME DISTRIBUTION");
    formData.append("stop.addressLine", "4400 Navigation Blvd");
    formData.append("stop.city", "Houston");
    formData.append("stop.state", "tx");
    formData.append("stop.postalCode", "77011");
    formData.append("stop.date", "2026-11-02");
    formData.append("stop.windowStart", "08:00");
    formData.append("stop.windowEnd", "12:00");
    formData.append("stop.referenceNumber", "PU-4471");
    formData.append("stop.windowRawText", "PU 11/02 0800-1200");

    formData.append("stop.id", "");
    formData.append("stop.kind", "delivery");
    formData.append("stop.partyName", "LONE STAR FOODS");
    formData.append("stop.addressLine", "");
    formData.append("stop.city", "Dallas");
    formData.append("stop.state", "TX");
    formData.append("stop.postalCode", "");
    formData.append("stop.date", "2026-11-03");
    formData.append("stop.windowStart", "14:00");
    formData.append("stop.windowEnd", "");
    formData.append("stop.referenceNumber", "");
    formData.append("stop.windowRawText", "");

    return formData;
  }

  it("reads the load and its stops, in order", () => {
    const read = readEditedLoad(editForm());
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.edited.referenceNumber).toBe("884213");
    // "MC-987654" and "987654" are the same number.
    expect(read.edited.carrierMcNumber).toBe("987654");
    expect(read.edited.weightLbs).toBe(42000);
    // Dollars in the box, cents in the record.
    expect(read.edited.carrierRateCents).toBe(185_000);
    expect(read.edited.stops.map((stop) => stop.kind)).toEqual(["pickup", "delivery"]);
    expect(read.edited.stops[0].state).toBe("TX");
    expect(read.edited.stops[1].addressLine).toBeNull();
  });

  it("tells an existing stop from an added one", () => {
    const read = readEditedLoad(editForm());
    if (!read.ok) return;

    expect(read.edited.stops[0].id).toBe("stop-1");
    // A blank id is a row the reviewer added, not a row with a blank id.
    expect(read.edited.stops[1].id).toBeNull();
  });

  it("refuses a rate it cannot read rather than saving a blank one", () => {
    const read = readEditedLoad(editForm({ carrierRateCents: "about $1850" }));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.message).toContain("is not an amount");
  });

  it("refuses a load with no stops", () => {
    const formData = new FormData();
    formData.set("referenceNumber", "884213");
    formData.set("weightLbs", "");
    formData.set("carrierRateCents", "");

    const read = readEditedLoad(formData);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.message).toBe("A load needs at least one stop");
  });
});
```

Add `readEditedLoad` to the file's existing import from `./form-values`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run "src/app/(app)/loads/form-values.test.ts"`
Expected: FAIL — `readEditedLoad is not a function`.

- [ ] **Step 3: Extract the shared reader and add the new one**

In `src/app/(app)/loads/form-values.ts`, rename `readValues` to `readLoadValues`, export it, and have it read `stop.id` into a parallel array it returns separately. Replace the function and add the new entry point:

```ts
import { editedLoadSchema, type EditedLoad } from "@/domain/load/update";

export type EditReadResult =
  | { readonly ok: true; readonly edited: EditedLoad }
  | { readonly ok: false; readonly message: string };

/**
 * The edit form's submission, turned into an `EditedLoad`.
 *
 * Shares `readLoadValues` with the confirm path, so the money and weight
 * parsing — the part a human's typing actually breaks — exists once. What it
 * adds is `stop.id`: the row a stop came from, or null for one the reviewer
 * added. That distinction is what lets the route be renumbered instead of
 * reissued.
 */
export function readEditedLoad(formData: FormData): EditReadResult {
  const problems: string[] = [];
  const values = readLoadValues(formData, problems);
  if (problems.length > 0) return { ok: false, message: problems[0] };

  const ids = formData.getAll("stop.id").map((value) => optional(value));

  const parsed = editedLoadSchema.safeParse({
    ...values,
    stops: values.stops.map((stop, index) => ({ ...stop, id: ids[index] ?? null })),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Some of these values could not be saved.",
    };
  }

  return { ok: true, edited: parsed.data };
}
```

`readConfirmedLoad` keeps its body; only the call to `readValues` becomes `readLoadValues`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/(app)/loads/form-values.test.ts"`
Expected: PASS — the existing cases plus 4 new.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/loads/form-values.ts" "src/app/(app)/loads/form-values.test.ts"
git commit -m "feat: read the edit form's submission"
```

---

### Task 9: The edit screen

**Files:**

- Create: `src/app/(app)/loads/[id]/edit/form-state.ts`
- Create: `src/app/(app)/loads/[id]/edit/actions.ts`
- Create: `src/app/(app)/loads/[id]/edit/edit-form.tsx`
- Create: `src/app/(app)/loads/[id]/edit/page.tsx`
- Create: `src/app/(app)/loads/[id]/edit/edit-form.test.tsx`
- Modify: `src/server/intake.ts`

**Interfaces:**

- Consumes: `readEditedLoad` (task 8), `Field` (task 7), `createUpdateLoad` (task 6).
- Produces: `updateLoad` from `@/server/intake`; `editLoadAction`; `EditState`, `initialEditState`; `EditForm({ load, stops, parties, carrier })`.

- [ ] **Step 1: Wire the composition root**

Append to `src/server/intake.ts`:

```ts
import { createUpdateLoad } from "@/domain/load/update";

export const updateLoad = createUpdateLoad({
  loads: loadRepository,
  parties: partyRepository,
  carriers: carrierRepository,
});
```

- [ ] **Step 2: Write the form state**

Create `src/app/(app)/loads/[id]/edit/form-state.ts`:

```ts
/**
 * Separate from `actions.ts` because a `"use server"` module may export **only**
 * async functions. An exported constant there throws `A "use server" file can
 * only export async functions, found object` when the module is evaluated,
 * which takes down whatever rendered it — it typechecks and it builds, and this
 * project has shipped it once already.
 */
export type EditState =
  { readonly status: "idle" } | { readonly status: "error"; readonly message: string };

export const initialEditState: EditState = { status: "idle" };
```

- [ ] **Step 3: Write the action**

Create `src/app/(app)/loads/[id]/edit/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateLoad } from "@/server/intake";
import { getCurrentBrokerage } from "@/server/tenant";
import { readEditedLoad } from "../../form-values";
import type { EditState } from "./form-state";

/**
 * Saving an edit.
 *
 * Checks the session itself: the `(app)` route group's layout renders for a
 * page request and does not run for a server action, so it is no guard here.
 * The load id travels in a hidden field rather than from the route, because an
 * action has no params.
 */
export async function editLoadAction(
  _previous: EditState,
  formData: FormData,
): Promise<EditState> {
  const scope = await getCurrentBrokerage();
  if (!scope)
    return { status: "error", message: "You are not signed in to a brokerage." };

  const loadId = String(formData.get("loadId") ?? "");
  if (!loadId) return { status: "error", message: "This edit lost its load." };

  const read = readEditedLoad(formData);
  if (!read.ok) return { status: "error", message: read.message };

  const outcome = await updateLoad(scope, loadId, read.edited);

  if (outcome.status === "not_found") {
    return { status: "error", message: "This load no longer exists." };
  }

  if (outcome.status === "duplicate_reference") {
    return {
      status: "error",
      message: `Load ${outcome.existing.referenceNumber} already exists. Use a different load number.`,
    };
  }

  revalidatePath("/loads");
  revalidatePath(`/loads/${loadId}`);
  redirect(`/loads/${loadId}`);
}
```

- [ ] **Step 4: Write the form**

Create `src/app/(app)/loads/[id]/edit/edit-form.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { Carrier } from "@/domain/carrier/carrier";
import type { Load, Party, Stop } from "@/domain/load/load";
import { Money } from "@/domain/money";
import styles from "../../../../ui.module.css";
import { Field } from "../../field";
import { editLoadAction } from "./actions";
import { initialEditState } from "./form-state";

/**
 * Editing a saved load.
 *
 * Deliberately not the review screen. That screen is about a parser's
 * uncertainty — flags, confidences, the document text to check a field
 * against — and none of it applies to a record a person has already accepted.
 * What the two share is the field component and, crucially, the field *names*,
 * so one `readLoadValues` serves both.
 *
 * Values live in the DOM. State tracks only which stop rows exist, so adding
 * one does not discard what has been typed into the others.
 */
export interface EditFormProps {
  readonly load: Load;
  readonly stops: readonly Stop[];
  /** The facility behind each stop, keyed by party id. */
  readonly parties: ReadonlyMap<string, Party>;
  /** The linked carrier, whose numbers prefill the carrier fields. */
  readonly carrier: Carrier | null;
}

interface Row {
  /** Stable across re-renders, so an uncontrolled input keeps its value. */
  readonly key: string;
  /** The stop this row came from; null for one the user added. */
  readonly stop: Stop | null;
  readonly kind: "pickup" | "delivery";
}

export function EditForm({ load, stops, parties, carrier }: EditFormProps) {
  const [state, formAction, pending] = useActionState(editLoadAction, initialEditState);

  const [rows, setRows] = useState<Row[]>(() =>
    stops.map((stop) => ({
      key: stop.id,
      stop,
      kind: stop.type === "delivery" ? "delivery" : "pickup",
    })),
  );
  const [added, setAdded] = useState(0);

  function addStop(kind: "pickup" | "delivery") {
    setRows((current) => [...current, { key: `added-${added}`, stop: null, kind }]);
    setAdded((count) => count + 1);
  }

  function removeStop(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  return (
    <form action={formAction} className={styles.reviewForm}>
      <input type="hidden" name="loadId" value={load.id} />

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Load</h2>
        <div className={styles.grid}>
          <Field
            name="referenceNumber"
            label="Load number"
            defaultValue={load.referenceNumber}
            required
            hint="Must be unique across your loads."
          />
          <Field
            name="carrierName"
            label="Carrier"
            defaultValue={load.details.carrierAsWritten ?? carrier?.legalName ?? ""}
          />
          {/*
            Prefilled from the linked carrier, because a load stores the link
            and not the numbers someone typed. Leaving these blank would make
            every save unlink the carrier.
          */}
          <Field
            name="carrierMcNumber"
            label="Carrier MC number"
            defaultValue={carrier?.mcNumber ?? ""}
          />
          <Field
            name="carrierDotNumber"
            label="Carrier USDOT number"
            defaultValue={carrier?.dotNumber ?? ""}
          />
          <Field
            name="commodity"
            label="Commodity"
            defaultValue={load.commodityDescription ?? ""}
          />
          <Field
            name="weightLbs"
            label="Weight (lbs)"
            defaultValue={load.weightLbs === null ? "" : String(load.weightLbs)}
          />
          <Field
            name="equipment"
            label="Equipment"
            defaultValue={load.details.equipmentAsWritten ?? ""}
            hint="As the document wrote it. Classified on save."
          />
          <Field
            name="carrierRateCents"
            label="Carrier rate ($)"
            defaultValue={
              load.carrierPayCents === null
                ? ""
                : Money.fromCents(load.carrierPayCents).toDollarString()
            }
          />
        </div>
        <p className={styles.hint}>
          Status stays <strong>{load.status}</strong> — this screen does not change it.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Stops</h2>
        {rows.length === 0 && (
          <p className={styles.empty}>
            A load needs at least one stop. Add the pickup and delivery below.
          </p>
        )}

        {rows.map((row, index) => (
          <StopFields
            key={row.key}
            index={index}
            row={row}
            party={row.stop ? (parties.get(row.stop.partyId) ?? null) : null}
            onRemove={() => removeStop(row.key)}
          />
        ))}

        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => addStop("pickup")}
          >
            Add pickup
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => addStop("delivery")}
          >
            Add delivery
          </button>
        </div>
        <p className={styles.hint}>
          Correcting an address fixes that facility on every load that uses it. To send
          this stop somewhere else, change the name instead.
        </p>
      </section>

      <div className={styles.formFooter}>
        <button type="submit" className={styles.button} disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        <Link href={`/loads/${load.id}`} className={styles.linkButton}>
          Cancel
        </Link>
        {state.status === "error" && (
          <p className={styles.formError} role="alert">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

const STOP_LABEL = { pickup: "Pickup", delivery: "Delivery" } as const;

function StopFields({
  index,
  row,
  party,
  onRemove,
}: {
  index: number;
  row: Row;
  party: Party | null;
  onRemove: () => void;
}) {
  const stop = row.stop;
  const date =
    stop?.opensAtLocal?.slice(0, 10) ?? stop?.closesAtLocal?.slice(0, 10) ?? "";

  return (
    <fieldset className={styles.stopCard}>
      <legend className={styles.stopLegend}>
        {STOP_LABEL[row.kind]} {index + 1}
      </legend>

      {/* Empty for a row the user added, which is how the route gets renumbered
          rather than reissued. */}
      <input type="hidden" name="stop.id" value={stop?.id ?? ""} />
      {/* What the document said about timing, kept whatever the edits below. */}
      <input type="hidden" name="stop.windowRawText" value={stop?.windowRawText ?? ""} />

      <div className={styles.grid}>
        <div className={styles.field}>
          <label className={styles.label}>Stop type</label>
          <select
            name="stop.kind"
            className={styles.select}
            defaultValue={row.kind}
            aria-label={`Stop ${index + 1} type`}
          >
            <option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option>
          </select>
        </div>

        <Field
          name="stop.partyName"
          label="Name"
          defaultValue={party?.name ?? ""}
          required
        />
        <Field
          name="stop.addressLine"
          label="Address"
          defaultValue={party?.addressLine1 ?? ""}
        />
        <Field name="stop.city" label="City" defaultValue={party?.city ?? ""} />
        <Field name="stop.state" label="State" defaultValue={party?.region ?? ""} />
        <Field
          name="stop.postalCode"
          label="ZIP"
          defaultValue={party?.postalCode ?? ""}
        />
        <Field name="stop.date" label="Date" defaultValue={date} type="date" />
        <Field
          name="stop.windowStart"
          label="Window opens"
          defaultValue={stop?.opensAtLocal?.slice(11, 16) ?? ""}
          type="time"
          hint="Local time at the dock."
        />
        <Field
          name="stop.windowEnd"
          label="Window closes"
          defaultValue={stop?.closesAtLocal?.slice(11, 16) ?? ""}
          type="time"
        />
        <Field
          name="stop.referenceNumber"
          label="Reference number"
          defaultValue={stop?.details.appointmentNumber ?? ""}
        />
      </div>

      <div className={styles.rowActions}>
        <button type="button" className={styles.linkButton} onClick={onRemove}>
          Remove this stop
        </button>
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 5: Write the page**

Create `src/app/(app)/loads/[id]/edit/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Party } from "@/domain/load/load";
import { carrierRepository } from "@/server/carriers";
import { loadRepository, partyRepository } from "@/server/intake";
import { requireBrokerage } from "@/server/tenant";
import styles from "../../../../ui.module.css";
import { EditForm } from "./edit-form";

export default function EditLoadPage({ params }: PageProps<"/loads/[id]/edit">) {
  return (
    <div className={styles.page}>
      <Suspense fallback={<div className={styles.skeleton} />}>
        <EditLoad params={params} />
      </Suspense>
    </div>
  );
}

async function EditLoad({ params }: { params: PageProps<"/loads/[id]/edit">["params"] }) {
  const { id } = await params;
  const scope = await requireBrokerage();

  // Scoped read: another brokerage's load is indistinguishable from one that
  // does not exist.
  const found = await loadRepository.findById(scope, id);
  if (!found) notFound();

  const { load, stops } = found;

  const parties = new Map<string, Party>();
  for (const partyId of new Set(stops.map((stop) => stop.partyId))) {
    const party = await partyRepository.findById(scope, partyId);
    if (party) parties.set(partyId, party);
  }

  const carrier = load.carrierId
    ? await carrierRepository.findById(scope, load.carrierId)
    : null;

  return (
    <>
      <Link href={`/loads/${load.id}`} className={styles.backLink}>
        ← Load {load.referenceNumber}
      </Link>
      <header className={styles.header}>
        <h1 className={styles.title}>Edit load {load.referenceNumber}</h1>
        <p className={styles.subtitle}>
          Every change is recorded on the load, with what the value was before.
        </p>
      </header>
      <EditForm load={load} stops={stops} parties={parties} carrier={carrier} />
    </>
  );
}
```

- [ ] **Step 6: Write the render test**

Create `src/app/(app)/loads/[id]/edit/edit-form.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Carrier } from "@/domain/carrier/carrier";
import type { Load, Party, Stop } from "@/domain/load/load";

/**
 * The server action is stubbed so this stays a render test. Importing it for
 * real drags in the session module, Auth.js and `next/server`, none of which
 * resolves outside Next's bundler.
 *
 * Typechecking and `next build` both pass on a component that throws the
 * moment it renders — the bug this project shipped once, when a `"use server"`
 * file exported a constant. This catches that class of failure, and pins the
 * `name` attributes the action depends on.
 */
vi.mock("./actions", () => ({ editLoadAction: vi.fn() }));

const { EditForm } = await import("./edit-form");

const party: Party = {
  id: "party-1",
  brokerageId: "brokerage-1",
  name: "ACME DISTRIBUTION",
  addressLine1: "4400 Navigation Blvd",
  addressLine2: null,
  city: "Houston",
  region: "TX",
  postalCode: "77011",
  country: "US",
  timeZone: "America/Chicago",
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  details: {},
};

const load: Load = {
  id: "load-1",
  brokerageId: "brokerage-1",
  referenceNumber: "884213",
  status: "booked",
  equipmentType: "dry_van",
  commodityDescription: "Canned goods",
  weightLbs: 42000,
  customerRateCents: 210_000,
  carrierPayCents: 185_000,
  carrierId: "carrier-1",
  details: {
    equipmentAsWritten: "53' Dry Van",
    carrierAsWritten: "GULF COAST HAULING LLC",
  },
};

const stop: Stop = {
  id: "stop-1",
  brokerageId: "brokerage-1",
  loadId: "load-1",
  sequence: 0,
  type: "pickup",
  partyId: "party-1",
  opensAtLocal: "2026-11-02T08:00",
  closesAtLocal: "2026-11-02T12:00",
  timeZone: "America/Chicago",
  appointmentType: "fcfs",
  windowRawText: "PU 11/02 0800-1200",
  details: { appointmentNumber: "PU-4471" },
};

const carrier: Carrier = {
  id: "carrier-1",
  brokerageId: "brokerage-1",
  dotNumber: "264184",
  mcNumber: "133655",
  legalName: "GULF COAST HAULING LLC",
  dbaName: null,
  details: {},
};

function render(overrides: Partial<Parameters<typeof EditForm>[0]> = {}): string {
  return renderToStaticMarkup(
    <EditForm
      load={load}
      stops={[stop]}
      parties={new Map([[party.id, party]])}
      carrier={carrier}
      {...overrides}
    />,
  );
}

describe("the edit form", () => {
  it("renders without throwing", () => {
    expect(render()).toContain("Save changes");
  });

  it("emits every field name the edit action reads", () => {
    const html = render();

    for (const name of [
      "loadId",
      "referenceNumber",
      "carrierName",
      "carrierMcNumber",
      "carrierDotNumber",
      "commodity",
      "weightLbs",
      "equipment",
      "carrierRateCents",
      "stop.id",
      "stop.kind",
      "stop.partyName",
      "stop.addressLine",
      "stop.city",
      "stop.state",
      "stop.postalCode",
      "stop.date",
      "stop.windowStart",
      "stop.windowEnd",
      "stop.referenceNumber",
      "stop.windowRawText",
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
  });

  it("fills the inputs from the saved load", () => {
    const html = render();

    expect(html).toContain('value="884213"');
    expect(html).toContain("GULF COAST HAULING LLC");
    expect(html).toContain('value="1850.00"');
    expect(html).toContain('value="2026-11-02"');
    expect(html).toContain('value="08:00"');
    expect(html).toContain('value="PU-4471"');
  });

  it("prefills the carrier numbers from the linked carrier", () => {
    const html = render();

    // A load stores the link, not the numbers someone typed. Blank fields here
    // would make every save unlink the carrier.
    expect(html).toContain('value="133655"');
    expect(html).toContain('value="264184"');
  });

  it("carries the stop's id, so the route is renumbered and not reissued", () => {
    const html = render();
    expect(html).toMatch(/name="stop\.id"[^>]*value="stop-1"/);
  });

  it("keeps what the document said about the window", () => {
    const html = render();
    expect(html).toMatch(/name="stop\.windowRawText"[^>]*value="[^"]*0800-1200/);
  });

  it("says what the screen will not do", () => {
    const html = render();

    expect(html).toContain("does not change it");
    expect(html).toContain("every load that uses it");
  });

  it("offers an empty id for a load with no carrier", () => {
    const html = render({ carrier: null, load: { ...load, carrierId: null } });
    expect(html).toContain("Save changes");
  });
});
```

- [ ] **Step 7: Run the test**

Run: `npx vitest run "src/app/(app)/loads/[id]/edit/edit-form.test.tsx"`
Expected: PASS, 8 tests.

If `styles` resolves as `undefined` and class names render as `undefined`, check the relative depth of the CSS import: from `src/app/(app)/loads/[id]/edit/` the module is four levels up (`../../../../ui.module.css`), where `review-form.tsx` needs two.

- [ ] **Step 8: Build, to catch what the render test cannot**

Run: `npm run build && npm run lint && npm run typecheck`
Expected: PASS, with `/loads/[id]/edit` in the route list.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/loads/[id]/edit" src/server/intake.ts
git commit -m "feat: add the load edit screen"
```

---

### Task 10: The way in, and the trail

**Files:**

- Modify: `src/app/(app)/loads/[id]/page.tsx`

**Interfaces:**

- Consumes: `LoadEdit` from `@/domain/details`.

- [ ] **Step 1: Add the link and the trail**

In `src/app/(app)/loads/[id]/page.tsx`, add `LoadEdit` to the type import from `@/domain/details`, put an edit link in the header, and render the trail.

Inside the `<header>`'s `cardHeader` div, after `<StatusBadge />`:

```tsx
<Link href={`/loads/${load.id}/edit`} className={styles.inlineLink}>
  Edit load
</Link>
```

After the existing `{load.details.intake && <IntakeNote … />}` line:

```tsx
{
  load.details.edits && load.details.edits.length > 0 && (
    <EditNote edits={load.details.edits} />
  );
}
```

And the component, beside `IntakeNote`:

```tsx
/**
 * What has changed since this load was saved.
 *
 * On the screen rather than only in the column, for the same reason the intake
 * note is: a rate con is an agreement, and "the carrier pay says $1,850 — did
 * it always?" is a question someone eventually asks. Newest first, and only
 * the most recent save is open, because the usual question is about the last
 * change rather than all of them.
 */
function EditNote({ edits }: { edits: readonly LoadEdit[] }) {
  const newest = [...edits].reverse();

  return (
    <div className={styles.note}>
      <strong>
        Edited {edits.length === 1 ? "once" : `${edits.length} times`} since it was saved.
      </strong>
      <ul className={styles.list}>
        {newest.map((edit, index) => (
          <li key={`${edit.at}-${index}`} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowName}>{formatEditedAt(edit.at)}</span>
              <span className={styles.rowMeta}>
                {edit.changes.length === 0
                  ? "No fields changed."
                  : edit.changes
                      .map(
                        (change) =>
                          `${change.path}: ${change.from ?? "—"} → ${change.to ?? "—"}`,
                      )
                      .join(" · ")}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The instant an edit was made, in the reader's own zone — unlike a dock window. */
function formatEditedAt(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
```

- [ ] **Step 2: Verify it builds and typechecks**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/loads/[id]/page.tsx"
git commit -m "feat: show the edit trail and link to the edit screen"
```

---

### Task 11: End to end, against real adapters

The failure this project actually hits is a layer written and never wired. Every piece above is covered on its own; this is the test that they are connected.

**Files:**

- Create: `src/app/(app)/loads/edit-flow.test.ts`

**Interfaces:**

- Consumes: `readConfirmedLoad`, `readEditedLoad`; the real repositories; `createConfirmDraft`, `createUpdateLoad`; `seedBrokerage`, `withRollback`.

- [ ] **Step 1: Write the test**

Create `src/app/(app)/loads/edit-flow.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run "src/app/(app)/loads/edit-flow.test.ts"`
Expected: PASS, 4 tests.

If the first test reports more than two changes, `RATE_CON` and `confirmedLoad()` have drifted apart: a default `editForm()` submission must be a no-op edit, so every value in `RATE_CON`, the default pickup row and `DELIVERY_ROW` has to match what `confirmedLoad()` saved. Print the `changes` array — each extra entry names the field that disagrees.

- [ ] **Step 3: Run everything**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: PASS, all four.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/loads/edit-flow.test.ts"
git commit -m "test: drive intake and editing end to end against Postgres"
```

---

### Task 12: Drive it in a browser

A green suite says nothing about render time. Both bugs this module has actually had — the `"use server"` export and the carrier name-mismatch gap — were found here and by nothing else.

**Files:**

- Modify: `docs/load-intake.md`
- Modify: `CLAUDE.md`
- Create: `docs/images/` screenshots as needed

- [ ] **Step 1: Start the app with a database**

```bash
npm run db:up && npm run db:migrate && npm run dev
```

- [ ] **Step 2: Sign in without the email**

Auth.js stores `sha256(rawToken + AUTH_SECRET)` in `verification_tokens`. Insert a row with that hash, then open `/api/auth/callback/resend?token=<raw>&email=<addr>&callbackUrl=/loads` — the server sets the session cookie itself. Single-use. See `CLAUDE.md`, "Signing in locally without the email"; injecting a cookie directly does not work, because browser automation blocks cookie writes.

- [ ] **Step 3: Create a load to edit**

Go to `/loads/new`, paste the sample rate confirmation from `docs/load-intake.md`, review, and save.

- [ ] **Step 4: Walk the edit screen**

From `/loads/[id]`, click "Edit load", then check each of these on the screen:

1. Every field is prefilled, **including both carrier numbers** — blank ones here mean the load would be unlinked from its carrier on save.
2. Change the carrier rate. Save. The detail page shows the new rate and an edit trail entry naming the old one.
3. Correct a stop's ZIP. Save. The detail page shows it, and `/loads` still lists one load.
4. Swap the pickup and delivery with Remove/Add, or reorder, and save. The route reads in the new order, with no constraint error.
5. Add a third stop. Save. Three stops, numbered 1–3.
6. Remove a stop so none are left. Save. The form says "A load needs at least one stop" and nothing is written.
7. Change the load number to one another load already has. Save. The form names the clash; the load keeps its own number.
8. Confirm the status badge has not moved.

- [ ] **Step 5: Screenshot and document**

Add the edit screen and the edit trail to `docs/load-intake.md`, following the existing section format — a screenshot, what the screen is for, and what it cannot do. Say plainly that correcting an address changes the facility for every load, that status is not editable, and that there is no delete.

- [ ] **Step 6: Update `CLAUDE.md`**

In "Deliberately not built yet", replace the "Editing or deleting a saved load" bullet with:

```markdown
- **Deleting a saved load.** Editing is built (`/loads/[id]/edit`): any field, the route, and a facility's address, with every change recorded in `details.edits`. Deleting is not — a bad import is corrected rather than removed. Status is still inferred at intake and not settable by hand, so a load that saved as `draft` for want of a rate stays a draft after the rate is filled in; a real lifecycle needs discovery, not invention
```

And in "Current state", after the four things worth knowing about intake, add:

```markdown
- **A saved load can be edited, and says what changed.** `/loads/[id]/edit` rewrites the load, its route, and the facilities behind its stops. Each save appends `{at, changes}` to `details.edits`, which the load page renders — a rate con is an agreement, so "did the carrier pay always say $1,850?" is a question that gets asked. The trail is a sibling of `details.intake`, never part of it: `intake.corrections` is evidence about the _parser_, and diluting it with edits made days later would corrupt the only data the confidence scale can be calibrated from. Correcting a stop's address fixes the shared `Party`, so it is right on every load that touches that dock; retyping the name points the stop at a different facility instead, and never renames one other loads depend on
```

- [ ] **Step 7: Final verification**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: PASS, all four.

- [ ] **Step 8: Commit and open the PR**

```bash
git add docs CLAUDE.md
git commit -m "docs: record the load edit screen"
git push -u origin feat/load-editing
gh pr create --title "feat: edit a saved load" --body "$(cat <<'BODY'
A load saved through intake was frozen: `LoadRepository` was create-and-read,
so a wrong rate meant re-importing under a new reference number.

`/loads/[id]/edit` now rewrites any field, the whole route, and the facilities
behind its stops. Each save appends `{at, changes}` to the load's `details`
column, which the detail page renders.

Four decisions worth knowing:

- The trail is a sibling of `details.intake`, not part of it. `intake.corrections`
  is evidence about the parser; mixing in edits made days later would corrupt the
  only data the confidence scale can be calibrated from.
- Correcting a stop's address fixes the shared `Party`, so it is right on every
  load that touches that dock. Retyping the name points the stop at a different
  facility and never renames one other loads depend on.
- Status is neither editable nor re-inferred. A load that saved as a draft for
  want of a rate stays a draft; a real lifecycle needs discovery.
- The edit screen is its own form rather than a rehydrated `LoadDraft`, which
  would have meant faking a confidence of 1.0 on every field.

Driven in a browser end to end as well as under test, per the lesson from the
intake module.

Design: `docs/superpowers/specs/2026-10-29-load-editing-design.md`
Plan: `docs/superpowers/plans/2026-10-29-load-editing.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Deliberately not in this plan

- **Deleting a load.** Not in the spec, not asked for.
- **Setting status by hand.** Decided against; the consequence is documented.
- **`customerRateCents` on the edit form.** The edit use case _preserves_ it, and no screen sets it. This is the first screen that plausibly could — it is the broker's own number, which no document states, and margin depends on it. Out of scope here because the spec did not call for it; worth raising as its own small change.
- **A `load_revisions` table.** `details.edits` answers "what changed and when". Point-in-time reconstruction is a later, separate decision, and the data to seed it starts accumulating with the first edit.
- **Editing a facility outside a load.** A facilities screen is its own surface, and it is also the fix for per-stop time zones.
