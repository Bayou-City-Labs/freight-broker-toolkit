/**
 * Pickup and delivery windows.
 *
 * A rate con says "PU 10/30 0800-1200". That is wall-clock time at the dock,
 * and the document almost never states a timezone. Converting to an absolute
 * instant at intake would silently bake in a guess that can't be audited or
 * corrected later, so the wall time is stored as written, the facility's IANA
 * zone is stored alongside it, and the original text is kept for the audit
 * trail. Absolute time is derived only when something actually needs it —
 * sorting stops, computing transit, checking whether a truck is late.
 */

/** An appointment is a commitment to a time; FCFS is a commitment to a range. */
export type AppointmentType = "appointment" | "fcfs";

/** Naive local wall time: "YYYY-MM-DDTHH:mm", with no zone or offset. */
export type LocalDateTime = string;

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export interface StopWindow {
  /** Earliest the facility will accept the truck, in local wall time. */
  readonly opensAtLocal: LocalDateTime;
  /** Latest the facility will accept the truck, in local wall time. */
  readonly closesAtLocal: LocalDateTime;
  /** IANA zone of the facility, e.g. "America/Chicago". */
  readonly timeZone: string;
  readonly appointmentType: AppointmentType;
  /** Exactly what the source document said, for audit. Null when hand-entered. */
  readonly rawText: string | null;
}

export function isLocalDateTime(value: string): value is LocalDateTime {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || day < 1) return false;
  // Reject day-of-month values the month doesn't have (e.g. 2026-02-30).
  return new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
}

export function assertLocalDateTime(value: string): LocalDateTime {
  if (!isLocalDateTime(value)) {
    throw new RangeError(`Expected local wall time as YYYY-MM-DDTHH:mm, got "${value}"`);
  }
  return value;
}

/**
 * Offset of `timeZone` from UTC, in milliseconds, at the given instant.
 * Derived from Intl rather than a tz database dependency.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);

  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
  return asIfUtc - instant.getTime();
}

/**
 * Resolves a local wall time in a zone to an absolute instant.
 *
 * Guess using the offset at the naive timestamp, then re-check against the
 * offset actually in force at that guess. When the two disagree the wall time
 * sits on a DST transition, which has two inherent edge cases. Both are
 * resolved rather than thrown on — a dock appointment is a real commitment
 * even when the clock misbehaves:
 *
 *  - Fall-back overlap (01:30 on a day where it happens twice): resolves to
 *    the first, earlier occurrence.
 *  - Spring-forward gap (02:30 on a day where 02:00-03:00 doesn't exist):
 *    resolves forward, past the gap, so 02:30 becomes 03:30 local. Matching
 *    Temporal's "compatible" disambiguation and Luxon; resolving backward
 *    would turn a morning appointment into an earlier one.
 */
export function localToInstant(local: LocalDateTime, timeZone: string): Date {
  assertLocalDateTime(local);
  const naiveUtc = Date.parse(`${local}:00Z`);

  const guessOffset = zoneOffsetMs(new Date(naiveUtc), timeZone);
  const guess = naiveUtc - guessOffset;
  const offsetAtGuess = zoneOffsetMs(new Date(guess), timeZone);
  if (guessOffset === offsetAtGuess) return new Date(guess);

  const corrected = naiveUtc - offsetAtGuess;
  const offsetAtCorrected = zoneOffsetMs(new Date(corrected), timeZone);
  if (offsetAtGuess === offsetAtCorrected) return new Date(corrected);

  // Neither offset is self-consistent: the wall time falls in a gap. Taking
  // the smaller (more negative, i.e. standard-time) offset lands after it.
  return new Date(naiveUtc - Math.min(offsetAtGuess, offsetAtCorrected));
}

export function windowOpensAt(window: StopWindow): Date {
  return localToInstant(window.opensAtLocal, window.timeZone);
}

export function windowClosesAt(window: StopWindow): Date {
  return localToInstant(window.closesAtLocal, window.timeZone);
}

/** A window is valid when it closes no earlier than it opens. */
export function isValidWindow(window: StopWindow): boolean {
  return windowClosesAt(window).getTime() >= windowOpensAt(window).getTime();
}

/**
 * True when the truck arrived within the window. For an appointment, arriving
 * before it opens is still early — detention and late fees are computed from
 * the window, not from the arrival alone.
 */
export function isWithinWindow(window: StopWindow, arrivedAt: Date): boolean {
  const time = arrivedAt.getTime();
  return (
    time >= windowOpensAt(window).getTime() && time <= windowClosesAt(window).getTime()
  );
}
