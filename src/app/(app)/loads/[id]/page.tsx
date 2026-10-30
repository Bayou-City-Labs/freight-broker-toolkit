import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { IntakeProvenance, LoadEdit } from "@/domain/details";
import { carrierNameMatches } from "@/domain/load/carrier-name";
import type { Party, Stop } from "@/domain/load/load";
import { carrierRepository } from "@/server/carriers";
import { loadRepository, partyRepository } from "@/server/intake";
import { requireBrokerage } from "@/server/tenant";
import styles from "../../../ui.module.css";
import {
  formatEquipment,
  formatMoney,
  formatWeight,
  formatWindow,
  StatusBadge,
  stopTypeLabel,
} from "../ui";

export default function LoadDetailPage({ params }: PageProps<"/loads/[id]">) {
  return (
    <div className={styles.page}>
      <Link href="/loads" className={styles.backLink}>
        ← All loads
      </Link>
      <Suspense fallback={<div className={styles.skeleton} />}>
        <LoadDetail params={params} />
      </Suspense>
    </div>
  );
}

async function LoadDetail({ params }: { params: PageProps<"/loads/[id]">["params"] }) {
  const { id } = await params;
  const scope = await requireBrokerage();

  // Scoped read: a load belonging to another brokerage is indistinguishable
  // from one that does not exist.
  const found = await loadRepository.findById(scope, id);
  if (!found) notFound();

  const { load, stops } = found;

  const parties = new Map<string, Party>();
  for (const partyId of new Set(stops.map((stop) => stop.partyId))) {
    const party = await partyRepository.findById(scope, partyId);
    if (party) parties.set(partyId, party);
  }

  const carrier = load.carrierId
    ? await carrierRepository.findById(scope, load.carrierId)
    : null;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.cardHeader}>
          <h1 className={styles.title}>Load {load.referenceNumber}</h1>
          <StatusBadge status={load.status} />
          <Link href={`/loads/${load.id}/edit`} className={styles.inlineLink}>
            Edit load
          </Link>
        </div>
        <p className={styles.subtitle}>
          {load.commodityDescription ?? "No commodity stated"} ·{" "}
          {formatEquipment(load.equipmentType, load.details.equipmentAsWritten)}
        </p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Load</h2>
        <dl className={styles.facts}>
          <Fact term="Carrier pay" value={formatMoney(load.carrierPayCents)} />
          <Fact term="Customer rate" value={formatMoney(load.customerRateCents)} />
          <Fact term="Weight" value={formatWeight(load.weightLbs)} />
          <Fact
            term="Equipment"
            value={formatEquipment(load.equipmentType, load.details.equipmentAsWritten)}
          />
        </dl>
        <CarrierLine
          carrier={carrier}
          asWritten={load.details.carrierAsWritten ?? null}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Route</h2>
        {stops.length === 0 ? (
          <p className={styles.empty}>This load has no stops.</p>
        ) : (
          <ol className={styles.list}>
            {stops.map((stop) => (
              <StopRow
                key={stop.id}
                stop={stop}
                party={parties.get(stop.partyId) ?? null}
              />
            ))}
          </ol>
        )}
      </section>

      {load.details.intake && <IntakeNote provenance={load.details.intake} />}
      {load.details.edits && load.details.edits.length > 0 && (
        <EditNote edits={load.details.edits} />
      )}
    </>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className={styles.factTerm}>{term}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </div>
  );
}

/**
 * Says plainly when the carrier on this load has never been vetted here.
 *
 * A load whose carrier is a name on a PDF looks exactly like one whose carrier
 * has a vetting history, and only one of those is safe to dispatch. Intake does
 * not create carrier records precisely so this distinction survives — which
 * only helps if the screen draws it.
 *
 * It also draws the sharper distinction: the number on the document resolved
 * to a carrier whose name is *not* the one the document used. See
 * `carrierNameMatches` for why that is the one thing on this page worth
 * interrupting someone over.
 */
