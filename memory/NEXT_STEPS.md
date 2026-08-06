# Next Steps

The MVP is built and verified locally. Everything below needs a decision or a
credential from the user; none of it should be done without explicit approval.

## Review first, before anything external

1. Run it: `pnpm install && pnpm setup && pnpm demo:seed && pnpm dev`. Walk the
   journey at <http://localhost:3000> and decide whether it is worth continuing.
2. Run `pnpm verify` and `pnpm test:e2e` to confirm the checks pass on your
   machine.
3. Read `docs/THREAT_MODEL.md` and `docs/PRIVACY_MATRIX.md`. They state plainly
   what is and is not protected. Decide whether the residual risks — chiefly the
   unencrypted embedding table — are acceptable before any real data goes in.
4. Confirm or replace the working name `Cairn`. It is confined to
   `packages/config/src/product.ts` plus marketing copy.

## Then, in order of value and risk

1. **Usability test with five nontechnical people.** The highest-value and
   lowest-risk step, and the one the product plan named as a release gate. Watch
   whether someone reaches a cited answer without coaching. Costs nothing and
   changes what to build next.
2. **Turn on a real model** (`AI_PROVIDER=openai` plus a key, or
   `AI_PROVIDER=local` against a model you run). Low risk, immediately visible
   quality change, and the spending limit is already enforced before each call.
   Compare extraction quality against the built-in extractor before paying for it
   at scale.
3. **Connect one AI tool locally** over the stdio server, following
   `docs/MCP_GUIDE.md`. No hosting required and it proves the whole promise.
4. ~~**Provision Supabase.**~~ Done on 2026-07-28 and verified. See
   `CURRENT_STATE.md`.
5. **Connect one source connector.** Google Drive is the recommended first, per
   the product plan. GitHub is equally ready if the first users are technical.
   Both need OAuth credentials the user must create.
6. ~~**Deploy the website.**~~ Done on 2026-07-28. Live at
   <https://cairn-web-beta.vercel.app> with `/api/health` green. See
   `CURRENT_STATE.md`.
7. ~~**Enable remote MCP OAuth.**~~ Built and verified end to end on 2026-08-01.
   Cairn is now its own OAuth 2.1 authorization server; the previous design
   could not have worked against any issuer. See `docs/REMOTE_MCP_OAUTH.md` and
   `CURRENT_STATE.md`. **One user step remains:** apply migration `0008`, then
   set `MCP_AUTH_MODE=oauth` in Vercel and redeploy. No new secret is needed.

## Immediate

0aa. **Have the owner actually run `codex mcp add`.** The whole protocol chain
was verified against production by hand (401 → RFC 9728 discovery → dynamic
client registration → consent screen), and the RFC 8252 loopback-port gap that
could have refused Codex's callback is fixed and tested. But Codex is not
installed on the machine this was built from, so nobody has yet watched the
real thing complete. Command:
`codex mcp add cairn --url https://cairn-web-beta.vercel.app/api/mcp`
(needs Codex 0.77+; then `/mcp`). If it fails, the first thing to check is
whether the `redirect_uri` Codex registers matches the one it authorizes with
— `redirectUriAllowed` relaxes the port but requires the path to be identical,
and Codex appends a per-server `/callback/<hash>` segment.

0ab. **`offline_access` is absent from `scopes_supported`.** OpenAI's connector
pre-flight documents checking for it and warns access can lapse at token
expiry. Cairn's `refresh_token` grant already works, so the impact is limited
to ChatGPT-in-browser, which is marked unsupported anyway. `parseScopes` drops
unknown scopes rather than refusing them, so advertising it would be safe —
but it was left alone deliberately rather than changed unasked. Decide.

0ac. **The two OAuth metadata documents advertise different scopes.** Protected
Resource Metadata offers only `memory:read`; the authorization server offers
`memory:read` and `memory:propose`. This is deliberate (the code comment says
propose is meant to arrive by step-up, not up front) but it means a client
deriving scope from the PRM — the spec-correct path — never asks for propose.
Confirm that is still the intent.

