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
