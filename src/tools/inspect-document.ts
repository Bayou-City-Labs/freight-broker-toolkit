/**
 * The corpus inspector: drop a document in, see what the pipeline sees.
 *
 *   npm run intake:inspect -- fixtures/intake/synthetic-rate-con.pdf
 *   npm run intake:inspect -- --items corpus/*.pdf
 *
 * Not production code. It is the instrument for the question load intake's
 * business case rests on — whether rate con layouts cluster by TMS vendor or
 * by shipper — and the fastest way to find out why a parser missed a field on
 * a document that looks obvious to a person.
 *
 * Given several files it also prints how alike their layouts are, which is the
 * clustering answer in the only form that can be read off real documents.
 *
 * Deliberately a CLI rather than a screen. It runs with no session, no
 * database and no deploy, over a directory of documents that must never be
 * uploaded anywhere — and OCR, when it exists, will not fit in a request
 * either.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  allLines,
  pageNeedsOcr,
  toColumns,
  toPlainText,
  type DocumentText,
} from "@/domain/intake/document-text";
import { fingerprint, layoutSimilarity } from "@/domain/intake/fingerprint";
import { createLabelParser } from "@/domain/intake/label-parser";
import { createIntakePipeline } from "@/domain/intake/pipeline";
import { createPlainTextExtractor } from "@/domain/intake/plain-text";
import {
  CONFIDENT_ENOUGH,
  flaggedFields,
  type DraftField,
  type LoadDraft,
} from "@/domain/intake/load-draft";
import { TextExtractionError, type DocumentInput } from "@/domain/ports/intake";
import { createPdfTextExtractor } from "@/integrations/pdf/pdf-text-extractor";

const runIntake = createIntakePipeline({
  extractors: [createPdfTextExtractor(), createPlainTextExtractor()],
  parser: createLabelParser(),
});

interface Options {
  /** Dump every positioned item, not just assembled lines. */
  readonly items: boolean;
  /** Skip the line dump; just the fingerprint and the draft. */
  readonly quiet: boolean;
  readonly paths: readonly string[];
}

function parseArgs(argv: readonly string[]): Options {
  const paths = argv.filter((arg) => !arg.startsWith("--"));
  return {
    items: argv.includes("--items"),
    quiet: argv.includes("--quiet"),
    paths,
  };
}

async function toInput(path: string): Promise<DocumentInput> {
  const bytes = new Uint8Array(await readFile(path));
  // A .txt alongside the PDFs is how a pasted email gets into the corpus.
  if (/\.(txt|eml|md)$/i.test(path)) {
    return { kind: "text", text: new TextDecoder().decode(bytes) };
  }
  return { kind: "pdf", bytes, filename: basename(path) };
}

function heading(text: string): void {
  console.log(`\n${text}`);
  console.log("─".repeat(text.length));
}

