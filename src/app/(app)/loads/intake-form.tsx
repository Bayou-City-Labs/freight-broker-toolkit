"use client";

import { useActionState } from "react";
import { extractDraftAction } from "./actions";
import { initialExtractState } from "./form-state";
import { ReviewForm } from "./review-form";
import styles from "../../ui.module.css";

/**
 * Step one of intake: get the document in.
 *
 * Two ways in, because brokers receive rate cons both ways — a PDF attachment
 * and a pasted email body — and the pasted path is the one that always works.
 * It is listed first for that reason: it needs no text layer, no OCR, and no
 * upload, so it is the fallback when anything about the file goes wrong.
 *
 * Once a draft exists this component steps aside and the review form takes
 * over, holding the draft in the browser rather than parking it in a table.
 */
export function IntakeForm() {
  const [state, formAction, pending] = useActionState(
    extractDraftAction,
    initialExtractState,
  );

  if (state.status === "drafted") {
    return <ReviewForm extracted={state} />;
  }

  return (
    <form action={formAction} className={styles.intakeForm}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="text">
          Paste the rate confirmation or tender
        </label>
        <textarea
          id="text"
          name="text"
          className={styles.textarea}
          rows={12}
          placeholder={
            "CARRIER: GULF COAST HAULING LLC\nMC#: 133655\n\nPICKUP\nShipper: HOUSTON TERMINAL WAREHOUSE\n2100 Navigation Blvd, Houston, TX 77003\nDate: 10/30/2026   Time: 0800-1200"
          }
        />
        <span className={styles.hint}>
          Paste the email body or the text of the document. Columns and spacing help —
          they are what the parser reads structure from.
        </span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="file">
          Or upload a PDF
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          className={styles.fileInput}
        />
        <span className={styles.hint}>
          Digital PDFs only for now. A scan or a fax has no text layer and needs OCR,
          which is not built yet.
        </span>
      </div>

      <div className={styles.formFooter}>
        <button type="submit" className={styles.button} disabled={pending}>
          {pending ? "Reading…" : "Read the document"}
        </button>

        {state.status === "needs_ocr" && (
          <p className={styles.callout} role="status">
            {state.message}
          </p>
        )}
        {state.status === "error" && (
          <p className={styles.formError} role="alert">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
