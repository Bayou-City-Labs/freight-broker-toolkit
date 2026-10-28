/**
 * Money is stored and computed in integer cents. A broker's margin is the
 * difference between the customer rate and the carrier pay, so rounding drift
 * here is a defect in the number the business runs on.
 *
 * Per-mile figures (fuel surcharge at $0.055/mi and the like) need sub-cent
 * precision and are NOT money — derive them from a total and a mileage at the
 * point of display, never store them in this type.
 */
export class Money {
  private constructor(readonly cents: number) {}

  static readonly zero = new Money(0);

  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents)) {
      throw new RangeError(`Money requires whole cents, received ${cents}`);
    }
    if (!Number.isSafeInteger(cents)) {
      throw new RangeError(`Money amount is outside the safe integer range: ${cents}`);
    }
    return new Money(cents);
  }

  /**
   * Parses a decimal dollar string such as "2450", "2450.5", "2,450.00" or
   * "-1200.25". Strings are the only exact input: a float literal like 2450.15
   * is already imprecise before it reaches us.
   */
  static fromDollarString(input: string): Money {
    const normalized = input.trim().replace(/[$,\s]/g, "");
    const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
    if (!match) {
      throw new RangeError(`Cannot parse "${input}" as a dollar amount`);
    }
    const [, sign, whole, fraction = ""] = match;
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return Money.fromCents(sign ? -cents : cents);
  }

  plus(other: Money): Money {
    return Money.fromCents(this.cents + other.cents);
  }

  minus(other: Money): Money {
    return Money.fromCents(this.cents - other.cents);
  }

  /** Multiplies by a whole-number quantity (pallets, stops, days of detention). */
  timesQuantity(quantity: number): Money {
    if (!Number.isInteger(quantity)) {
      throw new RangeError(`Quantity must be a whole number, received ${quantity}`);
    }
    return Money.fromCents(this.cents * quantity);
  }

  negated(): Money {
    return Money.fromCents(-this.cents);
  }

  isZero(): boolean {
    return this.cents === 0;
  }

  isNegative(): boolean {
    return this.cents < 0;
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  /** Returns a negative number, zero, or a positive number (Array#sort order). */
  compare(other: Money): number {
    return this.cents - other.cents;
  }

  /** Exact decimal string, e.g. "2450.00". Safe to round-trip through fromDollarString. */
  toDollarString(): string {
    const negative = this.cents < 0;
    const absolute = Math.abs(this.cents);
    const whole = Math.trunc(absolute / 100);
    const fraction = String(absolute % 100).padStart(2, "0");
    return `${negative ? "-" : ""}${whole}.${fraction}`;
  }

  /**
   * Display form with a currency symbol and thousands separators. Goes through
   * a float, which is exact for every amount a freight invoice will ever hold;
   * use toDollarString() anywhere the value is persisted or compared.
   */
  format(locale = "en-US"): string {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
    }).format(this.cents / 100);
  }

  static sum(amounts: readonly Money[]): Money {
    return amounts.reduce<Money>((total, amount) => total.plus(amount), Money.zero);
  }
}
