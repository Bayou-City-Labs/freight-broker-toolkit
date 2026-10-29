/**
 * How a carrier is identified when a broker goes to vet one.
 *
 * Brokers type these from a rate con, a carrier packet, or a phone call, so the
 * input is never clean: "MC-123456", "mc 123456", "USDOT 76830", "#1234567".
 * Normalizing here — rather than at the HTTP edge — keeps the rule in one place
 * and makes it testable without a network.
 */
export type CarrierIdentifierKind = "dot" | "mc";

export interface CarrierIdentifier {
  readonly kind: CarrierIdentifierKind;
  /** Digits only, no leading zeros. Safe to interpolate into a URL path. */
  readonly value: string;
}

/**
 * Both numbers are assigned sequentially and are well under eight digits today
 * (DOT numbers are in the 4,000,000s, MC numbers in the 1,600,000s). The cap is
 * a typo guard — a pasted phone number or ZIP+4 should be rejected, not sent
 * upstream as a lookup.
 */
const MAX_DIGITS = 8;

// `(?![a-z])` rather than `\b` so "MC123456" matches (there is no word boundary
// between "c" and "1") while "MCLANE TRUCKING" does not.
const MC_PREFIX = /^(?:mc|ff|mx|docket)(?![a-z])/;
const DOT_PREFIX = /^(?:us\s*)?dot(?![a-z])/;

/**
 * Reads an explicit prefix if the broker typed one. Returns null when the input
 * is a bare number, which is genuinely ambiguous — an MC and a DOT number look
 * identical, and guessing wrong vets a different company.
 */
export function detectIdentifierKind(raw: string): CarrierIdentifierKind | null {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^[#:\s-]+/, "");
  if (MC_PREFIX.test(normalized)) return "mc";
  if (DOT_PREFIX.test(normalized)) return "dot";
  return null;
}

/**
 * Parses broker-typed input into an identifier, falling back to `fallback` when
 * the input carries no prefix of its own. An explicit prefix always wins: if
 * someone picks "DOT" in the UI and then pastes "MC-123456", they meant MC.
 *
 * Returns null when there is no usable number, so the caller can show a message
 * rather than issue a lookup that cannot succeed.
 */
export function parseCarrierIdentifier(
  raw: string,
  fallback: CarrierIdentifierKind,
): CarrierIdentifier | null {
  const kind = detectIdentifierKind(raw) ?? fallback;

  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 0 || digits.length > MAX_DIGITS) return null;

  return { kind, value: digits };
}

export function formatIdentifier(identifier: CarrierIdentifier): string {
  return identifier.kind === "mc" ? `MC-${identifier.value}` : `DOT ${identifier.value}`;
}
