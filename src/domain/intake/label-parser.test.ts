import { describe, expect, it } from "vitest";
import { allLines, type DocumentText } from "./document-text";
import { createLabelParser, parseLines } from "./label-parser";
import { CONFIDENT_ENOUGH, flaggedFields } from "./load-draft";
import { createPlainTextExtractor } from "./plain-text";

const extractor = createPlainTextExtractor();

async function textOf(body: string): Promise<DocumentText> {
  return extractor.extract({ kind: "text", text: body });
}

async function parse(body: string) {
  return parseLines(allLines(await textOf(body)));
}

/**
 * The same layout as `fixtures/intake/synthetic-rate-con.txt`, as pasted text.
 * Kept here as well as in the fixture so the parser can be exercised without a
 * PDF in the loop — the PDF path is covered separately against the real file.
 */
const RATE_CON = `ACME LOGISTICS LLC          RATE CONFIRMATION
Load #: 884213              Date: 10/28/2026

CARRIER: GULF COAST HAULING LLC
MC#: 133655     DOT#: 264184

PICKUP
Shipper: HOUSTON TERMINAL WAREHOUSE
2100 Navigation Blvd, Houston, TX 77003
Date: 10/30/2026   Time: 0800-1200

DELIVERY
Consignee: DALLAS DISTRIBUTION CENTER
500 Industrial Way, Dallas, TX 75201
Date: 10/31/2026   Time: 1400-1700

Commodity: Canned goods     Weight: 42000 lbs
Equipment: 53' Dry Van
Total Rate: $2,450.00`;

describe("the label parser on a whole rate con", () => {
  it("reads the load-level fields", async () => {
    const draft = await parse(RATE_CON);

    expect(draft.loadNumber.value).toBe("884213");
    expect(draft.carrierName.value).toBe("GULF COAST HAULING LLC");
    expect(draft.carrierMcNumber.value).toBe("133655");
    expect(draft.carrierDotNumber.value).toBe("264184");
    expect(draft.commodity.value).toBe("Canned goods");
    expect(draft.weightLbs.value).toBe(42000);
    expect(draft.equipment.value).toBe("53' Dry Van");
    expect(draft.carrierRateCents.value).toBe(245_000);
  });

  it("does not let a second field on the same row bleed into the first", async () => {
    // "Load #: 884213    Date: 10/28/2026" is one text row. Without a cut at
    // the next label the load number swallows the date, and the date parser
    // then finds it and reports a confident wrong answer.
    const draft = await parse(RATE_CON);

    expect(draft.loadNumber.value).not.toContain("Date");
    expect(draft.commodity.value).not.toContain("Weight");
    expect(draft.carrierMcNumber.value).toBe("133655");
  });

  it("finds both stops, in document order", async () => {
    const draft = await parse(RATE_CON);

    expect(draft.stops.map((stop) => [stop.kind, stop.sequence])).toEqual([
      ["pickup", 0],
      ["delivery", 1],
    ]);
  });

  it("reads each stop's party, address, date and window", async () => {
    const draft = await parse(RATE_CON);
    const [pickup, delivery] = draft.stops;

    expect(pickup.partyName.value).toBe("HOUSTON TERMINAL WAREHOUSE");
    expect(pickup.city.value).toBe("Houston");
    expect(pickup.state.value).toBe("TX");
    expect(pickup.postalCode.value).toBe("77003");
    expect(pickup.date.value).toBe("2026-10-30");
    expect(pickup.windowStart.value).toBe("08:00");
    expect(pickup.windowEnd.value).toBe("12:00");

    expect(delivery.partyName.value).toBe("DALLAS DISTRIBUTION CENTER");
    expect(delivery.city.value).toBe("Dallas");
    expect(delivery.date.value).toBe("2026-10-31");
    expect(delivery.windowStart.value).toBe("14:00");
    expect(delivery.windowEnd.value).toBe("17:00");
  });

  it("does not read the date on a row as the window on that row", async () => {
    // "Date: 10/30/2026   Time: 0800-1200" — the year 2026 is itself a valid
    // military time, so a careless time matcher invents 20:26 as a window.
    const draft = await parse(RATE_CON);
    expect(draft.stops[0].windowStart.value).toBe("08:00");
  });

  it("names itself on the draft, so parsers can be compared", async () => {
    const draft = await parse(RATE_CON);
    expect(draft.producedBy).toBe("label-proximity-v1");
  });

  it("scores a labelled value high enough to clear review", async () => {
    const draft = await parse(RATE_CON);

    expect(draft.carrierRateCents.confidence).toBeGreaterThanOrEqual(CONFIDENT_ENOUGH);
    expect(draft.loadNumber.confidence).toBeGreaterThanOrEqual(CONFIDENT_ENOUGH);
  });

  it("keeps everything found by position below the review threshold", async () => {
    const draft = await parse(RATE_CON);

    // The address was matched by its shape, not by a label. A generic parser
    // that called this certain would be worse than no parser.
    expect(draft.stops[0].city.confidence).toBeLessThan(CONFIDENT_ENOUGH);
    expect(flaggedFields(draft).map((flag) => flag.path)).toContain("stops.0.city");
  });

  it("keeps the source text on every field it filled", async () => {
    const draft = await parse(RATE_CON);

    expect(draft.carrierRateCents.sourceText).toContain("2,450.00");
    expect(draft.stops[0].date.sourceText).toContain("10/30/2026");
  });
});

