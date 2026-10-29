import type { CarrierFacts } from "@/domain/carrier/snapshot";
import type { VerdictLevel } from "@/domain/carrier/verdict";
import styles from "./carriers.module.css";

const LEVEL_CLASS: Record<VerdictLevel, string> = {
  pass: styles.pass,
  warn: styles.warn,
  fail: styles.fail,
};

const LEVEL_LABEL: Record<VerdictLevel, string> = {
  pass: "Pass",
  warn: "Warn",
  fail: "Fail",
};

/**
 * The level is spelled out, not just coloured. A dispatcher who can't
 * distinguish the amber from the green still has to be able to read this.
 */
export function VerdictBadge({ level }: { level: VerdictLevel }) {
  return (
    <span className={`${styles.badge} ${LEVEL_CLASS[level]}`}>{LEVEL_LABEL[level]}</span>
  );
}

export function UncheckedBadge() {
  return <span className={`${styles.badge} ${styles.unchecked}`}>Not checked</span>;
}

/**
 * Timestamps are rendered in Central Time because the business is Houston and
 * a fixed zone keeps server and client output identical. When a brokerage can
 * set its own zone (Phase 2), this reads from the brokerage instead.
 */
const DISPLAY_ZONE = "America/Chicago";

const timestampFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: DISPLAY_ZONE,
});

export function formatCheckedAt(at: Date): string {
  return `${timestampFormat.format(at)} CT`;
}

function authorityLabel(facts: CarrierFacts): string {
  switch (facts.authorityStatus) {
    case "active":
      return "Active";
    case "inactive":
      return "Inactive";
    case "not_authorized":
      return "Not authorized";
    case "unknown":
      return "Unknown";
  }
}

function insuranceLabel(facts: CarrierFacts): string {
  if (facts.insuranceOnFile === null) return "Not reported";
  return facts.insuranceOnFile ? "Filing on record" : "None on record";
}

function safetyLabel(facts: CarrierFacts): string {
  switch (facts.safetyRating) {
    case "satisfactory":
      return "Satisfactory";
    case "conditional":
      return "Conditional";
    case "unsatisfactory":
      return "Unsatisfactory";
    case "unrated":
      return "Unrated";
  }
}

export function FactList({ facts }: { facts: CarrierFacts }) {
  const entries: Array<[string, string]> = [
    ["Operating authority", authorityLabel(facts)],
    ["Liability insurance", insuranceLabel(facts)],
    ["Safety rating", safetyLabel(facts)],
    [
      "Out of service",
      facts.outOfService
        ? facts.outOfServiceDate
          ? `Yes, since ${facts.outOfServiceDate}`
          : "Yes"
        : "No order on file",
    ],
    [
      "Power units",
      facts.powerUnits === null ? "Not reported" : String(facts.powerUnits),
    ],
    ["Drivers", facts.drivers === null ? "Not reported" : String(facts.drivers)],
  ];

  return (
    <dl className={styles.facts}>
      {entries.map(([term, value]) => (
        <div key={term}>
          <dt className={styles.factTerm}>{term}</dt>
          <dd className={styles.factValue}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The limits of the source data, stated on the screen where the decision is
 * made rather than buried in docs. A pass here means "nothing in the public
 * file disqualifies them", which is a much weaker claim than it looks.
 */
export function DataLimitsNote() {
  return (
    <p className={styles.note}>
      <strong>What this check can and cannot tell you.</strong> It reads FMCSA&rsquo;s
      public file only. Most carriers are <em>unrated</em> — no safety rating means no
      compliance review has happened, not a clean record. CSA Crash Indicator and HazMat
      percentiles are not public, so a carrier can look clear here and still be flagged in
      FMCSA&rsquo;s own screening. &ldquo;Insurance on file&rdquo; means a filing exists,
      not that the coverage fits this load. None of it detects identity theft or double
      brokering — verify the carrier is who they say they are separately.
    </p>
  );
}
