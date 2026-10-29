import { describe, expect, it } from "vitest";
import {
  TextExtractionError,
  type DocumentInput,
  type TextExtractor,
} from "../ports/intake";
import type { DocumentText, TextPage } from "./document-text";
import { createLabelParser } from "./label-parser";
import { emptyDraft } from "./load-draft";
import { createIntakePipeline, textExtractionMessage } from "./pipeline";
import { createPlainTextExtractor } from "./plain-text";

function page(pageNumber: number, text: string | null): TextPage {
  return {
    pageNumber,
    width: 612,
    height: 792,
    items:
      text === null ? [] : [{ text, x: 36, y: 36, width: 100, height: 10, fontSize: 10 }],
  };
}

/** An extractor that returns whatever pages a test hands it. */
function fakeExtractor(pages: TextPage[]): TextExtractor {
  return {
    supports: (input: DocumentInput) => input.kind === "pdf",
    extract: async (): Promise<DocumentText> => ({ pages, source: "pdf-text" }),
  };
}

function failingExtractor(error: TextExtractionError): TextExtractor {
  return {
    supports: () => true,
    extract: () => Promise.reject(error),
  };
}

const parser = createLabelParser();
const pdf: DocumentInput = {
  kind: "pdf",
  bytes: new Uint8Array([1]),
  filename: "rate-con.pdf",
};

describe("the intake pipeline", () => {
  it("runs both stages and returns a draft", async () => {
    const run = createIntakePipeline({
      extractors: [createPlainTextExtractor()],
      parser,
    });

    const result = await run({ kind: "text", text: "Total Rate: $2,450.00" });

    expect(result.status).toBe("drafted");
    if (result.status !== "drafted") return;
    expect(result.draft.carrierRateCents.value).toBe(245_000);
    expect(result.text.source).toBe("plain-text");
    expect(result.unreadablePages).toEqual([]);
  });

  it("picks the first extractor that supports the input", async () => {
    const run = createIntakePipeline({
      // The plain-text extractor does not support a PDF, so it must be skipped
      // rather than tried and failed.
      extractors: [createPlainTextExtractor(), fakeExtractor([page(1, "PICKUP")])],
      parser,
    });

    const result = await run(pdf);
    expect(result.status).toBe("drafted");
  });

  it("reports a scan as needing OCR rather than as an empty draft", async () => {
    const run = createIntakePipeline({
      extractors: [fakeExtractor([page(1, null), page(2, null)])],
      parser,
    });

    const result = await run(pdf);

    // An empty draft here would read as a broken parser. It is an unread file.
    expect(result).toEqual({ status: "needs_ocr", pageCount: 2 });
  });

  it("parses a mixed document and names the pages it could not read", async () => {
    const run = createIntakePipeline({
      extractors: [fakeExtractor([page(1, "Total Rate: $2,450.00"), page(2, null)])],
      parser,
    });

    const result = await run(pdf);

    expect(result.status).toBe("drafted");
    if (result.status !== "drafted") return;
    // A digital rate con with a photographed signature page on the end is
    // worth parsing for page 1 — as long as the screen admits page 2 was
    // skipped, so a missing field does not look like a parser failure.
    expect(result.draft.carrierRateCents.value).toBe(245_000);
    expect(result.unreadablePages).toEqual([2]);
  });

  it("reports an input nothing can handle", async () => {
    const run = createIntakePipeline({
      extractors: [createPlainTextExtractor()],
      parser,
    });

    expect(await run(pdf)).toEqual({ status: "unsupported" });
  });

  it("lets a text-stage failure through to the caller", async () => {
    const run = createIntakePipeline({
      extractors: [
        failingExtractor(new TextExtractionError("encrypted", "locked.pdf is locked")),
      ],
      parser,
    });

    // A corrupt or locked file is a failure to report, not a status to fold
    // into a draft — the same split the carrier lookup makes.
    await expect(run(pdf)).rejects.toBeInstanceOf(TextExtractionError);
  });

  it("returns an honest empty draft for a readable document with nothing in it", async () => {
    const run = createIntakePipeline({
      extractors: [createPlainTextExtractor()],
      parser,
    });

    const result = await run({ kind: "text", text: "Thanks, talk soon." });

    expect(result.status).toBe("drafted");
    if (result.status !== "drafted") return;
    expect(result.draft).toMatchObject(emptyDraft(parser.name));
  });
});

describe("textExtractionMessage", () => {
  it("says what to do about it, for every failure kind", () => {
    const kinds = ["encrypted", "too_large", "unreadable", "unsupported_input"] as const;

    for (const kind of kinds) {
      const message = textExtractionMessage(
        new TextExtractionError(kind, "file.pdf is 20MB; the limit is 15MB."),
      );
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("passes a size limit through verbatim, since the numbers matter", () => {
    const message = textExtractionMessage(
      new TextExtractionError("too_large", "huge.pdf is 20MB; the limit is 15MB."),
    );
    expect(message).toContain("15MB");
  });
});
