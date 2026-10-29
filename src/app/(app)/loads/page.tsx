import Link from "next/link";
import { Suspense } from "react";
import { loadRepository } from "@/server/intake";
import { requireBrokerage } from "@/server/tenant";
import styles from "../../ui.module.css";
import { formatMoney, StatusBadge } from "./ui";

export const metadata = {
  title: "Loads",
};

export default function LoadsPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Loads</h1>
        <p className={styles.subtitle}>
          Loads built from rate confirmations and tenders. Each one was read off a
          document and confirmed by a person.
        </p>
      </header>

      <p className={styles.inlineAction}>
        <Link href="/loads/new" className={styles.button}>
          New load from a document
        </Link>
      </p>

      <Suspense fallback={<div className={styles.skeleton} />}>
        <LoadList />
      </Suspense>
    </div>
  );
}

async function LoadList() {
  // The route group's layout has already guaranteed a brokerage; this throws
  // rather than renders if that guard was somehow bypassed.
  const scope = await requireBrokerage();
  const loads = await loadRepository.list(scope);

  if (loads.length === 0) {
    return (
      <p className={styles.empty}>
        No loads yet. Paste a rate confirmation above and you will get a draft to check.
      </p>
    );
  }

  return (
    <ul className={styles.list}>
      {loads.map((load) => (
        <li key={load.id} className={styles.row}>
          <div className={styles.rowMain}>
            <Link href={`/loads/${load.id}`} className={styles.rowName}>
              {load.referenceNumber}
            </Link>
            <span className={styles.rowMeta}>
              {load.commodityDescription ?? "No commodity stated"}
              {" · "}
              {formatMoney(load.carrierPayCents)} to the carrier
            </span>
          </div>
          <StatusBadge status={load.status} />
        </li>
      ))}
    </ul>
  );
}
