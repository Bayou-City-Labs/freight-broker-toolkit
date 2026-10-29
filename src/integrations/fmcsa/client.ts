import type { CarrierIdentifier } from "@/domain/carrier/identifier";
import {
  CarrierLookupError,
  type CarrierLookup,
  type CarrierLookupResult,
} from "@/domain/ports/carrier-lookup";
import { FMCSA_SOURCE, mapCarrierFacts, mapContactDetails, mapIdentity } from "./map";
import { extractCarrier, fmcsaResponseSchema } from "./schema";

export const FMCSA_BASE_URL = "https://mobile.fmcsa.dot.gov/qc/services";

export interface FmcsaClientOptions {
  /** QCMobile webKey. Obtained through login.gov; see README. */
  readonly webKey: string | undefined;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Reads a carrier from FMCSA's QCMobile API.
 *
 * The webKey is a secret and must never reach a log, an error message, or the
 * UI. Every thrown error here is constructed from the status and the path, not
 * from the request URL.
 */
export function createFmcsaCarrierLookup(options: FmcsaClientOptions): CarrierLookup {
  const {
    webKey,
    baseUrl = FMCSA_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  } = options;

  return {
    async byIdentifier(
      identifier: CarrierIdentifier,
    ): Promise<CarrierLookupResult | null> {
      if (!webKey) {
        throw new CarrierLookupError(
          "not_configured",
          "FMCSA_WEB_KEY is not set, so carrier lookups cannot run.",
        );
      }

      const path = pathFor(identifier);
      const url = new URL(`${baseUrl}${path}`);
      url.searchParams.set("webKey", webKey);

      const response = await request(fetchImpl, url, timeoutMs, path);

      if (response.status === 401 || response.status === 403) {
        throw new CarrierLookupError(
          "unauthorized",
          "FMCSA rejected the API key. Check FMCSA_WEB_KEY.",
        );
      }
      if (response.status === 429) {
        throw new CarrierLookupError(
          "rate_limited",
          "FMCSA is rate limiting this key. Try again shortly.",
        );
      }

      // The body is read before the status is judged, because FMCSA reports a
      // rejected key as a 404 carrying {"content": "Webkey not found"}. Taking
      // the status at face value would tell a broker the carrier does not
      // exist when in fact we never authenticated.
      const body: unknown = await response.json().catch(() => undefined);
      const parsed = fmcsaResponseSchema.safeParse(body);

      if (!parsed.success) {
        if (!response.ok) {
          throw new CarrierLookupError(
            "unavailable",
            `FMCSA returned ${response.status} for ${path}.`,
          );
        }
        throw new CarrierLookupError(
          "malformed_response",
          `FMCSA returned an unrecognised response for ${path}.`,
          { cause: parsed.error },
        );
      }

      if (typeof parsed.data.content === "string") {
        throw diagnosticError(parsed.data.content, path);
      }

      if (!response.ok && response.status !== 404) {
        throw new CarrierLookupError(
          "unavailable",
          `FMCSA returned ${response.status} for ${path}.`,
        );
      }

      // A structured-but-empty body, with or without a 404, is the genuine
      // "no such carrier".
      const carrier = extractCarrier(parsed.data);
      if (!carrier) return null;

      return {
        source: FMCSA_SOURCE,
        // The unmodified body is the audit artifact. `parsed.data` would drop
        // anything the schema doesn't name; this keeps the response whole.
        payload: body as Record<string, unknown>,
        identity: mapIdentity(carrier),
        facts: mapCarrierFacts(carrier),
        details: mapContactDetails(carrier),
      };
    },
  };
}

/**
 * FMCSA puts request-level problems in `content` as plain prose, served with a
 * 404: "Must provide Webkey", "Webkey not found". These say nothing about the
 * carrier, so every one of them has to surface as a failed lookup.
 *
 * The text is FMCSA's own and never contains the key itself, but it is capped
 * before being echoed — upstream prose should not be trusted to be short.
 */
function diagnosticError(content: string, path: string): CarrierLookupError {
  const text = content.trim().slice(0, 200);

  if (/webkey/i.test(text)) {
    return new CarrierLookupError(
      /must provide/i.test(text) ? "not_configured" : "unauthorized",
      `FMCSA rejected the request: ${text}`,
    );
  }

  return new CarrierLookupError("unavailable", `FMCSA responded "${text}" for ${path}.`);
}

function pathFor(identifier: CarrierIdentifier): string {
  return identifier.kind === "dot"
    ? `/carriers/${identifier.value}`
    : `/carriers/docket-number/${identifier.value}`;
}

async function request(
  fetchImpl: typeof fetch,
  url: URL,
  timeoutMs: number,
  path: string,
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      // A vetting result is a point-in-time snapshot; a cached one is a lie.
      cache: "no-store",
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new CarrierLookupError(
      timedOut ? "timeout" : "unavailable",
      timedOut
        ? `FMCSA did not respond within ${timeoutMs}ms.`
        : `Could not reach FMCSA for ${path}.`,
      { cause },
    );
  }
}
