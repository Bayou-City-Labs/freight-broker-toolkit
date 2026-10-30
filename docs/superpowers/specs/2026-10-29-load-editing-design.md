# Editing a saved load

**Date:** 2026-10-29
**Status:** approved, not yet implemented
**Depends on:** load intake, merged to `main` as PR #6 (`34a3586`).

## The problem

A load saved through intake is frozen. `LoadRepository` is create-and-read, there is no route under `src/app/(app)/loads/` that writes to an existing load, and the only form that writes a load at all is the intake review screen. A reviewer who notices a wrong rate after confirming has one option: re-import under a different reference number, because the number is unique per brokerage.

That was a deliberate omission, recorded in `CLAUDE.md` under "Deliberately not built yet". It is now the thing in the way.

## Scope

A broker can open a saved load, change any of its data fields, correct a facility's address, and add, remove, or reorder its stops. Each save records what changed.

Out of scope, deliberately:

- **Deleting a load.** Not asked for. A bad import can be corrected now, which is the pressing case.
- **Changing status.** Decided explicitly: status stays whatever intake inferred. See "Status" below for the consequence.
- **Editing a facility outside the context of a load.** A facilities screen is its own surface; address correction here is a side effect of fixing a stop.
- **Point-in-time reconstruction of a load.** The edit trail says what changed and when, not what the whole record looked like on a past date.

## Decisions

Four questions were settled before design, and each one closes off an approach that looks reasonable from the code alone.

**Editing is allowed, and leaves a trace in `details`.** A rate confirmation is an agreement, so "the carrier pay says $1,850 — did it always?" is a question someone eventually asks. The trace goes in the existing `jsonb` `details` column, alongside the intake corrections already stored there. A `load_revisions` table would answer more, and is a schema commitment made before any client has asked for revision history; it remains available later, because the data to seed it is being kept from the first edit.

**Correcting a stop's address fixes the facility everywhere.** The address lives on the shared `Party` row, not on the stop — one "WALMART DC 6094" is reused by every load that touches it. A wrong ZIP is wrong on all of them, so the fix propagates. The alternative, making address fields read-only until a facilities screen exists, leaves a visibly wrong ZIP with no way to fix it.

**Status is untouched.** Not editable, not re-inferred on save.

**A separate edit screen, sharing primitives with the review screen.** The tempting alternative is to rehydrate a saved load into a `LoadDraft` with a confidence of 1.0 on every field and reuse `ReviewForm`. That buys one form and costs the correction dataset: `compareToDraft` would then emit "corrections" measured against a saved load rather than against a parser, diluting the only evidence that can tell anyone whether a confidence ever meant anything (`CLAUDE.md`, "the corrections a reviewer makes are recorded"). The review screen's chrome — "Read by `label-proximity-v1` from pasted text", the flagged-field counts, the document-text disclosure — is also meaningless on an edit.

So: two forms, sharing the code where bugs live (FormData reading, money and weight parsing) and not sharing the markup. The duplication that costs is in JSX; the duplication avoided is in logic.

## Domain

### The edit record

`src/domain/details.ts` gains one schema and one optional field on `loadDetailsSchema`:

```ts
export const loadEditSchema = z.object({
  /** ISO instant. */
  at: z.string(),
  changes: z.array(
    z.object({
      /** Dotted path, matching the correction paths: "carrierPayCents", "stops.1.city". */
      path: z.string(),
      from: z.string().nullable(),
      to: z.string().nullable(),
    }),
  ),
});

// on loadDetailsSchema:
edits: z.array(loadEditSchema).optional(),
```

`from` and `to` are strings rather than a `number | string | null` union. This trail is read by a person on a screen and never computed on, so formatting at write time means the renderer does not have to know a path's type. The columns still hold current truth; nothing is derived from the trail.

It is a sibling of `intake`, not part of it. `details.intake.corrections` is evidence about the parser, captured at the one moment a human overruled it. An edit made three days later is a different fact and must not be mixed in.

### Shared value shapes

New `src/domain/load/load-values.ts` holds the fields of a load as a human states them — `stopValuesSchema` and `loadValuesSchema`, lifted out of `confirmedStopSchema` / `confirmedLoadSchema` in `src/domain/intake/confirm.ts`. Then:

```ts
// intake/confirm.ts
export const confirmedLoadSchema = loadValuesSchema.extend({
  provenance: intakeProvenanceSchema,
});

// load/update.ts
export const editedLoadSchema = loadValuesSchema.extend({
  stops: z.array(stopValuesSchema.extend({ id: z.string().nullable() })),
});
```

