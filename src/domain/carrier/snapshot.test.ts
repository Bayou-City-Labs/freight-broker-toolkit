import { describe, expect, it } from "vitest";
import { snapshotHash } from "./snapshot";

describe("snapshotHash", () => {
  it("is stable regardless of key order", () => {
    const a = { dotNumber: "123456", legalName: "ACME TRUCKING", allowedToOperate: "Y" };
    const b = { allowedToOperate: "Y", legalName: "ACME TRUCKING", dotNumber: "123456" };
    expect(snapshotHash(a)).toBe(snapshotHash(b));
  });

  it("is stable for nested objects", () => {
    const a = {
      carrier: { dot: 1, name: "A" },
      insurance: [{ type: "BIPD", amount: 1000000 }],
    };
    const b = {
      insurance: [{ amount: 1000000, type: "BIPD" }],
      carrier: { name: "A", dot: 1 },
    };
    expect(snapshotHash(a)).toBe(snapshotHash(b));
  });

  it("changes when any value changes", () => {
    const before = { allowedToOperate: "Y", safetyRating: "S" };
    const after = { allowedToOperate: "N", safetyRating: "S" };
    expect(snapshotHash(before)).not.toBe(snapshotHash(after));
  });

  it("preserves array order, which is meaningful", () => {
    expect(snapshotHash([1, 2])).not.toBe(snapshotHash([2, 1]));
  });

  it("ignores undefined values so optional fields don't churn the hash", () => {
    expect(snapshotHash({ a: 1 })).toBe(snapshotHash({ a: 1, b: undefined }));
  });

  it("distinguishes null from a missing key", () => {
    expect(snapshotHash({ a: 1, b: null })).not.toBe(snapshotHash({ a: 1 }));
  });
});