0ad. **LinkedIn and X/Twitter do not exist as connectors.** The owner listed
them among "connected apps". `sourceProviders` has no entry and there is no
`CONNECTOR_DESCRIPTIONS` record, so this is new connector work, not an
interface change. Gmail and Calendar's hand-rolled Google OAuth is the nearest
template.

0ae. **Junk memories predating the Gmail filter are still stored.** The filter
stops new ones, but Cairn only ever stored `Subject/From/To/Date` — not
`List-Unsubscribe` — so old newsletter-derived proposals cannot be detected
retroactively with any confidence. "Remove all N" on each source group is the
reliable way to clear them.

0z. ~~**Apply migrations 0005–0007.**~~ Done 2026-07-31, verified against
Supabase before merge.

0y. ~~**Finish the deep-query tier.**~~ Done 2026-08-01. `ask_deeply` and
`read_deep_answer` are live MCP tools; `handleDeepQuery` runs the job.
Verified as a real external agent over the MCP SDK against production.

0x. **Superseded — do not pursue.** Gmail and Calendar no longer go through
Pipedream at all; see "Gmail, Calendar and Drive now use real Google OAuth"
in `CURRENT_STATE.md` for why (their Connect-components API is blocked with
no visible fix) and what replaced it (hand-rolled Google OAuth, the same
pattern Drive always used). `PipedreamConnector.list()` in
`packages/connectors/src/pipedream.ts` still throws setup-required and that is
fine to leave as-is — it is unused by any provider now, kept only because the
JSON-RPC plumbing in `pipedream.ts` may be worth reusing for a future app that
doesn't hit this specific block (Notion, GitHub, LinkedIn were all under
consideration earlier in the project).

0w. **Add more Google-family test users, or move the OAuth consent screen out
of Testing mode**, if anyone other than the project owner needs to sign in.
Testing mode caps sign-ins to explicitly added test users; see
`console.cloud.google.com/auth/audience?project=ciarn-504204`. Moving to
Production requires Google's verification process for sensitive scopes
(`gmail.readonly`, `calendar.readonly`) — expect this to take real review time
and to require a privacy policy URL, which ties into the retention/deletion
policy still listed as an open question below.

0v. ~~**Verify a real sync end to end.**~~ Done 2026-08-01. Both bugs found
while verifying (Google API disabled; wrong-format Supabase key) are fixed —
see `CURRENT_STATE.md`. A real "Check for updates" click against production
pulled actual Gmail messages: Gmail shows "Connected — Checked just now,"
and Memory holds 49 real extracted candidates (not fixture data). Confirmed
by the agent directly in the browser, not just by reading logs.

0a. ~~**Add an identity editor to Settings.**~~ Done on 2026-07-31 (commit
`8566024`). The form starts from the derived summary so editing begins from
what the machine currently says; saving it empty is the labelled way back to
automatic.

0. ~~**Create a Pipedream OAuth client.**~~ Done on 2026-07-31. Credentials are
   set in Vercel with `PIPEDREAM_ENVIRONMENT=production`, and the live call
   confirmed `TOKEN_ENDPOINT` and disproved two assumptions — see
   `CURRENT_STATE.md`. **Rotate the client secret**: it was pasted into a chat
   transcript, and rotation is one click from the `···` menu on the client row
   at <https://pipedream.com/settings/api>.
1. **Rotate the Supabase personal access token** that was stored in plaintext in
   the now-deleted `.codex/config.toml` (prefix `sbp_4f25…`). A PAT carries
   management-API access to every project in the account, so this is a wider
   exposure than the database password. Revoke it at
   <https://supabase.com/dashboard/account/tokens> and issue a replacement only
   if something still needs one — nothing in the current config does. This is
   distinct from the database password whose rotation was declined on 2026-07-29.
2. ~~**Set `AUTH_PROVIDER=workos` and the WorkOS/session env vars in Vercel,
   then redeploy.**~~ Env vars set by the user 2026-08-01, redeployed, and
   confirmed live: the demo-mode copy is gone from the production sign-in
   page (`providers.auth.state` only reports `'ready'` when the switch has
   actually taken effect). Code-side hardening (OAuth state/CSRF check,
   session-cookie signing) verified earlier via `pnpm verify` and
   `pnpm test:e2e`. **Not personally completed by the agent:** an actual
   end-to-end stranger sign-up (WorkOS hosted page → email/magic-link
   verification → landing on a fresh isolated workspace) — that needs an
   inbox to receive a code, which the agent doesn't have access to. The
   config-level confirmation is strong, but a real walkthrough with a real
   inbox is the one piece still unverified firsthand.

