import { allLines, toColumns, type DocumentText, type TextLine } from "./document-text";
import {
  emptyDraft,
  field,
  missing,
  type DraftField,
  type LoadDraft,
  type StopDraft,
  type StopKind,
} from "./load-draft";
import {
  parseCityStateZip,
  parseDate,
  parseIdentifierDigits,
  parseMoneyCents,
  parseTimeRange,
  parseWeightLbs,
} from "./parse-values";

/**
 * A layout-independent parser: find a label, take the value next to it.
 *
 * This is the baseline, not the destination. It knows nothing about any
 * particular document, which means it works on the first rate con from a new
 * customer and works mediocrely on all of them. Per-layout templates should
 * beat it — and the point of having this is that "beat it" becomes a
 * measurable claim rather than an assumption.
 *
 * Confidence is deliberately pitched so that a labelled, cleanly parsed value
 * clears review and everything inferred by position does not. A generic
 * parser that marked its guesses as certain would be worse than no parser.
 */
export const LABEL_PARSER = "label-proximity-v1";

/** A label sat next to the value on the same line. The strongest signal here. */
const SAME_LINE = 0.9;
/** The label's line held no value, so the line beneath it was used. */
const NEXT_LINE = 0.7;
/** No label at all — found by shape, or by position within a section. */
const INFERRED = 0.55;

export function createLabelParser() {
  return {
    name: LABEL_PARSER,
    parse(text: DocumentText): Promise<LoadDraft> {
      return Promise.resolve(parseLines(allLines(text)));
    },
  };
}

export function parseLines(lines: readonly TextLine[]): LoadDraft {
  const sections = splitIntoSections(lines);

  return {
    ...emptyDraft(LABEL_PARSER),
    loadNumber: labelled(
      lines,
      /\b(?:load|order|pro|shipment)\s*#?\s*(?:number)?/i,
      (v) => v.trim() || null,
    ),
    carrierName: labelled(lines, /\bcarrier\b(?!\s*(?:mc|dot|pay|rate))/i, cleanName),
    carrierMcNumber: labelled(
      lines,
      /\b(?:mc|motor carrier)\s*#?/i,
      parseIdentifierDigits,
    ),
    carrierDotNumber: labelled(
      lines,
      /\b(?:us\s*dot|usdot|dot)\s*#?/i,
      parseIdentifierDigits,
    ),
    commodity: labelled(lines, /\b(?:commodity|freight|product)\b/i, cleanName),
    weightLbs: labelled(lines, /\bweight\b/i, parseWeightLbs),
    equipment: labelled(lines, /\b(?:equipment|trailer|equip)\b/i, cleanName),
    carrierRateCents: labelled(
      lines,
      /\b(?:total rate|carrier pay|line\s*haul|agreed rate|rate)\b/i,
      parseMoneyCents,
    ),
    stops: sections.map(parseStop),
  };
}

// --- Labels ---------------------------------------------------------------

interface LabelHit {
  /**
   * Candidate values on the label's own row, nearest first: the rest of the
   * label's own column, then any later column that is not itself labelled.
   *
   * Two layouts, one list. "Load #: 884213   Date: 10/28/2026" puts the value
   * in the label's column, and taking the whole row would let the load number
   * swallow the date — which the date parser then finds and reports as a
   * confident wrong answer. "Total Rate:        $2,450.00" right-aligns the
   * value into the *next* column, and stopping at the label's own column would
   * miss it entirely. Both are common; neither can be read from the string
   * alone, because `toLines` renders both gaps as one space.
   */
  readonly sameRow: readonly string[];
  readonly line: TextLine;
  readonly next: TextLine | null;
}

/**
 * Every place a label appears, in document order.
 *
 * All of them, not the first: "RATE CONFIRMATION" in a heading matches a rate
 * label and yields nothing parseable, and the real total is further down. The
 * caller walks the hits until one produces a value.
 */
