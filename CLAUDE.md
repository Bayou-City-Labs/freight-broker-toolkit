# Bayou City Labs — Freight Broker Toolkit

## What this is
Automation tools for small and mid-size freight brokers (roughly 2–50 people), starting in Houston. These brokers run on email, spreadsheets, and an aging or entry-level TMS. They lose hours every day re-keying load data, generating documents, and vetting carriers.

The business starts as custom builds for paying clients. This codebase is the shared foundation those builds draw from, and the eventual SaaS product.

**Status: pre-validation.** Customer discovery calls are in progress. Keep everything modular and cheap to change. Don't over-build anything that discovery could invalidate.

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
- TypeScript everywhere, strict mode
- Next.js (App Router) for the UI and API routes
- PostgreSQL + Prisma (or Drizzle — decide in the first session)
- zod for all external input and LLM output validation
- PDF generation: decide in the first session (e.g. React-PDF or Playwright HTML→PDF)
- Vitest for tests
- Single-tenant first, but put `brokerageId` on every table so multi-tenancy stays easy later

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

## Suggested first session
1. Interview me to pressure-test this brief and settle the open decisions (ORM, PDF library, LLM provider)
2. Scaffold the repo: Next.js, Prisma/Drizzle, Vitest, lint/format, `.env.example`
3. Model the core entities: `Brokerage`, `Load`, `Party` (shipper/consignee), `Carrier`, `CarrierCheck`, `Document`
4. Build carrier vetting first. It's the smallest module, uses a public API, and makes a useful demo for discovery calls
