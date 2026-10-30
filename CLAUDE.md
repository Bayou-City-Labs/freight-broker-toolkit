# Bayou City Labs — Freight Broker Toolkit

## What this is

Automation tools for small and mid-size freight brokers (roughly 2–50 people), starting in Houston. These brokers run on email, spreadsheets, and an aging or entry-level TMS. They lose hours every day re-keying load data, generating documents, and vetting carriers.

The business starts as custom builds for paying clients. This codebase is the shared foundation those builds draw from, and the eventual SaaS product.

**Status: pre-validation, with a production-grade foundation built on spec.** Customer discovery calls are in progress; there is no client yet. The foundation (schema, tenancy, auth, tests, CI, deploy) is deliberately built to production standards because it survives a pivot. Everything above it — UI flows, document templates, extraction field lists — stays cheap to change, because discovery can still invalidate it.

Where a decision is speculative, it is made reversible rather than deferred: uncertain fields live in a validated `jsonb` column, vendors sit behind ports, routing is modelled as ordered stops rather than fixed foreign keys.

## Owner context

- Sam: senior full-stack engineer (TypeScript, Node, React, C#/.NET). Formerly at Gulf Winds (Houston logistics), so knows the domain basics.
- Writes code at a senior level. Skip beginner explanations, flag tradeoffs.

## MVP scope (provisional — revise after discovery)

Three modules, each usable on its own:

1. **Load intake (local-first, no external LLM required)**
   - Paste an email or upload a PDF/image (rate confirmation, tender) and extract a structured `LoadDraft`: shipper, consignee, pickup/delivery windows, commodity, weight, equipment, rate, reference numbers.
   - Two stages behind a pluggable `Extractor` interface, so stages can be swapped or chained:
     - **Text stage:** `PdfTextExtractor` (`unpdf`/`pdfjs-dist`, text with x/y positions) for digital PDFs. When there's no text layer, fall back to `TesseractExtractor` (`pdf-to-img` → `sharp` preprocessing → `tesseract.js`).
     - **Structure stage:** `TemplateParser`, one template per document layout (anchor labels + positions + regex), selected by sender domain or layout fingerprint. Optional fallback for unknown layouts: a local LLM via Ollama, off by default and enabled per brokerage.
   - Every extractor returns a zod-validated `LoadDraft` plus per-field confidence. Low-confidence or missing fields are flagged, and a human always reviews and edits before saving.
   - No document data leaves the server unless a brokerage explicitly enables an external provider.
   - Keep anonymized real documents in `/fixtures/intake/` as regression tests for each template. Public samples and synthetic documents count — waiting on client permission would block the module indefinitely.
   - **Carrier vetting is reachable from a draft.** A rate con names the carrier; vetting it should be one click from the review screen, not a separate errand. This is the first place the modules compose.
2. **Document generation**
   - From a load record, generate a carrier rate confirmation and a BOL as PDFs.
   - Templates are editable per brokerage (logo, terms, fields).
3. **Carrier vetting**
   - Look up a carrier by MC/DOT number using the FMCSA public data API: authority status, insurance on file, safety rating, out-of-service flags.
   - Show a pass/warn/fail summary and store a snapshot with a timestamp for the audit trail.

### Load intake: build order, and what a document corpus actually calibrates

Build order — **steps 1–4 are built** (see "Current state"):

1. ~~**Text stage — digital PDFs with positions.**~~ Built. Also a plain-text stage, because a pasted email is the commonest intake there is.
2. ~~**The review screen.**~~ Built, including the save into a real `Load` + `Stop[]` + `Party`.
3. **Structure stage** — the generic label-proximity parser is built. Per-layout templates are **not**, and are the next decision, not the next task: build them where they measurably beat the generic parser on real documents.
4. ~~**A corpus inspector.**~~ Built as a CLI: `npm run intake:inspect -- <file...>`.

**Real documents are not a build gate.** An earlier version of this file said not to build the structure stage before having a corpus. That was wrong, and it conflated two separate things: whether the template _engine_ can be built, and whether templating will be a good _strategy_. The engine — anchor labels, positions, regex, fingerprint selection — is identical whether a template corresponds to McLeod or to Acme Foods. It does not care what the cluster means. Build it against synthetic fixtures.

What a corpus calibrates, none of which blocks the above:

- **Template authoring ergonomics — the real fork.** Five templates ever means hand-written objects forever. Fifty, with clients adding their own unaided, means a template editor, probably a teach-by-example flow over a rendered PDF. A different order of build, and a decision to make _after_ the engine exists.
- **How good the Ollama fallback must be** — rare path or main path.
- **Confidence calibration** — what a 0.6 from a template match should mean next to a 0.6 from an LLM, on one review screen.

**The trap in synthetic-only fixtures.** Author a dummy rate con, then write a template for it, and the template matches perfectly — because the same person wrote both sides. That validates the engine and proves nothing about the premise. Worse, the engine quietly gets shaped around whatever the generator emits: clean `Label: value` pairs produce an anchor matcher that assumes them, which then meets a real rate con whose pickup window sits in an unruled table, whose weight is a rotated stamp, and three of whose fields are one merged text run. Keep a handful of real documents to design against, even before there is coverage.

**The business signal, which is separate from the code.** Whether layouts cluster by TMS vendor or by shipper predicts whether Phase 2 self-serve is reachable: a "McLeod rate con" template is reusable across every future client, where a per-shipper template is bespoke work on every onboarding. Worth knowing early for roadmap and pricing. It changes investment sizing, not the build.

### Known constraints on the intake pipeline

Flagged before building, because each one changes the shape of the code:

- **OCR does not fit in a request handler.** `tesseract.js` is WASM: cold start, language-data load, then seconds per page, and memory-hungry. A multi-page scanned rate con will exceed the function timeout on Vercel. That path needs a job queue and a status-polling UI — a materially bigger build than the digital-PDF path, and the reason the two stages are listed separately rather than as one step.
- ~~`unpdf`'s convenience API does not return positions.~~ **Wrong — corrected against the library.** `unpdf@2` exports `extractTextItems`, which returns `str`, `x`, `y`, `width`, `height`, `fontSize` and `hasEOL` per item. Two things that are true and useful: its x/y use PDF coordinates (**origin bottom-left**), so y is flipped to a top-left origin at the adapter boundary; and page dimensions are not included, so the adapter opens a `getDocumentProxy` once and reads `getViewport()` per page.
- **`inspectPages` is how you detect a scan.** It returns `textLength`, `invisibleTextLength`, `imageCount` and `imageCoverage` per page. A page with no text and an image covering it needs OCR — a far better signal than catching an empty extraction downstream. It resolves to `{ totalPages, pages }`, **not** an array; `pages` is the part you want. Wired in as `TextPage.imageCoverage`, and `pageNeedsOcr` uses it for the case that actually bites: a faxed page is one full-page image with a transmission footer stamped on it, so it _has_ text and a test for emptiness waves it through to a parser that then finds nothing.
- **Text arrives as fragments, not lines.** unpdf emits `"ACME"`, `" "`, `"LOGISTICS"` as separate items. Assembling lines by y-proximity is the adapter's job, and it is the part worth unit-testing, since every downstream parser depends on it.
- ~~**The existing `Extractor` port does not fit.**~~ Reshaped into `TextExtractor` + `StructureParser` in `src/domain/ports/intake.ts`; the old `Extractor` is gone.
- **`sharp` is a heavy native dependency.** Only pull it in when the OCR path is actually built.

### Lessons from building it, which cost real time

- **Geometry must not be smuggled through the text.** `toLines` normalizes a column gap to a single space by design — positions stay on the items. A first cut of the label parser then tried to split "Load #: 884213 Date: 10/28/2026" with a `\s{2,}` rule, which could never fire, so the load number silently swallowed the date on the one fixture that existed. The fix is `toColumns(line)`, which re-derives column breaks from item x-gaps. **If a rule needs to know where a value ends, read the items, not the string.**
- **Right-aligned values are as common as inline ones.** "Total Rate: $2,450.00" puts the value in the _next_ column, so a parser that only reads the rest of the label's own column misses every total. Both layouts have to work: own column first, then later columns on the same row, then the line beneath.
- **Section headings and party labels are different strengths.** `PICKUP` announces a section; `Shipper:` names the company inside one. Treating both as section starts reads the standard two-stop layout as four stops. Headings win; party labels are promoted only for documents that have no headings at all, which is what a pasted tender looks like.
- **A `"use server"` file may export only async functions.** Exporting `initialVetFormState` from an actions module throws `A "use server" file can only export async functions, found object` at module evaluation and takes down whatever rendered it. It typechecks, it builds, and it only fails at runtime — the carrier module shipped with this and nothing caught it. Form state lives in a sibling `form-state.ts`.
- **Compile-time green says nothing about render-time.** That bug was found by driving the real app, not by `tsc` or `next build`. Hence `review-form.test.tsx`: `renderToStaticMarkup` over the real components, which catches a render-time throw and pins the `name` attributes the server action depends on. Rendering a client component in Vitest needs `vi.mock` on the action module — importing it for real drags in Auth.js and `next/server`, which do not resolve outside Next's bundler.

### Out of scope for now

Full TMS, load board integrations, accounting/invoicing, tracking/ELD integrations, multi-tenant billing. These come later, if discovery supports them.

## Stack

Decisions settled in the first session; see "Foundation decisions" below for the reasoning that is not obvious from the code.

- TypeScript everywhere, strict mode
- Next.js 16 (App Router, Cache Components enabled) for the UI and API routes
- PostgreSQL + **Drizzle** + postgres.js. Docker Compose locally, Neon when deployed
- zod for all external input and LLM output validation
- **Auth.js** — magic link via Resend, database sessions, Drizzle adapter
- PDF generation: **`@react-pdf/renderer`** — decided, not yet installed (lands with the doc-gen module)
- Extraction: **local-first, no external LLM in the default path.** PDF text via `unpdf`/`pdfjs-dist`, OCR fallback via `tesseract.js`, structure via templates. A local LLM through Ollama is an optional per-brokerage fallback for unknown layouts, off by default. Document data leaves the server only if a brokerage opts in
- Vitest for tests, against real Postgres with per-test transaction rollback
- Single-tenant first, but `brokerageId` is on every table and every repository call requires a `BrokerageScope`

## Foundation decisions

The non-obvious ones, with the reasoning. Revisit these deliberately, not by accident.

- **Money is integer cents** (`src/domain/money.ts`). Margin is the difference between two amounts; rounding drift there is a defect in the number the business runs on. Per-mile figures need sub-cent precision and are derived for display, never stored as money.
- **Windows are naive local wall time + IANA zone + the raw source text** (`src/domain/time-window.ts`). A rate con states a dock's wall clock and rarely a zone. Converting to an instant at intake bakes in an unauditable guess. DST gaps resolve forward, overlaps resolve to the first occurrence.
- **Routing is `Load` → ordered `Stop[]` → `Party`**, not shipper/consignee foreign keys. Multi-stop and drayage are then the same shape with more rows instead of a migration.
- **Uncertain fields live in a zod-validated `jsonb` `details` column** (`src/domain/details.ts`). Promote a field to a real column when you start querying, sorting, or filtering on it.
- **Carrier checks store the raw payload, a derived projection, and a content hash.** The hash makes Phase 3 monitoring a cheap diff; the raw payload means verdicts can be re-derived when rules change. Verdicts are stamped with `CARRIER_RULESET_VERSION`.
- **Tenancy is enforced at the repository boundary**, not by convention and not yet by RLS. Repository methods take a `BrokerageScope` first argument, so a call cannot be made without one. `src/server/tenant.ts` is the single place a scope enters the system.
- **The domain boundary is enforced by lint**, not discipline: `src/domain/**` cannot import Next.js, React, Drizzle, postgres.js, Auth.js, or the app/db/env layers. That is what makes extracting it into a shared package later a cheap move.
- **The app is gated by default, not page by page.** Everything lives under the `src/app/(app)/` route group whose layout redirects anyone without a session. Adding a route means opting _out_ of protection rather than remembering to opt in — the same reasoning as making every repository call take a `BrokerageScope`. **A layout is not a security boundary on its own:** it renders for page requests and does not run for server actions or route handlers, which are separately addressable. Those check independently (see `vetCarrierAction`), and pages use `requireBrokerage()`, which throws rather than renders if the guard was somehow bypassed.

### Known limits of the FMCSA data

Most carriers are **unrated** (absence of a bad rating is not a good sign), and CSA Crash Indicator and HazMat percentiles are **not public** — a carrier can look clean to us and still be flagged in FMCSA's own screening. "Insurance on file" means a filing exists, not that coverage suits a given load. None of it detects identity theft or double brokering. `DataLimitsNote` in `src/app/(app)/carriers/ui.tsx` states all of this on the screen where the booking decision is made.

One mapping gap worth knowing: a carrier with no interstate authority on file but `allowedToOperate: "Y"` is reported as active. That is correct for an intrastate move and wrong for an interstate one, and the payload does not say which the broker is booking. The verdict rules cannot close this.

### Quirks of the QCMobile API

Discovered by probing it, not from the docs — the docs are wrong in places.

- **A rejected or missing key returns HTTP 404** with `content` as a plain string (`"Webkey not found"`, `"Must provide Webkey"`). By status alone this is identical to an unknown carrier, so the client parses the body before trusting the status. Reporting "no such carrier" when we never authenticated is the failure mode the whole `CarrierLookupError` taxonomy exists to prevent.
- **The published element list disagrees with the wire format**: docs say `allowToOperate` and `outOfService`, the API sends `allowedToOperate` and `oosDate`. Counts arrive as numbers or as strings. Hence the deliberately permissive schema.
- **`content` is an object for a DOT lookup and an array for a docket-number lookup.** Confirmed live against MC-133655 — the docs say "Object" for both. Since MC is the primary way brokers search, an object-only schema would have failed the main path.

## Domain glossary

- **Broker:** arranges shipping between a shipper and a carrier; doesn't own trucks
- **Shipper / Consignee:** origin / destination party
- **Carrier:** trucking company that hauls the load; identified by MC and/or USDOT number
- **Rate con (rate confirmation):** agreement between broker and carrier for a specific load and rate
- **BOL (bill of lading):** shipping document for the freight; receipt and contract of carriage
- **Tender:** a shipper's offer of a load to the broker
- **Equipment:** dry van, reefer, flatbed, etc.
- **Drayage:** short-haul container moves, usually port ↔ warehouse (big in Houston)

## Engineering principles

- Domain logic stays separate from frameworks (`/src/domain`), so modules can become a product later
- Never trust LLM extraction blindly: validate with zod, show confidence, require human confirmation
- Every carrier check and generated document is stored and auditable
- Keep secrets in env vars; no real client data in fixtures (use synthetic loads)
- Small PRs, tests for domain logic and parsers; don't snapshot-test PDFs

## Long-term roadmap

Context for design decisions only. Do NOT build ahead of the current phase. Each phase has a gate that must be met first.

**Phase 1 — First paying clients (now → ~month 3)**

- Custom builds for 2–3 brokers using the shared modules above; pricing is setup fee + monthly maintenance
- Track every feature request in `/docs/requests.md`; interview questions and outreach in `/docs/discovery.md`
- Gate: 3 paying clients needing the same core module

**Phase 2 — Productize the core (~months 3–6)**

- Hosted multi-tenant app: self-serve signup, Stripe billing, per-brokerage templates
- Migrate early clients onto the single codebase
- Gate: a broker can sign up and get value without a call

**Phase 3 — Expand along the broker workflow (~months 6–12)**
Prioritize by client demand:

- Carrier monitoring and fraud alerts (insurance lapses, authority changes, identity red flags)
- Carrier onboarding packets (W-9, insurance certificates, signed agreements)
- Inbox automation (tenders and rate cons straight from email into load records)
- Invoicing, payment tracking, quick-pay to carriers
- Automatic pickup/delivery status updates to shippers
- Integrations with brokers' existing TMS (sit beside it, don't replace it)

