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
