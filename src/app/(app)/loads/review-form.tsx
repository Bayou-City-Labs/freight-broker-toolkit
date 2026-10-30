"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  CONFIDENT_ENOUGH,
  flaggedFields,
  type DraftField,
  type LoadDraft,
  type StopDraft,
  type StopKind,
} from "@/domain/intake/load-draft";
import { Money } from "@/domain/money";
import { confirmDraftAction } from "./actions";
import { Field as FieldInput } from "./field";
import { initialConfirmState, type ExtractState } from "./form-state";
import styles from "../../ui.module.css";

/**
 * The review screen: everything the parser read, every field editable, and the
 * uncertain ones marked.
 *
 * The flags are the product. An extractor that is right nine times in ten is
 * useless if a broker has to re-read the whole document to find the tenth, and
 * dangerous if they stop checking. So a low-confidence field is marked where it
 * sits, and nothing is saved until a person submits this form.
 *
 * Values live in the DOM rather than in React state. The only thing state
 * tracks is which stop rows exist, so adding or removing a stop does not
 * discard what has been typed into the others.
 */
type Drafted = Extract<ExtractState, { status: "drafted" }>;

interface StopRow {
  /** Stable across re-renders, so an uncontrolled input keeps its value. */
  readonly key: string;
  readonly kind: StopKind;
  readonly draft: StopDraft | null;
}

