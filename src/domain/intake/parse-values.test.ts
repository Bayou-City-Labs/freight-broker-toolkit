import { describe, expect, it } from "vitest";
import {
  parseCityStateZip,
  parseDate,
  parseIdentifierDigits,
  parseMoneyCents,
  parseTime,
  parseTimeRange,
  parseWeightLbs,
} from "./parse-values";

describe("parseDate", () => {
  it("reads the US slash order", () => {
    // Rate cons are US-domestic: 03/04/2026 is March 4th, not April 3rd.
    expect(parseDate("10/30/2026")).toBe("2026-10-30");
    expect(parseDate("03/04/2026")).toBe("2026-03-04");
    expect(parseDate("3/4/2026")).toBe("2026-03-04");
  });

  it("reads ISO", () => {
    expect(parseDate("2026-10-30")).toBe("2026-10-30");
  });

  it("expands a two-digit year into this century", () => {
    expect(parseDate("10/30/26")).toBe("2026-10-30");
  });

  it("reads month names", () => {
    expect(parseDate("Oct 30, 2026")).toBe("2026-10-30");
    expect(parseDate("October 30 2026")).toBe("2026-10-30");
    expect(parseDate("30th")).toBeNull();
  });

  it("finds a date inside a longer line", () => {
    expect(parseDate("Date: 10/30/2026   Time: 0800-1200")).toBe("2026-10-30");
  });

  it("rejects a day that does not exist in that month", () => {
    // Date would otherwise roll 02/30 forward to March.
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("04/31/2026")).toBeNull();
    expect(parseDate("13/01/2026")).toBeNull();
  });

  it("accepts a real leap day and rejects a fake one", () => {
    expect(parseDate("02/29/2028")).toBe("2028-02-29");
    expect(parseDate("02/29/2026")).toBeNull();
  });

  it("returns null rather than guessing", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate("next Tuesday")).toBeNull();
    expect(parseDate("ASAP")).toBeNull();
  });

  it("does not infer a missing year", () => {
    // Inferring from today silently produces a date a year out every December.
    expect(parseDate("Oct 30")).toBeNull();
  });
});

describe("parseTime", () => {
  it("reads military time as docks write it", () => {
    expect(parseTime("0800")).toBe("08:00");
    expect(parseTime("1430")).toBe("14:30");
    expect(parseTime("0000")).toBe("00:00");
  });

  it("reads colon times", () => {
    expect(parseTime("08:00")).toBe("08:00");
    expect(parseTime("14:30")).toBe("14:30");
  });

  it("reads meridiem times", () => {
    expect(parseTime("8:00 AM")).toBe("08:00");
    expect(parseTime("2:30 PM")).toBe("14:30");
    expect(parseTime("8am")).toBe("08:00");
    expect(parseTime("5 p.m.")).toBe("17:00");
  });

  it("handles the midnight and noon edge cases", () => {
    expect(parseTime("12:00 AM")).toBe("00:00");
    expect(parseTime("12:00 PM")).toBe("12:00");
  });

  it("ignores a three-digit number, which is not a time", () => {
    // "800" is far more likely a weight or reference number.
    expect(parseTime("800")).toBeNull();
  });

  it("rejects impossible clock values", () => {
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("12:75")).toBeNull();
    expect(parseTime("13:00 PM")).toBeNull();
  });

  it("returns null for no time", () => {
    expect(parseTime("")).toBeNull();
    expect(parseTime("appointment required")).toBeNull();
  });

  it("does not read a time out of a date", () => {
    // The year in 10/30/2026 is otherwise a perfectly valid military 20:26 —
    // a delivery window invented out of thin air.
    expect(parseTime("Date: 10/30/2026")).toBeNull();
    expect(parseTime("2026-10-30")).toBeNull();
  });

  it("finds the real time on a line that also carries a date", () => {
    expect(parseTime("Date: 10/30/2026   Time: 0800")).toBe("08:00");
  });

  it("does not carve a time out of a longer digit run", () => {
    // A reference or load number is not a window.
    expect(parseTime("Load #: 884213")).toBeNull();
  });
});

