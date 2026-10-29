import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createLoadRepository } from "@/db/repositories/loads";
import { createPartyRepository } from "@/db/repositories/parties";
import { createCarrierRepository } from "@/db/repositories/carriers";
import { createConfirmDraft } from "@/domain/intake/confirm";
import { createLabelParser } from "@/domain/intake/label-parser";
import { createIntakePipeline } from "@/domain/intake/pipeline";
import { createPlainTextExtractor } from "@/domain/intake/plain-text";
import type { LoadDraft } from "@/domain/intake/load-draft";
import { createPdfTextExtractor } from "@/integrations/pdf/pdf-text-extractor";
import { seedBrokerage, withRollback } from "@/test/db";
import type { DbExecutor } from "@/db/client";
import { readConfirmedLoad } from "./form-values";

/**
 * The whole module, end to end, against the real adapters: a PDF off disk
 * through the text stage, the parser, the form boundary, and into Postgres.
 *
 * Every layer here is covered on its own elsewhere. This exists because the
 * failure this project has actually hit is not a broken layer — it is a layer
 * written and never wired, which every unit test passes and nothing catches.
 * The only substitution is the database executor, so the test can roll back.
 */
const FIXTURE = "fixtures/intake/synthetic-rate-con.pdf";

const runIntake = createIntakePipeline({
  extractors: [createPdfTextExtractor(), createPlainTextExtractor()],
  parser: createLabelParser(),
});

function wire(tx: DbExecutor) {
  return createConfirmDraft({
    loads: createLoadRepository(tx),
    parties: createPartyRepository(tx),
    carriers: createCarrierRepository(tx),
  });
}

/** The submission the review form posts when the reviewer changes nothing. */
function acceptDraft(draft: LoadDraft, filename: string): FormData {
  const formData = new FormData();
  formData.set("draft", JSON.stringify(draft));
  formData.set("textSource", "pdf-text");
  formData.set("filename", filename);

  formData.set("referenceNumber", draft.loadNumber.value ?? "");
  formData.set("carrierName", draft.carrierName.value ?? "");
  formData.set("carrierMcNumber", draft.carrierMcNumber.value ?? "");
  formData.set("carrierDotNumber", draft.carrierDotNumber.value ?? "");
  formData.set("commodity", draft.commodity.value ?? "");
  formData.set("weightLbs", String(draft.weightLbs.value ?? ""));
  formData.set("equipment", draft.equipment.value ?? "");
  // The form shows the rate in dollars; the draft holds cents.
  formData.set(
    "carrierRateCents",
    draft.carrierRateCents.value === null
      ? ""
      : (draft.carrierRateCents.value / 100).toFixed(2),
  );

  for (const stop of draft.stops) {
    formData.append("stop.kind", stop.kind);
    formData.append("stop.partyName", stop.partyName.value ?? "");
    formData.append("stop.addressLine", stop.addressLine.value ?? "");
    formData.append("stop.city", stop.city.value ?? "");
    formData.append("stop.state", stop.state.value ?? "");
    formData.append("stop.postalCode", stop.postalCode.value ?? "");
    formData.append("stop.date", stop.date.value ?? "");
    formData.append("stop.windowStart", stop.windowStart.value ?? "");
    formData.append("stop.windowEnd", stop.windowEnd.value ?? "");
    formData.append("stop.referenceNumber", stop.referenceNumber.value ?? "");
    formData.append("stop.windowRawText", stop.windowStart.sourceText ?? "");
  }

  return formData;
}

async function draftFromFixture(): Promise<LoadDraft> {
  const result = await runIntake({
    kind: "pdf",
    bytes: new Uint8Array(await readFile(FIXTURE)),
    filename: "synthetic-rate-con.pdf",
  });

  if (result.status !== "drafted") {
    throw new Error(`expected a draft, got ${result.status}`);
  }
  return result.draft;
}