`findCarrier` moves to `load-values.ts` alongside them. Intake's rule that a carrier is never created from a document has to hold on edit for exactly the same reason — a carrier record is the subject of a vetting history, and one conjured from a name would sit in the carrier list looking checked. A second copy of that rule is how it gets lost.

Both of these are domain-to-domain imports, so the lint boundary is unaffected.

### The use case

`src/domain/load/update.ts`, depending only on ports, the same shape as `createConfirmDraft`:

```ts
export interface UpdateLoadDeps {
  readonly loads: LoadRepository;
  readonly parties: PartyRepository;
  readonly carriers: CarrierRepository;
  /** Injectable so tests pin the edit timestamp; mirrors `checkedAt` in vetting. */
  readonly now?: () => Date;
}

export type UpdateOutcome =
  | { status: "saved"; load: Load; stops: readonly Stop[]; carrierLinked: boolean }
  | { status: "duplicate_reference"; existing: Load }
  | { status: "not_found" };

export type UpdateLoad = (
  scope: BrokerageScope,
  loadId: string,
  edited: EditedLoad,
) => Promise<UpdateOutcome>;
```

Steps:

1. `loads.findById(scope, loadId)`. Null gives `not_found`, which also covers another brokerage's load — indistinguishable from one that does not exist, same as every other scoped read.
2. If the reference number changed, `loads.findByReferenceNumber`. `duplicate_reference` only when it resolves to a **different** id; a load is not a duplicate of itself.
3. Resolve the carrier by MC then DOT, via the shared `findCarrier`. Never create one.
4. For each submitted stop, resolve its party:
   - **Name unchanged** (case-insensitive match against that stop's current party): `parties.update` with the submitted address fields. This is the "fix the facility everywhere" path.
   - **Name changed**: a different facility. `parties.findByName`, or create. A facility other loads point at is never silently renamed.
   - **A row with no `id`** (a stop the user added): resolve by name or create, as intake does.
5. Diff the stored load and stops against the submission, producing `changes[]`. Append `{ at: now().toISOString(), changes }` to `details.edits`, carrying `details.intake` and every other `details` key through untouched. An edit that changes nothing appends nothing.
6. `loads.update(...)`.

### Status

Untouched, and not re-inferred. The consequence, accepted knowingly: a load that saved as `draft` because the document stated no rate stays `draft` after someone fills the rate in. Re-running `inferStatus` on edit would fix that case and would also silently flip a load a dispatcher had deliberately set, which is worse. A real lifecycle needs discovery, not invention.

## Persistence

```ts
// LoadRepository
update(
  scope: BrokerageScope,
  id: string,
  input: NewLoad,
  stops: readonly StopWrite[],
): Promise<LoadWithStops | null>;

// PartyRepository
update(scope: BrokerageScope, id: string, input: NewParty): Promise<Party | null>;
```

`StopWrite = NewStop & { id?: string }`. Both return `null` when the row is not in scope.

One trap in reusing `NewLoad` as the update input: `status` is optional on it, and `create` resolves that with `input.status ?? "draft"`. An `update` that copies the pattern would silently demote a booked load to a draft whenever the caller omitted the field. The use case passes the stored status through verbatim, and `update` writes `status` unconditionally rather than defaulting it.

`createLoadRepository`'s `update` runs one transaction, which nests as a savepoint under the test harness's rollback transaction — the reason the repository takes an executor rather than reaching for `db`:

1. Delete the load's stops whose ids are absent from the submission.
2. Update each surviving stop, setting `sequence = -1 - index`.
3. Insert the rows that have no id, at `sequence = -1 - index`.
4. Update every stop for the load to its final `sequence = index`.

The two passes exist because `stops_load_sequence_key` is unique on `(load_id, sequence)`: swapping two stops collides on the first write if final sequences are assigned directly. The negative range is unreachable by real data, so the intermediate state cannot collide either.

The cheaper alternative — delete every stop and re-insert — is two statements instead of four, and silently reissues every stop id and resets `created_at`. Stop ids have no referent today, which makes this invisible now and a quiet loss of history the moment a generated BOL references a stop. Two extra statements is the right price.

## UI

```
src/app/(app)/loads/
  field.tsx                    ← Field, extracted from review-form.tsx
  form-values.ts               ← + readLoadValues (shared), + readEditedLoad
  [id]/edit/
    page.tsx                   ← requireBrokerage, findById, notFound, resolve parties
    edit-form.tsx              ← client component, useActionState
    actions.ts                 ← editLoadAction ("use server")
    form-state.ts              ← EditState, initialEditState
```

### The shared field

`Field` currently takes a `DraftField<unknown>` and renders confidence wording. The seam is lower than that: it is extracted with a plain surface —

```ts
{ name, label, defaultValue, type?, required?, hint?, flag?, sourceText? }
```

— and `review-form.tsx` keeps translating confidence into "Low confidence (medium) — check it" on its own side. The shared thing is the input markup; the confidence vocabulary belongs only to review.

### Field names

Identical to the review form, including the `stop.*` parallel arrays that `getAll` returns in document order. Two additions per stop row: a hidden `stop.id` (empty for added rows) and the stored `stop.windowRawText`, so what the document said about timing survives an edit that changes the parsed window.

Keeping the names identical is what lets `readLoadValues` serve both forms, so the money and weight parsing exists once.

### Behaviour

Stop rows use the same `useState` list pattern as `ReviewForm`: values live in the DOM, state tracks only which rows exist, so adding a stop does not discard what has been typed into the others.

`initialEditState` lives in `form-state.ts`, **not** in `actions.ts`. A `"use server"` file may export only async functions; exporting an object throws at module evaluation, type-checks cleanly, builds cleanly, and takes down whatever rendered it. This project has already shipped that bug once.

The action checks `getCurrentBrokerage()` itself. The route group's layout does not run for a server action, so it is no guard here.

### Entry and exit

An "Edit load" link in the `/loads/[id]` header. On success, `revalidatePath` for both `/loads` and `/loads/[id]`, then redirect to the detail page.

Error paths:

- `duplicate_reference` → a form error naming the clashing load, with a link to it.
- `not_found` → an error state, not `notFound()`; a server action cannot render a 404.
- Zero stops → rejected by `loadValuesSchema`'s `min(1)`.
- An unreadable weight or rate → the first problem reported, never quietly nulled, as `readConfirmedLoad` already does.

### The trail on the detail page

`/loads/[id]` grows an `EditNote` beside `IntakeNote`:

> **Edited twice.** Oct 29: carrier pay $1,750 → $1,850, pickup city HOUSTON → Houston.

Newest first, collapsed into a `<details>` past the first entry. On the screen rather than only in the column for the same reason the intake note is: it is the record of how much the saved data has moved since a document produced it.

## Testing

The repository fakes sit inline in `src/domain/intake/confirm.test.ts`. They are lifted into a shared test module so the edit use case does not fork a second copy that drifts out of step with the ports.

| Test                                                               | What it pins                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/load/update.test.ts` (fakes)                           | A changed field recorded with `from`/`to`; an unchanged reference number is not a self-duplicate; another load's number is rejected; an address corrected in place; a changed name re-resolving to a different party; a stop added, removed, and reordered; no carrier ever created; `details.intake` preserved; status untouched; a no-op edit appending nothing; another brokerage's id returning `not_found` |
| `src/db/repositories/loads.test.ts` (real Postgres)                | The four-statement write under an actual stop swap; removed stops deleted; stop ids and `created_at` stable across an edit; an out-of-scope update returning null                                                                                                                                                                                                                                               |
| `src/app/(app)/loads/edit-form.test.tsx` (`renderToStaticMarkup`)  | The real component renders without throwing, and every `name` the action reads is present, including `stop.id`. Needs `vi.mock` on the action module — importing it for real drags in Auth.js and `next/server`, which do not resolve outside Next's bundler                                                                                                                                                    |
| `src/app/(app)/loads/form-values.test.ts`                          | `readEditedLoad` over realistic FormData, including stop ids and a removed row                                                                                                                                                                                                                                                                                                                                  |
| `src/app/(app)/loads/edit-flow.test.ts` (real adapters + Postgres) | Confirm a draft, then edit it: the row, stable stop ids, the updated party, and the trail in `details.edits`                                                                                                                                                                                                                                                                                                    |

Then **drive it in a browser.** Sign in with a minted magic-link token (`CLAUDE.md`, "Signing in locally without the email"), open a saved load, change a field, correct an address, swap two stops, save, and read the trail on the detail page. Both bugs this module has actually had — the `"use server"` export and the carrier name-mismatch gap — were found that way and by nothing else. A green suite says nothing about render time.

## Documentation

`docs/load-intake.md` gains the edit screen, with a screenshot and the paste-ready sample that reaches it. It is the canonical walkthrough and the fastest way to hand the module to someone else.

`CLAUDE.md`'s "Deliberately not built yet" entry for editing is replaced by what is now true: editing exists, deleting does not, and status is still inferred rather than set.
