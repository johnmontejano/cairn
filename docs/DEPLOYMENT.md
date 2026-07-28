# Deployment

Nothing here has been deployed. This is the procedure, written so it can be
followed without guessing — and so the cost and the trust boundaries are visible
before anyone commits to them.

Target: Supabase (database, storage, queue), Vercel (website), Railway (worker),
WorkOS (sign-in). See [cost controls](COST_CONTROLS.md) for what that costs.

## 1. Database — Supabase

Create a project, then in the SQL editor:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Apply the migrations from a machine with the connection string:

```bash
DATABASE_URL='postgresql://…' pnpm db:migrate
```

The migration creates the `cairn_app` role, grants it, and enables row-level
security on every tenant table. Confirm before going further:

```sql
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
SELECT tablename, policyname, roles FROM pg_policies WHERE schemaname = 'public';
```

Every tenant table must show `rowsecurity = true` and a policy targeting
`cairn_app`. The security tests assert exactly this; run them against a scratch
database if you want the check automated.

## 2. Storage — Supabase

Create a **private** bucket named `cairn-raw-sources`. Objects are encrypted
before upload, so the bucket never holds readable content — but a public bucket
would still leak sizes and structure.

## 3. The encryption key

Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put it in a secret manager. Losing it makes every workspace key — and therefore
every memory encrypted under it — permanently unreadable.

For production, prefer the KMS provider so the process never holds the master key
itself:

```
CAIRN_KEY_PROVIDER=kms
CAIRN_KMS_KEY_ID=…
```

`KmsKeyProvider` needs two calls — encrypt and decrypt with an encryption context
— implemented against AWS KMS, Google Cloud KMS, or Vault. Register it at
start-up with `registerKmsClient()`. It fails loudly if selected and unregistered
rather than silently falling back to an environment key.

## 4. Sign-in — WorkOS

Create an AuthKit environment, enable email codes and Google, and set the
redirect to `https://your-app.example.com/api/oauth/workos/callback`.

```
AUTH_PROVIDER=workos
WORKOS_API_KEY=…
WORKOS_CLIENT_ID=…
WORKOS_REDIRECT_URI=https://your-app.example.com/api/oauth/workos/callback
CAIRN_SESSION_SECRET=…   # at least 32 random characters
```

## 5. Website — Vercel

Import the repository. Root directory `apps/web`, build `pnpm build`, install
`pnpm install`.

Set every variable from [the environment reference](ENVIRONMENT.md) as a
**server-side** variable. None of them is prefixed `NEXT_PUBLIC_`; if a tool
offers to expose one to the browser, that is a mistake.

Vercel's Hobby plan is for personal, non-commercial use. Anything else needs Pro.

## 6. Worker — Railway

Deploy the same repository with start command `pnpm --filter @cairn/worker start`
and the same `DATABASE_URL`, `CAIRN_MASTER_KEY`, `AI_PROVIDER`, and storage
variables.

The worker refuses to start against the local single-process database and says
why. One instance is enough to begin; the queue claims with
`FOR UPDATE SKIP LOCKED`, so scaling out means starting another copy.

## 7. Connectors

Optional. See [connectors](CONNECTORS.md) for Google Drive and GitHub.

## 8. Remote MCP authorization

```
MCP_AUTH_MODE=oauth
MCP_OAUTH_ISSUER=https://your-tenant.authkit.app
MCP_OAUTH_JWKS_URL=https://your-tenant.authkit.app/oauth2/jwks
MCP_OAUTH_AUDIENCE=https://your-app.example.com/api/mcp
```

**Verify the current official integration guidance before enabling this.** The
implementation validates signature, issuer, audience, expiry, and scope
intersection, but it has not been exercised against a live issuer. Until then,
`MCP_AUTH_MODE=local` with connection codes is the tested path.

## Before letting anyone else in

- [ ] `pnpm verify` passes.
- [ ] `pnpm test:e2e` passes.
- [ ] RLS confirmed on the production database with the queries above.
- [ ] `GET /api/health` returns 200 with every check green.
- [ ] `CAIRN_APP_URL` is the real HTTPS origin, so cookies are marked `Secure`.
- [ ] The master key is in a secret manager, not an environment file.
- [ ] Spend caps set at every metered vendor as well as in Settings.
- [ ] A backup taken, verified, and restored into a scratch workspace.
- [ ] Your privacy policy names every processor in
      [the privacy matrix](PRIVACY_MATRIX.md) and your provider's backup
      retention window.
- [ ] Nothing in your public copy claims end-to-end encryption, zero knowledge,
      or a compliance certification.

## Rolling back

Application code rolls back by redeploying. **Migrations do not.** They are
append-only and forward-only by design, so a schema change that must be undone
needs a new migration that undoes it. Take a database snapshot before applying
migrations to a database with real data in it.
