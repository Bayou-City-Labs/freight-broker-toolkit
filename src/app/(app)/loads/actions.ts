"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toPlainText } from "@/domain/intake/document-text";
import { textExtractionMessage } from "@/domain/intake/pipeline";
import { TextExtractionError, type DocumentInput } from "@/domain/ports/intake";
import { confirmDraft, runIntake } from "@/server/intake";
import { getCurrentBrokerage } from "@/server/tenant";
import type { ConfirmState, ExtractState } from "./form-state";
import { readConfirmedLoad } from "./form-values";

/**
 * Intake is two round trips, and the draft lives on the client in between.
 *
 * Extract, review, confirm. The draft is handed back to the browser and posted
 * again with the human's edits rather than parked in a table: a draft nobody
 * confirms has no value — re-running the extractor is cheap and deterministic
 * — and a `load_drafts` table would be a schema commitment made to serve a
 * screen rather than a question anyone asks of the data.
 *
 * Both actions check the session themselves. The route group's layout does not
 * run for a server action, so it is no guard at all here.
 */

/** Enough text for a reviewer to check a field against; not a whole packet. */
const MAX_DISPLAYED_TEXT = 40_000;

export async function extractDraftAction(
  _previous: ExtractState,
  formData: FormData,
): Promise<ExtractState> {
  const scope = await getCurrentBrokerage();
  if (!scope)
    return { status: "error", message: "You are not signed in to a brokerage." };

  const input = await toDocumentInput(formData);
  if (!input) {
    return {
      status: "error",
      message: "Paste the text of the document, or choose a PDF to upload.",
    };
  }

  let result;
  try {
    result = await runIntake(input);
  } catch (error) {
    if (error instanceof TextExtractionError) {
      return { status: "error", message: textExtractionMessage(error) };
    }
    throw error;
  }

  if (result.status === "unsupported") {
    return {
      status: "error",
      message: "That kind of file cannot be read yet. Paste the text instead.",
    };
  }

  if (result.status === "needs_ocr") {
    return {
      status: "needs_ocr",
      message:
        result.pageCount === 1
          ? "That page has no text layer, so it is a scan or a fax. Reading those needs OCR, which is not built yet — paste the details in as text for now."
          : `All ${result.pageCount} pages have no text layer, so this is a scan or a fax. Reading those needs OCR, which is not built yet — paste the details in as text for now.`,
    };
  }

  return {
    status: "drafted",
    draft: result.draft,
    filename: input.kind === "pdf" ? input.filename : null,
    textSource: result.text.source,
    unreadablePages: result.unreadablePages,
    documentText: toPlainText(result.text).slice(0, MAX_DISPLAYED_TEXT),
  };
}

async function toDocumentInput(formData: FormData): Promise<DocumentInput | null> {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    return {
      kind: "pdf",
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
    };
  }

  const pasted = String(formData.get("text") ?? "").trim();
  return pasted.length > 0 ? { kind: "text", text: pasted } : null;
}

// --- Confirming ----------------------------------------------------------

export async function confirmDraftAction(
  _previous: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const scope = await getCurrentBrokerage();
  if (!scope)
    return { status: "error", message: "You are not signed in to a brokerage." };

  const read = readConfirmedLoad(formData);
  if (!read.ok) return { status: "error", message: read.message };

  const outcome = await confirmDraft(scope, read.confirmed);

  if (outcome.status === "duplicate_reference") {
    return {
      status: "error",
      message: `Load ${outcome.existing.referenceNumber} already exists. Change the load number, or open the existing load.`,
    };
  }

  revalidatePath("/loads");
  redirect(`/loads/${outcome.load.id}`);
}
