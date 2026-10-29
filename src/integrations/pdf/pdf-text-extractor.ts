import { extractTextItems, getDocumentProxy, inspectPages } from "unpdf";
import type { DocumentText, TextItem, TextPage } from "@/domain/intake/document-text";
import {
  TextExtractionError,
  type DocumentInput,
  type TextExtractor,
} from "@/domain/ports/intake";

/**
 * Reads the text layer out of a digital PDF, with positions.
 *
 * Does **not** do OCR. A scanned or faxed rate con has no text layer, and this
 * returns pages with no items rather than guessing — `pageNeedsOcr` then
 * routes it. Keeping that decision out of here is what lets the OCR path,
 * which needs a job queue, live somewhere else entirely.
 */
export const PDF_TEXT_EXTRACTOR = "pdf-text";

/**
 * Rate confirmations are one to three pages. Anything much larger is a
 * carrier packet or a mis-drop, and parsing it in a request is not worth the
 * memory — the cap fails fast instead of timing out.
 */
const MAX_BYTES = 15 * 1024 * 1024;

export function createPdfTextExtractor(): TextExtractor {
  return {
    supports(input: DocumentInput): boolean {
      return input.kind === "pdf";
    },

    async extract(input: DocumentInput): Promise<DocumentText> {
      if (input.kind !== "pdf") {
        throw new TextExtractionError(
          "unsupported_input",
          "The PDF extractor was given something that is not a PDF.",
        );
      }
      if (input.bytes.byteLength > MAX_BYTES) {
        throw new TextExtractionError(
          "too_large",
          `${input.filename} is ${Math.round(input.bytes.byteLength / 1_000_000)}MB; the limit is ${MAX_BYTES / 1_000_000}MB.`,
        );
      }

      // One parse, reused for both the items and the page geometry. unpdf
      // consumes the buffer it is handed, so the proxy is the shared handle.
      const document = await openDocument(input);

      try {
        const { items } = await extractTextItems(document);
        // How much of each page is image. A faxed rate con is one full-page
        // image with a transmission footer stamped on it, which has a text
        // layer and still needs OCR — see `pageNeedsOcr`. Best-effort: losing
        // the signal degrades scan detection, it must not fail an extraction
        // that otherwise worked.
        const inspected = await inspectPages(document)
          .then((result) => result.pages)
          .catch(() => []);

        const pages: TextPage[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          const page = await document.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          const coverage = inspected[pageNumber - 1]?.imageCoverage;
          pages.push({
            pageNumber,
            width: viewport.width,
            height: viewport.height,
            items: (items[pageNumber - 1] ?? []).map((item) =>
              toTextItem(item, viewport.height),
            ),
            ...(typeof coverage === "number" ? { imageCoverage: coverage } : {}),
          });
        }

        return { pages, source: "pdf-text" };
      } finally {
        // `PDFDocumentProxy` has no `destroy`: `cleanup` releases per-page
        // resources, and tearing down the worker goes through the loading
        // task. Both are best-effort — failing to free memory must not turn a
        // successful extraction into an error.
        await document.cleanup().catch(() => undefined);
        await document.loadingTask?.destroy().catch(() => undefined);
      }
    },
  };
}

async function openDocument(input: Extract<DocumentInput, { kind: "pdf" }>) {
  try {
    return await getDocumentProxy(input.bytes);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (/password/i.test(message)) {
      throw new TextExtractionError(
        "encrypted",
        `${input.filename} is password-protected.`,
        { cause },
      );
    }
    throw new TextExtractionError(
      "unreadable",
      `${input.filename} could not be read as a PDF.`,
      { cause },
    );
  }
}

interface UnpdfTextItem {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
}

/**
 * PDF coordinates put the origin at the bottom-left and measure y upward;
 * `TextItem.y` is the distance from the top of the page. The flip happens
 * here, at the adapter boundary, so nothing above it has to think in two
 * coordinate systems.
 *
 * `item.y` is the text baseline, so the item's height is subtracted to get its
 * top edge — otherwise lines group against the wrong row on dense layouts.
 */
function toTextItem(item: UnpdfTextItem, pageHeight: number): TextItem {
  return {
    text: item.str,
    x: item.x,
    y: pageHeight - item.y - item.height,
    width: item.width,
    height: item.height,
    fontSize: item.fontSize,
  };
}
