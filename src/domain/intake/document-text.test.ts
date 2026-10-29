import { describe, expect, it } from "vitest";
import {
  allLines,
  pageNeedsOcr,
  toColumns,
  toLines,
  toPlainText,
  type TextItem,
  type TextPage,
} from "./document-text";

function item(text: string, x: number, y: number, fontSize = 12): TextItem {
  return {
    text,
    x,
    y,
    // Roughly the advance width a monospace-ish font would give, which is all
    // the gap heuristics need.
    width: text.length * fontSize * 0.5,
    height: fontSize,
    fontSize,
  };
}

function page(items: TextItem[], pageNumber = 1): TextPage {
  return { pageNumber, width: 612, height: 792, items };
}

describe("toLines", () => {
  it("reassembles fragments emitted as separate items", () => {
    // This is what a PDF text layer actually gives you: words and the spaces
    // between them as distinct items.
    const line = toLines(
      page([item("ACME", 17, 29), item(" ", 45, 29), item("LOGISTICS", 53, 29)]),
    );

    expect(line).toHaveLength(1);
    expect(line[0].text).toBe("ACME LOGISTICS");
  });

  it("inserts a space when a gap is wide but no space item was emitted", () => {
    const line = toLines(page([item("Weight:", 17, 29), item("42000", 200, 29)]));
    expect(line[0].text).toBe("Weight: 42000");
  });

  it("does not insert a space for kerning-sized gaps", () => {
    // Two fragments of one word, a sub-space gap apart.
    const line = toLines(page([item("Ware", 17, 29), item("house", 41, 29)]));
    expect(line[0].text).toBe("Warehouse");
  });

  it("collapses wide column whitespace to a single space", () => {
    const line = toLines(page([item("PICKUP", 17, 29), item("DELIVERY", 400, 29)]));
    expect(line[0].text).toBe("PICKUP DELIVERY");
  });

  it("splits rows that are vertically apart", () => {
    const lines = toLines(page([item("First", 17, 29), item("Second", 17, 60)]));
    expect(lines.map((l) => l.text)).toEqual(["First", "Second"]);
  });

  it("keeps items on one row when they differ by less than the tolerance", () => {
    // Subscripts and mixed fonts shift the baseline a little; that is still one line.
    const lines = toLines(page([item("Total", 17, 29), item("Rate", 60, 31)]));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Total Rate");
  });

  it("scales the row tolerance with font size", () => {
    // A 4pt difference splits 7pt text but not 24pt text.
    const small = toLines(page([item("a", 10, 100, 7), item("b", 40, 104, 7)]));
    const large = toLines(page([item("a", 10, 100, 24), item("b", 40, 104, 24)]));

    expect(small).toHaveLength(2);
    expect(large).toHaveLength(1);
  });

  it("orders a row left to right regardless of emission order", () => {
    const lines = toLines(page([item("second", 200, 29), item("first", 17, 29)]));
    expect(lines[0].text).toBe("first second");
  });

  it("orders rows top to bottom", () => {
    const lines = toLines(page([item("bottom", 17, 700), item("top", 17, 29)]));
    expect(lines.map((l) => l.text)).toEqual(["top", "bottom"]);
  });

  it("reports the line's top edge", () => {
    const lines = toLines(page([item("Total", 17, 29), item("Rate", 60, 31)]));
    expect(lines[0].y).toBe(29);
  });

  it("keeps the underlying items for anything that needs geometry", () => {
    const lines = toLines(page([item("Weight:", 17, 29), item("42000", 200, 29)]));
    expect(lines[0].items.map((i) => i.x)).toEqual([17, 200]);
  });

  it("drops empty items without dropping the line", () => {
    const lines = toLines(page([item("", 0, 29), item("Rate", 17, 29)]));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Rate");
  });

  it("returns nothing for an empty page", () => {
    expect(toLines(page([]))).toEqual([]);
  });
});

describe("toColumns", () => {
  it("splits a row where the layout put a column break", () => {
    const [line] = toLines(
      page([
        item("Load", 17, 29),
        item("#:", 45, 29),
        item("884213", 62, 29),
        item("Date:", 300, 29),
        item("10/28/2026", 340, 29),
      ]),
    );

    expect(toColumns(line).map((column) => column.text)).toEqual([
      "Load #: 884213",
      "Date: 10/28/2026",
    ]);
  });

  it("returns a single column for a row with no wide gaps", () => {
    const [line] = toLines(page([item("CARRIER:", 17, 29), item("ACME", 70, 29)]));

    expect(toColumns(line).map((column) => column.text)).toEqual(["CARRIER: ACME"]);
  });

  it("keeps the items on each column for anything that needs geometry", () => {
    const [line] = toLines(page([item("Rate:", 17, 29), item("$2,450.00", 400, 29)]));
    const columns = toColumns(line);

    expect(columns).toHaveLength(2);
    expect(columns[1].items.map((i) => i.x)).toEqual([400]);
    expect(columns[1].y).toBe(29);
  });
});

describe("allLines", () => {
  it("walks pages in order", () => {
    const lines = allLines({
      source: "pdf-text",
      pages: [page([item("one", 17, 29)], 1), page([item("two", 17, 29)], 2)],
    });

    expect(lines.map((l) => [l.pageNumber, l.text])).toEqual([
      [1, "one"],
      [2, "two"],
    ]);
  });
});

describe("toPlainText", () => {
  it("joins lines with newlines and pages with a blank line", () => {
    const text = toPlainText({
      source: "pdf-text",
      pages: [
        page([item("first", 17, 29), item("second", 17, 60)], 1),
        page([item("third", 17, 29)], 2),
      ],
    });

    expect(text).toBe("first\nsecond\n\nthird");
  });
});

describe("pageNeedsOcr", () => {
  it("is true for a page with no text layer", () => {
    expect(pageNeedsOcr(page([]))).toBe(true);
  });

  it("is true for a page carrying only whitespace", () => {
    // A scan sometimes yields a few stray whitespace items rather than none.
    expect(pageNeedsOcr(page([item(" ", 0, 0), item("\n", 0, 10)]))).toBe(true);
  });

  it("is false once there is real text", () => {
    expect(pageNeedsOcr(page([item("RATE CONFIRMATION", 17, 29)]))).toBe(false);
  });

  it("is true for a fax: one full-page image with a stamped footer", () => {
    // The text layer here is the fax machine's own header, not the document.
    // Testing emptiness alone passes this to a parser that finds nothing.
    expect(
      pageNeedsOcr({
        ...page([item("RECEIVED 11/02 08:14", 17, 20)]),
        imageCoverage: 0.94,
      }),
    ).toBe(true);
  });

  it("is false for a document that merely contains a large image", () => {
    // A rate con with a logo banner and real content underneath.
    expect(
      pageNeedsOcr({
        ...page([
          item("RATE CONFIRMATION", 17, 29),
          item("Load #: 884213  Carrier: GULF COAST HAULING LLC", 17, 60),
        ]),
        imageCoverage: 0.6,
      }),
    ).toBe(false);
  });
});
