# Retention and deletion: what is required, and what is yours to choose

Date: 2026-08-01. Prepared so the policy calls can be made deliberately.

Nothing here is a decision. Each section separates **what is required of you**
from **what is genuinely a choice**, and names the tradeoff on each choice so it
can be made once and written down.

## The forcing function you may not have priced in

Cairn requests `gmail.readonly` and `calendar.readonly`. Google classes both as
**restricted** scopes. The OAuth consent screen for project `ciarn-504204` is
still in Testing mode, which caps you at explicitly added test users. Moving to
Production is not a toggle — it is a review, and it has hard prerequisites:

- A privacy policy hosted on **the same domain as the app**, publicly reachable
  without signing in.
- A homepage on that same domain that explains the app.
- An explicit **Limited Use** disclosure (see the draft policy).
- A demonstration video of the OAuth flow.
- For restricted scopes, potentially an independent security assessment. This is
  the expensive one, and whether it applies depends on how the data is handled.

Two consequences worth deciding on early:

1. **The privacy policy is on the critical path to letting anyone else use
   Cairn with Gmail**, not a nice-to-have for later.
2. **Narrowing scope is a lever.** If Gmail turns out not to be the first
   connector you need, dropping the restricted scopes removes the heaviest part
   of the review entirely. Drive with `drive.file` (files the user explicitly
   picks) is far lighter than Gmail with `gmail.readonly`.

## Decision 1 — Retention of raw source documents

Cairn stores the encrypted original of everything it reads, so evidence spans
can be verified against the source. That is what makes citations trustworthy.
It is also the largest and most sensitive thing on disk.

| Option                                     | What it costs                                                                              | What it buys                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **Keep indefinitely** (today's behaviour)  | Every email ever synced stays until the workspace is deleted. Largest breach blast radius. | Evidence always verifiable; History always complete.                             |
| **Keep 90 days, then drop the raw blob**   | After 90 days a citation can name its source but cannot re-verify the exact characters.    | Bounded exposure. Most of the value, since re-verification is rare after months. |
| **Drop the raw blob once extraction ends** | Evidence verification becomes impossible; the "show me the sentence" promise weakens.      | Smallest footprint.                                                              |

**Recommendation, for you to accept or reject:** 90 days. It keeps the product's
distinctive promise where it actually gets used and stops Cairn becoming an
indefinite second copy of someone's mailbox. The middle option is also the
easiest to explain to Google's reviewers.

## Decision 2 — Retention of approved memory

Approved memory is the product. It should persist until deleted.

The real question is narrower: **what happens to memory whose source connection
is later disconnected?** Today, disconnecting stops future reads and destroys
the credential, and leaves saved memory untouched. The interface says so.

| Option                               | Tradeoff                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| **Keep it** (today)                  | Honest and predictable. But memory outlives the person's access to its source. |
| **Offer to delete it on disconnect** | One extra question at a moment the person is already thinking about removal.   |

**Recommendation:** keep today's behaviour, and add the offer as a checkbox on
the disconnect confirmation. Do not delete silently — that would surprise
someone who disconnected merely to re-authorise.

## Decision 3 — Deleted-data grace period

Deleting a workspace today is immediate and irreversible.

| Option                 | Tradeoff                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------- |
| **Immediate** (today)  | Strongest privacy claim. A mistaken deletion is unrecoverable.                      |
| **30-day soft delete** | Recoverable mistakes. But "deleted" now means "hidden," which must be said plainly. |

**Recommendation:** keep immediate deletion. It is the stronger claim, it is
what the interface already promises, and Cairn's backup feature is the honest
answer to accidental deletion. If you choose a grace period, the deletion screen
copy has to change in the same commit.

## Decision 4 — Audit and usage logs

Audit events record who did what. They are the thing that survives a deletion
request longest, because they intentionally outlive the objects they reference.

| Option                        | Tradeoff                                                          |
| ----------------------------- | ----------------------------------------------------------------- |
| **Keep indefinitely** (today) | Complete history. Also a permanent activity record of a person.   |
| **12 months, then prune**     | Standard, defensible, still useful for investigating an incident. |

**Recommendation:** 12 months. Audit rows hold no memory content, but they do
disclose an activity pattern, and an unbounded one is hard to justify.

## Decision 5 — The embedding table

Already flagged in `CURRENT_STATE.md` as the weakest at-rest surface, and listed
as an open decision. Embeddings are stored unencrypted because pgvector must
compare them, and they are partially invertible.

| Option                             | Tradeoff                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| **Leave as-is** (today)            | Fast search. Someone with database read access can partially reconstruct meaning.   |
| **Encrypt and search client-side** | Server-side search becomes impossible. This is a product amputation, not a tweak.   |
| **Isolate in a separate database** | Compromise of the main database no longer yields embeddings. Real operational cost. |

**Recommendation:** leave as-is for now, and **say so explicitly in the privacy
policy** rather than leaving it implied. The threat model already names it; a
policy that quietly omits it would be the actual problem.

## What is required regardless of the above

- A publicly reachable privacy policy at a stable URL on the app's domain.
- Naming every processor. The draft does this.
- Saying what a person can do: export, delete, disconnect — all of which exist.
- Not claiming a certification, audit, or compliance status you do not have.
  Cairn has had no independent security review, and the policy must not imply
  otherwise.

## Once you decide

Fill the marked places in `docs/PRIVACY_POLICY.md`, record the choices in
`memory/DECISIONS.md`, and only then implement enforcement — retention that is
written down but not enforced is worse than no policy, because it is a claim
that is not true.