describe("parseTimeRange", () => {
  it("reads a military range", () => {
    expect(parseTimeRange("0800-1200")).toEqual({ start: "08:00", end: "12:00" });
  });

  it("reads a meridiem range", () => {
    expect(parseTimeRange("8:00 AM - 12:00 PM")).toEqual({
      start: "08:00",
      end: "12:00",
    });
  });

  it("reads 'to' as a separator", () => {
    expect(parseTimeRange("0800 to 1200")).toEqual({ start: "08:00", end: "12:00" });
  });

  it("handles an en dash", () => {
    expect(parseTimeRange("0800–1200")).toEqual({ start: "08:00", end: "12:00" });
  });

  it("reads a single appointment time with no end", () => {
    expect(parseTimeRange("Appointment 1400")).toEqual({ start: "14:00", end: null });
  });

  it("does not tear a date apart looking for a range", () => {
    // 10-30-2026 contains dash-separated digits but is not a window.
    expect(parseTimeRange("10-30-2026")).toBeNull();
  });

  it("returns null when there is no time at all", () => {
    expect(parseTimeRange("FCFS")).toBeNull();
  });
});

describe("parseMoneyCents", () => {
  it("reads a formatted dollar amount as integer cents", () => {
    expect(parseMoneyCents("$2,450.00")).toBe(245000);
    expect(parseMoneyCents("2450")).toBe(245000);
    expect(parseMoneyCents("$1,234.56")).toBe(123456);
  });

  it("finds an amount inside a longer line", () => {
    expect(parseMoneyCents("Total Rate: $2,450.00")).toBe(245000);
  });

  it("handles a single decimal place", () => {
    expect(parseMoneyCents("$2450.5")).toBe(245050);
  });

  it("returns null for no amount", () => {
    expect(parseMoneyCents("")).toBeNull();
    expect(parseMoneyCents("TBD")).toBeNull();
  });
});

describe("parseWeightLbs", () => {
  it("reads pounds with and without a unit", () => {
    expect(parseWeightLbs("42000 lbs")).toBe(42000);
    expect(parseWeightLbs("42,000")).toBe(42000);
    expect(parseWeightLbs("42000 pounds")).toBe(42000);
  });

  it("converts tons", () => {
    expect(parseWeightLbs("21 tons")).toBe(42000);
  });

  it("refuses kilograms rather than silently treating them as pounds", () => {
    // A 42,000 kg load is 92,000 lbs — over gross weight and not a quiet
    // rounding problem.
    expect(parseWeightLbs("19000 kg")).toBeNull();
  });

  it("rounds a fractional weight", () => {
    expect(parseWeightLbs("42000.6 lbs")).toBe(42001);
  });

  it("returns null for no number", () => {
    expect(parseWeightLbs("")).toBeNull();
    expect(parseWeightLbs("heavy")).toBeNull();
  });
});

describe("parseIdentifierDigits", () => {
  it("strips prefixes and punctuation", () => {
    expect(parseIdentifierDigits("MC#: 133655")).toBe("133655");
    expect(parseIdentifierDigits("DOT# 264184")).toBe("264184");
    expect(parseIdentifierDigits("00133655")).toBe("133655");
  });

  it("rejects nothing and overlong runs", () => {
    expect(parseIdentifierDigits("none")).toBeNull();
    expect(parseIdentifierDigits("713-555-0100")).toBeNull();
  });
});

describe("parseCityStateZip", () => {
  it("reads a standard US tail", () => {
    expect(parseCityStateZip("2100 Navigation Blvd, Houston, TX 77003")).toEqual({
      city: "Houston",
      state: "TX",
      postalCode: "77003",
    });
  });

  it("handles ZIP+4", () => {
    expect(parseCityStateZip("Dallas, TX 75201-1234").postalCode).toBe("75201-1234");
  });

  it("works without a ZIP", () => {
    expect(parseCityStateZip("Houston, TX")).toEqual({
      city: "Houston",
      state: "TX",
      postalCode: null,
    });
  });

  it("title-cases a shouted city name", () => {
    // Rate cons are frequently all-caps.
    expect(parseCityStateZip("HOUSTON, TX 77003").city).toBe("Houston");
    expect(parseCityStateZip("FORT WORTH, TX").city).toBe("Fort Worth");
  });

  it("returns nulls when there is no city/state tail", () => {
    expect(parseCityStateZip("2100 Navigation Blvd")).toEqual({
      city: null,
      state: null,
      postalCode: null,
    });
  });
});