function describeField(name: string, field: DraftField<unknown>): void {
  if (field.value === null) {
    console.log(`  ${name.padEnd(20)} —`);
    return;
  }

  const mark = field.confidence >= CONFIDENT_ENOUGH ? " " : "!";
  const confidence = field.confidence.toFixed(2);
  const source = field.sourceText ? `  ← "${truncate(field.sourceText, 44)}"` : "";
  console.log(
    `${mark} ${name.padEnd(20)} ${String(field.value).padEnd(28)} ${confidence}${source}`,
  );
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function reportDraft(draft: LoadDraft): void {
  heading("Draft");
  console.log(`  parser: ${draft.producedBy}`);
  console.log("  (a leading ! marks a field the review screen would flag)\n");

  describeField("loadNumber", draft.loadNumber);
  describeField("carrierName", draft.carrierName);
  describeField("carrierMcNumber", draft.carrierMcNumber);
  describeField("carrierDotNumber", draft.carrierDotNumber);
  describeField("commodity", draft.commodity);
  describeField("weightLbs", draft.weightLbs);
  describeField("equipment", draft.equipment);
  describeField("carrierRateCents", draft.carrierRateCents);

  draft.stops.forEach((stop, index) => {
    console.log(`\n  stop ${index} — ${stop.kind}`);
    describeField("  partyName", stop.partyName);
    describeField("  addressLine", stop.addressLine);
    describeField("  city", stop.city);
    describeField("  state", stop.state);
    describeField("  postalCode", stop.postalCode);
    describeField("  date", stop.date);
    describeField("  windowStart", stop.windowStart);
    describeField("  windowEnd", stop.windowEnd);
    describeField("  referenceNumber", stop.referenceNumber);
  });

  const flags = flaggedFields(draft);
  console.log(
    `\n  ${flags.length} field(s) flagged for review` +
      (flags.length > 0 ? `: ${flags.map((flag) => flag.path).join(", ")}` : ""),
  );
}

function reportGeometry(document: DocumentText, options: Options): void {
  heading("Pages");
  for (const page of document.pages) {
    const coverage =
      page.imageCoverage === undefined
        ? "n/a"
        : `${Math.round(page.imageCoverage * 100)}%`;
    console.log(
      `  page ${page.pageNumber}: ${Math.round(page.width)}×${Math.round(page.height)}pt, ` +
        `${page.items.length} items, image coverage ${coverage}` +
        (pageNeedsOcr(page) ? "  ← needs OCR" : ""),
    );
  }

  if (options.quiet) return;

  heading("Lines (y, then columns separated by │)");
  for (const line of allLines(document)) {
    const columns = toColumns(line)
      .map((column) => column.text)
      .join(" │ ");
    console.log(`  p${line.pageNumber} y=${line.y.toFixed(0).padStart(4)}  ${columns}`);
  }

  if (!options.items) return;

  heading("Items (x, y, size)");
  for (const page of document.pages) {
    for (const item of page.items) {
      if (item.text.trim().length === 0) continue;
      console.log(
        `  p${page.pageNumber} x=${item.x.toFixed(0).padStart(4)} ` +
          `y=${item.y.toFixed(0).padStart(4)} ${item.fontSize.toFixed(1).padStart(5)}pt  ` +
          JSON.stringify(item.text),
      );
    }
  }
}

interface Inspected {
  readonly path: string;
  readonly fingerprint: ReturnType<typeof fingerprint>;
}

async function inspect(path: string, options: Options): Promise<Inspected | null> {
  console.log(`\n${"═".repeat(72)}`);
  console.log(path);
  console.log("═".repeat(72));

  let result;
  try {
    result = await runIntake(await toInput(path));
  } catch (error) {
    if (error instanceof TextExtractionError) {
      console.log(`\n  could not read it (${error.kind}): ${error.message}`);
      return null;
    }
    throw error;
  }

  if (result.status === "unsupported") {
    console.log("\n  no extractor handles this input");
    return null;
  }

  if (result.status === "needs_ocr") {
    // The single most useful thing this tool reports about a real corpus: how
    // much of it is scans, which decides whether OCR is a rare path or the
    // main one.
    console.log(
      `\n  every one of its ${result.pageCount} page(s) is a scan — no text layer. Needs OCR.`,
    );
    return null;
  }

  reportGeometry(result.text, options);

  if (result.unreadablePages.length > 0) {
    console.log(
      `\n  pages with no text layer: ${result.unreadablePages.join(", ")} (skipped)`,
    );
  }

  const print = fingerprint(result.text);
  heading("Layout fingerprint");
  console.log(`  hash:     ${print.hash}`);
  console.log(`  pageSize: ${print.pageSize}, pages: ${print.pageCount}`);
  console.log(`  anchors:  ${print.anchors.length}`);
  for (const anchor of print.anchors) console.log(`    ${anchor}`);

  reportDraft(result.draft);

  if (options.items) {
    heading("Plain text");
    console.log(toPlainText(result.text));
  }

  return { path, fingerprint: print };
}

/**
 * The clustering answer, as far as code can give it.
 *
 * Identical hashes are one template. Everything else is a similarity score for
 * a person to look at — whether 0.7 means "same vendor, different version" or
 * "two vendors who both use a table" is a judgement about documents, not a
 * threshold to hardcode before any have been seen.
 */
function reportClusters(inspected: readonly Inspected[]): void {
  if (inspected.length < 2) return;

  heading("Layout clusters");

  const byHash = new Map<string, string[]>();
  for (const entry of inspected) {
    const group = byHash.get(entry.fingerprint.hash) ?? [];
    group.push(basename(entry.path));
    byHash.set(entry.fingerprint.hash, group);
  }

  console.log(`  ${inspected.length} documents, ${byHash.size} distinct layout(s)`);
  for (const [hash, files] of byHash) {
    console.log(`\n  ${hash}  (${files.length})`);
    for (const file of files) console.log(`    ${file}`);
  }

  heading("Pairwise similarity");
  for (let i = 0; i < inspected.length; i += 1) {
    for (let j = i + 1; j < inspected.length; j += 1) {
      const score = layoutSimilarity(inspected[i].fingerprint, inspected[j].fingerprint);
      // Only pairs worth a look; a corpus of fifty would otherwise print 1225
      // lines of near-zero scores.
      if (score < 0.3) continue;
      console.log(
        `  ${score.toFixed(2)}  ${basename(inspected[i].path)} ↔ ${basename(inspected[j].path)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.paths.length === 0) {
    console.error(
      [
        "Usage: npm run intake:inspect -- [--items] [--quiet] <file...>",
        "",
        "  PDFs are read through the text stage; .txt/.eml files are treated as",
        "  pasted text. Several files also get a layout cluster report.",
        "",
        "  --items   dump every positioned text item, and the plain text",
        "  --quiet   fingerprint and draft only, no line dump",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const inspected: Inspected[] = [];
  for (const path of options.paths) {
    const result = await inspect(path, options);
    if (result) inspected.push(result);
  }

  reportClusters(inspected);
  console.log("");
}

// No top-level await: the package is CommonJS under tsx, where it is a hard
// build error.
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