**Phase 4 — Drayage (12+ months)**

- Houston port container drayage: container tracking, chassis management, detention/demurrage/per diem tracking

### Design implications now

- `brokerageId` on every table (multi-tenancy in Phase 2)
- Carrier checks stored as timestamped snapshots so ongoing monitoring (Phase 3) is just scheduled re-checks plus diffs
- Load intake built behind an interface so email ingestion (Phase 3) is just another source
- Keep `/src/domain` free of framework code so modules can move into the product

## Current state (carrier vetting and load intake built)

Verified: `npm test` (447 tests), `npm run lint`, `npm run typecheck`, `npm run format:check`, and `npm run build` all pass — and the intake and edit flows have both been driven in a browser end to end, which is a different question (see below).

**Load intake is implemented end to end.** Paste a rate confirmation or upload a digital PDF at `/loads/new`, get a draft with per-field confidence and the uncertain fields flagged where they sit, edit it, and save a real `Load` + ordered `Stop[]` + resolved `Party` rows. `/loads` lists them; `/loads/[id]` shows the route, the window as the document stated it, and how the load was read.

The flow: `DocumentInput` → `TextExtractor` (`PdfTextExtractor` or the plain-text stage) → `DocumentText` with positions → `StructureParser` (`label-proximity-v1`) → `LoadDraft` with confidences → **a human** → `ConfirmedLoad` → `confirmDraft` → persisted `Load`/`Stop`/`Party`. `createIntakePipeline` and `createConfirmDraft` depend only on ports, so both are tested against fakes; `intake-flow.test.ts` drives the real adapters from the fixture PDF into real Postgres, because the failure this project actually hits is a layer written and never wired.

