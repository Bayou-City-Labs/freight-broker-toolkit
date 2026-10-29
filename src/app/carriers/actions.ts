"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  formatIdentifier,
  parseCarrierIdentifier,
  type CarrierIdentifierKind,
} from "@/domain/carrier/identifier";
import { CarrierLookupError } from "@/domain/ports/carrier-lookup";
import { getCurrentBrokerage } from "@/server/tenant";
import { vetCarrier } from "@/server/carriers";

export type VetFormState =
  | { readonly status: "idle" }
  /** A finding: the provider answered, and has no such carrier. */
  | { readonly status: "not_found"; readonly message: string }
  /** We could not get an answer. Deliberately worded so it can't read as a pass. */
  | { readonly status: "error"; readonly message: string };

export const initialVetFormState: VetFormState = { status: "idle" };

export async function vetCarrierAction(
  _previous: VetFormState,
  formData: FormData,
): Promise<VetFormState> {
  const scope = await getCurrentBrokerage();
  if (!scope) {
    return {
      status: "error",
      message: "You are not signed in to a brokerage.",
    };
  }

  const kind: CarrierIdentifierKind = formData.get("kind") === "dot" ? "dot" : "mc";
  const identifier = parseCarrierIdentifier(String(formData.get("number") ?? ""), kind);
  if (!identifier) {
    return {
      status: "error",
      message: "Enter an MC or USDOT number — digits only, up to eight.",
    };
  }

  let outcome;
  try {
    outcome = await vetCarrier(scope, identifier);
  } catch (error) {
    if (error instanceof CarrierLookupError) {
      return { status: "error", message: lookupFailureMessage(error) };
    }
    throw error;
  }

  if (outcome.status === "not_found") {
    return {
      status: "not_found",
      message: `FMCSA has no record of ${formatIdentifier(identifier)}. Check the number with the carrier.`,
    };
  }

  revalidatePath("/carriers");
  redirect(`/carriers/${outcome.carrier.id}`);
}

/**
 * A failed lookup is not a verdict. Every message here says we know nothing,
 * never that the carrier is fine — the whole point of separating this from a
 * `not_found` result is that a broker must not read an outage as a clean bill.
 */
function lookupFailureMessage(error: CarrierLookupError): string {
  switch (error.kind) {
    case "not_configured":
      return "Carrier lookups are not configured yet: FMCSA_WEB_KEY is not set.";
    case "unauthorized":
      return "FMCSA rejected our API key, so this carrier could not be checked.";
    case "rate_limited":
      return "FMCSA is rate limiting us. Wait a moment and try again — this carrier is not yet checked.";
    case "timeout":
      return "FMCSA did not respond in time. This carrier is not yet checked.";
    case "malformed_response":
      return "FMCSA returned a response we could not read. This carrier is not yet checked.";
    case "unavailable":
      return "FMCSA could not be reached. This carrier is not yet checked.";
  }
}
