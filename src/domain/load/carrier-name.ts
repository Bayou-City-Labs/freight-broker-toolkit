/**
 * Does the carrier named on a document match the carrier we hold under that
 * number?
 *
 * Intake links a load to a carrier by MC or DOT number, because that is the
 * identifier a rate con states precisely and a name is written a dozen ways.
 * But a number that resolves to a *different company* than the document names
 * is not a detail — it is the signature of double brokering or carrier
 * identity theft, where a rate con arrives under a legitimate carrier's
 * authority with somebody else's name on it.
 *
 * FMCSA's own data cannot detect that (see "Known limits of the FMCSA data").
 * This can, for free, because we have both halves: the number that resolved
 * and the name the document actually used. Reporting it is the whole point —
 * a mismatch the screen swallows is worse than no check, since the load then
 * displays a carrier the paperwork never mentioned.
 */

/**
 * Corporate forms and punctuation differ between a rate con and the FMCSA
 * record of the same company — "Gulf Coast Hauling, L.L.C." against "GULF
 * COAST HAULING LLC". Those are the same carrier and must not be flagged, or
 * the warning becomes noise and stops being read.
 */
const SUFFIXES =
  /\b(?:LLC|LC|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LP|LLP|PLLC|PC|DBA|THE)\b/g;

export function normalizeCarrierName(name: string): string {
  return (
    name
      .toUpperCase()
      // A period inside an abbreviation joins — "L.L.C." is one word, and
      // turning it into "L L C" hides it from the suffix list below. A comma
      // or an ampersand separates, so those become spaces.
      .replace(/\./g, "")
      .replace(/[,'"&\-/]/g, " ")
      .replace(SUFFIXES, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export interface HeldCarrierName {
  readonly legalName: string;
  readonly dbaName: string | null;
}

/**
 * True when the document's name is recognisably the held carrier.
 *
 * Matches against the DBA as well as the legal name, because a rate con names
 * whoever answers the phone and plenty of carriers operate under a trade name.
 *
 * An empty or absent document name is **not** a mismatch: the document said
 * nothing to disagree with, and flagging that would cry wolf on every rate con
 * whose carrier block the parser could not read.
 */
export function carrierNameMatches(
  documentName: string | null,
  held: HeldCarrierName,
): boolean {
  if (documentName === null) return true;

  const written = normalizeCarrierName(documentName);
  if (written.length === 0) return true;

  const legal = normalizeCarrierName(held.legalName);
  const dba = held.dbaName ? normalizeCarrierName(held.dbaName) : null;

  // Containment either way, not equality: a document writing "SCHNEIDER
  // NATIONAL" for "SCHNEIDER NATIONAL CARRIERS" is the same company, and so is
  // one adding a division to the registered name. Substituting a different
  // company's name is what has to be caught, and that shares no prefix.
  return matches(written, legal) || (dba !== null && matches(written, dba));
}

function matches(a: string, b: string): boolean {
  if (a === b) return true;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === 0) return false;

  // Two or more words is enough of the name to be evidence.
  if (short.includes(" ")) return long.includes(short);

  // One word is weak, and matching it by containment would let "GULF" pass as
  // any carrier starting with it. Allowed only when it is a distinctive
  // leading word — long enough not to be a coincidence, and at the front,
  // which is where a carrier's identifying word sits.
  return short.length >= 6 && long.startsWith(`${short} `);
}
