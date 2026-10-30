import { createConfirmDraft, type ConfirmDraft } from "@/domain/intake/confirm";
import { createLabelParser } from "@/domain/intake/label-parser";
import { createIntakePipeline } from "@/domain/intake/pipeline";
import { createPlainTextExtractor } from "@/domain/intake/plain-text";
import { createUpdateLoad, type UpdateLoad } from "@/domain/load/update";
import { db, type DbExecutor } from "@/db/client";
import { createCarrierRepository } from "@/db/repositories/carriers";
import { createLoadRepository } from "@/db/repositories/loads";
import { createPartyRepository } from "@/db/repositories/parties";
import { createPdfTextExtractor } from "@/integrations/pdf/pdf-text-extractor";

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

/**
 * One save is one transaction.
 *
 * Both use cases write more than one table: a facility per stop, then the load
 * and its route. Built over `db`, each of those is its own implicit
 * transaction — so a facility correction could commit for every load that
 * touches that dock while the write carrying `details.edits` failed, leaving
 * the correction live and no trail entry anywhere, behind an error message
 * implying nothing was saved. The load write can fail: a lost race on
 * `loads_brokerage_reference_key`, a dropped connection, a redeploy mid-request.
 *
 * The repositories already take an executor for the test harness's rollback
 * transaction, which is also what made this invisible to the suite —
 * `edit-flow.test.ts` wires every repository over one `tx`, so in tests the
 * whole use case already was atomic and production was the only configuration
 * that was not.
 */
function useCases(executor: DbExecutor) {
  return {
    loads: createLoadRepository(executor),
    parties: createPartyRepository(executor),
    carriers: createCarrierRepository(executor),
  };
}

export const confirmDraft: ConfirmDraft = (scope, confirmed) =>
  db.transaction((tx) => createConfirmDraft(useCases(tx))(scope, confirmed));

export const updateLoad: UpdateLoad = (scope, loadId, edited) =>
  db.transaction((tx) => createUpdateLoad(useCases(tx))(scope, loadId, edited));
