"use client";

import { useActionState } from "react";
import { initialVetFormState, vetCarrierAction } from "./actions";
import styles from "./carriers.module.css";

/**
 * The kind selector defaults to MC because that is what a rate con and a
 * carrier packet lead with. It is a default, not a constraint — pasting
 * "USDOT 1234567" into the box overrides it (see parseCarrierIdentifier).
 */
export function VetForm({ disabled = false }: { disabled?: boolean }) {
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
        <select id="kind" name="kind" className={styles.select} defaultValue="mc">
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
