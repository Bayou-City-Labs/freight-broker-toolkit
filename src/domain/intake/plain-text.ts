import {
  TextExtractionError,
  type DocumentInput,
  type TextExtractor,
} from "../ports/intake";
import type { DocumentText, TextItem, TextPage } from "./document-text";

/**
 * Pasted text, given the same shape a PDF gets.
 *
 * A broker forwarding a tender out of Outlook is the most common intake there
 * is, and it has no geometry at all. Rather than giving the structure stage a
 * second input type to handle, the text is laid out on a synthetic page: one
 * item per line, at a plausible x and y. The parser then works on pasted email
 * and on a PDF with the same code, and the line-assembly logic every parser
 * depends on is exercised by both.
 *
 * Lives in the domain rather than `src/integrations/` despite implementing an
 * adapter's port: there is no vendor here, nothing to mock, and no I/O — just
 * string handling that belongs with the parsers that consume it.
 */
export const PLAIN_TEXT_EXTRACTOR = "plain-text";

/** US Letter at 72dpi, matching what a PDF of the same document would report. */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

const FONT_SIZE = 10;
/** Comfortably more than the row tolerance in `toLines`, so lines stay distinct. */
const LINE_HEIGHT = 14;
const MARGIN = 36;

/** Enough to catch a pasted carrier packet; far more than any tender email. */
const MAX_CHARS = 2_000_000;

export function createPlainTextExtractor(): TextExtractor {
  return {
    supports(input: DocumentInput): boolean {
      return input.kind === "text";
    },

    // `async` rather than a plain function returning a promise: the port's
    // failures have to arrive as rejections. Throwing synchronously from a
    // method typed as returning a Promise is invisible to a caller using
    // `.catch()`, and the PDF extractor beside it rejects.
    async extract(input: DocumentInput): Promise<DocumentText> {
      if (input.kind !== "text") {
        throw new TextExtractionError(
          "unsupported_input",
          "The plain-text extractor was given a document, not text.",
        );
      }
      if (input.text.length > MAX_CHARS) {
        throw new TextExtractionError(
          "too_large",
          "That is more text than a rate confirmation could plausibly be.",
        );
      }

      return { pages: [toPage(input.text)], source: "plain-text" };
    },
  };
}

/** Width of one character, treating the text as monospaced. */
const CHAR_WIDTH = FONT_SIZE * 0.5;

function toPage(text: string): TextPage {
  const items: TextItem[] = [];
  let y = MARGIN;

  // Blank lines advance the cursor without emitting an item, so the vertical
  // gaps an email uses to separate a pickup block from a delivery block
  // survive.
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    // One item per whitespace-separated token, positioned by character offset,
    // rather than one item per line. That reproduces the fragmentation a PDF
    // text layer has, which matters for more than symmetry: a run of spaces
    // becomes a wide x-gap, so a pasted rate con with two fields on a row is
    // readable by exactly the same column logic as the PDF version. One item
    // per line would hide that geometry and leave the structure stage with two
    // different worlds to handle.
    for (const match of line.matchAll(/\S+/g)) {
      items.push({
        text: match[0],
        x: MARGIN + match.index * CHAR_WIDTH,
        y,
        width: match[0].length * CHAR_WIDTH,
        height: FONT_SIZE,
        fontSize: FONT_SIZE,
      });
    }
    y += LINE_HEIGHT;
  }

  return { pageNumber: 1, width: PAGE_WIDTH, height: PAGE_HEIGHT, items };
}