function findLabel(lines: readonly TextLine[], label: RegExp): LabelHit[] {
  const pattern = new RegExp(label.source, label.flags.replace("g", ""));
  const hits: LabelHit[] = [];

  lines.forEach((line, index) => {
    const columns = toColumns(line);

    columns.forEach((column, columnIndex) => {
      const match = pattern.exec(column.text);
      if (!match) return;

      const own = column.text
        .slice(match.index + match[0].length)
        .replace(/^\s*[:#-]\s*/, "")
        .trim();

      const later = columns
        .slice(columnIndex + 1)
        // A column that opens with its own label belongs to that field, not
        // this one — otherwise "Equipment:" picks up the "Temp: -10" beside it.
        .filter((other) => !OPENS_WITH_LABEL.test(other.text))
        .map((other) => other.text.trim());

      hits.push({
        sameRow: [own, ...later].filter((value) => value.length > 0),
        line,
        next: lines[index + 1] ?? null,
      });
    });
  });

  return hits;
}

const OPENS_WITH_LABEL = /^\s*[A-Za-z][A-Za-z ]{0,20}#?\s*:/;

/**
 * The first hit that yields a parseable value, preferring the label's own row
 * over the line beneath it.
 */
function labelled<T>(
  lines: readonly TextLine[],
  label: RegExp,
  parse: (value: string) => T | null,
): DraftField<T> {
  for (const hit of findLabel(lines, label)) {
    for (const candidate of hit.sameRow) {
      const value = parse(candidate);
      if (value !== null) return field(value, SAME_LINE, hit.line.text);
    }
    // A label alone on its row — "CARRIER" above the name — is common enough
    // to be worth following, but it is a weaker claim.
    if (hit.sameRow.length === 0 && hit.next) {
      const value = parse(hit.next.text);
      if (value !== null) return field(value, NEXT_LINE, hit.next.text);
    }
  }
  return missing<T>();
}

function cleanName(value: string): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

// --- Stops ----------------------------------------------------------------

/**
 * Section markers come in two strengths, and conflating them doubles every
 * stop.
 *
 * A heading announces a section: "PICKUP", "DELIVERY", "ORIGIN". A party label
 * names the company inside one: "Shipper:", "Consignee:". Most rate cons carry
 * both, one under the other — and a rule that treats "Shipper:" as a section
 * start then reads that layout as four stops instead of two.
 *
 * So headings are tried first, and party labels are promoted to section starts
 * only for documents that have no headings at all, which is the shape a pasted
 * tender email usually has.
 */
/**
 * The `(?!\s*#)` matters: "PICKUP #: 4471" is a reference number *inside* a
 * pickup block, not the start of another one. Without it a rate con that
 * numbers its stops gets a phantom section per stop, and the reference never
 * reaches the stop it belongs to.
 */
const PICKUP_HEADING = /^\s*(?:pick\s*-?\s*up|pickup|origin|pu)\b(?!\s*#)/i;
const DELIVERY_HEADING =
  /^\s*(?:delivery|deliver\s*to|destination|drop)\b(?!\s*#)|^\s*consignee\s*$/i;

const PICKUP_PARTY = /^\s*shipper\b/i;
const DELIVERY_PARTY = /^\s*(?:consignee|receiver)\b/i;

interface Section {
  readonly kind: StopKind;
  readonly sequence: number;
  readonly lines: readonly TextLine[];
}

/**
 * Splits the document at pickup and delivery headings.
 *
 * Section order is document order, which is what `sequence` records. That is
 * an assumption — a rate con listing stops out of order would be mis-sequenced
 * — but it holds for every layout seen so far, and the review screen lets a
 * person reorder.
 */
function splitIntoSections(lines: readonly TextLine[]): Section[] {
  const starts =
    findStarts(lines, PICKUP_HEADING, DELIVERY_HEADING) ??
    findStarts(lines, PICKUP_PARTY, DELIVERY_PARTY) ??
    [];

  return starts.map((start, i) => ({
    kind: start.kind,
    sequence: i,
    // Up to the next heading, or the end of the document.
    lines: lines.slice(start.index, starts[i + 1]?.index ?? lines.length),
  }));
}

/** Null when neither pattern matched, so the caller can try weaker markers. */
function findStarts(
  lines: readonly TextLine[],
  pickup: RegExp,
  delivery: RegExp,
): Array<{ kind: StopKind; index: number }> | null {
  const starts: Array<{ kind: StopKind; index: number }> = [];

  lines.forEach((line, index) => {
    if (pickup.test(line.text)) starts.push({ kind: "pickup", index });
    else if (delivery.test(line.text)) starts.push({ kind: "delivery", index });
  });

  return starts.length > 0 ? starts : null;
}

function parseStop(section: Section): StopDraft {
  const { lines, kind, sequence } = section;
  const body = lines.slice(1);

  const window = firstTimeRange(lines);
  const address = firstAddress(body);

  return {
    kind,
    sequence,
    partyName: partyName(lines, body),
    addressLine: address.line,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    date: labelled(lines, /\b(?:date|pu date|del date|appt|appointment)\b/i, parseDate),
    windowStart: window.start,
    windowEnd: window.end,
    referenceNumber: labelled(
      lines,
      // The trailing \b is load-bearing: without it "po" matches inside
      // "Port Rd, Beaumont" and the street address becomes the reference
      // number. Short label abbreviations need both edges anchored.
      /\b(?:ref|reference|po|bol|confirmation)\b\s*#?|\bpickup\s*#/i,
      (v) => cleanName(v),
    ),
  };
}

/**
 * A labelled name wins. Failing that, the line under the heading is usually
 * the company — true often enough to be worth offering, never confident
 * enough to skip review.
 */
function partyName(
  lines: readonly TextLine[],
  body: readonly TextLine[],
): DraftField<string> {
  const labelledName = labelled(
    lines,
    /\b(?:shipper|consignee|customer|company|name|facility)\b/i,
    cleanName,
  );
  if (labelledName.value !== null) return labelledName;

  const candidate = body.find((line) => looksLikeName(line.text));
  return candidate
    ? field(cleanName(candidate.text), INFERRED, candidate.text)
    : missing();
}

function looksLikeName(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;
  // Not a street address, not a date/time row.
  if (/^\d/.test(trimmed)) return false;
  if (parseDate(trimmed) !== null) return false;
  return /[A-Za-z]{3}/.test(trimmed);
}

interface AddressParts {
  readonly line: DraftField<string>;
  readonly city: DraftField<string>;
  readonly state: DraftField<string>;
  readonly postalCode: DraftField<string>;
}

/** The first line carrying a `City, ST ZIP` tail is taken as the address. */
function firstAddress(body: readonly TextLine[]): AddressParts {
  for (const line of body) {
    const parsed = parseCityStateZip(line.text);
    if (parsed.city === null || parsed.state === null) continue;

    return {
      line: field(cleanName(line.text), INFERRED, line.text),
      city: field(parsed.city, INFERRED, line.text),
      state: field(parsed.state, INFERRED, line.text),
      postalCode:
        parsed.postalCode === null
          ? missing<string>()
          : field(parsed.postalCode, INFERRED, line.text),
    };
  }

  return {
    line: missing(),
    city: missing(),
    state: missing(),
    postalCode: missing(),
  };
}

function firstTimeRange(lines: readonly TextLine[]): {
  start: DraftField<string>;
  end: DraftField<string>;
} {
  const labelHits = findLabel(lines, /\b(?:time|window|hours|appt|appointment)\b/i);

  for (const hit of labelHits) {
    for (const candidate of hit.sameRow) {
      const range = parseTimeRange(candidate);
      if (range) {
        return {
          start: field(range.start, SAME_LINE, hit.line.text),
          end:
            range.end === null
              ? missing<string>()
              : field(range.end, SAME_LINE, hit.line.text),
        };
      }
    }
  }

  // No "Time:" label — fall back to any line carrying something clock-shaped.
  for (const line of lines) {
    const range = parseTimeRange(line.text);
    if (range) {
      return {
        start: field(range.start, INFERRED, line.text),
        end:
          range.end === null ? missing<string>() : field(range.end, INFERRED, line.text),
      };
    }
  }

  return { start: missing(), end: missing() };
}
