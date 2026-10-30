import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LoadEdit } from "@/domain/details";
import { editChangeLabel, EditNote, formatEditedAt } from "./ui";

/**
 * The edit trail, rendered.
 *
 * The detail page it sits on is an async server component and stays that way,
 * so the trail block was lifted into `ui.tsx` — the module the page's other
 * presentational helpers already live in — rather than the page being
 * restructured around a test. What is pinned here is what a browser pass
 * found wrong: a timestamp with no year, sixteen changes run into one
 * paragraph, and storage field names on a broker-facing screen.
 */
const EDIT: LoadEdit = {
  at: "2026-10-30T02:25:00.000Z",
  changes: [
    { path: "carrierPayCents", from: "$2,450.00", to: "$2,600.00" },
    { path: "stops.0.windowStart", from: "08:00", to: "09:00" },
  ],
};

describe("formatEditedAt", () => {
  it("carries the year, so a previous year's edit cannot read as today's", () => {
    expect(formatEditedAt(EDIT.at)).toContain("2026");
  });

  it("states the time the way the dock windows on the same page do", () => {
    // 24-hour, matching `formatWindow`. The windows cannot move to 12-hour
    // without reformatting the wall-clock strings the document stated, so the
    // timestamp is the half that gives way.
    //
    // Called the way the page calls it — no zone argument — because that is
    // the only configuration production has. An earlier version of this test
    // passed `America/Chicago`, which the page never passed, so it pinned the
    // formatting and missed the zone entirely: on Vercel the same instant
    // rendered as the next day in UTC and the suite stayed green.
    const rendered = formatEditedAt(EDIT.at);
    expect(rendered).toBe("Oct 29, 2026, 21:25 CT");
    expect(rendered).not.toMatch(/[AP]M/);
  });

  it("takes its zone from the formatter, not from the host", () => {
    // The trail is rendered by a server component, so the host's zone is
    // whatever the deploy happens to be — UTC on Vercel, Central on this
    // laptop. An entry that read differently depending on which machine
    // rendered it would not be an audit trail.
    //
    // What pins that is the `timeZone` option inside `formatEditedAt`, which
    // is why this asserts on the option's effect rather than moving the host.
    // Mutating `process.env.TZ` here would prove nothing twice over: the
    // formatter never reads it, and Node does not reliably re-read it after
    // the first `Intl` call.
    // Verified by running this file under a foreign host zone, which is the
    // only way to prove it: `TZ=UTC npx vitest run` and `TZ=Asia/Tokyo …`
    // both stay green. On a UTC host an unpinned formatter renders 12:00, so
    // that run is a genuine discriminator rather than a restatement.
    const noon = formatEditedAt("2026-10-29T12:00:00.000Z");
    expect(noon).toBe("Oct 29, 2026, 07:00 CT");
    expect(noon).toContain("CT");
  });

  it("falls back to the stored string rather than rendering Invalid Date", () => {
    expect(formatEditedAt("not an instant")).toBe("not an instant");
  });
});

describe("editChangeLabel", () => {
  it("uses the form's own words, not the column names", () => {
    expect(editChangeLabel("carrierPayCents")).toBe("Carrier rate");
    expect(editChangeLabel("commodityDescription")).toBe("Commodity");
    expect(editChangeLabel("referenceNumber")).toBe("Load number");
  });

  it("numbers a stop the way the route does, from one", () => {
    expect(editChangeLabel("stops.0.partyName")).toBe("Stop 1 name");
    expect(editChangeLabel("stops.1.postalCode")).toBe("Stop 2 ZIP");
    expect(editChangeLabel("stops.2")).toBe("Stop 3");
  });

  it("names the vetting link in words a broker uses", () => {
    expect(editChangeLabel("carrierId")).toBe("Vetted carrier");
  });

  it("shows an unmapped path verbatim rather than hiding the change", () => {
    // A trail entry written before a label existed still has to render; the
    // stored path is the stable key and the label is applied at read time.
    expect(editChangeLabel("stops.0.somethingNew")).toBe("stops.0.somethingNew");
    expect(editChangeLabel("futureField")).toBe("futureField");
  });
});

describe("EditNote", () => {
  it("gives each change its own line instead of one joined paragraph", () => {
    const html = renderToStaticMarkup(<EditNote edits={[EDIT]} />);

    // One list item per change. A single stop reorder produces sixteen of
    // these, which as a joined sentence was nine wrapped lines of prose.
    expect(html.match(/<li[^>]*>Carrier rate:/)).not.toBeNull();
    expect(html).not.toContain(" · ");
  });

  it("labels each change and keeps both values", () => {
    const html = renderToStaticMarkup(<EditNote edits={[EDIT]} />);

    expect(html).toContain("Carrier rate: $2,450.00 → $2,600.00");
    expect(html).toContain("Stop 1 window opens: 08:00 → 09:00");
    expect(html).not.toContain("carrierPayCents");
  });

  it("says plainly when a save changed nothing", () => {
    const html = renderToStaticMarkup(
      <EditNote edits={[{ at: EDIT.at, changes: [] }]} />,
    );
    expect(html).toContain("No fields changed.");
  });

  it("shows the newest save first", () => {
    const older: LoadEdit = {
      at: "2026-10-01T02:25:00.000Z",
      changes: [{ path: "weightLbs", from: "41000", to: "42000" }],
    };
    const html = renderToStaticMarkup(<EditNote edits={[older, EDIT]} />);

    expect(html).toContain("Edited 2 times since it was saved.");
    expect(html.indexOf("Carrier rate")).toBeLessThan(html.indexOf("Weight"));
  });
});