function CarrierLine({
  carrier,
  asWritten,
}: {
  carrier: { id: string; legalName: string; dbaName: string | null } | null;
  asWritten: string | null;
}) {
  if (carrier) {
    if (!carrierNameMatches(asWritten, carrier)) {
      return (
        <p className={styles.callout}>
          <strong>The name and the number disagree.</strong> The document names{" "}
          <strong>{asWritten}</strong>, but that MC/USDOT number is registered to{" "}
          <Link href={`/carriers/${carrier.id}`} className={styles.inlineLink}>
            {carrier.legalName}
          </Link>
          . That is either a typo on the rate confirmation or someone operating under
          another carrier&rsquo;s authority — confirm who you are actually booking before
          dispatching.
        </p>
      );
    }

    return (
      <p className={styles.inlineAction}>
        Carrier:{" "}
        <Link href={`/carriers/${carrier.id}`} className={styles.inlineLink}>
          {carrier.legalName}
        </Link>
      </p>
    );
  }

  if (!asWritten) {
    return <p className={styles.inlineAction}>No carrier named on the document.</p>;
  }

  return (
    <p className={styles.callout}>
      <strong>{asWritten}</strong> was named on the document but has never been vetted
      here, so there is no authority or insurance check behind this load.{" "}
      <Link href="/carriers" className={styles.inlineLink}>
        Vet them now
      </Link>
      .
    </p>
  );
}

function StopRow({ stop, party }: { stop: Stop; party: Party | null }) {
  const address = party
    ? [
        party.addressLine1,
        [party.city, party.region].filter(Boolean).join(", "),
        party.postalCode,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.rowName}>
          {stop.sequence + 1}. {stopTypeLabel(stop.type)} — {party?.name ?? "Unknown"}
        </span>
        <span className={styles.rowMeta}>
          {formatWindow(stop)}
          {address ? ` · ${address}` : ""}
        </span>
        {stop.windowRawText && (
          <span className={styles.sourceText}>document said “{stop.windowRawText}”</span>
        )}
      </div>
    </li>
  );
}

/**
 * How this load was read, and what the reviewer had to fix.
 *
 * On the screen rather than only in the column because it is the record of how
 * much the extractor can be trusted: a load with six corrections is evidence
 * about the parser, and the person best placed to notice the pattern is the one
 * who made them.
 */
function IntakeNote({ provenance }: { provenance: IntakeProvenance }) {
  const source =
    provenance.textSource === "plain-text"
      ? "pasted text"
      : provenance.textSource === "ocr"
        ? "OCR"
        : "the PDF text layer";

  return (
    <p className={styles.note}>
      <strong>How this was read.</strong> Extracted by {provenance.producedBy} from{" "}
      {source}
      {provenance.filename ? ` (${provenance.filename})` : ""}.{" "}
      {provenance.corrections.length === 0
        ? "Nothing was corrected on review."
        : `${provenance.corrections.length} field${
            provenance.corrections.length === 1 ? " was" : "s were"
          } corrected on review: ${provenance.corrections
            .map((correction) => correction.path)
            .join(", ")}.`}{" "}
      {provenance.acceptedFlagged.length > 0 &&
        `${provenance.acceptedFlagged.length} flagged field${
          provenance.acceptedFlagged.length === 1 ? " was" : "s were"
        } checked and accepted as read.`}
    </p>
  );
}

/**
 * What has changed since this load was saved.
 *
 * On the screen rather than only in the column, for the same reason the intake
 * note is: a rate con is an agreement, and "the carrier pay says $1,850 — did
 * it always?" is a question someone eventually asks. Newest first, since the
 * usual question is about the last change — but every save is shown, because
 * nobody has yet seen a load with enough edits to need collapsing. Revisit
 * when one does.
 */
function EditNote({ edits }: { edits: readonly LoadEdit[] }) {
  const newest = [...edits].reverse();

  return (
    <div className={styles.note}>
      <strong>
        Edited {edits.length === 1 ? "once" : `${edits.length} times`} since it was saved.
      </strong>
      <ul className={styles.list}>
        {newest.map((edit, index) => (
          <li key={`${edit.at}-${index}`} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowName}>{formatEditedAt(edit.at)}</span>
              <span className={styles.rowMeta}>
                {edit.changes.length === 0
                  ? "No fields changed."
                  : edit.changes
                      .map(
                        (change) =>
                          `${change.path}: ${change.from ?? "—"} → ${change.to ?? "—"}`,
                      )
                      .join(" · ")}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The instant an edit was made, in the reader's own zone — unlike a dock window. */
function formatEditedAt(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