describe("load intake, end to end", () => {
  it("turns a PDF on disk into a load, its route, and its facilities", async () => {
    const draft = await draftFromFixture();

    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const confirmDraft = wire(tx);

      const read = readConfirmedLoad(acceptDraft(draft, "synthetic-rate-con.pdf"));
      expect(read.ok).toBe(true);
      if (!read.ok) return;

      const outcome = await confirmDraft(scope, read.confirmed);
      expect(outcome.status).toBe("saved");
      if (outcome.status !== "saved") return;

      const loads = createLoadRepository(tx);
      const parties = createPartyRepository(tx);

      const saved = await loads.findById(scope, outcome.load.id);
      expect(saved).not.toBeNull();
      if (!saved) return;

      expect(saved.load.referenceNumber).toBe("884213");
      expect(saved.load.carrierPayCents).toBe(245_000);
      expect(saved.load.weightLbs).toBe(42000);
      expect(saved.load.equipmentType).toBe("dry_van");
      expect(saved.load.commodityDescription).toBe("Canned goods");
      // A carrier and a rate: the document is an agreement.
      expect(saved.load.status).toBe("booked");

      expect(saved.stops).toHaveLength(2);
      const [pickup, delivery] = saved.stops;

      expect(pickup.type).toBe("pickup");
      expect(pickup.opensAtLocal).toBe("2026-10-30T08:00");
      expect(pickup.closesAtLocal).toBe("2026-10-30T12:00");
      expect(pickup.appointmentType).toBe("fcfs");
      // No zone was stated on the document, and none was invented.
      expect(pickup.timeZone).toBeNull();

      expect(delivery.type).toBe("delivery");
      expect(delivery.opensAtLocal).toBe("2026-10-31T14:00");

      const facilities = await parties.list(scope);
      expect(facilities.map((party) => party.name).sort()).toEqual([
        "DALLAS DISTRIBUTION CENTER",
        "HOUSTON TERMINAL WAREHOUSE",
      ]);
      expect(facilities.find((party) => party.name.startsWith("HOUSTON"))?.city).toBe(
        "Houston",
      );
    });
  });

  it("records the extraction on the saved load", async () => {
    const draft = await draftFromFixture();

    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const read = readConfirmedLoad(acceptDraft(draft, "synthetic-rate-con.pdf"));
      if (!read.ok) throw new Error(read.message);

      const outcome = await wire(tx)(scope, read.confirmed);
      if (outcome.status !== "saved") throw new Error("expected a save");

      const saved = await createLoadRepository(tx).findById(scope, outcome.load.id);

      expect(saved?.load.details.intake).toMatchObject({
        producedBy: "label-proximity-v1",
        textSource: "pdf-text",
        filename: "synthetic-rate-con.pdf",
      });
      // The reviewer accepted everything, so the only entries are the flagged
      // fields they checked and let stand.
      expect(saved?.load.details.intake?.corrections).toEqual([]);
      expect(saved?.load.details.intake?.acceptedFlagged.length).toBeGreaterThan(0);
    });
  });

  it("links the carrier when one has already been vetted here", async () => {
    const draft = await draftFromFixture();

    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);

      // MC-133655 is the number on the fixture.
      const carrier = await createCarrierRepository(tx).create(scope, {
        legalName: "GULF COAST HAULING LLC",
        mcNumber: "133655",
      });

      const read = readConfirmedLoad(acceptDraft(draft, "synthetic-rate-con.pdf"));
      if (!read.ok) throw new Error(read.message);

      const outcome = await wire(tx)(scope, read.confirmed);
      if (outcome.status !== "saved") throw new Error("expected a save");

      expect(outcome.carrierLinked).toBe(true);
      expect(outcome.load.carrierId).toBe(carrier.id);
    });
  });

  it("reports the second import of the same document instead of duplicating it", async () => {
    const draft = await draftFromFixture();

    await withRollback(async (tx) => {
      const scope = await seedBrokerage(tx);
      const confirmDraft = wire(tx);

      const first = readConfirmedLoad(acceptDraft(draft, "synthetic-rate-con.pdf"));
      if (!first.ok) throw new Error(first.message);
      await confirmDraft(scope, first.confirmed);

      const second = readConfirmedLoad(acceptDraft(draft, "synthetic-rate-con.pdf"));
      if (!second.ok) throw new Error(second.message);
      const outcome = await confirmDraft(scope, second.confirmed);

      expect(outcome.status).toBe("duplicate_reference");
    });
  });
});
