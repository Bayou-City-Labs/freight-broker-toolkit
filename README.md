# Freight Broker Toolkit

Automation tools for small and mid-size freight brokers, starting in Houston. Three modules, each usable on its own: **carrier vetting**, **load intake**, and **document generation**.

Status: pre-validation. The foundation is built; no module is implemented yet. See [CLAUDE.md](./CLAUDE.md) for scope, roadmap, and the reasoning behind the design decisions.

## Getting started

Requires Node 24+ and Docker.

```bash
cp .env.example .env.local   # fill in AUTH_SECRET with `npx auth secret`
npm install
npm run db:up                # Postgres 17 in Docker, with a separate test database
npm run db:migrate
npm test
npm run dev
```

## Scripts

| Script                | What it does                                                 |
| --------------------- | ------------------------------------------------------------ |
| `npm run dev`         | Next.js dev server                                           |
| `npm run build`       | Production build                                             |
| `npm test`            | Vitest — domain tests plus repository tests against Postgres |
| `npm run typecheck`   | `tsc --noEmit`                                               |
| `npm run lint`        | ESLint, including the `src/domain` boundary rule             |
| `npm run format`      | Prettier                                                     |
| `npm run db:up`       | Start the local Postgres container                           |
| `npm run db:generate` | Generate a migration from schema changes                     |
| `npm run db:migrate`  | Apply committed migrations                                   |
| `npm run db:studio`   | Drizzle Studio                                               |

## Layout

```
src/domain/   Framework-free business logic: money, time windows,
              carrier facts and verdicts, ports (DocumentStore, Extractor,
              repositories). Enforced by lint — no Next, React, Drizzle, or Auth.js.
src/db/       Drizzle schema, client, repository implementations.
src/env/      zod-parsed environment, split by concern.
src/server/   Request-scoped server helpers (tenant resolution).
src/app/      Routes and UI.
src/test/     Transaction-rollback harness and migration setup.
```

## Conventions

- **Money is integer cents.** Use `Money` from `src/domain/money.ts`; never store a dollar float.
- **Every repository call takes a `BrokerageScope`.** This is how tenant isolation is guaranteed — it cannot be forgotten, because it cannot be omitted.
- **Stop windows are local wall time + an IANA zone + the raw source text.** Absolute instants are derived, never stored.
- **Uncertain fields go in the zod-validated `details` jsonb column**, and get promoted to real columns once something queries them.
- **Migrations are generated and committed**, never pushed from the schema.
- Branches are named `feat/...`, `fix/...`, `chore/...`.
