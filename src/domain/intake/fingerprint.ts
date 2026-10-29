import { createHash } from "node:crypto";
import { toColumns, toLines, type DocumentText, type TextPage } from "./document-text";

/**
 * A layout's identity, independent of what it says.
 *
 * Two rate cons out of the same TMS carry different carriers, dates and rates
 * but put their labels in the same places. A fingerprint is what is left when
 * the values are stripped out: which label words appear, and roughly where.
 * Matching ones mean one template can read both.
 *
 * This is the instrument for the question the module's business case rests on
 * — whether layouts cluster by TMS vendor or by shipper. It is deliberately
 * not wired into the parser yet: template selection by fingerprint is the
 * fourth build step, and choosing a similarity threshold before seeing real
 * documents would be guessing. What it does now is group a corpus, so the
 * clusters can be looked at.
 */

/** Page positions are bucketed to this fraction of the page, each axis. */
const GRID = 12;

/**
 * Only the first page.
 *
 * A rate con's identity is its header page; later pages are terms and
 * conditions that vary with length and would otherwise split one layout into
 * several fingerprints.
 */
export interface LayoutFingerprint {
  /** Stable hash of the features below. Equal hashes mean the same layout. */
  readonly hash: string;
  /** Page shape, rounded — Letter and A4 are different layouts. */
  readonly pageSize: string;
  readonly pageCount: number;
  /** Label-looking tokens with their grid cell, sorted. The actual signature. */
  readonly anchors: readonly string[];
}

export function fingerprint(document: DocumentText): LayoutFingerprint {
  const [first] = document.pages;
  if (!first) {
    return { hash: emptyHash(), pageSize: "0x0", pageCount: 0, anchors: [] };
  }

  const anchors = anchorsOf(first);
  const pageSize = `${Math.round(first.width)}x${Math.round(first.height)}`;

  return {
    hash: hashOf([pageSize, ...anchors]),
    pageSize,
    pageCount: document.pages.length,
    anchors,
  };
}

/**
 * The label words on a page, each tagged with the grid cell it sits in.
 *
 * A label is text ending in a colon, or a short all-caps run — "Load #:",
 * "PICKUP", "Total Rate:". Values are excluded by the same rule that makes
 * this useful: digits and long prose are what change between two copies of the
 * same form, so anything containing a digit is dropped.
 *
 * Position is bucketed rather than exact. The same template rendered with a
 * one-line-longer address shifts everything below it by a few points, and a
 * fingerprint that treats that as a different layout would be useless.
 */
function anchorsOf(page: TextPage): string[] {
  const anchors = new Set<string>();

  for (const line of toLines(page)) {
    for (const column of toColumns(line)) {
      const label = labelOf(column.text);
      if (!label) continue;

      const x = Math.floor((column.items[0].x / page.width) * GRID);
      const y = Math.floor((column.y / page.height) * GRID);
      anchors.add(`${label}@${x},${y}`);
    }
  }

  return [...anchors].sort();
}

/** Longer than this is prose, not a label. */
const MAX_LABEL_CHARS = 28;

/**
 * Company names, which are the one kind of all-caps heading that must not
 * count as structure.
 *
 * Letterhead sits in a fixed place on a fixed form, so it looks exactly like
 * an anchor — and it is the single worst thing to include here, because the
 * question this tool exists to answer is whether layouts cluster by *TMS
 * vendor*. Two brokers running the same TMS would score as different layouts
 * purely because their names differ, which is the error that would make the
 * answer come out backwards.
 *
 * A corporate suffix is the available signal. It is not complete — a brokerage
 * called "GULF COAST FREIGHT" with no suffix still lands in the anchor set —
 * so a similarity score between documents from two different brokers reads a
 * little low, and that limit is worth remembering when reading one.
 */
const COMPANY_SUFFIX = /\b(?:LLC|L\.L\.C|INC|CORP|CO|LTD|LP|LLP|PLLC|GROUP)\b\.?$/;

function labelOf(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const colon = trimmed.indexOf(":");
  // Everything up to the colon is the label; a colon at position 0 is not one.
  const candidate = colon > 0 ? trimmed.slice(0, colon) : trimmed;

  // Digits are values, not structure: "Load #: 884213" keeps "Load #", and a
  // bare "884213" is dropped entirely.
  if (/\d/.test(candidate) && colon <= 0) return null;
  if (candidate.length > MAX_LABEL_CHARS) return null;

  const normalized = candidate
    .toUpperCase()
    .replace(/[^A-Z#&/ ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length < 2) return null;

  // With no colon, only an all-caps heading counts — otherwise every company
  // name and street on the page becomes an anchor.
  if (colon <= 0) {
    if (candidate !== candidate.toUpperCase()) return null;
    if (COMPANY_SUFFIX.test(normalized)) return null;
  }

  return normalized;
}

function hashOf(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex").slice(0, 16);
}

function emptyHash(): string {
  return hashOf([]);
}

/**
 * How alike two layouts are, 0 to 1 — the overlap of their anchor sets.
 *
 * Reported rather than thresholded. "Is 0.7 the same layout?" is exactly the
 * question a corpus answers and first principles do not, so the inspector
 * prints the number and a person decides.
 */
export function layoutSimilarity(a: LayoutFingerprint, b: LayoutFingerprint): number {
  if (a.anchors.length === 0 && b.anchors.length === 0) return 1;

  const left = new Set(a.anchors);
  const right = new Set(b.anchors);
  const shared = [...left].filter((anchor) => right.has(anchor)).length;

  // Jaccard: shared over the union, so a page with many extra anchors is not
  // rewarded for containing another's by accident.
  return shared / (left.size + right.size - shared);
}
