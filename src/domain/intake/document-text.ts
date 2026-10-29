/**
 * A document reduced to positioned text, before anyone tries to understand it.
 *
 * This is the boundary between the text stage and the structure stage. Both a
 * PDF text layer and OCR produce this shape, so a parser written against it
 * does not care which one ran — which is the point, since the same rate con
 * can arrive as a clean PDF from one customer and a fax from the next.
 */

/** Where the text came from. OCR output carries transcription error; a PDF text layer does not. */
export type TextSource = "pdf-text" | "ocr" | "plain-text";

export interface TextItem {
  readonly text: string;
  /** Left edge, in points from the page's left edge. */
  readonly x: number;
  /**
   * Top edge, in points from the page's **top** edge.
   *
   * PDF's native coordinate space has its origin at the bottom-left, so this
   * is flipped at the adapter boundary. Everything above the adapter reasons
   * top-down, the way a person reads a page and the way a template describes
   * one.
   */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
}

export interface TextPage {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly items: readonly TextItem[];
  /**
   * Fraction of the page covered by images, 0–1, when the source can report
   * it. Absent for pasted text, which has no images by definition.
   *
   * Carried because "has no text" is not the only shape a scan takes: a faxed
   * rate con often arrives as one full-page image with a transmission footer
   * stamped over it, and that footer is text.
   */
  readonly imageCoverage?: number;
}

export interface DocumentText {
  readonly pages: readonly TextPage[];
  readonly source: TextSource;
}

/** A run of items sharing a baseline, assembled back into readable text. */
export interface TextLine {
  readonly pageNumber: number;
  /** Top edge of the line, in points from the page top. */
  readonly y: number;
  readonly text: string;
  readonly items: readonly TextItem[];
}

/**
 * Items are emitted as fragments — "ACME", " ", "LOGISTICS" are three items —
 * so anything that wants to match a label against a value has to rebuild lines
 * first. A fraction of font size is used as the row tolerance rather than a
 * fixed number of points, so the grouping holds for a dense 7pt table and a
 * 24pt heading alike.
 */
const ROW_TOLERANCE_RATIO = 0.5;

/** Below this fraction of the font size, a gap between items is kerning, not a space. */
const SPACE_GAP_RATIO = 0.25;

export function toLines(page: TextPage): TextLine[] {
  const items = [...page.items]
    .filter((item) => item.text.length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: TextItem[][] = [];
  for (const item of items) {
    const row = rows.at(-1);
    const tolerance = Math.max(item.fontSize, 1) * ROW_TOLERANCE_RATIO;
    // Compared against the row's first item rather than a running average, so
    // a tall item mid-line can't drag the baseline and split the row.
    if (row && Math.abs(row[0].y - item.y) <= tolerance) {
      row.push(item);
    } else {
      rows.push([item]);
    }
  }

  return rows.map((row) => {
    const ordered = [...row].sort((a, b) => a.x - b.x);
    return {
      pageNumber: page.pageNumber,
      y: Math.min(...ordered.map((item) => item.y)),
      text: joinRow(ordered),
      items: ordered,
    };
  });
}

function joinRow(ordered: readonly TextItem[]): string {
  let out = "";
  let previousRight: number | null = null;

  for (const item of ordered) {
    if (previousRight !== null) {
      const gap = item.x - previousRight;
      const needsSpace =
        gap > Math.max(item.fontSize, 1) * SPACE_GAP_RATIO &&
        !out.endsWith(" ") &&
        !item.text.startsWith(" ");
      if (needsSpace) out += " ";
    }
    out += item.text;
    previousRight = item.x + item.width;
  }

  // Columns separated by wide whitespace collapse to a single space. Position
  // is still on every item for anything that needs the original geometry.
  return out.replace(/\s+/g, " ").trim();
}

/**
 * A gap this many times the font size is a column break rather than a word
 * space. A word space runs about 0.25–0.35em, so there is a wide margin here;
 * what it has to separate is "Load #: 884213" from the "Date: 10/28/2026"
 * sitting ten spaces away on the same row.
 */
const COLUMN_GAP_RATIO = 1.5;

/**
 * Splits a line where the layout put a column break.
 *
 * `toLines` deliberately renders a column gap as a single space, keeping
 * geometry on the items instead of encoding it in whitespace. That makes the
 * text easy to match against and loses the one thing a parser needs when a
 * rate con puts two fields on one row: where the first value ends. This is how
 * that gets read back, from the positions rather than from the string.
 *
 * A line with no wide gaps comes back as itself, so callers can always treat
 * the result as the list of columns.
 */
export function toColumns(line: TextLine): TextLine[] {
  const groups: TextItem[][] = [];

  for (const item of line.items) {
    const current = groups.at(-1);
    const previous = current?.at(-1);

    if (!current || !previous) {
      groups.push([item]);
      continue;
    }

    const gap = item.x - (previous.x + previous.width);
    if (gap > Math.max(item.fontSize, 1) * COLUMN_GAP_RATIO) {
      groups.push([item]);
    } else {
      current.push(item);
    }
  }

  return groups.map((items) => ({
    pageNumber: line.pageNumber,
    y: Math.min(...items.map((item) => item.y)),
    text: joinRow(items),
    items,
  }));
}

/** Every line in the document, pages in order. */
export function allLines(document: DocumentText): TextLine[] {
  return document.pages.flatMap(toLines);
}

/** Plain text for the whole document — for logging, diffing, and LLM fallbacks. */
export function toPlainText(document: DocumentText): string {
  return document.pages
    .map((page) =>
      toLines(page)
        .map((line) => line.text)
        .join("\n"),
    )
    .join("\n\n");
}

/**
 * A page covered by an image this much is a picture of a document, not a
 * document with a picture on it.
 */
const SCAN_IMAGE_COVERAGE = 0.5;

/**
 * Below this many characters, a mostly-image page is carrying a stamp or a
 * footer rather than content. A real rate con page runs to hundreds.
 */
const SCAN_TEXT_LENGTH = 32;

/**
 * True when a page carries no usable text layer — the signature of a scan or a
 * fax, which needs OCR rather than a parser that will silently find nothing.
 *
 * Two shapes, not one. The obvious case is a page with no text at all. The
 * case that bites is a faxed page: one full-page image with "RECEIVED
 * 11/02/2026 08:14 PAGE 1/3" stamped across the top by the fax machine. That
 * page has text, so a test for emptiness passes it through to a parser that
 * then finds nothing and reports an empty draft — the failure mode that looks
 * like a bad parser rather than an unread document.
 */
export function pageNeedsOcr(page: TextPage): boolean {
  const textLength = page.items.reduce(
    (total, item) => total + item.text.trim().length,
    0,
  );
  if (textLength === 0) return true;

  return (
    (page.imageCoverage ?? 0) >= SCAN_IMAGE_COVERAGE && textLength < SCAN_TEXT_LENGTH
  );
}