export function ReviewForm({ extracted }: { extracted: Drafted }) {
  const { draft } = extracted;
  const [state, formAction, pending] = useActionState(
    confirmDraftAction,
    initialConfirmState,
  );

  const [stops, setStops] = useState<StopRow[]>(() =>
    draft.stops.map((stop, index) => ({
      key: `extracted-${index}`,
      kind: stop.kind,
      draft: stop,
    })),
  );
  const [added, setAdded] = useState(0);

  const flags = new Map(flaggedFields(draft).map((flag) => [flag.path, flag]));

  function addStop(kind: StopKind) {
    setStops((current) => [...current, { key: `added-${added}`, kind, draft: null }]);
    setAdded((count) => count + 1);
  }

  function removeStop(key: string) {
    setStops((current) => current.filter((stop) => stop.key !== key));
  }

  return (
    <form action={formAction} className={styles.reviewForm}>
      <input type="hidden" name="draft" value={JSON.stringify(draft)} />
      <input type="hidden" name="textSource" value={extracted.textSource} />
      {extracted.filename && (
        <input type="hidden" name="filename" value={extracted.filename} />
      )}

      <ReviewSummary draft={draft} extracted={extracted} />

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Load</h2>
        <div className={styles.grid}>
          <Field
            name="referenceNumber"
            label="Load number"
            field={draft.loadNumber}
            flagged={flags.has("loadNumber")}
            required
            hint="Must be unique across your loads."
          />
          <Field
            name="carrierName"
            label="Carrier"
            field={draft.carrierName}
            flagged={flags.has("carrierName")}
          />
          <Field
            name="carrierMcNumber"
            label="Carrier MC number"
            field={draft.carrierMcNumber}
            flagged={flags.has("carrierMcNumber")}
          />
          <Field
            name="carrierDotNumber"
            label="Carrier USDOT number"
            field={draft.carrierDotNumber}
            flagged={flags.has("carrierDotNumber")}
          />
          <Field
            name="commodity"
            label="Commodity"
            field={draft.commodity}
            flagged={flags.has("commodity")}
          />
          <Field
            name="weightLbs"
            label="Weight (lbs)"
            field={draft.weightLbs}
            flagged={flags.has("weightLbs")}
          />
          <Field
            name="equipment"
            label="Equipment"
            field={draft.equipment}
            flagged={flags.has("equipment")}
            hint="As the document wrote it. Classified on save."
          />
          <Field
            name="carrierRateCents"
            label="Carrier rate ($)"
            field={draft.carrierRateCents}
            flagged={flags.has("carrierRateCents")}
            format={dollars}
          />
        </div>

        <CarrierVettingLink draft={draft} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Stops</h2>
        {stops.length === 0 && (
          <p className={styles.empty}>
            No stops were found. Add the pickup and delivery below — a load needs at least
            one stop.
          </p>
        )}

        {stops.map((stop, index) => (
          <StopFields
            key={stop.key}
            index={index}
            row={stop}
            flags={flags}
            onRemove={() => removeStop(stop.key)}
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
      </section>

      <details className={styles.disclosure}>
        <summary className={styles.disclosureSummary}>
          Show the document text as it was read
        </summary>
        <pre className={styles.documentText}>{extracted.documentText}</pre>
      </details>

      <div className={styles.formFooter}>
        <button type="submit" className={styles.button} disabled={pending}>
          {pending ? "Saving…" : "Save load"}
        </button>
        {state.status === "error" && (
          <p className={styles.formError} role="alert">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * What to look at, before looking at anything else.
 *
 * A count rather than a list of names: the fields are marked in place, and a
 * second list to cross-reference is a worse way to find them.
 */
function ReviewSummary({ draft, extracted }: { draft: LoadDraft; extracted: Drafted }) {
  const flags = flaggedFields(draft);
  const missing = flags.filter((flag) => flag.reason === "missing").length;
  const uncertain = flags.length - missing;

  return (
    <div className={styles.summary}>
      <p className={styles.summaryLine}>
        {flags.length === 0 ? (
          <>
            <strong>Nothing flagged.</strong> Read it over anyway — the parser does not
            know what it missed.
          </>
        ) : (
          <>
            <strong>
              {flags.length} field{flags.length === 1 ? "" : "s"} to check.
            </strong>{" "}
            {missing > 0 &&
              `${missing} required field${missing === 1 ? "" : "s"} missing`}
            {missing > 0 && uncertain > 0 && ", "}
            {uncertain > 0 && `${uncertain} read with low confidence`}.
          </>
        )}
      </p>
      <p className={styles.summaryMeta}>
        Read by {draft.producedBy} from{" "}
        {extracted.filename ? <code>{extracted.filename}</code> : "pasted text"}.
      </p>
      {extracted.unreadablePages.length > 0 && (
        <p className={styles.formError} role="status">
          Page{extracted.unreadablePages.length === 1 ? " " : "s "}
          {extracted.unreadablePages.join(", ")} had no text layer and{" "}
          {extracted.unreadablePages.length === 1 ? "was" : "were"} skipped. Anything on{" "}
          {extracted.unreadablePages.length === 1 ? "it" : "them"} is missing here.
        </p>
      )}
    </div>
  );
}

/**
 * Vetting, one click from the draft.
 *
 * A rate con names the carrier, and the moment to check them is while looking
 * at the load — not as a separate errand afterwards. The number is carried over
 * so the vetting screen does not ask for it again.
 */
function CarrierVettingLink({ draft }: { draft: LoadDraft }) {
  const mc = draft.carrierMcNumber.value;
  const dot = draft.carrierDotNumber.value;
  if (!mc && !dot) return null;

  const query = mc ? `kind=mc&number=${mc}` : `kind=dot&number=${dot}`;

  return (
    <p className={styles.inlineAction}>
      <Link href={`/carriers?${query}`} className={styles.inlineLink} target="_blank">
        Vet {draft.carrierName.value ?? "this carrier"} with FMCSA
      </Link>{" "}
      <span className={styles.hint}>Opens in a new tab, so this draft is not lost.</span>
    </p>
  );
}

const STOP_LABEL: Record<StopKind, string> = {
  pickup: "Pickup",
  delivery: "Delivery",
};

function StopFields({
  index,
  row,
  flags,
  onRemove,
}: {
  index: number;
  row: StopRow;
  flags: Map<string, unknown>;
  onRemove: () => void;
}) {
  const stop = row.draft;
  // Flags are keyed by the stop's position in the extracted draft. A row the
  // human added has no flags, and a reordered one is no longer what the parser
  // scored, which is honest: once edited, the parser's confidence is stale.
  const flagged = (name: string) => (stop ? flags.has(`stops.${index}.${name}`) : false);

  return (
    <fieldset className={styles.stopCard}>
      <legend className={styles.stopLegend}>
        {STOP_LABEL[row.kind]} {index + 1}
      </legend>

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
          field={stop?.partyName}
          flagged={flagged("partyName")}
          required
        />
        <Field
          name="stop.addressLine"
          label="Address"
          field={stop?.addressLine}
          flagged={flagged("addressLine")}
        />
        <Field
          name="stop.city"
          label="City"
          field={stop?.city}
          flagged={flagged("city")}
        />
        <Field
          name="stop.state"
          label="State"
          field={stop?.state}
          flagged={flagged("state")}
        />
        <Field
          name="stop.postalCode"
          label="ZIP"
          field={stop?.postalCode}
          flagged={flagged("postalCode")}
        />
        <Field
          name="stop.date"
          label="Date"
          field={stop?.date}
          flagged={flagged("date")}
          type="date"
        />
        <Field
          name="stop.windowStart"
          label="Window opens"
          field={stop?.windowStart}
          flagged={flagged("windowStart")}
          type="time"
          hint="Local time at the dock."
        />
        <Field
          name="stop.windowEnd"
          label="Window closes"
          field={stop?.windowEnd}
          flagged={flagged("windowEnd")}
          type="time"
        />
        <Field
          name="stop.referenceNumber"
          label="Reference number"
          field={stop?.referenceNumber}
          flagged={flagged("referenceNumber")}
        />
      </div>

      {/* What the document said about timing, kept whatever the edits above. */}
      <input
        type="hidden"
        name="stop.windowRawText"
        value={stop?.windowStart.sourceText ?? ""}
      />

      <div className={styles.rowActions}>
        <button type="button" className={styles.linkButton} onClick={onRemove}>
          Remove this stop
        </button>
      </div>
    </fieldset>
  );
}

function dollars(cents: unknown): string {
  return typeof cents === "number" ? Money.fromCents(cents).toDollarString() : "";
}

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

function describeConfidence(confidence: number): string {
  if (confidence >= CONFIDENT_ENOUGH) return "high";
  if (confidence >= 0.65) return "medium";
  return "low";
}
