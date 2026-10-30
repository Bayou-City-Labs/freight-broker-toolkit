import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Carrier } from "@/domain/carrier/carrier";
import type { Load, Party, Stop } from "@/domain/load/load";

/**
 * The server action is stubbed so this stays a render test. Importing it for
 * real drags in the session module, Auth.js and `next/server`, none of which
 * resolves outside Next's bundler.
 *
 * Typechecking and `next build` both pass on a component that throws the
 * moment it renders — the bug this project shipped once, when a `"use server"`
 * file exported a constant. This catches that class of failure, and pins the
 * `name` attributes the action depends on.
 */
vi.mock("./actions", () => ({ editLoadAction: vi.fn() }));

const { EditForm } = await import("./edit-form");

const party: Party = {
  id: "party-1",
  brokerageId: "brokerage-1",
  name: "ACME DISTRIBUTION",
  addressLine1: "4400 Navigation Blvd",
  addressLine2: null,
  city: "Houston",
  region: "TX",
  postalCode: "77011",
  country: "US",
  timeZone: "America/Chicago",
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  details: {},
};

const load: Load = {
  id: "load-1",
  brokerageId: "brokerage-1",
  referenceNumber: "884213",
  status: "booked",
  equipmentType: "dry_van",
  commodityDescription: "Canned goods",
  weightLbs: 42000,
  customerRateCents: 210_000,
  carrierPayCents: 185_000,
  carrierId: "carrier-1",
  details: { equipmentAsWritten: "53' Dry Van", carrierAsWritten: "GULF COAST HAULING LLC" },
};

const stop: Stop = {
  id: "stop-1",
  brokerageId: "brokerage-1",
  loadId: "load-1",
  sequence: 0,
  type: "pickup",
  partyId: "party-1",
  opensAtLocal: "2026-11-02T08:00",
  closesAtLocal: "2026-11-02T12:00",
  timeZone: "America/Chicago",
  appointmentType: "fcfs",
  windowRawText: "PU 11/02 0800-1200",
  details: { appointmentNumber: "PU-4471" },
};

const carrier: Carrier = {
  id: "carrier-1",
  brokerageId: "brokerage-1",
  dotNumber: "264184",
  mcNumber: "133655",
  legalName: "GULF COAST HAULING LLC",
  dbaName: null,
  details: {},
};

function render(overrides: Partial<Parameters<typeof EditForm>[0]> = {}): string {
  return renderToStaticMarkup(
    <EditForm
      load={load}
      stops={[stop]}
      parties={new Map([[party.id, party]])}
      carrier={carrier}
      {...overrides}
    />,
  );
}

describe("the edit form", () => {
  it("renders without throwing", () => {
    expect(render()).toContain("Save changes");
  });

  it("emits every field name the edit action reads", () => {
    const html = render();

    for (const name of [
      "loadId",
      "referenceNumber",
      "carrierName",
      "carrierMcNumber",
      "carrierDotNumber",
      "commodity",
      "weightLbs",
      "equipment",
      "carrierRateCents",
      "stop.id",
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

  it("fills the inputs from the saved load", () => {
    const html = render();

    expect(html).toContain('value="884213"');
    expect(html).toContain("GULF COAST HAULING LLC");
    expect(html).toContain('value="1850.00"');
    expect(html).toContain('value="2026-11-02"');
    expect(html).toContain('value="08:00"');
    expect(html).toContain('value="PU-4471"');
  });

  it("prefills the carrier numbers from the linked carrier", () => {
    const html = render();

    // A load stores the link, not the numbers someone typed. Blank fields here
    // would make every save unlink the carrier. Each value is bound to its own
    // field name so a swap between the two boxes fails this test.
    expect(html).toMatch(/name="carrierMcNumber"[^>]*value="133655"/);
    expect(html).toMatch(/name="carrierDotNumber"[^>]*value="264184"/);
  });

  it("carries the stop's id, so the route is renumbered and not reissued", () => {
    const html = render();
    expect(html).toMatch(/name="stop\.id"[^>]*value="stop-1"/);
  });

  it("keeps what the document said about the window", () => {
    const html = render();
    expect(html).toMatch(/name="stop\.windowRawText"[^>]*value="[^"]*0800-1200/);
  });

  it("says what the screen will not do", () => {
    const html = render();

    expect(html).toContain("does not change it");
    expect(html).toContain("every load that uses it");
  });

  it("leaves the carrier number boxes empty for a load with no carrier", () => {
    const html = render({ carrier: null, load: { ...load, carrierId: null } });

    // An unlinked load is the one case where empty boxes are correct rather
    // than destructive; a hardcoded prefill would also pass this test's old
    // "Save changes" assertion, so bind it to the real fields instead.
    expect(html).toMatch(/name="carrierMcNumber"[^>]*value=""/);
    expect(html).toMatch(/name="carrierDotNumber"[^>]*value=""/);
  });
});
