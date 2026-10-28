import type { z } from "zod";

/**
 * Turning an unstructured document into a structured record.
 *
 * The provider and model are deliberately not decided here. Load intake is not
 * built yet, and the choice should be made against real rate confirmations
 * rather than in advance. What matters at the foundation is the shape of the
 * boundary: extraction output is never trusted, it is schema-validated, it
 * carries the provenance needed to audit it, and a human confirms it before
 * it becomes a load.
 */
export type ExtractionSource =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "pdf"; readonly bytes: Uint8Array; readonly filename: string };

export interface ExtractionRequest<T> {
  readonly source: ExtractionSource;
  /** The contract the output must satisfy. Validation is not optional. */
  readonly schema: z.ZodType<T>;
  /** Task-specific guidance for the extractor. */
  readonly instructions?: string;
}

export interface ExtractionSuccess<T> {
  readonly ok: true;
  readonly data: T;
  /** Identifier of the model or rules engine that produced this, for audit. */
  readonly producedBy: string;
  /** Unvalidated provider response, retained so a bad extraction can be diagnosed. */
  readonly raw: unknown;
}

export interface ExtractionFailure {
  readonly ok: false;
  readonly reason: "schema_validation_failed" | "unreadable_source" | "provider_error";
  readonly message: string;
  readonly raw: unknown;
}

export type ExtractionResult<T> = ExtractionSuccess<T> | ExtractionFailure;

export interface Extractor {
  extract<T>(request: ExtractionRequest<T>): Promise<ExtractionResult<T>>;
}