Four things about it worth knowing without reading the code:

- **A draft is never persisted.** It round-trips through the browser in a hidden field and is re-validated on the way back. A draft nobody confirms has no value, re-extraction is cheap and deterministic, and a `load_drafts` table would be a schema commitment made to serve a screen.
- **Intake never creates a carrier.** A carrier record is the subject of a vetting history; one conjured from a name on a PDF would sit in the list looking checked. The name is kept in `details.carrierAsWritten`, the load links only to a carrier already held, and both the review screen and the load page say so out loud — with a one-click link to vet them.
- **The corrections a reviewer makes are recorded** in `details.intake`, with the confidence the parser had claimed. That is the only moment the module can learn whether a confidence meant anything, and it cannot be reconstructed afterwards. It is the evidence the scale eventually gets tuned from.
- **A name/number disagreement is reported, loudly.** The link is made on MC or DOT number, because that is what a document states precisely. When the number resolves to a carrier whose name is not the one the document used, the load page says so instead of quietly displaying the held carrier's name — that disagreement is the signature of double brokering or carrier identity theft, which the FMCSA data explicitly cannot detect but this _can_, for free, because both halves are in hand. `carrierNameMatches` normalizes corporate form and punctuation so "Gulf Coast Hauling, L.L.C." does not trip it; a warning that cries wolf stops being read.

