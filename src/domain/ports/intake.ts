import type { DocumentText } from "../intake/document-text";
import type { LoadDraft } from "../intake/load-draft";

/**
 * Load intake, as two stages.
 *
 * This replaces the single `Extractor` port from the foundation, which took a
 * zod schema and returned the parsed value — an LLM-shaped interface. Intake
 * is local-first, so the work splits in two: getting text off the page, and
 * understanding it. Separating them means the hard, slow, failure-prone half
 * (OCR) is swappable without touching the half that reads meaning, and a
 * parser can be tested against positioned text without a PDF anywhere near it.
 *
 * An LLM fallback, when one is enabled, implements `StructureParser` like any
 * other — it is one more way to get from text to a draft, not a special case.
 */

export type DocumentInput =
  | { readonly kind: "pdf"; readonly bytes: Uint8Array; readonly filename: string }
  /** A pasted email body. No geometry, but no OCR risk either. */
  | { readonly kind: "text"; readonly text: string };

/** Stage one: document bytes in, positioned text out. */
export interface TextExtractor {
  extract(input: DocumentInput): Promise<DocumentText>;
  /** Whether this extractor can handle the input at all, checked before extracting. */
  supports(input: DocumentInput): boolean;
}

/** Stage two: positioned text in, an unconfirmed draft out. */
export interface StructureParser {
  /** Stable identifier, recorded on the draft so parsers can be compared. */
  readonly name: string;
  parse(text: DocumentText): Promise<LoadDraft>;
}

/**
 * The document could not be turned into text.
 *
 * Distinct from "text came back empty", which is a finding — an image-only
 * PDF that needs OCR — rather than a failure. The caller must be able to tell
 * "this is a scan" from "this file is corrupt", because only one of them is
 * worth retrying down another path.
 */
export class TextExtractionError extends Error {
  readonly kind: TextExtractionErrorKind;

  constructor(kind: TextExtractionErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TextExtractionError";
    this.kind = kind;
  }
}

export type TextExtractionErrorKind =
  /** Not a PDF, or a PDF we cannot open. */
  | "unreadable"
  /** Password-protected. */
  | "encrypted"
  /** Larger than we are willing to process in a request. */
  | "too_large"
  | "unsupported_input";
