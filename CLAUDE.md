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

1. **Load intake**
   - Paste an email or upload a PDF (rate confirmation, tender) and extract a structured load record: shipper, consignee, pickup/delivery windows, commodity, weight, equipment, rate, reference numbers.
   - Use an LLM for extraction with a strict schema (zod). A human reviews and edits before saving.
2. **Document generation**
   - From a load record, generate a carrier rate confirmation and a BOL as PDFs.
   - Templates are editable per brokerage (logo, terms, fields).
3. **Carrier vetting**
   - Look up a carrier by MC/DOT number using the FMCSA public data API: authority status, insurance on file, safety rating, out-of-service flags.
   - Show a pass/warn/fail summary and store a snapshot with a timestamp for the audit trail.

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
- LLM provider: **deliberately undecided.** `Extractor` port only; pick a model against real rate cons, not in advance
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

### Known limits of the FMCSA data

Relevant when the vetting rules are built out: most carriers are **unrated** (absence of a bad rating is not a good sign), and CSA Crash Indicator and HazMat percentiles are **not public** — a carrier can look clean to us and still be flagged in FMCSA's own screening. "Insurance on file" means a filing exists, not that coverage suits a given load.

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
- Track every feature request in `/docs/requests.md`
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

## Current state (first session complete)

The foundation is built and verified: `npm test` (46 tests), `npm run lint`, `npm run typecheck`, and `npm run build` all pass.

**Entities (12 tables).** Seven business tables — `Brokerage`, `Party`, `Load`, `Stop`, `Carrier`, `CarrierCheck`, `Document` — plus Auth.js's `User`/`Account`/`Session`/`VerificationToken` and a `Membership` join carrying `brokerageId` + role. `Stop` is an addition to the original six; see "Foundation decisions".

**Layout.**

- `src/domain/` — framework-free. Money, time windows, carrier facts and verdicts, `details` schemas, ports (`DocumentStore`, `Extractor`, repositories)
- `src/db/` — Drizzle schema, client, repository implementations
- `src/env/` — zod-parsed env, split by concern so a migration doesn't require an email provider key
- `src/server/tenant.ts` — the only place a `BrokerageScope` is created from a session
- `src/test/` — transaction-rollback harness and global migration setup

**Getting started.** Copy `.env.example` to `.env.local`, then `npm run db:up && npm run db:migrate && npm test`.

**Deployed.** https://freight-broker-toolkit.vercel.app, on Neon Postgres provisioned through the Vercel marketplace; the schema is migrated there. The repo is connected, so pushes deploy automatically — `main` to production, branches to previews. Note that `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` have to be set in the Vercel environment as well as `.env.local`; a key that only exists locally will not make deployed sign-in work.

### Deliberately not built yet

- Repositories for `Load`, `Party`, `Stop`, `Document` — the tables exist; access patterns should be designed against a real module, not guessed
- Any UI beyond the default scaffold, and any sign-in page
- The FMCSA client, PDF renderer, and LLM extractor — ports exist, implementations do not
- A `DocumentStore` implementation (the local-filesystem adapter lands with doc generation)

### Next session

Build **carrier vetting**. It's the smallest module, uses a public API, has objectively verifiable output, and makes a useful demo for discovery calls. The domain pieces (facts, verdict rules, snapshot hashing) and persistence are already in place and tested — what's missing is the FMCSA client, the mapping from its payload to `CarrierFacts`, and a UI.