Rotating the database password was offered and declined on 2026-07-29; see the
accepted risk in `CURRENT_STATE.md`. Do not re-raise it as a task, but do rotate
before storing anyone else's data.

## Before anyone else's data goes in

- **Make the five retention/deletion calls** in `docs/RETENTION_DECISIONS.md`,
  fill the `[DECIDE: …]` markers in `docs/PRIVACY_POLICY.md`, publish it at a
  stable URL on the app's own domain, and record the choices in `DECISIONS.md`.
  Do not implement enforcement before deciding — a written retention rule that
  nothing enforces is a false claim. Decision 5 subsumes the old "encrypt the
  embedding table or isolate it" item.
- ~~Take a backup, verify it, and restore it into a scratch workspace.~~ Done by
  hand on 2026-08-01, through the real interface, into a genuinely different
  account. See `CURRENT_STATE.md`. Kept as `tests/e2e/recovery.spec.ts`.
- Set spend caps at every vendor, not only in Settings.
- Consider an independent security review. Note this may not be optional:
  Google's restricted-scope review can require one.

## Onboarding gaps worth closing next

From `docs/ONBOARDING_BENCHMARK.md`, in the order that loses the fewest people.
Gap A is closed by the OAuth work.

- ~~**B — waiting is unbounded and needs a manual refresh.**~~ Done
  2026-08-01, redesign brief item 6. `/welcome` polls itself instead.
- ~~**D — `/home` leads with counts, not with what Cairn knows about you.**~~
  Done 2026-08-01, redesign brief item 8.
- ~~**F — providers that cannot work on this deployment are still offered.**~~
  Done 2026-08-01, redesign brief item 16.
- ~~**G — nothing invites connecting an AI once there is memory worth
  connecting.**~~ Done 2026-08-01, redesign brief item 9.
- ~~**C — 49 candidates from one Gmail sync, each needing its own
  decision.**~~ Done 2026-08-01, redesign brief item 7. "Keep all from this
  source" on `/memory`, excluding conflicted/sensitive items, verified live.
- **E — scope is per-connection, not per-content.** Still open, not part of
  the redesign brief. Let a connection choose which memory types it may read;
  `mcp_clients.projectIds` already exists and is always written `null`. A day.

~~Also open, found during the backup drill: `/home`'s `approvedCount` and what
the vault backs up appear to count different things.~~ Done 2026-08-01,
redesign brief item 17 — `loadSettings`' `memoryCount` query was the one
unscoped-by-project query of the three; now matches. See
`memory/CURRENT_STATE.md`.

**The whole redesign brief (`docs/REDESIGN_BRIEF.md`, all four phases,
items 1–18) is done, verified, and pushed to `main` as of 2026-08-01.** See
`memory/CURRENT_STATE.md` for the full breakdown, including two real bugs
found and fixed in review (a setup banner that would have nagged forever, and
a garbled identity-summary lede) that no automated check caught.

**One small, deliberately-not-expanded follow-up found along the way:**
`loadSettings`' `sourceCount` and `identityItems` queries
(`apps/web/src/server/views.ts`) have the same unscoped-by-project pattern the
`memoryCount` fix above just corrected. The brief named only `memoryCount`;
worth a look, not urgent — same fix shape if it turns out to matter.

## Open questions

- Product name and brand direction.
- Which cloud providers hold the database, encrypted objects, and backups.
- Whether the canonical vault must eventually be literal Git, or whether the
  current versioned Markdown store with optional Git mirroring is sufficient.
- Hosting region, operating budget, retention period, deletion policy.
- Which runtime AI and embedding providers have acceptable data-processing terms.
- Whether teams are in the first paid release or explicitly post-MVP.
- Should users hold their own encryption keys in the first release, accepting
  that server-side search would then be impossible?
