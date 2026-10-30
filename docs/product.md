# Product scope, modules, glossary

Bayou City Labs — Freight Broker Toolkit
What this is
Automation tools for small and mid-size freight brokers (roughly 2–50 people), starting in Houston. These brokers run on email, spreadsheets, and an aging or entry-level TMS. They lose hours every day re-keying load data, generating documents, and vetting carriers.

The business starts as custom builds for paying clients. This codebase is the shared foundation those builds draw from, and the eventual SaaS product.

Status: pre-validation, with a production-grade foundation built on spec. Customer discovery calls are in progress; there is no client yet. The foundation (schema, tenancy, auth, tests, CI, deploy) is deliberately built to production standards because it survives a pivot. Everything above it — UI flows, document templates, extraction field lists — stays cheap to change, because discovery can still invalidate it.

Where a decision is speculative, it is made reversible rather than deferred: uncertain fields live in a validated jsonb column, vendors sit behind ports, routing is modelled as ordered stops rather than fixed foreign keys.

Owner context
Sam: senior full-stack engineer (TypeScript, Node, React, C#/.NET). Formerly at Gulf Winds (Houston logistics), so knows the domain basics.
Writes code at a senior level. Skip beginner explanations, flag tradeoffs.
MVP scope (provisional — revise after discovery)
Three modules, each usable on its own:

Load intake (local-first, no external LLM required)
Paste an email or upload a PDF/image (rate confirmation, tender) and extract a structured LoadDraft: shipper, consignee, pickup/delivery windows, commodity, weight, equipment, rate, reference numbers.
Two stages behind a pluggable Extractor interface, so stages can be swapped or chained:
Text stage: PdfTextExtractor (unpdf/pdfjs-dist, text with x/y positions) for digital PDFs. When there's no text layer, fall back to TesseractExtractor (pdf-to-img → sharp preprocessing → tesseract.js).
Structure stage: TemplateParser, one template per document layout (anchor labels + positions + regex), selected by sender domain or layout fingerprint. Optional fallback for unknown layouts: a local LLM via Ollama, off by default and enabled per brokerage.
Every extractor returns a zod-validated LoadDraft plus per-field confidence. Low-confidence or missing fields are flagged, and a human always reviews and edits before saving.
No document data leaves the server unless a brokerage explicitly enables an external provider.
Keep anonymized real documents in /fixtures/intake/ as regression tests for each template. Public samples and synthetic documents count — waiting on client permission would block the module indefinitely.
Carrier vetting is reachable from a draft. A rate con names the carrier; vetting it should be one click from the review screen, not a separate errand. This is the first place the modules compose.
Document generation
From a load record, generate a carrier rate confirmation and a BOL as PDFs.
Templates are editable per brokerage (logo, terms, fields).
Carrier vetting
Look up a carrier by MC/DOT number using the FMCSA public data API: authority status, insurance on file, safety rating, out-of-service flags.
Show a pass/warn/fail summary and store a snapshot with a timestamp for the audit trail.

Out of scope for now
Full TMS, load board integrations, accounting/invoicing, tracking/ELD integrations, multi-tenant billing. These come later, if discovery supports them.

Domain glossary
Broker: arranges shipping between a shipper and a carrier; doesn't own trucks
Shipper / Consignee: origin / destination party
Carrier: trucking company that hauls the load; identified by MC and/or USDOT number
Rate con (rate confirmation): agreement between broker and carrier for a specific load and rate
BOL (bill of lading): shipping document for the freight; receipt and contract of carriage
Tender: a shipper's offer of a load to the broker
Equipment: dry van, reefer, flatbed, etc.
Drayage: short-haul container moves, usually port ↔ warehouse (big in Houston)
