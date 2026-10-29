import { describe, expect, it } from "vitest";
import { allLines } from "@/domain/intake/document-text";
import { parseLines } from "@/domain/intake/label-parser";
import { createPlainTextExtractor } from "@/domain/intake/plain-text";
import type { LoadDraft } from "@/domain/intake/load-draft";
import { readConfirmedLoad } from "./form-values";

const RATE_CON = `Load #: 884213              Date: 10/28/2026
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

async function draftOf(text: string): Promise<LoadDraft> {
  const document = await createPlainTextExtractor().extract({ kind: "text", text });
  return parseLines(allLines(document));
}

/**
 * Builds the submission the review form actually posts: the draft in a hidden
 * field, load fields by name, and stop fields as parallel repeated names.
 */
function submission(
  draft: LoadDraft,
  load: Record<string, string>,
  stops: Array<Record<string, string>> = [],
): FormData {
  const formData = new FormData();
  formData.set("draft", JSON.stringify(draft));
  formData.set("textSource", "plain-text");

  for (const [key, value] of Object.entries(load)) formData.set(key, value);

  for (const stop of stops) {
    // Repeated names in row order, exactly as the rendered rows emit them.
    for (const name of [
      "kind",
      "partyName",
      "addressLine",
      "city",
      "state",
      "postalCode",
      "date",
      "windowStart",
      "windowEnd",
      "referenceNumber",
      "windowRawText",
    ]) {
      formData.append(`stop.${name}`, stop[name] ?? "");
    }
  }

  return formData;
}

function fromDraft(draft: LoadDraft): {
  load: Record<string, string>;
  stops: Array<Record<string, string>>;
} {
  return {
    load: {
      referenceNumber: draft.loadNumber.value ?? "",
      carrierName: draft.carrierName.value ?? "",
      carrierMcNumber: draft.carrierMcNumber.value ?? "",
      carrierDotNumber: draft.carrierDotNumber.value ?? "",
      commodity: draft.commodity.value ?? "",
      weightLbs: String(draft.weightLbs.value ?? ""),
      equipment: draft.equipment.value ?? "",
      carrierRateCents: "2450.00",
    },
    stops: draft.stops.map((stop) => ({
      kind: stop.kind,
      partyName: stop.partyName.value ?? "",
      addressLine: stop.addressLine.value ?? "",
      city: stop.city.value ?? "",
      state: stop.state.value ?? "",
      postalCode: stop.postalCode.value ?? "",
      date: stop.date.value ?? "",
      windowStart: stop.windowStart.value ?? "",
      windowEnd: stop.windowEnd.value ?? "",
      referenceNumber: stop.referenceNumber.value ?? "",
      windowRawText: stop.windowStart.sourceText ?? "",
    })),
  };
}

describe("readConfirmedLoad", () => {
  it("reads a submission the reviewer accepted unchanged", async () => {
    const draft = await draftOf(RATE_CON);
    const { load, stops } = fromDraft(draft);

    const result = readConfirmedLoad(submission(draft, load, stops));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confirmed.referenceNumber).toBe("884213");
    expect(result.confirmed.carrierName).toBe("GULF COAST HAULING LLC");
    expect(result.confirmed.carrierRateCents).toBe(245_000);
    expect(result.confirmed.stops).toHaveLength(2);
    expect(result.confirmed.provenance.corrections).toEqual([]);
  });

  it("keeps stops in the order the rows were rendered", async () => {
    const draft = await draftOf(RATE_CON);
    const { load, stops } = fromDraft(draft);

    const result = readConfirmedLoad(submission(draft, load, stops));
    if (!result.ok) throw new Error(result.message);

    // Parallel arrays, zipped by position: a mix-up here would route freight
    // to the pickup address.
    expect(result.confirmed.stops.map((stop) => [stop.kind, stop.city])).toEqual([
      ["pickup", "Houston"],
      ["delivery", "Dallas"],
    ]);
  });

  it("records what the reviewer corrected, with the parser's confidence", async () => {
    const draft = await draftOf(RATE_CON);
    const { load, stops } = fromDraft(draft);

    const result = readConfirmedLoad(
      submission(draft, { ...load, weightLbs: "44000" }, stops),
    );
    if (!result.ok) throw new Error(result.message);

    expect(result.confirmed.provenance.corrections).toEqual([
      { path: "weightLbs", confidence: 0.9 },
    ]);
  });

  it("accepts a stop the reviewer added by hand", async () => {
    const draft = await draftOf(RATE_CON);
    const { load, stops } = fromDraft(draft);

    const result = readConfirmedLoad(
      submission(draft, load, [
        ...stops,
        { kind: "delivery", partyName: "SECOND DROP", date: "2026-11-01" },
      ]),
    );
    if (!result.ok) throw new Error(result.message);

    expect(result.confirmed.stops).toHaveLength(3);
    expect(result.confirmed.stops[2].partyName).toBe("SECOND DROP");
    // The parser had no confidence in the number of stops it found.
    expect(result.confirmed.provenance.corrections).toContainEqual({
      path: "stops",
      confidence: 0,
    });
  });

  it("parses a typed rate into cents without going through a float", async () => {
    const draft = await draftOf(RATE_CON);
    const { load, stops } = fromDraft(draft);

    for (const [typed, cents] of [
      ["1850", 185_000],
      ["1850.00", 185_000],
      ["1,850.55", 185_055],
      ["$1,850.55", 185_055],
    ] as const) {
      const result = readConfirmedLoad(
        submission(draft, { ...load, carrierRateCents: typed }, stops),
      );
      if (!result.ok) throw new Error(result.message);
      expect(result.confirmed.carrierRateCents).toBe(cents);
    }
  });

  it("refuses to save rather than silently drop an unreadable rate", async () => {
    const draft = await draftOf(RATE_CON);
    const { load, stops } = fromDraft(draft);

    const result = readConfirmedLoad(
      submission(draft, { ...load, carrierRateCents: "about 1850" }, stops),
    );

    // Nulling this would save a load with no rate on it and say nothing.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("not an amount");
  });

  it("refuses an unreadable weight for the same reason", async () => {
    const draft = await draftOf(RATE_CON);
    const { load, stops } = fromDraft(draft);

    const result = readConfirmedLoad(
      submission(draft, { ...load, weightLbs: "heavy" }, stops),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("not a weight");
  });

  it("takes an MC number however the broker typed it", async () => {
    const draft = await draftOf(RATE_CON);
    const { load, stops } = fromDraft(draft);

    for (const typed of ["133655", "MC-133655", "MC 133655", "mc#133655"]) {
      const result = readConfirmedLoad(
        submission(draft, { ...load, carrierMcNumber: typed }, stops),
      );
      if (!result.ok) throw new Error(result.message);
      expect(result.confirmed.carrierMcNumber).toBe("133655");
    }
  });

  it("requires a reference number", async () => {
    const draft = await draftOf(RATE_CON);
    const { load, stops } = fromDraft(draft);

    const result = readConfirmedLoad(
      submission(draft, { ...load, referenceNumber: "   " }, stops),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("reference number");
  });

  it("requires at least one stop", async () => {
    const draft = await draftOf(RATE_CON);
    const { load } = fromDraft(draft);

    const result = readConfirmedLoad(submission(draft, load, []));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("at least one stop");
  });

  it("requires a name on every stop", async () => {
    const draft = await draftOf(RATE_CON);
    const { load } = fromDraft(draft);

    const result = readConfirmedLoad(
      submission(draft, load, [{ kind: "pickup", partyName: "" }]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("needs a name");
  });

  it("rejects a date the form could not have produced", async () => {
    const draft = await draftOf(RATE_CON);
    const { load } = fromDraft(draft);

    const result = readConfirmedLoad(
      submission(draft, load, [
        { kind: "pickup", partyName: "ACME", date: "30/10/2026" },
      ]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("YYYY-MM-DD");
  });

  it("blanks out empty optional fields rather than storing empty strings", async () => {
    const draft = await draftOf(RATE_CON);
    const { load } = fromDraft(draft);

    const result = readConfirmedLoad(
      submission(draft, { ...load, commodity: "", equipment: "   " }, [
        { kind: "pickup", partyName: "ACME" },
      ]),
    );
    if (!result.ok) throw new Error(result.message);

    expect(result.confirmed.commodity).toBeNull();
    expect(result.confirmed.equipment).toBeNull();
    expect(result.confirmed.stops[0].city).toBeNull();
  });

  it("uppercases a state typed in lower case", async () => {
    const draft = await draftOf(RATE_CON);
    const { load } = fromDraft(draft);

    const result = readConfirmedLoad(
      submission(draft, load, [{ kind: "pickup", partyName: "ACME", state: "tx" }]),
    );
    if (!result.ok) throw new Error(result.message);

    expect(result.confirmed.stops[0].state).toBe("TX");
  });

  it("refuses a submission whose draft is missing or mangled", async () => {
    const draft = await draftOf(RATE_CON);
    const { load, stops } = fromDraft(draft);

    const withoutDraft = submission(draft, load, stops);
    withoutDraft.delete("draft");
    expect(readConfirmedLoad(withoutDraft).ok).toBe(false);

    const mangled = submission(draft, load, stops);
    mangled.set("draft", "{not json");
    expect(readConfirmedLoad(mangled).ok).toBe(false);

    const wrongShape = submission(draft, load, stops);
    wrongShape.set("draft", JSON.stringify({ loadNumber: "884213" }));
    expect(readConfirmedLoad(wrongShape).ok).toBe(false);
  });

  it("carries the parser name and text source into the provenance", async () => {
    const draft = await draftOf(RATE_CON);
    const { load, stops } = fromDraft(draft);

    const formData = submission(draft, load, stops);
    formData.set("filename", "rate-con.pdf");
    formData.set("textSource", "pdf-text");

    const result = readConfirmedLoad(formData);
    if (!result.ok) throw new Error(result.message);

    expect(result.confirmed.provenance).toMatchObject({
      producedBy: "label-proximity-v1",
      textSource: "pdf-text",
      filename: "rate-con.pdf",
    });
  });

  it("rejects a text source that is not one we produce", async () => {
    const draft = await draftOf(RATE_CON);
    const { load, stops } = fromDraft(draft);

    const formData = submission(draft, load, stops);
    formData.set("textSource", "chatgpt");

    expect(readConfirmedLoad(formData).ok).toBe(false);
  });
});
