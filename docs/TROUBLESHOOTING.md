# Troubleshooting

## Setup

**`CAIRN_MASTER_KEY is not set`**
Run `pnpm setup`. It writes `.env.local` at the repository root and creates the
local database. It never overwrites an existing key, because doing so would make
everything encrypted under the old one unreadable.

**`CAIRN_MASTER_KEY must decode to 32 bytes`**
The value must be exactly 32 random bytes, base64:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**`relation "…" does not exist`, or health reports "Not set up yet"**
`pnpm db:migrate`.

**The database seems empty after it worked before**
`CAIRN_LOCAL_DATA_DIR` is resolved against the workspace root, so this should not
happen — but if you set an absolute path in one shell and a relative one in
another, you have two databases. Check `.env.local`.

## Running

**`Refusing to reset: DATABASE_URL is set`**
Deliberate. `pnpm db:reset` only ever touches the local database.

**The worker exits saying it is not needed**
Also deliberate. Without `DATABASE_URL` the local database is single-process and
the website runs jobs itself. Set `DATABASE_URL` to run the worker separately.

**Nothing happens after adding a document**
Look at **Sources → Recent activity**. Jobs show their state, attempts, duration,
and error category. `budget_exceeded` means the workspace hit its spending limit
— raise it in Settings and retry. `validation_failed` will not be retried,
because it would fail identically.

**Port 3000 is busy**
`PORT=3001 pnpm dev`.

## The interface

**Buttons do nothing**
Almost always a Content Security Policy problem: the framework's inline bootstrap
script must be allowed or the page never becomes interactive. The nonce is issued
per request in `apps/web/src/proxy.ts`. If you edit that file, check the browser
console for a CSP error before assuming the bug is elsewhere.

**"This form has expired. Reload the page and try again."**
The CSRF cookie no longer matches. Reload. If it persists, the session cookie is
not being sent — check that `CAIRN_APP_URL` matches the origin you are actually
using, since it decides whether cookies are marked `Secure`.

**Sign-in says "Too many attempts"**
Five sign-in attempts per address per fifteen minutes. Wait, or use a different
address in development.

**No sign-in code arrives**
In demo mode none is sent. It is shown on screen and printed by the server; the
interface says so.

## Memory and search

**Search returns nothing after a restore**
The index is derived and is rebuilt after a restore. If you restored outside the
application, run a project reindex — `rebuildProjectIndex` — or approve any item
to trigger one.

**A memory cannot be kept**
It has no evidence. That is enforced, not advisory: nothing is saved without
something to point back to. It usually means the extraction was discarded because
its quoted text was not found in the document.

**Two notes disagree**
Both are kept and flagged. Choose one on the Memory page; the other is marked
superseded and stays in History. Nothing is ever overwritten.

**An answer says there is not enough saved**
Correct behaviour, not a failure. Answers may only use retrieved evidence, and no
saved memory matched the question's topic words.

## Connected AI tools

**"That connection code is not valid"**
It was revoked, mistyped, or belongs to another deployment. Codes are stored only
as hashes, so a lost one cannot be recovered — create a new connection.

**A tool connects but finds nothing**
Check three things in order: is the memory _saved_ rather than waiting for
review; is it marked sensitive or never-share; was the connection granted a
specific project. All three are visible on the item's card.

**The remote endpoint returns 401**
The `WWW-Authenticate` header names the reason. In `oauth` mode, the most common
cause is an audience mismatch: the token must be minted for the value in
`MCP_OAUTH_AUDIENCE`.

## Tests

**Playwright times out waiting for the web server**
A previous run left one behind:

```bash
pkill -f "next dev"; lsof -ti:3311 | xargs kill -9
```

**Browser tests fail after changing a server action**
The dev server's action map can go stale across hot reloads. Restart it and clear
`apps/web/.next`.

**Vitest tests are slow**
Each file boots its own in-process PostgreSQL. That is deliberate — the tests run
against real SQL, real RLS, and real pgvector rather than mocks.
