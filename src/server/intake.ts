import { createConfirmDraft } from "@/domain/intake/confirm";
import { createLabelParser } from "@/domain/intake/label-parser";
import { createIntakePipeline } from "@/domain/intake/pipeline";
import { createPlainTextExtractor } from "@/domain/intake/plain-text";
import { createUpdateLoad } from "@/domain/load/update";
import { db } from "@/db/client";
import { createLoadRepository } from "@/db/repositories/loads";
import { createPartyRepository } from "@/db/repositories/parties";
import { createPdfTextExtractor } from "@/integrations/pdf/pdf-text-extractor";
import { carrierRepository } from "./carriers";

/**
 * Where load intake meets its real adapters.
 *
 * Deliberately not `server-only`, for the same reason `carriers.ts` is not:
 * nothing here reads a request. Phase 3's inbox ingestion is a plain Node
 * process that wants exactly this module, and `server-only` resolves to its
 * client-error entry outside a bundler.
 */
export const partyRepository = createPartyRepository(db);
export const loadRepository = createLoadRepository(db);

/**
 * Extractor order is the routing rule: each one declares what it supports, and
 * the first match wins. OCR slots in here when it is built — except that it
 * cannot, because it needs a job queue rather than a request. The pipeline
 * reports `needs_ocr` until then, which is the honest answer.
 */
export const runIntake = createIntakePipeline({
  extractors: [createPdfTextExtractor(), createPlainTextExtractor()],
  parser: createLabelParser(),
});

export const confirmDraft = createConfirmDraft({
  loads: loadRepository,
  parties: partyRepository,
  carriers: carrierRepository,
});

export const updateLoad = createUpdateLoad({
  loads: loadRepository,
  parties: partyRepository,
  carriers: carrierRepository,
});
