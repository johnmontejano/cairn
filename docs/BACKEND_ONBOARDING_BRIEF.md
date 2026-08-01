# Backend and onboarding brief

Date: 2026-08-01. Written as a handoff for a session focused on the server
side of "anyone can set up shared memory easily" — the functional goal, not a
visual one.

## The boundary, stated once

The goal is functional parity with the category's best onboarding — as easy to
set up as Unabyss, using Cairn's own backend. That is not permission to
reproduce Unabyss's implementation. Declined since 2026-07-27 (`DECISIONS.md`),
restated in `PROJECT_BRIEF.md` non-goals, and independently a copyright/ToS
line regardless of who authorises it: their server code is theirs, not a
reference implementation to port. Build the same _outcome_ — a stranger
connects a source, sees what was learned, connects an AI, asks a question,
with nothing that requires reading documentation — using Cairn's existing
architecture (Postgres, the job queue, the MCP server already shipped).

Research Unabyss only from their public marketing/docs surface, never from an
authenticated dashboard.

## Relationship to the redesign session

A separate session is doing `docs/REDESIGN_BRIEF.md` — tokens, type, layout,
and the _interface_ side of the onboarding flow (auto-refresh instead of
manual, bulk-approve UI, leading with the identity summary, promoting the
connect-an-AI step). **Do not redo that work here.** This brief owns what sits
underneath those changes: the actual data operations, jobs, and connectors —
plus backend work with no UI-visible component at all.

**Sequencing matters:** if that session is still running, coordinate rather
than editing the same route files concurrently — both will touch
`apps/web/src/app/sources/page.tsx` and `apps/web/src/server/actions.ts`. Check
`git log` and `git status` before starting; if the redesign work is mid-flight
on `main`, either wait for it to land or work from the same up-to-date
checkout so there is no silent conflict.

## What's confirmed missing, not assumed

Checked directly against the code before writing this, so nothing below is a
guess:

- **No bulk-approve action exists.** `apps/web/src/server/actions.ts` has no
  `approveAll` / `bulkApprove` / equivalent. The redesign session is building
  the "Keep all from this source" _button_; this session builds the server
  action and query it calls.
- **`backup.create` is a real job type** (`packages/domain/src/types.ts`) with
  storage and a manual trigger, but nothing schedules it — there is no cron, no
  recurring job, and no `retention.enforce` job type at all.
- **No worker is deployed.** Production runs `CAIRN_INLINE_JOBS=always`, so the
  web process drains its own queue. `docs/PRIVACY_MATRIX.md` names a
  Railway-hosted worker as a live processor — that line is currently false and
  needs either a real worker or a doc fix (also flagged on the punch list).

## Part 1 — Make the onboarding backend actually frictionless

1. **Bulk-approve action.** A server action that approves every proposal from
   one source connection in a single transaction, excluding anything flagged
   conflicted or sensitive (those stay individually reviewed — that exclusion
   is not optional, it is what keeps Cairn's evidence model honest). Audited
   the same way individual approval is. The redesign session's UI expects this
   to exist; without it the button has nothing to call.
2. **A real progress signal for first-run indexing**, not just what the
   redesign session polls for. `overview.runningJobs` already exists —
   confirm the count is granular enough (per-source, not just a total) that
   the interface can say "3 of 12 read" rather than only "still reading."
3. **Reconcile the memory-count discrepancy.** `/home`'s `approvedCount` and
   what the backup vault actually holds disagreed by one item during the
   2026-08-01 drill (source said "1 thing saved," backup held and restored 2).
   Find where those two counts diverge — likely `loadOverview()` vs whatever
   the vault iterates over — and make them agree. This blocks trusting either
   number.
4. **A per-connection scope filter.** `mcp_clients.projectIds` exists and is
   always written `null`. Wire it so a connection can be scoped to specific
   memory types at grant time (the OAuth consent screen and the connection-code
   form both create the row — both call sites need the new field).

## Part 2 — The connectors "anyone" actually needs

"Anyone can set this up" fails if the only connector that's actually been
proven live is Gmail.

5. **Verify Google Drive live**, the same way Gmail was verified on
   2026-08-01: real OAuth grant, real file listed, real memory extracted. Not
   just unit-tested at the HTTP boundary.
6. **Verify the GitHub App live**: real installation, a real webhook received,
   a real repository read into memory.
7. **Add the test-user gate warning to the connect flow.** Google's OAuth
   consent screen for this project is in Testing mode — a stranger who isn't
   an added test user will fail at the Google screen, not at Cairn, and get no
   explanation. Either surface that state before they start (best), or catch
   the specific Google error and explain it in Cairn's own words rather than
   showing Google's raw rejection.

## Part 3 — What makes "anyone" actually work at scale

8. **Deploy a real worker**, or decide deliberately not to and fix
   `PRIVACY_MATRIX.md` to match. `CAIRN_INLINE_JOBS=always` is fine for one
   person; it means every request pays the cost of draining the queue, which
   will not hold if more than a handful of workspaces sync at once.
9. **Build the retention-enforcement job.** `docs/RETENTION_DECISIONS.md` has
   the approved numbers once the owner signs off in `DECISIONS.md` (90-day raw
   document drop, 12-month audit prune). A written retention policy nothing
   enforces is a false claim, not a safeguard — this is also on the critical
   path for the privacy policy already published at `/privacy` to be true.
10. **Scheduled, automatic backups.** The job type and storage exist; add the
    scheduler. This is what makes "recoverable" a property of the product
    rather than something that only happens if a person remembers to click a
    button.
11. **Data-key rotation.** Rotating the deployment master key already works.
    Rotating one workspace's individual data key does not — it needs a
    migration that re-encrypts every row under the new key. Low urgency with
    one user; real urgency once workspaces are shared or a key is ever
    suspected compromised.
12. **Team invitations.** The membership model already supports more than one
    person per workspace; there's no invite flow. Relevant the moment "anyone"
    includes a person inviting a colleague rather than only signing up solo.

## Out of scope here

Visual redesign, page layout, and the onboarding-flow _interface_ changes —
all `docs/REDESIGN_BRIEF.md`. Credential rotation, Terms of Service, and the
Google OAuth verification paperwork (video, homepage, moving out of Testing) —
all on the punch list already given to the owner, not design or backend work
proper.

## Definition of done

Same bar as the redesign session: `pnpm verify` and `pnpm test:e2e` green,
including a real end-to-end test for anything newly wired to a live service
(follow the pattern already used for Gmail and for remote MCP OAuth — a real
round trip, not a mock at the HTTP boundary). Update `memory/CURRENT_STATE.md`
and `memory/NEXT_STEPS.md`. Nothing added to `memory/DECISIONS.md` beyond what
the owner explicitly approves in that session.

## Autonomy for this session

Same pre-authorization as the redesign session: once `pnpm verify` and
`pnpm test:e2e` are green, commit and push to `main` without pausing to ask.
This does not cover creating new external accounts, entering credentials, or
spending money — those still stop and ask, as always.
