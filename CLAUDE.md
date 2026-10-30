# Freight Broker Toolkit (Bayou City Labs)

@AGENTS.md

Automation for small freight brokers (2–50 people, Houston first): load intake, document generation, carrier vetting.
Pre-validation, no client yet. The foundation (schema, tenancy, auth, tests, CI, deploy) is production-grade because it survives a pivot; everything above it (UI flows, templates, extraction field lists) must stay cheap to change. Speculative decisions are made reversible, not deferred.
Owner is a senior engineer: skip beginner explanations, flag tradeoffs.

## Stack
TypeScript strict · Next.js 16 App Router (Cache Components) · Postgres + Drizzle + postgres.js · zod at every external boundary · Auth.js (Resend magic link, DB sessions, Drizzle adapter) · Vitest against real Postgres (per-test transaction rollback) · @react-pdf/renderer for doc gen · Vercel + Neon.
Extraction is local-first: no external LLM in the default path. PDF text via unpdf, OCR via tesseract.js, structure via parsers/templates, optional Ollama fallback per brokerage.

## Commands
npm run db:up | db:migrate | test | lint | typecheck | format:check | build
npm run intake:inspect -- <file...>   # corpus inspector, see docs/dev-setup.md

## Layout
src/domain/        framework-free, lint-enforced (money, time windows, carrier, intake, load, ports)
src/db/            Drizzle schema + repository implementations
src/integrations/  outbound vendor adapters (fmcsa/, pdf/)
src/server/        composition roots; tenant.ts is the only place a BrokerageScope is created
src/app/(app)/     every gated route; the layout redirects without a session
src/tools/         dev tooling (corpus inspector), not production code

## Docs (read when relevant, do not load up front)
- docs/status.md          what is built / not built / next. May lag the code: verify before trusting.
- docs/architecture.md    foundation decisions and their reasoning, entities, full layout notes
- docs/intake-notes.md    intake pipeline: constraints, lessons, how the flow works, edit trail
- docs/fmcsa.md          FMCSA/QCMobile data limits and API quirks, carrier vetting flow
- docs/dev-setup.md      getting started, local sign-in trick, inspector, deployment
- docs/product.md        scope, modules, glossary
- docs/roadmap.md        phases and gates
- docs/load-intake.md    screen-by-screen walkthrough with screenshots
- docs/plans/            one plan file per feature (see docs/plans/TEMPLATE.md)
