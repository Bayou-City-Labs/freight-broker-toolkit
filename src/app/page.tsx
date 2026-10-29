import Link from "next/link";
import styles from "./carriers/carriers.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Freight Broker Toolkit</h1>
        <p className={styles.subtitle}>
          Automation for small freight brokerages. One module is live; the rest are on the
          way.
        </p>
      </header>

      <ul className={styles.list}>
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <Link href="/carriers" className={styles.rowName}>
              Carrier vetting
            </Link>
            <span className={styles.rowMeta}>
              Check a carrier against FMCSA&rsquo;s public file and keep a timestamped
              record of what you saw.
            </span>
          </div>
        </li>
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowName}>Load intake</span>
            <span className={styles.rowMeta}>
              Rate confirmation or tender in, structured load record out. Not built yet.
            </span>
          </div>
        </li>
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowName}>Document generation</span>
            <span className={styles.rowMeta}>
              Rate confirmations and bills of lading from a load record. Not built yet.
            </span>
          </div>
        </li>
      </ul>
    </div>
  );
}
