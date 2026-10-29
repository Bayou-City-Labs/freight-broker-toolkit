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

## Deployment

Production: **https://freight-broker-toolkit.vercel.app** (Vercel project `freight-broker-toolkit`, Neon Postgres provisioned through the Vercel marketplace).

Deploy with `npx vercel deploy --prod`. Apply migrations to a deployed database by passing its connection string directly:

```bash
npx tsx src/db/migrate.ts "postgresql://..."
```

The repo is connected to the Vercel project, so pushes deploy automatically — `main` to production, branches to previews.

**Magic-link email needs its key in two places.** `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` live in `.env.local` for development _and_ in the Vercel environment for deployed sign-in; setting one does not set the other.

`AUTH_EMAIL_FROM` is currently **`onboarding@resend.dev`**, Resend's shared test sender. It needs no DNS setup, but it only delivers to the Resend account owner's own address — enough to exercise the sign-in flow, not enough to let anyone else log in. Before a real user touches this, verify a domain in Resend (`samklep.dev` is on the account but unverified) and switch the sender to an address on it.

```bash
npx vercel env ls production          # check what's set
printf '%s' "re_..." | npx vercel env add AUTH_RESEND_KEY production --force
```

## Conventions

- **Money is integer cents.** Use `Money` from `src/domain/money.ts`; never store a dollar float.
- **Every repository call takes a `BrokerageScope`.** This is how tenant isolation is guaranteed — it cannot be forgotten, because it cannot be omitted.
- **Stop windows are local wall time + an IANA zone + the raw source text.** Absolute instants are derived, never stored.
- **Uncertain fields go in the zod-validated `details` jsonb column**, and get promoted to real columns once something queries them.
- **Migrations are generated and committed**, never pushed from the schema.
- Branches are named `feat/...`, `fix/...`, `chore/...`.
