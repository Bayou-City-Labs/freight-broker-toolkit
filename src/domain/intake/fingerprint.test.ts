import { describe, expect, it } from "vitest";
import type { DocumentText } from "./document-text";
import { fingerprint, layoutSimilarity } from "./fingerprint";
import { createPlainTextExtractor } from "./plain-text";

const extractor = createPlainTextExtractor();

function textOf(body: string): Promise<DocumentText> {
  return extractor.extract({ kind: "text", text: body });
}

/** The same form, filled in twice. Different values, same structure. */
const FIRST = `ACME LOGISTICS LLC          RATE CONFIRMATION
Load #: 884213              Date: 10/28/2026
CARRIER: GULF COAST HAULING LLC
MC#: 133655

PICKUP
Shipper: HOUSTON TERMINAL WAREHOUSE
Date: 10/30/2026   Time: 0800-1200

DELIVERY
Consignee: DALLAS DISTRIBUTION CENTER
Date: 10/31/2026   Time: 1400-1700

Total Rate: $2,450.00`;

const SECOND = `ACME LOGISTICS LLC          RATE CONFIRMATION
Load #: 991044              Date: 11/14/2026
CARRIER: BAYOU FREIGHT SYSTEMS INC
MC#: 445522

PICKUP
Shipper: PORT ARTHUR COLD STORAGE
Date: 11/16/2026   Time: 0600-1000

DELIVERY
Consignee: OKLAHOMA CITY DEPOT
Date: 11/17/2026   Time: 0900-1200

Total Rate: $3,180.00`;

/** A different vendor's form: same information, different labels and places. */
const OTHER_VENDOR = `TRANSIT PARTNERS
Order Number: 55012
Hauler: LONE STAR TRUCKING
Origin Facility: BEAUMONT YARD
Destination Facility: TULSA TERMINAL
Agreed Amount: $2,900.00`;

describe("fingerprint", () => {
  it("is identical for two fillings of the same form", async () => {
    const a = fingerprint(await textOf(FIRST));
    const b = fingerprint(await textOf(SECOND));

    // The whole premise of templating: values change, structure does not.
    expect(a.hash).toBe(b.hash);
    expect(layoutSimilarity(a, b)).toBe(1);
  });

  it("differs for a different vendor's form", async () => {
    const a = fingerprint(await textOf(FIRST));
    const b = fingerprint(await textOf(OTHER_VENDOR));

    expect(a.hash).not.toBe(b.hash);
    expect(layoutSimilarity(a, b)).toBeLessThan(0.2);
  });

  it("keeps label words and drops the values beside them", async () => {
    const { anchors } = fingerprint(await textOf(FIRST));
    const labels = anchors.map((anchor) => anchor.split("@")[0]);

    expect(labels).toContain("LOAD #");
    expect(labels).toContain("CARRIER");
    expect(labels).toContain("PICKUP");
    expect(labels).toContain("TOTAL RATE");
    // A value, and the carrier name that followed a label, are not structure.
    expect(labels).not.toContain("GULF COAST HAULING LLC");
    expect(anchors.join(" ")).not.toContain("884213");
  });

  it("ignores letterhead, so one TMS's form matches across brokerages", async () => {
    // Letterhead in its own block, which is where a rate con puts it.
    const form = (broker: string) =>
      `${broker}
RATE CONFIRMATION
Load #: 884213
CARRIER: GULF COAST HAULING LLC
Total Rate: $2,450.00`;

    const a = fingerprint(await textOf(form("ACME LOGISTICS LLC")));
    const b = fingerprint(await textOf(form("BAYOU CITY BROKERAGE LLC")));

    // The point of the whole instrument: two brokers on the same TMS must not
    // read as two layouts just because their names differ. Getting this wrong
    // would make the clustering answer come out backwards.
    expect(a.hash).toBe(b.hash);
    expect(a.anchors.join(" ")).not.toContain("ACME");
  });

  it("is only as position-blind as the grid, which a shared row can defeat", async () => {
    // A known limit, pinned so it is a documented property rather than a
    // surprise: letterhead on the *same row* as a heading pushes that heading
    // sideways, and a wide enough shift crosses a grid cell. Real layouts put
    // the two in separate boxes; a pasted-text corpus will not always.
    const a = fingerprint(await textOf(FIRST));
    const b = fingerprint(
      await textOf(FIRST.replace("ACME LOGISTICS LLC", "BAYOU CITY BROKERAGE LLC")),
    );

    expect(a.hash).not.toBe(b.hash);
    // Still obviously the same family, which is what the score is for.
    expect(layoutSimilarity(a, b)).toBeGreaterThan(0.8);
  });

  it("records where each label sits, not just that it exists", async () => {
    const { anchors } = fingerprint(await textOf(FIRST));

    // The grid cell is what distinguishes a form with "Date:" in the header
    // from one with it down beside the stops.
    expect(anchors.every((anchor) => /@\d+,\d+$/.test(anchor))).toBe(true);
  });

  it("survives a layout shifted down by an extra address line", async () => {
    const shifted = FIRST.replace(
      "Shipper: HOUSTON TERMINAL WAREHOUSE",
      "Shipper: HOUSTON TERMINAL WAREHOUSE\nDock 14, Gate B",
    );

    const a = fingerprint(await textOf(FIRST));
    const b = fingerprint(await textOf(shifted));

    // One line longer is the same form, and a fingerprint that disagreed
    // would split every real layout into a dozen near-duplicates.
    expect(layoutSimilarity(a, b)).toBeGreaterThan(0.75);
  });

  it("reports the page size, since Letter and A4 are different layouts", async () => {
    const { pageSize, pageCount } = fingerprint(await textOf(FIRST));

    expect(pageSize).toBe("612x792");
    expect(pageCount).toBe(1);
  });

  it("fingerprints only the first page", async () => {
    const one = await textOf(FIRST);
    const withTerms: DocumentText = {
      ...one,
      pages: [
        one.pages[0],
        { ...one.pages[0], pageNumber: 2, items: [] },
        { ...one.pages[0], pageNumber: 3, items: [] },
      ],
    };

    // Terms and conditions pages vary in length and would otherwise split one
    // layout into several fingerprints.
    expect(fingerprint(withTerms).hash).toBe(fingerprint(one).hash);
    expect(fingerprint(withTerms).pageCount).toBe(3);
  });

  it("handles a document with nothing in it", async () => {
    const empty = fingerprint(await textOf(""));

    expect(empty.anchors).toEqual([]);
    expect(empty.pageCount).toBe(1);
    expect(layoutSimilarity(empty, empty)).toBe(1);
  });
});
