import Link from "next/link";
import { Suspense } from "react";
import type { CarrierCheck } from "@/domain/carrier/carrier";
import {
  carrierCheckRepository,
  carrierRepository,
  isCarrierLookupConfigured,
} from "@/server/carriers";
import { requireBrokerage } from "@/server/tenant";
import styles from "../../ui.module.css";
import { DataLimitsNote, UncheckedBadge, VerdictBadge, formatCheckedAt } from "./ui";
import { VetForm } from "./vet-form";

export const metadata = {
  title: "Carrier vetting",
};

export default function CarriersPage({ searchParams }: PageProps<"/carriers">) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Carrier vetting</h1>
        <p className={styles.subtitle}>
          Look up a carrier in FMCSA&rsquo;s public file by MC or USDOT number. Every
          check is stored with the raw response, so you can show what you saw and when you
          saw it.
        </p>
      </header>

      <Suspense fallback={<div className={styles.skeleton} />}>
        <Workspace searchParams={searchParams} />
      </Suspense>

      <DataLimitsNote />
    </div>
  );
}

async function Workspace({
  searchParams,
}: {
  searchParams: PageProps<"/carriers">["searchParams"];
}) {
  // The route group's layout has already guaranteed a brokerage; this throws
  // rather than renders if that guard was somehow bypassed.
  const scope = await requireBrokerage();

  // A number carried over from a load draft, so vetting is one click from the
  // review screen. Nothing is run automatically: the broker still presses the
  // button, because a lookup is a recorded event in the audit trail.
  const { kind, number } = await searchParams;

  const carriers = await carrierRepository.list(scope);
  const latest = await carrierCheckRepository.latestForEach(
    scope,
    carriers.map((carrier) => carrier.id),
  );

  return (
    <>
      {!isCarrierLookupConfigured && (
        <p className={styles.callout}>
          <strong>Lookups are not configured.</strong> Set <code>FMCSA_WEB_KEY</code> in
          the environment to enable carrier checks. Get a key by registering an
          application at mobile.fmcsa.dot.gov with a login.gov account.
        </p>
      )}

      <VetForm
        disabled={!isCarrierLookupConfigured}
        defaultKind={kind === "dot" ? "dot" : "mc"}
        defaultNumber={typeof number === "string" ? number.replace(/\D/g, "") : ""}
      />

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Carriers</h2>
        {carriers.length === 0 ? (
          <p className={styles.empty}>
            No carriers yet. Run a check above and the carrier will be saved here.
          </p>
        ) : (
          <ul className={styles.list}>
            {carriers.map((carrier) => (
              <CarrierRow
                key={carrier.id}
                id={carrier.id}
                legalName={carrier.legalName}
                dbaName={carrier.dbaName}
                dotNumber={carrier.dotNumber}
                mcNumber={carrier.mcNumber}
                check={latest.get(carrier.id) ?? null}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function CarrierRow({
  id,
  legalName,
  dbaName,
  dotNumber,
  mcNumber,
  check,
}: {
  id: string;
  legalName: string;
  dbaName: string | null;
  dotNumber: string | null;
  mcNumber: string | null;
  check: CarrierCheck | null;
}) {
  const numbers = [
    mcNumber ? `MC-${mcNumber}` : null,
    dotNumber ? `DOT ${dotNumber}` : null,
  ].filter(Boolean);

  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <Link href={`/carriers/${id}`} className={styles.rowName}>
          {legalName}
          {dbaName ? ` (dba ${dbaName})` : ""}
        </Link>
        <span className={styles.rowMeta}>
          {numbers.join(" · ")}
          {check && (
            <>
              {numbers.length > 0 ? " · " : ""}
              <span className={styles.timestamp}>
                checked {formatCheckedAt(check.checkedAt)}
              </span>
            </>
          )}
        </span>
      </div>
      {check ? <VerdictBadge level={check.verdict.level} /> : <UncheckedBadge />}
    </li>
  );
}