- **A saved load can be edited, and says what changed.** `/loads/[id]/edit` rewrites the load, its route, and the facilities behind its stops. Each save appends `{at, changes}` to `details.edits`, which the load page renders — a rate con is an agreement, so "did the carrier pay always say $1,850?" is a question that gets asked. The trail is a sibling of `details.intake`, never part of it: `intake.corrections` is evidence about the _parser_, and diluting it with edits made days later would corrupt the only data the confidence scale can be calibrated from. Correcting a stop's address fixes the shared `Party`, so it is right on every load that touches that dock; retyping the name points the stop at a different facility instead, and never renames one other loads depend on.

The whole flow has been driven in a browser end to end — paste, review, correct a field, save, and the duplicate-reference path — and that is how both the `"use server"` bug and the name-mismatch gap were found. **Neither was visible to 359 passing tests, `tsc`, or `next build`.** The name-mismatch gap in particular is the one worth remembering: no test would have been written for it, because nobody had had the thought yet. It took a real screen showing a wrong-looking name. Run the thing before calling a screen done.

**The edit screen proved the same lesson twice over.** Driving it found a bug 426 passing tests, three task reviews and a clean build had all missed: clearing both carrier-number boxes set `carrier_id` to NULL and the trail recorded **nothing** — and if the unlink was the only change in that save, no entry was written at all. The vetting link is the difference between "this carrier's authority and insurance were checked" and "nobody checked", and it could move in either direction leaving no record.

