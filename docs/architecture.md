# Architecture: stack, foundation decisions, entities, layout


Stack
Decisions settled in the first session; see "Foundation decisions" below for the reasoning that is not obvious from the code.

TypeScript everywhere, strict mode
Next.js 16 (App Router, Cache Components enabled) for the UI and API routes
PostgreSQL + Drizzle + postgres.js. Docker Compose locally, Neon when deployed
zod for all external input and LLM output validation
Auth.js — magic link via Resend, database sessions, Drizzle adapter
PDF generation: @react-pdf/renderer — decided, not yet installed (lands with the doc-gen module)
Extraction: local-first, no external LLM in the default path. PDF text via unpdf/pdfjs-dist, OCR fallback via tesseract.js, structure via templates. A local LLM through Ollama is an optional per-brokerage fallback for unknown layouts, off by default. Document data leaves the server only if a brokerage opts in
Vitest for tests, against real Postgres with per-test transaction rollback
Single-tenant first, but brokerageId is on every table and every repository call requires a BrokerageScope
Foundation decisions
The non-obvious ones, with the reasoning. Revisit these deliberately, not by accident.

Money is integer cents (src/domain/money.ts). Margin is the difference between two amounts; rounding drift there is a defect in the number the business runs on. Per-mile figures need sub-cent precision and are derived for display, never stored as money.
Windows are naive local wall time + IANA zone + the raw source text (src/domain/time-window.ts). A rate con states a dock's wall clock and rarely a zone. Converting to an instant at intake bakes in an unauditable guess. DST gaps resolve forward, overlaps resolve to the first occurrence.
Routing is Load → ordered Stop[] → Party, not shipper/consignee foreign keys. Multi-stop and drayage are then the same shape with more rows instead of a migration.
Uncertain fields live in a zod-validated jsonb details column (src/domain/details.ts). Promote a field to a real column when you start querying, sorting, or filtering on it.
Carrier checks store the raw payload, a derived projection, and a content hash. The hash makes Phase 3 monitoring a cheap diff; the raw payload means verdicts can be re-derived when rules change. Verdicts are stamped with CARRIER_RULESET_VERSION.
Tenancy is enforced at the repository boundary, not by convention and not yet by RLS. Repository methods take a BrokerageScope first argument, so a call cannot be made without one. src/server/tenant.ts is the single place a scope enters the system.
The domain boundary is enforced by lint, not discipline: src/domain/** cannot import Next.js, React, Drizzle, postgres.js, Auth.js, or the app/db/env layers. That is what makes extracting it into a shared package later a cheap move.
The app is gated by default, not page by page. Everything lives under the src/app/(app)/ route group whose layout redirects anyone without a session. Adding a route means opting out of protection rather than remembering to opt in — the same reasoning as making every repository call take a BrokerageScope. A layout is not a security boundary on its own: it renders for page requests and does not run for server actions or route handlers, which are separately addressable. Those check independently (see vetCarrierAction), and pages use requireBrokerage(), which throws rather than renders if the guard was somehow bypassed.

Engineering principles
Domain logic stays separate from frameworks (/src/domain), so modules can become a product later
Never trust LLM extraction blindly: validate with zod, show confidence, require human confirmation
Every carrier check and generated document is stored and auditable
Keep secrets in env vars; no real client data in fixtures (use synthetic loads)
Small PRs, tests for domain logic and parsers; don't snapshot-test PDFs

Entities (12 tables). Seven business tables — Brokerage, Party, Load, Stop, Carrier, CarrierCheck, Document — plus Auth.js's User/Account/Session/VerificationToken and a Membership join carrying brokerageId + role. Stop is an addition to the original six; see "Foundation decisions".

Layout.

src/domain/ — framework-free. Money, time windows, carrier facts, verdicts, the vetting use case, details schemas, ports (CarrierLookup, DocumentStore, TextExtractor/StructureParser, repositories)
src/domain/intake/ — the whole intake brain: document-text (line and column assembly, scan detection), plain-text (the pasted-email stage, in the domain because it is pure string handling with no vendor), parse-values, label-parser, load-draft, pipeline, confirm, provenance, fingerprint
src/domain/load/ — load/stop/party shapes plus the status, equipment and stop-type vocabularies. These moved out of the Drizzle schema so a parser can classify equipment without the database on its import path; the schema reads them from here and re-exports them. Also load-values (a load as a human states it: the schemas plus the translation into stored shapes, shared by intake's confirm step and the edit screen so rules like "never create a carrier" have one implementation) and update (the edit use case, including the diff that writes the trail)
src/db/ — Drizzle schema, client, repository implementations
src/integrations/ — outbound vendor adapters. fmcsa/ implements CarrierLookup: a permissive zod schema, the payload→facts mapper, and the HTTP client. pdf/ implements TextExtractor over unpdf
src/tools/inspect-document.ts — the corpus inspector (npm run intake:inspect). Not production code
src/env/ — zod-parsed env, split by concern so a migration doesn't require an email provider key
src/server/tenant.ts — the only place a BrokerageScope is created from a session. resolveSession() returns three states, not two: signed out, signed in with no brokerage, and ready. The middle one needs its own screen — folding it into "signed out" bounces the user to /signin, which redirects signed-in users back, forever. Wrapped in React cache so the layout and the page beneath it share one session read
src/server/intake.ts — composition root for intake and editing. Extractor order is the routing rule: each declares what it supports, first match wins
src/server/carriers.ts — composition root for vetting. Deliberately not server-only: nothing in it touches a request, and Phase 3's scheduled re-checks are a plain Node process that needs exactly this module. server-only belongs on modules that read a session
src/test/ — transaction-rollback harness and global migration setup
