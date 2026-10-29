import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { pageNeedsOcr, toLines, toPlainText } from "@/domain/intake/document-text";
import { TextExtractionError, type DocumentInput } from "@/domain/ports/intake";
import { createPdfTextExtractor } from "./pdf-text-extractor";

const FIXTURE = "fixtures/intake/synthetic-rate-con.pdf";

async function fixtureInput(): Promise<DocumentInput> {
  return {
    kind: "pdf",
    bytes: new Uint8Array(await readFile(FIXTURE)),
    filename: "synthetic-rate-con.pdf",
  };
}

const extractor = createPdfTextExtractor();

describe("supports", () => {
  it("accepts a PDF and rejects pasted text", () => {
    expect(
      extractor.supports({ kind: "pdf", bytes: new Uint8Array(), filename: "a.pdf" }),
    ).toBe(true);
    expect(extractor.supports({ kind: "text", text: "hello" })).toBe(false);
  });
});

describe("extract", () => {
  it("reads the page geometry", async () => {
    const { pages, source } = await extractor.extract(await fixtureInput());

    expect(source).toBe("pdf-text");
    expect(pages).toHaveLength(1);
    // US Letter at 72dpi.
    expect(pages[0]).toMatchObject({ pageNumber: 1, width: 612, height: 792 });
  });

  it("reassembles fragments into readable lines", async () => {
    // unpdf emits "ACME", " ", "LOGISTICS" as three items; the value of the
    // text stage is that nothing downstream has to know that.
    const document = await extractor.extract(await fixtureInput());
    const lines = toLines(document.pages[0]).map((line) => line.text);

    expect(lines[0]).toContain("ACME LOGISTICS LLC");
    expect(lines.join("\n")).toContain("MC#: 133655");
    expect(lines.join("\n")).toContain("Total Rate: $2,450.00");
  });

  it("puts lines in reading order, top to bottom", async () => {
    const document = await extractor.extract(await fixtureInput());
    const text = toPlainText(document);

    expect(text.indexOf("RATE CONFIRMATION")).toBeLessThan(text.indexOf("PICKUP"));
    expect(text.indexOf("PICKUP")).toBeLessThan(text.indexOf("DELIVERY"));
    expect(text.indexOf("DELIVERY")).toBeLessThan(text.indexOf("Total Rate"));
  });

  it("flips PDF coordinates so y measures down from the page top", async () => {
    // The heading sits near the top of the page. In PDF's native bottom-left
    // space its y would be ~763; here it must be small.
    const document = await extractor.extract(await fixtureInput());
    const [first] = toLines(document.pages[0]);

    expect(first.y).toBeLessThan(100);
    expect(first.text).toContain("ACME");
  });

  it("keeps positions on every item", async () => {
    const document = await extractor.extract(await fixtureInput());
    const items = document.pages[0].items;

    expect(items.length).toBeGreaterThan(50);
    for (const item of items) {
      expect(Number.isFinite(item.x)).toBe(true);
      expect(Number.isFinite(item.y)).toBe(true);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeLessThanOrEqual(792);
    }
  });

  it("does not report a text-bearing page as needing OCR", async () => {
    const document = await extractor.extract(await fixtureInput());
    expect(pageNeedsOcr(document.pages[0])).toBe(false);
  });

  it("rejects a non-PDF input", async () => {
    await expect(
      extractor.extract({ kind: "text", text: "not a pdf" }),
    ).rejects.toMatchObject({ kind: "unsupported_input" });
  });

  it("reports an unreadable file rather than throwing something opaque", async () => {
    const error = await extractor
      .extract({
        kind: "pdf",
        bytes: new TextEncoder().encode("this is not a PDF at all"),
        filename: "broken.pdf",
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TextExtractionError);
    expect((error as TextExtractionError).kind).toBe("unreadable");
    expect((error as Error).message).toContain("broken.pdf");
  });

  it("refuses a file too large to parse in a request", async () => {
    await expect(
      extractor.extract({
        kind: "pdf",
        bytes: new Uint8Array(16 * 1024 * 1024),
        filename: "huge.pdf",
      }),
    ).rejects.toMatchObject({ kind: "too_large" });
  });
});
