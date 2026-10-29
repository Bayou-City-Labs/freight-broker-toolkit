import { describe, expect, it } from "vitest";
import { loadDetailsSchema } from "./details";

describe("loadDetailsSchema", () => {
  it("validates an edit trail", () => {
    const parsed = loadDetailsSchema.safeParse({
      edits: [
        {
          at: "2026-10-29T20:15:00.000Z",
          changes: [{ path: "carrierPayCents", from: "$1750.00", to: "$1850.00" }],
        },
      ],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.edits?.[0].changes[0].path).toBe("carrierPayCents");
  });

  it("keeps the intake record and the edit trail apart", () => {
    const parsed = loadDetailsSchema.parse({
      intake: {
        producedBy: "label-proximity-v1",
        textSource: "pdf-text",
        filename: null,
        corrections: [{ path: "weightLbs", confidence: 0.9 }],
        acceptedFlagged: [],
      },
      edits: [{ at: "2026-10-29T20:15:00.000Z", changes: [] }],
    });

    // Evidence about the parser and evidence about a later human are different
    // facts; mixing them would corrupt the confidence calibration data.
    expect(parsed.intake?.corrections).toHaveLength(1);
    expect(parsed.edits).toHaveLength(1);
  });

  it("accepts a field that was or became unset", () => {
    const parsed = loadDetailsSchema.safeParse({
      edits: [
        {
          at: "2026-10-29T20:15:00.000Z",
          changes: [{ path: "commodity", from: null, to: "Canned goods" }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an edit with no timestamp", () => {
    const parsed = loadDetailsSchema.safeParse({ edits: [{ changes: [] }] });
    expect(parsed.success).toBe(false);
  });
});
