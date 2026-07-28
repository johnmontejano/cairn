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
4. **Provision Supabase** (database plus a private storage bucket) and run
   `pnpm db:migrate`. Confirm row-level security with the queries in
   `docs/DEPLOYMENT.md`. This is the first step that creates a cloud resource and
   needs explicit approval.
5. **Connect one source connector.** Google Drive is the recommended first, per
   the product plan. GitHub is equally ready if the first users are technical.
6. **Deploy the website and worker** (Vercel plus Railway), then work through the
   pre-launch checklist in `docs/DEPLOYMENT.md`.
7. **Enable remote MCP OAuth.** Last, because it is the one path never exercised
   against a live issuer. Verify current official guidance first; connection
   codes remain the tested alternative.

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
