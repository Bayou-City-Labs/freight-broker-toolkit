# Roadmap

Long-term roadmap
Context for design decisions only. Do NOT build ahead of the current phase. Each phase has a gate that must be met first.

Phase 1 — First paying clients (now → ~month 3)

Custom builds for 2–3 brokers using the shared modules above; pricing is setup fee + monthly maintenance
Track every feature request in /docs/requests.md; interview questions and outreach in /docs/discovery.md
Gate: 3 paying clients needing the same core module
Phase 2 — Productize the core (~months 3–6)

Hosted multi-tenant app: self-serve signup, Stripe billing, per-brokerage templates
Migrate early clients onto the single codebase
Gate: a broker can sign up and get value without a call
Phase 3 — Expand along the broker workflow (~months 6–12) Prioritize by client demand:

Carrier monitoring and fraud alerts (insurance lapses, authority changes, identity red flags)
Carrier onboarding packets (W-9, insurance certificates, signed agreements)
Inbox automation (tenders and rate cons straight from email into load records)
Invoicing, payment tracking, quick-pay to carriers
Automatic pickup/delivery status updates to shippers
Integrations with brokers' existing TMS (sit beside it, don't replace it)
Phase 4 — Drayage (12+ months)

Houston port container drayage: container tracking, chassis management, detention/demurrage/per diem tracking
Design implications now
brokerageId on every table (multi-tenancy in Phase 2)
Carrier checks stored as timestamped snapshots so ongoing monitoring (Phase 3) is just scheduled re-checks plus diffs
Load intake built behind an interface so email ingestion (Phase 3) is just another source
Keep /src/domain free of framework code so modules can move into the product
