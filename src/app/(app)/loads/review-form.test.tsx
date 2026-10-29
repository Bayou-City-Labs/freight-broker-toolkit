import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { allLines } from "@/domain/intake/document-text";
import { parseLines } from "@/domain/intake/label-parser";
import { createPlainTextExtractor } from "@/domain/intake/plain-text";
import type { LoadDraft } from "@/domain/intake/load-draft";
import type { ExtractState } from "./form-state";

/**
 * The server action is stubbed so this stays a render test.
 *
 * Importing it for real drags in the whole server graph — the session module,
 * Auth.js, `next/server` — none of which resolves outside Next's bundler, and
 * none of which this test is about. What the action does with the form is
 * covered by form-values.test.ts against the same field names asserted below.
 */
vi.mock("./actions", () => ({
  confirmDraftAction: vi.fn(),
  extractDraftAction: vi.fn(),
}));

const { ReviewForm } = await import("./review-form");
const { IntakeForm } = await import("./intake-form");

/**
 * The review screen, rendered.
 *
 * Typechecking and the production build both pass on a component that throws
 * the moment it renders — which is exactly the bug this module shipped once
 * already, when a `"use server"` file exported a constant. Rendering the form
 * here catches that class of failure in CI rather than in a browser, and
 * pins down the thing the server action depends on: the `name` attributes.
 *
 * Static markup only. There is no DOM, so this says nothing about clicking
 * "Add pickup" — the form's interactivity is thin by design, and the values
 * it posts are covered by form-values.test.ts.
 */
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

function drafted(
  draft: LoadDraft,
  overrides: Partial<Extract<ExtractState, { status: "drafted" }>> = {},
): Extract<ExtractState, { status: "drafted" }> {
  return {
    status: "drafted",
    draft,
    filename: "rate-con.pdf",
    textSource: "pdf-text",
    unreadablePages: [],
    documentText: RATE_CON,
    ...overrides,
  };
}

function render(state: Extract<ExtractState, { status: "drafted" }>): string {
  return renderToStaticMarkup(<ReviewForm extracted={state} />);
}

describe("the intake form", () => {
  it("renders both ways in, with the pasted path first", () => {
    const html = renderToStaticMarkup(<IntakeForm />);

    expect(html).toContain('name="text"');
    expect(html).toContain('name="file"');
    // Pasting always works; a PDF needs a text layer. The order on the page
    // reflects that, so the reliable route is the one read first.
    expect(html.indexOf('name="text"')).toBeLessThan(html.indexOf('name="file"'));
    expect(html).toContain("Read the document");
  });

  it("accepts only PDFs on the upload input", () => {
    const html = renderToStaticMarkup(<IntakeForm />);
    expect(html).toContain('accept="application/pdf,.pdf"');
  });
});

describe("the review form", () => {
  it("renders without throwing", async () => {
    const html = render(drafted(await draftOf(RATE_CON)));
    expect(html).toContain("Save load");
  });

  it("emits every field name the confirm action reads", async () => {
    const html = render(drafted(await draftOf(RATE_CON)));

    for (const name of [
      "draft",
      "textSource",
      "filename",
      "referenceNumber",
      "carrierName",
      "carrierMcNumber",
      "carrierDotNumber",
      "commodity",
      "weightLbs",
      "equipment",
      "carrierRateCents",
    ]) {
      expect(html).toContain(`name="${name}"`);
    }

    for (const name of [
      "stop.kind",
      "stop.partyName",
      "stop.addressLine",
      "stop.city",
      "stop.state",
      "stop.postalCode",
      "stop.date",
      "stop.windowStart",
      "stop.windowEnd",
      "stop.referenceNumber",
      "stop.windowRawText",
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
  });

  it("fills the inputs with what the parser read", async () => {
    const html = render(drafted(await draftOf(RATE_CON)));

    expect(html).toContain('value="884213"');
    expect(html).toContain("GULF COAST HAULING LLC");
    expect(html).toContain('value="133655"');
    // Cents in the draft, dollars in the box.
    expect(html).toContain('value="2450.00"');
    expect(html).toContain('value="2026-10-30"');
    expect(html).toContain('value="08:00"');
  });

  it("renders one row per stop, in order", async () => {
    const html = render(drafted(await draftOf(RATE_CON)));

    expect(html).toContain("Pickup 1");
    expect(html).toContain("Delivery 2");
    expect(html.indexOf("HOUSTON TERMINAL WAREHOUSE")).toBeLessThan(
      html.indexOf("DALLAS DISTRIBUTION CENTER"),
    );
  });

  it("marks the fields a human has to check", async () => {
    const html = render(drafted(await draftOf(RATE_CON)));

    // The address was read by shape rather than from a label.
    expect(html).toContain("Low confidence");
    expect(html).toContain("to check.");
  });

  it("shows what a field was read from, so a flag can be judged", async () => {
    const html = render(drafted(await draftOf(RATE_CON)));
    expect(html).toContain("read from");
  });

  it("offers carrier vetting with the number off the document", async () => {
    const html = render(drafted(await draftOf(RATE_CON)));

    // Vetting is one click from the draft, with the MC number carried over.
    expect(html).toContain("/carriers?kind=mc&amp;number=133655");
    expect(html).toContain("Vet GULF COAST HAULING LLC");
  });

  it("omits the vetting link when no carrier number was found", async () => {
    const draft = await draftOf("Total Rate: $1,200.00");
    const html = render(drafted(draft));

    expect(html).not.toContain("/carriers?kind=");
  });

  it("says so when a document yielded no stops", async () => {
    const draft = await draftOf("Total Rate: $1,200.00");
    const html = render(drafted(draft));

    expect(html).toContain("No stops were found");
    // Still offers the rows to add, so the draft is not a dead end.
    expect(html).toContain("Add pickup");
  });

  it("admits which pages it could not read", async () => {
    const html = render(drafted(await draftOf(RATE_CON), { unreadablePages: [2, 3] }));

    expect(html).toContain("2, 3");
    expect(html).toContain("no text layer");
  });

  it("carries the window's source text through for the audit trail", async () => {
    const html = render(drafted(await draftOf(RATE_CON)));

    // The hidden field keeps what the document said about timing, whatever
    // the reviewer types into the date and time boxes.
    expect(html).toMatch(/name="stop\.windowRawText"[^>]*value="[^"]*0800-1200/);
  });
});
