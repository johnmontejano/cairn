# Cost controls

## The short version

Running locally costs nothing. The built-in extractor and embedder are
deterministic and run in-process, so a fresh checkout is genuinely useful with no
spend at all.

Money only appears when `AI_PROVIDER=openai` or you deploy to managed hosting.

## What is metered

| Operation  | When                               | Rate at time of writing                    |
| ---------- | ---------------------------------- | ------------------------------------------ |
| Extraction | Once per new document revision     | GPT-5 mini: $0.25 / M input, $2 / M output |
| Embeddings | Once per approved or edited memory | `text-embedding-3-small`: $0.02 / M input  |
| Answering  | Per question asked                 | Same as extraction                         |

Processing one million source tokens once, producing 100,000 output tokens, and
embedding the same million is roughly **$0.47**. Real bills are higher when
documents are reprocessed, prompts repeat context, jobs retry, or people ask a
lot of questions — which is exactly what the controls below exist for.

Verify current pricing before relying on these figures.

## How spend is bounded

**Content addressing.** A document whose bytes have not changed is recognised and
produces no work at all. This is the largest saving and it is structural, not a
setting: the unique constraint on `(workspace, item, content hash)` makes
re-ingestion a no-op.

**Embedding cache.** Identical text is embedded once per process.

**A hard limit, checked before spending.** Every extraction job calls
`assertWithinBudget` _before_ the model call. A workspace at its limit stops
spending rather than discovering the bill later. The job is marked
`budget_exceeded` and can be retried once the limit is raised — no memory is
silently lost.

**A soft limit.** At 80% of the budget the Settings page warns.

**A ceiling per request.** `CAIRN_MAX_EXTRACTION_CHARS` (24,000 by default)
bounds how much of any one document reaches a model.

**Small outputs.** Extraction returns structured candidates, not prose.

**Retries that stop.** Validation failures are never retried. Transient failures
back off exponentially and give up after `maxAttempts`.

## Setting the limit

**Settings → Spending limit**: the monthly ceiling, whether to stop at it, and a
privacy-mode switch that keeps everything local regardless of configuration.
Month-to-date spend is shown, with a per-operation and per-model breakdown from
`model_usage`.

Defaults: `CAIRN_AI_MONTHLY_BUDGET_USD=5`, `CAIRN_AI_SOFT_LIMIT_RATIO=0.8`.

## Hosting

| Stage                    | Likely monthly | Assumptions                                                 |
| ------------------------ | -------------- | ----------------------------------------------------------- |
| Local                    | **$0**         | Built-in extractor and embedder; nothing hosted             |
| Small private deployment | **$1–$20**     | Free tiers throughout, light AI usage                       |
| Public beta              | **$50–$85**    | Vercel Pro $20, Supabase Pro $25, Railway $5–$20, AI $1–$20 |
| Heavy use                | **$85+**       | Larger compute, egress, reprocessing, more questions        |

Planning ranges, not quotes. Set spend caps at each vendor as well as in
Settings — this application can only limit its own model calls, not your
database's egress bill.

## Worth being honest about

For one light user, a $15/month hosted product is cheaper than operating this.
The reason to run it is control, portability, and the option of never sending
anything to an external model — not a lower bill.
