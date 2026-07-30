# Deployment

This is the procedure, written so it can be followed without guessing — and so
the cost and the trust boundaries are visible before anyone commits to them.

Target: Supabase (database, storage, queue), Vercel (website), Railway (worker),
WorkOS (sign-in). See [cost controls](COST_CONTROLS.md) for what that costs.

> **Status, 2026-07-28.** Steps 1 and 2 are done against Supabase project
> `Ai-Memory` and verified: `vector` installed, migrations `0001`–`0004` applied
> with checksums recorded, row-level security confirmed, private
> `cairn-raw-sources` bucket created, and Supabase's security advisor reporting
> zero errors. Steps 4 onward — WorkOS and the website — have not been done,
> because they need account sign-in and secret entry. `memory/CURRENT_STATE.md`
> holds the detail.

## Running it for nothing

For **one person**, the whole thing fits in free tiers. This is a real
configuration, not a crippled one — same schema, same encryption, same MCP
server.

| Piece                 | Free option           | The catch                                  |
| --------------------- | --------------------- | ------------------------------------------ |
| Website               | Vercel Hobby          | Personal, non-commercial use only          |
| Database              | Supabase Free         | Pauses after 7 days idle; no daily backups |
| Storage               | Supabase Free         | Shares the same project quota              |
| Sign-in               | WorkOS AuthKit        | Free to a very high user count             |
| Extraction and search | `AI_PROVIDER=fixture` | The built-in extractor, not a hosted model |
| Worker                | **Not deployed**      | See below                                  |

The worker is the interesting one. It exists because ingestion must not run
inside a page request — which is right for many users and unnecessary for one.
Set:

```
CAIRN_INLINE_JOBS=always
```

and the website drains the queue itself after each action: the same handlers,
claimed through the same queue, with the same retries and the same idempotency.
It just happens in the request that caused it. Nothing is faked and nothing is
skipped.

Two consequences to accept:

- **A large document makes one slow request.** Ingesting a long PDF happens
  while the page waits, so it can hit your host's function time limit. Uploads
  of a few pages are comfortable; a 300-page book is not.
- **Nothing retries while nobody is using the site.** A job that fails and backs
  off waits for your next action rather than a worker's next poll.

Neither matters for personal use. Both do the moment a second person joins, at
which point deploy the worker and drop the variable.

`GET /api/health` reports which arrangement is live, and — when a worker is
expected — fails if jobs have been queued for more than five minutes. That is
the failure this setup makes possible, so it is checked rather than left to be
discovered.

### What "free" costs you

- **The idle pause is the real one.** A Supabase free project sleeps after seven
  days without traffic and returns errors until it wakes. Fine for something you
  use weekly; not fine for something other people rely on.
- **No managed backups on the free database.** The application's own encrypted
  backup is therefore not optional — see [backup and recovery](BACKUP_AND_RECOVERY.md).
- **Vercel Hobby is non-commercial.** The moment you charge for this, you need
  Pro. That is their licence term, not a technical limit.
- **The built-in extractor is cue-based**, so it will miss things phrased
  unusually. Adding an API key later changes one variable.

Verify each provider's current limits before relying on them; the figures above
were checked on 2026-07-27 and free tiers change.

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

The [deploy button in the README](../README.md#put-it-online) sets the root
directory and build commands and then prompts for each variable, which is the
shortest path. To do it by hand instead: import the repository, root directory
`apps/web`, build `pnpm build`, install `pnpm install`.

Only three values cannot be copied verbatim from this guide:

| Variable                                | Where it comes from                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                          | Project Settings → Database → Connection string → URI. Tick **Use connection pooling**: Vercel is serverless and the direct connection will exhaust its pool. |
| `SUPABASE_SERVICE_ROLE_KEY`             | Project Settings → API Keys → `service_role`. It bypasses row-level security, so it is server-side only.                                                      |
| `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` | The AuthKit environment created in step 4.                                                                                                                    |

After the first deploy, run `pnpm preflight` against the same environment. It
reports every provider as ready, optional, or missing, and names the exact
variable behind each failure — the difference between "it doesn't work" and a
list of things to fix.

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
