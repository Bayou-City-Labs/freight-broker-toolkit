import Link from "next/link";
import styles from "../../../ui.module.css";
import { IntakeForm } from "../intake-form";

export const metadata = {
  title: "New load from a document",
};

export default function NewLoadPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/loads" className={styles.backLink}>
          ← Loads
        </Link>
        <h1 className={styles.title}>New load from a document</h1>
        <p className={styles.subtitle}>
          Paste a rate confirmation or upload a PDF. Everything read off it is yours to
          check and correct before anything is saved — nothing becomes a load until you
          say so.
        </p>
      </header>

      <IntakeForm />

      <p className={styles.note}>
        <strong>The document stays here.</strong> Extraction runs on this server: text
        comes out of the PDF locally and the structure is read by rules, with no
        third-party service in the path. Your rates are not sent anywhere.
      </p>
    </div>
  );
}
