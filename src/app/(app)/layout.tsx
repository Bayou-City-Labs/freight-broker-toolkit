import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { resolveSession } from "@/server/tenant";
import styles from "../ui.module.css";
import { signOutAction } from "./actions";

/**
 * Everything in this route group requires a signed-in user with a brokerage.
 *
 * The guard lives here rather than on each page so that adding a route means
 * opting *out* of protection, not remembering to opt in — the same reasoning
 * behind making every repository call take a BrokerageScope.
 *
 * It is not the only check, and must not be treated as one. A layout renders
 * for page requests; it does not run for server actions or route handlers,
 * which are separately addressable endpoints. Those verify independently —
 * see vetCarrierAction. This is defense in depth and a redirect for humans.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<div className={styles.bootSkeleton} />}>
      <Guard>{children}</Guard>
    </Suspense>
  );
}

async function Guard({ children }: { children: React.ReactNode }) {
  const state = await resolveSession();

  if (state.status === "signed_out") redirect("/signin");

  if (state.status === "no_brokerage") {
    return (
      <>
        <AppHeader email={state.email} brokerageName={null} />
        <div className={styles.page}>
          <header className={styles.header}>
            <h1 className={styles.title}>No brokerage yet</h1>
            <p className={styles.subtitle}>
              You are signed in as {state.email}, but your account does not belong to a
              brokerage, so there is nothing to scope your data to.
            </p>
          </header>
          <p className={styles.callout}>
            Until first-run onboarding exists, create one with{" "}
            <code>npm run db:seed -- {state.email}</code>.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader email={state.email} brokerageName={state.brokerageName} />
      {children}
    </>
  );
}

function AppHeader({
  email,
  brokerageName,
}: {
  email: string;
  brokerageName: string | null;
}) {
  return (
    <header className={styles.appBar}>
      <Link href="/carriers" className={styles.brand}>
        Freight Broker Toolkit
      </Link>

      <div className={styles.appBarRight}>
        <span className={styles.identity}>
          {/* The brokerage is shown because every query on the page is scoped
              to it. In Phase 1 it also catches a mis-seeded account early. */}
          {brokerageName && <strong className={styles.brokerage}>{brokerageName}</strong>}
          <span className={styles.email}>{email}</span>
        </span>
        <form action={signOutAction}>
          <button type="submit" className={styles.linkButton}>
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
