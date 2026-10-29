import type { CarrierLookup } from "../ports/carrier-lookup";
import type { CarrierCheckRepository, CarrierRepository } from "../ports/repositories";
import type { BrokerageScope } from "../tenancy";
import type { Carrier, CarrierCheck } from "./carrier";
import type { CarrierIdentifier } from "./identifier";
import { snapshotHash } from "./snapshot";
import { evaluateCarrier } from "./verdict";

/**
 * Vetting a carrier, as a use case: look it up, make sure we have a record for
 * it, derive a verdict, and store the result.
 *
 * This depends only on ports, so the whole flow is exercised in tests with
 * fakes — no database, no network. The adapters it runs against in production
 * are wired up in src/server.
 */
export interface VetCarrierDeps {
  readonly carriers: CarrierRepository;
  readonly checks: CarrierCheckRepository;
  readonly lookup: CarrierLookup;
}

export type VetOutcome =
  | {
      readonly status: "vetted";
      readonly carrier: Carrier;
      readonly check: CarrierCheck;
      /**
       * False when the provider returned byte-identical data to the previous
       * check. A broker re-vetting before dispatch wants to know "nothing has
       * moved since Tuesday" as much as they want the verdict itself.
       *
       * True on a first-ever check — there is no prior state to be unchanged
       * from, and calling that "unchanged" would read as reassurance we have
       * not earned.
       */
      readonly changed: boolean;
    }
  | { readonly status: "not_found"; readonly identifier: CarrierIdentifier };

export type VetCarrier = (
  scope: BrokerageScope,
  identifier: CarrierIdentifier,
) => Promise<VetOutcome>;

export function createVetCarrier({
  carriers,
  checks,
  lookup,
}: VetCarrierDeps): VetCarrier {
  return async function vetCarrier(scope, identifier) {
    const result = await lookup.byIdentifier(identifier);
    if (!result) return { status: "not_found", identifier };

    // The provider reports whichever numbers it holds; the broker searched by
    // one of them. Trust the provider first, then fall back to what was asked
    // for — a lookup by MC that resolves should still record that MC number,
    // even when the payload only echoes a DOT number back.
    const dotNumber =
      result.identity.dotNumber ?? (identifier.kind === "dot" ? identifier.value : null);
    const mcNumber =
      result.identity.mcNumber ?? (identifier.kind === "mc" ? identifier.value : null);

    const existing =
      (dotNumber ? await carriers.findByDotNumber(scope, dotNumber) : null) ??
      (mcNumber ? await carriers.findByMcNumber(scope, mcNumber) : null);

    const carrier =
      existing ??
      (await carriers.create(scope, {
        legalName: result.identity.legalName,
        dbaName: result.identity.dbaName,
        dotNumber,
        mcNumber,
        details: result.details,
      }));

    const previous = existing ? await checks.latestFor(scope, carrier.id) : null;
    const changed =
      previous === null || previous.payloadHash !== snapshotHash(result.payload);

    // Every check is recorded, including an unchanged one: the audit trail is
    // "we looked on this date and this is what we saw", which a diff-only log
    // cannot answer.
    const check = await checks.record(scope, {
      carrierId: carrier.id,
      source: result.source,
      payload: result.payload,
      facts: result.facts,
      verdict: evaluateCarrier(result.facts),
    });

    return { status: "vetted", carrier, check, changed };
  };
}
