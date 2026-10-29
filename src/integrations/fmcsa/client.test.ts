import { describe, expect, it, vi } from "vitest";
import type { CarrierIdentifier } from "@/domain/carrier/identifier";
import { CarrierLookupError } from "@/domain/ports/carrier-lookup";
import { createFmcsaCarrierLookup } from "./client";
import {
  badKeyResponse,
  carrierResponse,
  docketResponse,
  missingKeyResponse,
  notFoundResponse,
} from "./fixtures";

const byDot: CarrierIdentifier = { kind: "dot", value: "4100001" };
const byMc: CarrierIdentifier = { kind: "mc", value: "123456" };

const WEB_KEY = "test-web-key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lookupWith(fetchImpl: typeof fetch) {
  return createFmcsaCarrierLookup({
    webKey: WEB_KEY,
    baseUrl: "https://fmcsa.invalid/qc/services",
    fetchImpl,
  });
}

/** Captures the URL each call was made against. */
function recordingFetch(response: Response | (() => Response)) {
  const calls: URL[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    calls.push(new URL(String(input)));
    return typeof response === "function" ? response() : response.clone();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("createFmcsaCarrierLookup", () => {
  it("calls the DOT endpoint for a DOT identifier", async () => {
    const { impl, calls } = recordingFetch(jsonResponse(carrierResponse()));
    await lookupWith(impl).byIdentifier(byDot);

    expect(calls[0].pathname).toBe("/qc/services/carriers/4100001");
  });

  it("calls the docket endpoint for an MC identifier", async () => {
    const { impl, calls } = recordingFetch(jsonResponse(docketResponse()));
    await lookupWith(impl).byIdentifier(byMc);

    expect(calls[0].pathname).toBe("/qc/services/carriers/docket-number/123456");
  });

  it("sends the web key as a query parameter", async () => {
    const { impl, calls } = recordingFetch(jsonResponse(carrierResponse()));
    await lookupWith(impl).byIdentifier(byDot);

    expect(calls[0].searchParams.get("webKey")).toBe(WEB_KEY);
  });

  it("returns a mapped result", async () => {
    const { impl } = recordingFetch(jsonResponse(carrierResponse()));
    const result = await lookupWith(impl).byIdentifier(byDot);

    expect(result?.source).toBe("fmcsa.qcmobile");
    expect(result?.identity.legalName).toBe("GULF COAST HAULING LLC");
    expect(result?.facts.authorityStatus).toBe("active");
  });

  it("stores the response body verbatim, not the parsed subset", async () => {
    // The payload is the audit artifact. Anything the schema doesn't name has
    // to survive, or a field we haven't modelled yet is lost for good.
    const body = carrierResponse({ someUnmodelledField: "keep me" });
    const { impl } = recordingFetch(jsonResponse(body));
    const result = await lookupWith(impl).byIdentifier(byDot);

    expect(result?.payload).toEqual(body);
  });

  it("carries contact details through to the carrier record", async () => {
    const { impl } = recordingFetch(jsonResponse(carrierResponse()));
    const result = await lookupWith(impl).byIdentifier(byDot);

    expect(result?.details).toEqual({
      phone: "7135550100",
      physicalAddress: "1200 NAVIGATION BLVD, HOUSTON, TX 77002",
    });
  });

  it("handles an array content from the docket endpoint", async () => {
    const { impl } = recordingFetch(jsonResponse(docketResponse()));
    const result = await lookupWith(impl).byIdentifier(byMc);

    expect(result?.identity.dotNumber).toBe("4100001");
  });

  it("returns null for a 200 with null content", async () => {
    const { impl } = recordingFetch(jsonResponse(notFoundResponse));
    expect(await lookupWith(impl).byIdentifier(byDot)).toBeNull();
  });

  it("returns null for a 404 with a structured body", async () => {
    const { impl } = recordingFetch(jsonResponse(notFoundResponse, 404));
    expect(await lookupWith(impl).byIdentifier(byDot)).toBeNull();
  });

  // FMCSA serves key problems as a 404 whose `content` is prose. Reading the
  // status alone would report "no such carrier" for what is really an auth
  // failure — the one confusion this whole error taxonomy exists to prevent.
  it("does not mistake a rejected key for a missing carrier", async () => {
    const { impl } = recordingFetch(jsonResponse(badKeyResponse, 404));
    const result = await lookupWith(impl)
      .byIdentifier(byDot)
      .catch((e: unknown) => e);

    expect(result).toBeInstanceOf(CarrierLookupError);
    expect((result as CarrierLookupError).kind).toBe("unauthorized");
  });

  it("does not mistake a missing key for a missing carrier", async () => {
    const { impl } = recordingFetch(jsonResponse(missingKeyResponse, 404));
    await expect(lookupWith(impl).byIdentifier(byDot)).rejects.toMatchObject({
      kind: "not_configured",
    });
  });

  it("surfaces any other prose diagnostic as a failed lookup", async () => {
    const { impl } = recordingFetch(
      jsonResponse({ content: "Service temporarily unavailable" }, 404),
    );
    await expect(lookupWith(impl).byIdentifier(byDot)).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("throws not_configured when no key is set, without making a request", async () => {
    const { impl, calls } = recordingFetch(jsonResponse(carrierResponse()));
    const lookup = createFmcsaCarrierLookup({
      webKey: undefined,
      baseUrl: "https://fmcsa.invalid/qc/services",
      fetchImpl: impl,
    });

    await expect(lookup.byIdentifier(byDot)).rejects.toMatchObject({
      name: "CarrierLookupError",
      kind: "not_configured",
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [500, "unavailable"],
    [503, "unavailable"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    const { impl } = recordingFetch(jsonResponse({}, status));
    await expect(lookupWith(impl).byIdentifier(byDot)).rejects.toMatchObject({ kind });
  });

  it("maps a timeout to its own kind", async () => {
    const impl = vi.fn(async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof fetch;

    await expect(lookupWith(impl).byIdentifier(byDot)).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("maps a transport failure to unavailable", async () => {
    const impl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(lookupWith(impl).byIdentifier(byDot)).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("maps a non-JSON body to malformed_response", async () => {
    // An HTML error page from a proxy, served with a 200.
    const impl = vi.fn(
      async () => new Response("502 Bad Gateway", { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(lookupWith(impl).byIdentifier(byDot)).rejects.toMatchObject({
      kind: "malformed_response",
    });
  });

  it("never puts the web key in an error message", async () => {
    // These messages reach logs and, for some kinds, the broker's screen.
    const statuses = [401, 429, 500];
    for (const status of statuses) {
      const { impl } = recordingFetch(jsonResponse({}, status));
      const error = await lookupWith(impl)
        .byIdentifier(byDot)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CarrierLookupError);
      expect((error as Error).message).not.toContain(WEB_KEY);
    }
  });
});