describe("the label parser on the layouts that break it", () => {
  it("ignores a heading that matches a label but holds no value", async () => {
    // "RATE CONFIRMATION" matches the rate label. The real total is further
    // down, so the parser has to walk past the heading rather than stop there.
    const draft = await parse(
      ["RATE CONFIRMATION", "Carrier: ACME", "Total Rate: $1,200.00"].join("\n"),
    );

    expect(draft.carrierRateCents.value).toBe(120_000);
  });

  it("follows a label that sits alone above its value", async () => {
    const draft = await parse(["CARRIER", "GULF COAST HAULING LLC"].join("\n"));

    expect(draft.carrierName.value).toBe("GULF COAST HAULING LLC");
    // A weaker claim than a value on the label's own row, and scored as one.
    expect(draft.carrierName.confidence).toBeLessThan(CONFIDENT_ENOUGH);
  });

  it("falls back to the line under a stop heading for the party name", async () => {
    const draft = await parse(
      ["PICKUP", "HOUSTON TERMINAL WAREHOUSE", "2100 Navigation Blvd"].join("\n"),
    );

    expect(draft.stops[0].partyName.value).toBe("HOUSTON TERMINAL WAREHOUSE");
    expect(draft.stops[0].partyName.confidence).toBeLessThan(CONFIDENT_ENOUGH);
  });

  it("reports an empty draft for a document with nothing in it", async () => {
    const draft = await parse("Thanks, let me know.");

    expect(draft.loadNumber.value).toBeNull();
    expect(draft.carrierRateCents.value).toBeNull();
    expect(draft.stops).toEqual([]);
    // Missing required fields, so nothing here can be confirmed by accident.
    expect(flaggedFields(draft).map((flag) => flag.reason)).toContain("missing");
  });

  it("handles a multi-stop load as more stops, not a different shape", async () => {
    const draft = await parse(
      [
        "PICKUP",
        "Shipper: ACME ONE",
        "Date: 11/02/2026",
        "DELIVERY",
        "Consignee: DROP ONE",
        "Date: 11/03/2026",
        "DELIVERY",
        "Consignee: DROP TWO",
        "Date: 11/04/2026",
      ].join("\n"),
    );

    expect(draft.stops.map((stop) => stop.kind)).toEqual([
      "pickup",
      "delivery",
      "delivery",
    ]);
    expect(draft.stops[2].date.value).toBe("2026-11-04");
  });

  it("reads a value right-aligned into the next column", async () => {
    // "Total Rate:" and the figure are far apart on the same row, which is how
    // most rate cons set a total. The label's own column is empty, so stopping
    // there would miss it; taking the whole row would have let an adjacent
    // field bleed in. Both layouts have to work.
    const draft = await parse("Total Rate:                      $2,450.00");

    expect(draft.carrierRateCents.value).toBe(245_000);
    expect(draft.carrierRateCents.confidence).toBeGreaterThanOrEqual(CONFIDENT_ENOUGH);
  });

  it("does not take a neighbouring field's value as its own", async () => {
    // Two labelled fields side by side. "Equipment:" has nothing after it in
    // its own column, and the column beside it belongs to Temp.
    const draft = await parse("Equipment:          Temp: -10F");

    expect(draft.equipment.value).toBeNull();
  });

  it("promotes party labels to section starts when a document has no headings", async () => {
    // A pasted tender usually reads like this — no PICKUP/DELIVERY banners.
    const draft = await parse(
      [
        "Shipper: ACME DISTRIBUTION",
        "Date: 11/02/2026",
        "Consignee: LONE STAR FOODS",
        "Date: 11/03/2026",
      ].join("\n"),
    );

    expect(draft.stops.map((stop) => stop.kind)).toEqual(["pickup", "delivery"]);
    expect(draft.stops[0].partyName.value).toBe("ACME DISTRIBUTION");
    expect(draft.stops[1].partyName.value).toBe("LONE STAR FOODS");
  });

  it("does not count a heading and the party label beneath it as two stops", async () => {
    // "PICKUP" then "Shipper:" is the most common layout there is. Treating
    // both as section starts reads a two-stop load as four.
    const draft = await parse(
      [
        "PICKUP",
        "Shipper: ACME DISTRIBUTION",
        "DELIVERY",
        "Consignee: LONE STAR FOODS",
      ].join("\n"),
    );

    expect(draft.stops).toHaveLength(2);
  });

  it("does not find a reference number inside an ordinary word", async () => {
    // "Port Rd" contains "po". Without a closing word boundary on the label,
    // the street address is read as the reference number — found by a fixture
    // whose pickup happens to be on Port Road.
    const draft = await parse(
      ["PICKUP", "Shipper: BEAUMONT YARD", "1500 Port Rd, Beaumont, TX 77701"].join("\n"),
    );

    expect(draft.stops[0].referenceNumber.value).toBeNull();
  });

  it("still reads the reference labels that are real", async () => {
    for (const [line, expected] of [
      ["PO #: 44718", "44718"],
      ["BOL: 99120", "99120"],
      ["Ref: ABC-12", "ABC-12"],
      ["Reference #: ABC-12", "ABC-12"],
      ["Pickup #: 4471", "4471"],
    ] as const) {
      const draft = await parse(["PICKUP", "Shipper: ACME", line].join("\n"));
      expect(draft.stops[0].referenceNumber.value).toBe(expected);
    }
  });

  it("reads an equipment and rate line written without colons", async () => {
    const draft = await parse(["Equipment - Reefer", "Carrier Pay - $3,100"].join("\n"));

    expect(draft.equipment.value).toBe("Reefer");
    expect(draft.carrierRateCents.value).toBe(310_000);
  });
});

describe("createLabelParser", () => {
  it("implements the structure-stage port", async () => {
    const parser = createLabelParser();
    expect(parser.name).toBe("label-proximity-v1");

    const draft = await parser.parse(await textOf(RATE_CON));
    expect(draft.loadNumber.value).toBe("884213");
  });
});
