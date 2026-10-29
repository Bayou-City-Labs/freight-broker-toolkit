import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { CarrierCheck } from "@/domain/carrier/carrier";
import type { VerdictLevel } from "@/domain/carrier/verdict";
import { carrierCheckRepository, carrierRepository } from "@/server/carriers";
import { getCurrentBrokerage } from "@/server/tenant";
import styles from "../carriers.module.css";
import { DataLimitsNote, FactList, VerdictBadge, formatCheckedAt } from "../ui";

export default function CarrierDetailPage({ params }: PageProps<"/carriers/[id]">) {
  return (
    <div className={styles.page}>
      <Link href="/carriers" className={styles.backLink}>
        ← All carriers
      </Link>
      <Suspense fallback={<div className={styles.skeleton} />}>
        <CarrierDetail params={params} />
      </Suspense>
      <DataLimitsNote />
    </div>
  );
}

async function CarrierDetail({
  params,
}: {
  params: PageProps<"/carriers/[id]">["params"];
}) {
  const { id } = await params;

  const scope = await getCurrentBrokerage();
  if (!scope) {
    return (
      <p className={styles.empty}>
        <Link href="/signin" style={{ textDecoration: "underline" }}>
          Sign in
        </Link>{" "}
        to view carriers.
      </p>
    );
  }

  // Scoped read: a carrier belonging to another brokerage is indistinguishable
  // from one that does not exist.
  const carrier = await carrierRepository.findById(scope, id);
  if (!carrier) notFound();

  const history = await carrierCheckRepository.historyFor(scope, carrier.id);
  const [current, ...previous] = history;

  const numbers = [
    carrier.mcNumber ? `MC-${carrier.mcNumber}` : null,
    carrier.dotNumber ? `DOT ${carrier.dotNumber}` : null,
  ].filter(Boolean);

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>{carrier.legalName}</h1>
        <p className={styles.subtitle}>
          {carrier.dbaName ? `Doing business as ${carrier.dbaName}. ` : ""}
          {numbers.join(" · ")}
          {carrier.details.physicalAddress ? ` · ${carrier.details.physicalAddress}` : ""}
        </p>
      </header>

      {current ? (
        <CurrentCheck check={current} />
      ) : (
        <p className={styles.empty}>This carrier has not been checked yet.</p>
      )}

      {previous.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Earlier checks</h2>
          <ul className={styles.list}>
            {previous.map((check) => (
              <li key={check.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={`${styles.rowName} ${styles.timestamp}`}>
                    {formatCheckedAt(check.checkedAt)}
                  </span>
                  <span className={styles.rowMeta}>
                    {check.source} · ruleset {check.verdict.rulesetVersion}
                  </span>
                </div>
                <VerdictBadge level={check.verdict.level} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const levelDot: Record<VerdictLevel, string> = {
  pass: styles.dotPass,
  warn: styles.dotWarn,
  fail: styles.dotFail,
};

function CurrentCheck({ check }: { check: CarrierCheck }) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Latest check</h2>
          <p className={styles.rowMeta}>
            <span className={styles.timestamp}>{formatCheckedAt(check.checkedAt)}</span> ·{" "}
            {check.source} · ruleset {check.verdict.rulesetVersion}
          </p>
        </div>
        <VerdictBadge level={check.verdict.level} />
      </div>

      {check.verdict.reasons.length > 0 ? (
        <ul className={styles.reasons}>
          {check.verdict.reasons.map((reason) => (
            <li key={reason.code} className={styles.reason}>
              {/* The dot carries the level visually; the badge above and the
                  wording of the message carry it for everyone else. */}
              <span
                className={`${styles.reasonDot} ${levelDot[reason.level]}`}
                aria-hidden="true"
              />
              <span>{reason.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.rowMeta}>
          Nothing in the public file disqualifies this carrier.
        </p>
      )}

      <FactList facts={check.facts} />
    </section>
  );
}
