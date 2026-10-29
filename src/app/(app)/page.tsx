import { redirect } from "next/navigation";

/**
 * There is no signed-in landing page worth showing yet: a dashboard over two
 * modules would be a summary of a summary. Send people to the work.
 *
 * Loads rather than carriers, because intake is where a broker's day starts —
 * a rate con arrives, and vetting the carrier on it is a step inside that, not
 * a separate destination.
 *
 * The layout above has already established a session, so this never redirects
 * an anonymous visitor into the app — they were sent to /signin before this
 * ran.
 */
export default function Index() {
  redirect("/loads");
}
