# Freight Broker Toolkit

Automation tools for small and mid-size freight brokers, starting in Houston. Three modules, each usable on its own: **carrier vetting**, **load intake**, and **document generation**.

Status: pre-validation. **Carrier vetting is built**; the other two modules are not. See [CLAUDE.md](./CLAUDE.md) for scope, roadmap, and the reasoning behind the design decisions.

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
| `npm run db:seed`     | Create a brokerage and make a user its owner (throwaway)     |
| `npm run db:studio`   | Drizzle Studio                                               |

## Layout

```
src/domain/       Framework-free business logic: money, time windows, carrier
                  facts, verdicts, the vetting use case, and ports (CarrierLookup,
                  DocumentStore, Extractor, repositories). Enforced by lint — no
                  Next, React, Drizzle, or Auth.js.
src/db/           Drizzle schema, client, repository implementations.
src/integrations/ Outbound vendor adapters. fmcsa/ implements CarrierLookup.
src/env/          zod-parsed environment, split by concern.
src/server/       Composition roots and request-scoped helpers.
src/app/          Routes and UI. Everything under (app)/ requires a session;
                  /signin sits outside the group.
src/test/         Transaction-rollback harness and migration setup.
```

Dependencies point inward. `src/domain` knows about ports; everything else
implements them. That is what makes `vetCarrier` testable with in-memory fakes
and keeps the door open to lifting the domain into a shared package.

## Carrier vetting

Look up a carrier by MC or USDOT number against FMCSA's public QCMobile API,
derive a pass/warn/fail verdict, and store a timestamped snapshot.

Set `FMCSA_WEB_KEY` to enable it — register an application at
[mobile.fmcsa.dot.gov](https://mobile.fmcsa.dot.gov/QCDevsite/docs/getStarted)
with a login.gov account. Without a key the screen renders a setup notice
rather than failing a lookup it cannot make.

### Things the API does that will bite you

- **A rejected key comes back as HTTP 404**, with `content` as a plain string
  (`{"content": "Webkey not found"}`), which is indistinguishable by status
  from an unknown carrier. The client reads the body before trusting the
  status, because telling a broker "no such carrier" when we simply failed to
  authenticate is the worst available outcome.
- **The published field list disagrees with the wire format** — the docs name
  `allowToOperate` and `outOfService`; the API sends `allowedToOperate` and
  `oosDate`. Numbers arrive as either JSON numbers or strings. The schema in
  `src/integrations/fmcsa/schema.ts` is deliberately permissive as a result:
  unknown values degrade to "unknown" instead of throwing, and the raw payload
  is stored whole regardless.
- **The docket-number endpoint returns `content` as an array**, where the DOT
  endpoint returns an object — the docs claim "Object" for both. Confirmed
  live. MC is the primary way brokers search, so an object-only parser would
  have broken the main path.

To exercise the flow without a real key, point `FMCSA_BASE_URL` at a stub that
serves a QCMobile-shaped response.

## Auth

The app is gated by default. Everything lives under the `src/app/(app)/` route group, whose layout redirects anyone without a session to `/signin` — so adding a route means opting _out_ of protection rather than remembering to opt in. There are no public pages.

A layout is **not** a security boundary on its own: it renders for page requests and does not run for server actions or route handlers. Those check independently.

Three session states, not two: signed out, signed in with no brokerage, and ready. The middle one gets its own screen — redirecting it to `/signin` would loop, because `/signin` sends signed-in users back.

### Getting a tenant

Auth.js creates a user on first sign-in, but nothing creates the brokerage that user belongs to — so there is no scope for repository calls. The app shows a "No brokerage yet" screen rather than looping back to sign-in. Until there's a real onboarding flow, bridge it:

```bash
npm run db:seed -- you@example.com                        # local
npm run db:seed -- you@example.com "postgresql://..."     # a deployed database
```

`src/db/seed.ts` is deliberately throwaway. Delete it when first-run onboarding exists.

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
