import { Money } from "../money";

/**
 * Coercions from the strings a rate con actually contains into the types the
 * domain stores.
 *
 * Every one returns null rather than guessing. A parser that invents a
 * plausible delivery date is worse than one that leaves the field blank: blank
 * gets flagged and looked at, wrong gets confirmed and dispatched.
 */

/** `2026-10-30`, or null. */
export function parseDate(input: string): string | null {
  const text = input.trim();

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // US order. Rate cons are US-domestic documents, so 03/04 is March 4th.
  const slashed = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/.exec(text);
  if (slashed) {
    const month = Number(slashed[1]);
    const day = Number(slashed[2]);
    const rawYear = Number(slashed[3]);
    // A two-digit year is this century; these documents are never historical.
    const year = slashed[3].length === 2 ? 2000 + rawYear : rawYear;
    return validDate(year, month, day);
  }

  // "Oct 30, 2026" / "October 30 2026". The year is required — inferring it
  // from "today" would silently produce a date a year out every December.
  const named = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(
    text,
  );
  if (named) {
    const month = MONTHS[named[1].toLowerCase().slice(0, 3)];
    if (month) return validDate(Number(named[3]), month, Number(named[2]));
  }

  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function validDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Reject the 31st of a 30-day month rather than letting Date roll it over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Dates masked out before any time matching.
 *
 * Without this, the year in "10/30/2026" reads as the military time 20:26 —
 * a plausible-looking delivery window invented out of a date. Masking rather
 * than requiring the caller to pre-split keeps every entry point safe.
 */
const DATE_LIKE = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;

function withoutDates(input: string): string {
  return input.replace(DATE_LIKE, " ");
}

/**
 * Anything shaped like a clock time. Ordered longest-first so "8:00 AM" is
 * taken whole rather than as a bare "8:00". The military form is fenced by
 * digit lookarounds so it cannot be carved out of a longer run.
 */
const TIME_TOKEN =
  /\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]?\.?|\d{1,2}\s*[AaPp]\.?[Mm]\.?|\d{1,2}:\d{2}|(?<!\d)[0-2]\d[0-5]\d(?!\d)/g;

/** `HH:MM` 24-hour, or null. */
export function parseTime(input: string): string | null {
  return findTimes(input)[0] ?? null;
}

function findTimes(input: string): string[] {
  const text = withoutDates(input);
  const found: string[] = [];

  for (const match of text.matchAll(TIME_TOKEN)) {
    const parsed = parseTimeToken(match[0]);
    if (parsed) found.push(parsed);
  }

  return found;
}

function parseTimeToken(token: string): string | null {
  const colon = /^(\d{1,2}):(\d{2})\s*([AaPp])/.exec(token);
  if (colon) return to24(Number(colon[1]), Number(colon[2]), colon[3]);

  const bare = /^(\d{1,2})\s*([AaPp])/.exec(token);
  if (bare) return to24(Number(bare[1]), 0, bare[2]);

  const plain = /^(\d{1,2}):(\d{2})$/.exec(token);
  if (plain) return valid24(Number(plain[1]), Number(plain[2]));

  // Military, as docks write it: 0800, 1430. Four digits only — a bare "800"
  // is far more likely a weight or a reference number than a time.
  const military = /^(\d{2})(\d{2})$/.exec(token);
  if (military) return valid24(Number(military[1]), Number(military[2]));

  return null;
}

function to24(hour: number, minute: number, meridiem: string): string | null {
  if (hour < 1 || hour > 12) return null;
  const pm = meridiem.toLowerCase() === "p";
  const h = hour === 12 ? (pm ? 12 : 0) : pm ? hour + 12 : hour;
  return valid24(h, minute);
}

function valid24(hour: number, minute: number): string | null {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

export interface TimeRange {
  readonly start: string;
  readonly end: string | null;
}

/**
 * A dock window: `0800-1200`, `8:00 AM - 12:00 PM`, or a single appointment
 * time with no end.
 */
export function parseTimeRange(input: string): TimeRange | null {
  // Collecting every time token and taking the first two handles all the
  // separators brokers use — "-", en dash, "to", "thru" — without having to
  // enumerate them, and without a separator regex that breaks on "8 AM - 12 PM"
  // where the character before the dash is a letter.
  const times = findTimes(input);
  if (times.length === 0) return null;
  return { start: times[0], end: times[1] ?? null };
}

/**
 * A decimal number, comma-grouped or not.
 *
 * The grouped alternative requires at least one comma and comes first.
 * Written as `\d{1,3}(?:,\d{3})*` it matches "420" out of "42000" and stops,
 * because the group is optional and the regex is happy with a partial match.
 */
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

/** Integer cents, or null. Never a float — see the money rule. */
export function parseMoneyCents(input: string): number | null {
  const match = new RegExp(String.raw`\$?\s*(${NUMBER})`).exec(input.trim());
  if (!match) return null;

  try {
    return Money.fromDollarString(match[1]).cents;
  } catch {
    return null;
  }
}

/** Pounds. Tons are converted; kilograms are rejected rather than assumed. */
export function parseWeightLbs(input: string): number | null {
  const text = input.trim();

  const match = new RegExp(
    String.raw`(${NUMBER})\s*(lbs?|pounds?|tons?|kgs?|kilograms?)?`,
    "i",
  ).exec(text);
  if (!match) return null;

  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const unit = match[2]?.toLowerCase() ?? "";

  if (/^kg|^kilogram/.test(unit)) return null;
  if (/^ton/.test(unit)) return Math.round(value * 2000);
  return Math.round(value);
}

/** Digits of an MC or DOT number, without the prefix. */
export function parseIdentifierDigits(input: string): string | null {
  const digits = input.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length > 0 && digits.length <= 8 ? digits : null;
}

export interface UsAddress {
  readonly city: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
}

/**
 * Pulls `City, ST 77003` off the end of an address line. The street is
 * whatever precedes it, which the caller keeps separately — splitting the
 * street into components is not worth the error rate.
 */
export function parseCityStateZip(input: string): UsAddress {
  const match =
    /([A-Za-z][A-Za-z.\- ']*?)\s*,\s*([A-Za-z]{2})\b\s*(\d{5}(?:-\d{4})?)?/.exec(
      input.trim(),
    );
  if (!match) return { city: null, state: null, postalCode: null };

  return {
    city: titleCase(match[1].trim()),
    state: match[2].toUpperCase(),
    postalCode: match[3] ?? null,
  };
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /(^|[\s\-'])([a-z])/g,
      (_, lead: string, letter: string) => lead + letter.toUpperCase(),
    );
}
