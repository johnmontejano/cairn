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

0. **Create a Pipedream OAuth client** and set `PIPEDREAM_CLIENT_ID` and
   `PIPEDREAM_CLIENT_SECRET` in Vercel. This unblocks the whole connector queue:
   Gmail, Drive, GitHub and Calendar all sit on the Pipedream layer, and the
   layer cannot make a single live call without it. Two things then get
   finished with one real request — confirming `TOKEN_ENDPOINT` (currently the
   conventional OAuth2 URL, unverified because their docs were down) and mapping
   each app's discovered tools onto `FetchedSource`.
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
