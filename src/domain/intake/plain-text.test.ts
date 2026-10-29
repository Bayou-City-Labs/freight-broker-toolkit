import { describe, expect, it } from "vitest";
import { allLines, toColumns, toPlainText } from "./document-text";
import { TextExtractionError } from "../ports/intake";
import { createPlainTextExtractor } from "./plain-text";

const extractor = createPlainTextExtractor();

describe("supports", () => {
  it("accepts pasted text and rejects a PDF", () => {
    expect(extractor.supports({ kind: "text", text: "hello" })).toBe(true);
    expect(
      extractor.supports({ kind: "pdf", bytes: new Uint8Array(), filename: "a.pdf" }),
    ).toBe(false);
  });
});

describe("extract", () => {
  it("lays text out as a single page", async () => {
    const document = await extractor.extract({ kind: "text", text: "PICKUP" });

    expect(document.source).toBe("plain-text");
    expect(document.pages).toHaveLength(1);
    expect(document.pages[0]).toMatchObject({ pageNumber: 1, width: 612, height: 792 });
  });

  it("round-trips the lines it was given", async () => {
    const document = await extractor.extract({
      kind: "text",
      text: "CARRIER: ACME\nMC#: 133655",
    });

    expect(toPlainText(document)).toBe("CARRIER: ACME\nMC#: 133655");
  });

  it("emits one item per token, not one per line", async () => {
    // The same fragmentation a PDF text layer has, so the structure stage has
    // one world to reason about rather than two.
    const document = await extractor.extract({ kind: "text", text: "CARRIER: ACME" });

    expect(document.pages[0].items.map((item) => item.text)).toEqual([
      "CARRIER:",
      "ACME",
    ]);
  });

  it("turns a run of spaces into a readable column break", async () => {
    const document = await extractor.extract({
      kind: "text",
      text: "Load #: 884213              Date: 10/28/2026",
    });

    const [line] = allLines(document);
    expect(toColumns(line).map((column) => column.text)).toEqual([
      "Load #: 884213",
      "Date: 10/28/2026",
    ]);
  });

  it("keeps blank lines as vertical space without emitting items", async () => {
    const document = await extractor.extract({
      kind: "text",
      text: "PICKUP\n\n\nDELIVERY",
    });

    const lines = allLines(document);
    expect(lines.map((line) => line.text)).toEqual(["PICKUP", "DELIVERY"]);
    // The gap survives in the geometry even though no item represents it.
    expect(lines[1].y - lines[0].y).toBeGreaterThan(28);
  });

  it("handles Windows and classic Mac line endings", async () => {
    const crlf = await extractor.extract({ kind: "text", text: "one\r\ntwo" });
    const cr = await extractor.extract({ kind: "text", text: "one\rtwo" });

    expect(toPlainText(crlf)).toBe("one\ntwo");
    expect(toPlainText(cr)).toBe("one\ntwo");
  });

  it("never reports pasted text as needing OCR", async () => {
    const document = await extractor.extract({ kind: "text", text: "PICKUP" });
    expect(document.pages[0].imageCoverage).toBeUndefined();
  });

  it("rejects a PDF handed to it by mistake", async () => {
    // A rejection, not a synchronous throw: the port returns a promise, and a
    // caller using `.catch()` has to see the failure.
    await expect(
      extractor.extract({ kind: "pdf", bytes: new Uint8Array(), filename: "a.pdf" }),
    ).rejects.toBeInstanceOf(TextExtractionError);
  });

  it("refuses more text than a rate confirmation could be", async () => {
    await expect(
      extractor.extract({ kind: "text", text: "x".repeat(2_000_001) }),
    ).rejects.toMatchObject({ kind: "too_large" });
  });
});
