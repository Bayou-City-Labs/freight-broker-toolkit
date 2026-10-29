import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth, signIn } from "@/auth";
import styles from "../carriers/carriers.module.css";

export const metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>
          We email you a link that signs you in. No password to set or forget.
        </p>
      </header>
      <Suspense fallback={<div className={styles.skeleton} />}>
        <SignInForm />
      </Suspense>
    </div>
  );
}

async function SignInForm() {
  const session = await auth();
  if (session?.user) redirect("/carriers");

  return (
    <form
      className={styles.form}
      action={async (formData: FormData) => {
        "use server";
        await signIn("resend", {
          email: String(formData.get("email") ?? ""),
          redirectTo: "/carriers",
        });
      }}
    >
      <div className={styles.field}>
        <label className={styles.label} htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className={styles.input}
          placeholder="you@brokerage.com"
          autoComplete="email"
          required
        />
      </div>
      <button type="submit" className={styles.button}>
        Email me a link
      </button>
    </form>
  );
}
