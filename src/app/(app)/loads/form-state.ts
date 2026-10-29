import type { LoadDraft } from "@/domain/intake/load-draft";

/**
 * Form state shapes for the intake screens, and their initial values.
 *
 * Separate from `actions.ts` because a `"use server"` module may export
 * **only** async functions. An exported constant there is not a lint
 * preference: Next throws `A "use server" file can only export async
 * functions, found object` when the module is evaluated, which takes down
 * whatever rendered it. Types are erased so they would be harmless, but the
 * `initial*` values are not, and keeping both here stops the question coming
 * up again.
 */
export type ExtractState =
  | { readonly status: "idle" }
  | {
      readonly status: "drafted";
      readonly draft: LoadDraft;
      readonly filename: string | null;
      readonly textSource: "pdf-text" | "ocr" | "plain-text";
      /** Pages with no readable text, so the screen can admit what it skipped. */
      readonly unreadablePages: readonly number[];
      /** The document as text, for a reviewer checking a flagged field. */
      readonly documentText: string;
    }
  | { readonly status: "needs_ocr"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

export const initialExtractState: ExtractState = { status: "idle" };

export type ConfirmState =
  { readonly status: "idle" } | { readonly status: "error"; readonly message: string };

export const initialConfirmState: ConfirmState = { status: "idle" };
