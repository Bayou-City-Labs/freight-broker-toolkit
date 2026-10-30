# Dev setup, local sign-in, inspector, deployment

Signing in locally without the email. Verifying a gated screen needs a session, and the magic link goes to an inbox. Drive the real callback instead: Auth.js stores sha256(rawToken + AUTH_SECRET) in verification_tokens, so insert a row with that hash and open /api/auth/callback/resend?token=<raw>&email=<addr>&callbackUrl=<path> — the server sets the session cookie itself. Single-use, and it exercises real auth rather than faking it. Injecting a cookie directly does not work; browser automation blocks cookie writes.

Getting started. Copy .env.example to .env.local, then npm run db:up && npm run db:migrate && npm test. Carrier lookups additionally need FMCSA_WEB_KEY; without it the vetting screen renders a setup notice instead of failing. FMCSA_BASE_URL points the client at a stub to exercise the flow without a key. Load intake needs nothing beyond the database — no key, no network.

Trying load intake. docs/load-intake.md walks the whole flow with screenshots and paste-ready documents.

Looking at a document. npm run intake:inspect -- fixtures/intake/synthetic-rate-con.pdf. Add --items for every positioned item and the plain text, --quiet for just the fingerprint and the draft. Pass several files to get a layout cluster report. .txt/.eml files are read as pasted text, which is how an email joins the corpus.

Deployed. https://freight-broker-toolkit.vercel.app, on Neon Postgres provisioned through the Vercel marketplace; the schema is migrated there. The repo is connected, so pushes deploy automatically — main to production, branches to previews. Note that AUTH_RESEND_KEY and AUTH_EMAIL_FROM have to be set in the Vercel environment as well as .env.local; a key that only exists locally will not make deployed sign-in work.
