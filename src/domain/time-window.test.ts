import { describe, expect, it } from "vitest";
import {
  assertLocalDateTime,
  isLocalDateTime,
  isValidWindow,
  isWithinWindow,
  localToInstant,
  type StopWindow,
} from "./time-window";

const houston = "America/Chicago";
const phoenix = "America/Phoenix";

function window(overrides: Partial<StopWindow> = {}): StopWindow {
  return {
    opensAtLocal: "2026-10-30T08:00",
    closesAtLocal: "2026-10-30T12:00",
    timeZone: houston,
    appointmentType: "fcfs",
    rawText: "PU 10/30 0800-1200",
    ...overrides,
  };
}

describe("local wall time", () => {
  it("accepts well-formed values", () => {
    expect(isLocalDateTime("2026-10-30T08:00")).toBe(true);
    expect(assertLocalDateTime("2028-02-29T00:00")).toBe("2028-02-29T00:00");
  });

  it("rejects malformed or impossible values", () => {
    expect(isLocalDateTime("2026-10-30 08:00")).toBe(false); // no T
    expect(isLocalDateTime("2026-10-30T08:00:00Z")).toBe(false); // carries a zone
    expect(isLocalDateTime("2026-13-01T08:00")).toBe(false); // month 13
    expect(isLocalDateTime("2026-02-30T08:00")).toBe(false); // no such day
    expect(isLocalDateTime("2026-02-29T08:00")).toBe(false); // 2026 is not a leap year
    expect(isLocalDateTime("2026-10-30T24:00")).toBe(false); // hour 24
    expect(() => assertLocalDateTime("10/30/2026 8am")).toThrow(RangeError);
  });
});

describe("localToInstant", () => {
  it("resolves a wall time using the facility's zone", () => {
    // Houston is on CDT (UTC-5) on this date.
    expect(localToInstant("2026-10-30T08:00", houston).toISOString()).toBe(
      "2026-10-30T13:00:00.000Z",
    );
  });

  it("gives different instants for the same wall time in different zones", () => {
    // Arizona does not observe DST, so it is UTC-7 year round.
    expect(localToInstant("2026-10-30T08:00", phoenix).toISOString()).toBe(
      "2026-10-30T15:00:00.000Z",
    );
  });

  it("handles a standard-time date in the same zone", () => {
    // After the November transition Houston is on CST (UTC-6).
    expect(localToInstant("2026-11-15T08:00", houston).toISOString()).toBe(
      "2026-11-15T14:00:00.000Z",
    );
  });

  it("resolves forward through the spring-forward gap", () => {
    // 2026-03-08 02:30 does not exist in Chicago; 02:00 jumps to 03:00.
    expect(localToInstant("2026-03-08T02:30", houston).toISOString()).toBe(
      "2026-03-08T08:30:00.000Z",
    );
  });

  it("resolves the fall-back overlap to the earlier occurrence", () => {
    // 2026-11-01 01:30 happens twice in Chicago; CDT (UTC-5) comes first.
    expect(localToInstant("2026-11-01T01:30", houston).toISOString()).toBe(
      "2026-11-01T06:30:00.000Z",
    );
  });
});

describe("stop windows", () => {
  it("accepts a window that closes after it opens", () => {
    expect(isValidWindow(window())).toBe(true);
  });

  it("rejects a window that closes before it opens", () => {
    expect(
      isValidWindow(
        window({ opensAtLocal: "2026-10-30T12:00", closesAtLocal: "2026-10-30T08:00" }),
      ),
    ).toBe(false);
  });

  it("treats a window spanning the DST change as valid", () => {
    const overnight = window({
      opensAtLocal: "2026-11-01T01:00",
      closesAtLocal: "2026-11-01T03:00",
    });
    expect(isValidWindow(overnight)).toBe(true);
  });

  it("decides arrival against absolute time, not wall time", () => {
    const stop = window(); // 08:00-12:00 Houston == 13:00-17:00Z
    expect(isWithinWindow(stop, new Date("2026-10-30T13:00:00Z"))).toBe(true);
    expect(isWithinWindow(stop, new Date("2026-10-30T17:00:00Z"))).toBe(true);
    expect(isWithinWindow(stop, new Date("2026-10-30T12:59:00Z"))).toBe(false);
    expect(isWithinWindow(stop, new Date("2026-10-30T17:01:00Z"))).toBe(false);
  });

  it("treats the same wall-clock window in another zone as a different window", () => {
    const houstonStop = window(); // 13:00-17:00Z
    const phoenixStop = window({ timeZone: phoenix }); // 15:00-19:00Z
    const truckArrived = new Date("2026-10-30T13:30:00Z");

    expect(isWithinWindow(houstonStop, truckArrived)).toBe(true);
    expect(isWithinWindow(phoenixStop, truckArrived)).toBe(false);
  });

  it("keeps the source text for audit", () => {
    expect(window().rawText).toBe("PU 10/30 0800-1200");
  });
});
