import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Party } from "@/domain/load/load";
import { carrierRepository } from "@/server/carriers";
import { partyRepository } from "@/server/intake";
import { requireBrokerage } from "@/server/tenant";
import styles from "../../../../ui.module.css";
import { loadForPage } from "../load-page-data";
import { EditForm } from "./edit-form";

/** Matches the heading, so a tab mid-edit is tellable from the load itself. */
export async function generateMetadata({ params }: PageProps<"/loads/[id]/edit">) {
  const { id } = await params;
  const found = await loadForPage(id);
  return { title: found ? `Edit load ${found.load.referenceNumber}` : "Edit load" };
}

export default function EditLoadPage({ params }: PageProps<"/loads/[id]/edit">) {
  return (
    <div className={styles.page}>
      <Suspense fallback={<div className={styles.skeleton} />}>
        <EditLoad params={params} />
      </Suspense>
    </div>
  );
}

async function EditLoad({ params }: { params: PageProps<"/loads/[id]/edit">["params"] }) {
  const { id } = await params;
  const scope = await requireBrokerage();

  // Scoped read: another brokerage's load is indistinguishable from one that
  // does not exist. Shared with `generateMetadata` above.
  const found = await loadForPage(id);
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
      <Link href={`/loads/${load.id}`} className={styles.backLink}>
        ← Load {load.referenceNumber}
      </Link>
      <header className={styles.header}>
        <h1 className={styles.title}>Edit load {load.referenceNumber}</h1>
        <p className={styles.subtitle}>
          Every change is recorded on the load, with what the value was before.
        </p>
      </header>
      <EditForm load={load} stops={stops} parties={parties} carrier={carrier} />
    </>
  );
}
