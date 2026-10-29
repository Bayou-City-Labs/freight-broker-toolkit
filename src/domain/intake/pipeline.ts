import type { DocumentInput, StructureParser, TextExtractor } from "../ports/intake";
import { TextExtractionError } from "../ports/intake";
import { pageNeedsOcr, type DocumentText } from "./document-text";
import type { LoadDraft } from "./load-draft";

/**
 * The two stages, run in order: text off the page, then meaning out of the
 * text.
 *
 * Thin on purpose. The value of having it at all is that the decision points
 * between the stages — which extractor handles this input, is this a scan, was
 * any of it unreadable — are in one place that can be tested without a PDF or
 * a request, instead of spread through a server action.
 */
export interface IntakePipelineDeps {
  /** Tried in order; the first that `supports` the input runs. */
  readonly extractors: readonly TextExtractor[];
  readonly parser: StructureParser;
}

export type IntakeResult =
  | {
      readonly status: "drafted";
      readonly draft: LoadDraft;
      readonly text: DocumentText;
      /**
       * Pages that carried no readable text. Empty in the normal case. A
       * non-empty list on an otherwise successful read means part of the
       * document was skipped, which the review screen has to say — a draft
       * missing the fields that were on page 2 otherwise looks like a parser
       * failure.
       */
      readonly unreadablePages: readonly number[];
    }
  /**
   * The document is a scan, and OCR is not built. A distinct outcome rather
   * than an error: nothing is wrong with the file, we simply cannot read this
   * one yet, and the two need different words on screen.
   */
  | { readonly status: "needs_ocr"; readonly pageCount: number }
  /** Nothing here handles this input at all. */
  | { readonly status: "unsupported" };

export type RunIntake = (input: DocumentInput) => Promise<IntakeResult>;

export function createIntakePipeline({
  extractors,
  parser,
}: IntakePipelineDeps): RunIntake {
  return async function runIntake(input) {
    const extractor = extractors.find((candidate) => candidate.supports(input));
    if (!extractor) return { status: "unsupported" };

    // A TextExtractionError propagates: a corrupt or encrypted file is a
    // failure the caller has to report in its own words, the same way a failed
    // carrier lookup does. Only conditions that are findings, not failures,
    // come back as a status.
    const text = await extractor.extract(input);

    const unreadablePages = text.pages
      .filter((page) => pageNeedsOcr(page))
      .map((page) => page.pageNumber);

    // Every page unreadable is a scan. Some pages unreadable is a mixed
    // document — a digital rate con with a signed page photographed onto the
    // end — which is worth parsing for what it does have.
    if (text.pages.length > 0 && unreadablePages.length === text.pages.length) {
      return { status: "needs_ocr", pageCount: text.pages.length };
    }

    return {
      status: "drafted",
      draft: await parser.parse(text),
      text,
      unreadablePages,
    };
  };
}

/** The words to put on screen when the text stage could not read a file. */
export function textExtractionMessage(error: TextExtractionError): string {
  switch (error.kind) {
    case "encrypted":
      return "That PDF is password-protected. Save an unlocked copy and try again.";
    case "too_large":
      return error.message;
    case "unreadable":
      return "That file could not be read as a PDF. If it came from a scanner, try exporting it again.";
    case "unsupported_input":
      return "That kind of file cannot be read yet. Paste the text instead.";
  }
}
