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
7. **Enable remote MCP OAuth.** Last, because it is the one path never exercised
   against a live issuer. Verify current official guidance first; connection codes
   remain the tested alternative.

## Immediate

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

0v. **Verify a real sync end to end.** A connected Gmail account exists
(`state='active'`, real credential) but no `connection.sync` job has been
confirmed to actually pull messages into memory yet. Trigger one, read what
lands in Memory, and confirm the extractor handles a real email's shape
(headers, quoted-reply chains, HTML-only messages with no plain-text part —
`extractPlainText` in `gmail.ts` falls back to `'(no plain-text body)'` for
those, which is honest but worth seeing happen at least once on purpose).

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
2. **Set up WorkOS AuthKit** and switch `AUTH_PROVIDER` from `fixture` to
   `workos`. Redirect URI:
   `https://cairn-web-beta.vercel.app/api/oauth/workos/callback`. Until this is
   done the landing page shows demo-mode copy that is untrue of a hosted
   deployment, and sign-in codes go to the Vercel log rather than to email.

Rotating the database password was offered and declined on 2026-07-29; see the
accepted risk in `CURRENT_STATE.md`. Do not re-raise it as a task, but do rotate
before storing anyone else's data.

## Before anyone else's data goes in

- Decide the retention period and deletion policy, then state them in a privacy
  policy that names every processor in `docs/PRIVACY_MATRIX.md`.
- Decide whether to encrypt the embedding table and accept slower search, or to
  isolate it.
- Take a backup, verify it, and restore it into a scratch workspace. The test
  proves the mechanism; do it once by hand anyway.
- Set spend caps at every vendor, not only in Settings.
- Consider an independent security review.

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
