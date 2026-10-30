<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Check Obsidian vault before reading & writing to this project

Before making any changes to the codebase, read from 'agent-wiki' vault and write all changes to 'agent-wiki' vault. It can be found at:

"Users/sam/Documents/agent-wiki"

# Project rules

Kept outside the managed block above so `next dev` never rewrites them.

- Money is integer cents. Never floats.
- brokerageId on every table; every repository call takes a BrokerageScope as its first argument.
- src/domain/** must not import Next.js, React, Drizzle, postgres.js, Auth.js, or the app/db/env layers.
- A layout is not a security boundary. Server actions and route handlers check auth themselves; pages use requireBrokerage().
- A "use server" file may export only async functions (form state lives in a sibling form-state.ts).
- Never trust parser or LLM output: zod-validate, show per-field confidence, a human confirms before saving.
- Stop windows are naive wall time + IANA zone + raw source text. Never guess a timezone.
- Intake never creates a carrier. Edit trail (details.edits) stays separate from details.intake.
- Parsers read positioned items, not strings, when a rule needs to know where a value ends.
- Every carrier check and generated document is stored and auditable. Raw payload + hash + CARRIER_RULESET_VERSION on checks.
- No real client data in fixtures; secrets in env vars only.
- Run the screen in a browser before calling it done. tsc, build, and unit tests miss render-time and wiring failures.
- A comment asserting a property is not evidence it holds; verify against the code.
- Small PRs. Tests for domain logic and parsers. Don't snapshot-test PDFs.
- Don't build ahead of the roadmap phase.
