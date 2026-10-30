# FMCSA data limits, QCMobile quirks, carrier vetting flow

Known limits of the FMCSA data
Most carriers are unrated (absence of a bad rating is not a good sign), and CSA Crash Indicator and HazMat percentiles are not public — a carrier can look clean to us and still be flagged in FMCSA's own screening. "Insurance on file" means a filing exists, not that coverage suits a given load. None of it detects identity theft or double brokering. DataLimitsNote in src/app/(app)/carriers/ui.tsx states all of this on the screen where the booking decision is made.

One mapping gap worth knowing: a carrier with no interstate authority on file but allowedToOperate: "Y" is reported as active. That is correct for an intrastate move and wrong for an interstate one, and the payload does not say which the broker is booking. The verdict rules cannot close this.

Quirks of the QCMobile API
Discovered by probing it, not from the docs — the docs are wrong in places.

A rejected or missing key returns HTTP 404 with content as a plain string ("Webkey not found", "Must provide Webkey"). By status alone this is identical to an unknown carrier, so the client parses the body before trusting the status. Reporting "no such carrier" when we never authenticated is the failure mode the whole CarrierLookupError taxonomy exists to prevent.
The published element list disagrees with the wire format: docs say allowToOperate and outOfService, the API sends allowedToOperate and oosDate. Counts arrive as numbers or as strings. Hence the deliberately permissive schema.
content is an object for a DOT lookup and an array for a docket-number lookup. Confirmed live against MC-133655 — the docs say "Object" for both. Since MC is the primary way brokers search, an object-only schema would have failed the main path.

Carrier vetting is implemented end to end. Sign in, enter an MC or USDOT number, get a pass/warn/fail verdict with reasons, and a stored snapshot. /carriers lists every carrier with its current verdict; /carriers/[id] shows the latest check, the derived facts, and the full history.

The flow: parseCarrierIdentifier → CarrierLookup port → FMCSA adapter → CarrierFacts → evaluateCarrier → persisted CarrierCheck. createVetCarrier in src/domain/carrier/vetting.ts depends only on ports, so the whole use case is tested with in-memory fakes; the adapters are tested separately against fixtures.

A re-check reports whether the payload moved (changed), by comparing the content hash against the previous check. Unchanged checks are still recorded — the audit trail answers "we looked on this date and saw this", which a diff-only log cannot.
