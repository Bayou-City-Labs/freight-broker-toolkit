import { describe, expect, it } from "vitest";
import { Money } from "./money";

describe("Money", () => {
  it("rejects fractional cents rather than rounding silently", () => {
    expect(() => Money.fromCents(100.5)).toThrow(RangeError);
  });

  it("parses dollar strings exactly", () => {
    expect(Money.fromDollarString("2450.00").cents).toBe(245000);
    expect(Money.fromDollarString("2450").cents).toBe(245000);
    expect(Money.fromDollarString("2450.5").cents).toBe(245050);
    expect(Money.fromDollarString("$2,450.75").cents).toBe(245075);
    expect(Money.fromDollarString("-1200.25").cents).toBe(-120025);
  });

  it("rejects input it cannot represent exactly", () => {
    expect(() => Money.fromDollarString("2450.123")).toThrow(RangeError);
    expect(() => Money.fromDollarString("not a rate")).toThrow(RangeError);
    expect(() => Money.fromDollarString("")).toThrow(RangeError);
  });

  it("round-trips through its string form", () => {
    for (const input of ["0.00", "0.07", "2450.00", "-1200.25", "1000000.99"]) {
      expect(Money.fromDollarString(input).toDollarString()).toBe(input);
    }
  });

  it("computes margin without floating-point drift", () => {
    // 0.1 + 0.2 !== 0.3 in floats; in cents it is exact.
    const customerRate = Money.fromDollarString("1850.10");
    const carrierPay = Money.fromDollarString("1600.20");
    expect(customerRate.minus(carrierPay).toDollarString()).toBe("249.90");
  });

  it("sums accessorials exactly", () => {
    const charges = [
      Money.fromDollarString("1850.00"),
      Money.fromDollarString("125.50"),
      Money.fromDollarString("75.25"),
    ];
    expect(Money.sum(charges).toDollarString()).toBe("2050.75");
    expect(Money.sum([]).toDollarString()).toBe("0.00");
  });

  it("multiplies by whole quantities only", () => {
    const detentionPerHour = Money.fromDollarString("65.00");
    expect(detentionPerHour.timesQuantity(3).toDollarString()).toBe("195.00");
    expect(() => detentionPerHour.timesQuantity(2.5)).toThrow(RangeError);
  });

  it("orders and compares amounts", () => {
    const amounts = [
      Money.fromDollarString("300.00"),
      Money.fromDollarString("-50.00"),
      Money.fromDollarString("100.00"),
    ];
    const sorted = [...amounts].sort((a, b) => a.compare(b));
    expect(sorted.map((m) => m.toDollarString())).toEqual(["-50.00", "100.00", "300.00"]);
    expect(Money.fromCents(500).equals(Money.fromDollarString("5.00"))).toBe(true);
    expect(Money.fromDollarString("-50.00").isNegative()).toBe(true);
    expect(Money.zero.isZero()).toBe(true);
  });

  it("formats for display", () => {
    expect(Money.fromDollarString("2450.00").format()).toBe("$2,450.00");
  });
});
