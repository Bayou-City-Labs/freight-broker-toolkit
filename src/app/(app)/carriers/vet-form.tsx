"use client";

import { useActionState } from "react";
import { vetCarrierAction } from "./actions";
import { initialVetFormState } from "./form-state";
import styles from "../../ui.module.css";

/**
 * The kind selector defaults to MC because that is what a rate con and a
 * carrier packet lead with. It is a default, not a constraint — pasting
 * "USDOT 1234567" into the box overrides it (see parseCarrierIdentifier).
 *
 * `defaultKind` and `defaultNumber` let another screen hand the number over
 * rather than ask for it again: the review screen links here with the carrier
 * it read off the rate con, because vetting should be one click from the draft
 * and not a separate errand.
 */
export function VetForm({
  disabled = false,
  defaultKind = "mc",
  defaultNumber = "",
}: {
  disabled?: boolean;
  defaultKind?: "mc" | "dot";
  defaultNumber?: string;
}) {
  const [state, formAction, pending] = useActionState(
    vetCarrierAction,
    initialVetFormState,
  );

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.field} style={{ flex: "0 0 9rem" }}>
        <label className={styles.label} htmlFor="kind">
          Number type
        </label>
        <select
          id="kind"
          name="kind"
          className={styles.select}
          defaultValue={defaultKind}
        >
          <option value="mc">MC</option>
          <option value="dot">USDOT</option>
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="number">
          Carrier number
        </label>
        <input
          id="number"
          name="number"
          className={styles.input}
          placeholder="MC-123456"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={defaultNumber}
          required
        />
      </div>

      <button type="submit" className={styles.button} disabled={pending || disabled}>
        {pending ? "Checking…" : "Run check"}
      </button>

      {state.status !== "idle" && (
        <p className={styles.formError} role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