It survived review because of a specific trap worth naming: `StatedView` carried `carrierId` and its own doc comment said a changed linkage "is reported as `carrierId`" — but `carrierId` was never in `LOAD_PATHS`, the list the diff actually iterates. The comment described behaviour the code did not have, and a reviewer cited that comment as evidence the case was handled. **A comment asserting a property is not evidence the property holds**; the same pattern then turned up twice more on the same branch — a timestamp comment claiming "the reader's own zone" from a server component that rendered UTC, and a test named for host-zone independence whose mechanism the code never read. On an audit trail it matters more than elsewhere: a trail that lies is worse than no trail, because it gets believed.

**[`docs/load-intake.md`](./docs/load-intake.md) is the walkthrough**: annotated screenshots of every screen a load passes through — read, review, save, and correct afterwards — paste-ready sample documents to reproduce each one, and what the module cannot do yet. Read it before changing an intake or edit screen — it is also the fastest way to hand the module to someone else. (The same screenshots are in the agent wiki's project note; the repo copy is canonical.)

**Signing in locally without the email.** Verifying a gated screen needs a session, and the magic link goes to an inbox. Drive the real callback instead: Auth.js stores `sha256(rawToken + AUTH_SECRET)` in `verification_tokens`, so insert a row with that hash and open `/api/auth/callback/resend?token=<raw>&email=<addr>&callbackUrl=<path>` — the server sets the session cookie itself. Single-use, and it exercises real auth rather than faking it. Injecting a cookie directly does not work; browser automation blocks cookie writes.

**Carrier vetting is implemented end to end.** Sign in, enter an MC or USDOT number, get a pass/warn/fail verdict with reasons, and a stored snapshot. `/carriers` lists every carrier with its current verdict; `/carriers/[id]` shows the latest check, the derived facts, and the full history.

The flow: `parseCarrierIdentifier` → `CarrierLookup` port → FMCSA adapter → `CarrierFacts` → `evaluateCarrier` → persisted `CarrierCheck`. `createVetCarrier` in `src/domain/carrier/vetting.ts` depends only on ports, so the whole use case is tested with in-memory fakes; the adapters are tested separately against fixtures.

A re-check reports whether the payload moved (`changed`), by comparing the content hash against the previous check. Unchanged checks are still recorded — the audit trail answers "we looked on this date and saw this", which a diff-only log cannot.

**Entities (12 tables).** Seven business tables — `Brokerage`, `Party`, `Load`, `Stop`, `Carrier`, `CarrierCheck`, `Document` — plus Auth.js's `User`/`Account`/`Session`/`VerificationToken` and a `Membership` join carrying `brokerageId` + role. `Stop` is an addition to the original six; see "Foundation decisions".

**Layout.**

- `src/domain/` — framework-free. Money, time windows, carrier facts, verdicts, the vetting use case, `details` schemas, ports (`CarrierLookup`, `DocumentStore`, `TextExtractor`/`StructureParser`, repositories)
- `src/domain/intake/` — the whole intake brain: `document-text` (line and column assembly, scan detection), `plain-text` (the pasted-email stage, in the domain because it is pure string handling with no vendor), `parse-values`, `label-parser`, `load-draft`, `pipeline`, `confirm`, `provenance`, `fingerprint`
- `src/domain/load/` — load/stop/party shapes plus the status, equipment and stop-type vocabularies. These moved out of the Drizzle schema so a parser can classify equipment without the database on its import path; the schema reads them from here and re-exports them. Also `load-values` (a load as a human states it: the schemas plus the translation into stored shapes, shared by intake's confirm step and the edit screen so rules like "never create a carrier" have one implementation) and `update` (the edit use case, including the diff that writes the trail)
- `src/db/` — Drizzle schema, client, repository implementations
- `src/integrations/` — outbound vendor adapters. `fmcsa/` implements `CarrierLookup`: a permissive zod schema, the payload→facts mapper, and the HTTP client. `pdf/` implements `TextExtractor` over `unpdf`
- `src/tools/inspect-document.ts` — the corpus inspector (`npm run intake:inspect`). Not production code
- `src/env/` — zod-parsed env, split by concern so a migration doesn't require an email provider key
- `src/server/tenant.ts` — the only place a `BrokerageScope` is created from a session. `resolveSession()` returns three states, not two: signed out, **signed in with no brokerage**, and ready. The middle one needs its own screen — folding it into "signed out" bounces the user to `/signin`, which redirects signed-in users back, forever. Wrapped in React `cache` so the layout and the page beneath it share one session read
- `src/server/intake.ts` — composition root for intake and editing. Extractor order is the routing rule: each declares what it `supports`, first match wins
- `src/server/carriers.ts` — composition root for vetting. Deliberately **not** `server-only`: nothing in it touches a request, and Phase 3's scheduled re-checks are a plain Node process that needs exactly this module. `server-only` belongs on modules that read a session
- `src/test/` — transaction-rollback harness and global migration setup

**Getting started.** Copy `.env.example` to `.env.local`, then `npm run db:up && npm run db:migrate && npm test`. Carrier lookups additionally need `FMCSA_WEB_KEY`; without it the vetting screen renders a setup notice instead of failing. `FMCSA_BASE_URL` points the client at a stub to exercise the flow without a key. Load intake needs nothing beyond the database — no key, no network.

**Trying load intake.** [`docs/load-intake.md`](./docs/load-intake.md) walks the whole flow with screenshots and paste-ready documents.

**Looking at a document.** `npm run intake:inspect -- fixtures/intake/synthetic-rate-con.pdf`. Add `--items` for every positioned item and the plain text, `--quiet` for just the fingerprint and the draft. Pass several files to get a layout cluster report. `.txt`/`.eml` files are read as pasted text, which is how an email joins the corpus.

**Deployed.** https://freight-broker-toolkit.vercel.app, on Neon Postgres provisioned through the Vercel marketplace; the schema is migrated there. The repo is connected, so pushes deploy automatically — `main` to production, branches to previews. Note that `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` have to be set in the Vercel environment as well as `.env.local`; a key that only exists locally will not make deployed sign-in work.

### Deliberately not built yet

- A `Document` repository — that table exists, but its access patterns belong to document generation. `Load` and `Party` repositories are built; intake was the real module they were waiting for
- The PDF renderer and a `DocumentStore` implementation (both land with doc generation)
- **OCR.** `pageNeedsOcr` detects a scan and the pipeline returns `needs_ocr`, which the screen explains. The path itself needs a job queue — see the constraints above
- **Per-layout templates.** The generic label-proximity parser is the baseline; templates should be built where they measurably beat it on real documents, which needs real documents
- **Deleting a saved load.** Editing is built (`/loads/[id]/edit`): any field, the route, and a facility's address, with every change recorded in `details.edits`. Deleting is not — a bad import gets corrected rather than removed. Status is still inferred at intake and not settable by hand, so a load that saved as `draft` for want of a rate stays a draft after the rate is filled in; a real lifecycle needs discovery, not invention
- **Storing a date with no time.** A stop's window is a date _and_ a time together (`joinLocal` needs both), so a document stating "Delivery 11/03" with no appointment window loses the date — on the intake path as much as the edit path. The edit trail stays silent about it rather than reporting a save that did not happen, which is honest but not a fix. Closing it means either a separate nullable date column on `stop` or carrying the precision in `appointment_type`; both are schema decisions, and both collide with the rule that a window never claims a precision the document did not state
- **One address, stored twice.** The parser writes the whole address line into `Party.addressLine1` _and_ splits out `city`/`region`/`postalCode`, and `StopRow` prints all four. Correct the ZIP in the field labelled ZIP and the old one is still sitting in the address line beside it. Harmless while nothing could be edited; actively misleading now that it can be, because a reviewer who fixes it will believe they did
- **Per-stop timezones.** A stop stores the facility's zone when the `Party` has one, and new parties get `null` — the document never states a zone and inferring one from the state would be the exact guess the time-window model exists to avoid. The screen says "local time at the dock". Setting a zone per facility is the fix, and it needs a facilities screen
- **Refreshing a carrier's name or address on re-vet.** `vetCarrier` sets `details` when it creates a carrier and never updates it, because `CarrierRepository` has no update method. Stale rather than wrong — the raw payload on every check has the current values. Add the method when a screen needs it
- Searching a carrier by name (the QCMobile `/carriers/name/:name` endpoint). Brokers vet by number; add this only if discovery says otherwise

### Next session

**Point the inspector at real documents.** The code is no longer the constraint; the corpus is. `npm run intake:inspect -- <file...>` reports, per document, what the text stage saw, the layout fingerprint, what the parser extracted and which fields it flagged — and across several documents, how the layouts cluster. Three or four brokers' worth of rate cons turns every open question in this file into an answer:

- How much of a real corpus is scans, which decides whether OCR is a rare path or the main one.
- Whether layouts cluster by TMS vendor or by shipper — run the inspector over the lot and read the cluster report.
- Where the generic parser actually fails, which is the only honest basis for writing a template.
- Whether the confidence scale is calibrated: `details.intake.corrections` accumulates cases where the parser was confident and wrong.

Add each document to `/fixtures/intake/` anonymized, with its provenance, and expect the first few to break things.

This runs in parallel with discovery rather than after it — see `docs/discovery.md`. There is no client yet and no former-colleague network to draw on, so sample rate cons come from cold outreach and public sources.

**Then document generation**, which is now unblocked: load intake has defined what a load record contains.

**One known wart in the fixtures**, worth fixing before the corpus grows: `synthetic-rate-con.txt` pairs the invented carrier "GULF COAST HAULING LLC" with **MC-133655 / DOT-264184, which are Schneider National's real numbers** — they were used to probe the live QCMobile API and then copied into the fixture. It contradicts "fixtures are synthetic carriers", and in a dev database that has vetted the real MC it makes the fixture load link to Schneider, which is confusing. (It is also what surfaced the name-mismatch warning, so it earned its keep once.) Changing it means regenerating the PDF and updating four test files.
