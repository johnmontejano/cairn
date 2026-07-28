# Cost and Security Research

Status: Current public pricing and policy snapshot  
Date checked: 2026-07-27  
Currency: USD, before tax; estimates exclude the founder's development time

## Short answer

The project can remain effectively free while it runs locally. A personal,
non-commercial hosted prototype can also fit within free tiers, with only small
usage-based AI charges. A dependable public beta using the proposed managed
stack is more realistically **about $50–$85 per month**, plus a domain and
variable AI usage.

That is not automatically cheaper than Unabyss. Unabyss currently advertises
Pro at **$15/month monthly or $13/month billed annually**, Max at **$89/month
monthly or $79/month billed annually**, and a custom Team plan. Both paid plans
begin with a seven-day trial; its terms also describe a limited Free Plan.
([pricing](https://unabyss.com/#pricing),
[terms](https://unabyss.com/terms))

For one light user, Unabyss Pro is cheaper than operating a production-grade
hosted clone. A self-run product may become cheaper than Max at moderate usage,
but only if development, maintenance, security work, backups, support, and
incident response are treated as the owner's time rather than cash expense.
Its strongest reason is therefore **control and portability**, not guaranteed
savings.

## Current component prices

| Component         |                                                                            Free/start tier |                                                                                             Likely paid tier |
| ----------------- | -----------------------------------------------------------------------------------------: | -----------------------------------------------------------------------------------------------------------: |
| Supabase          | $0; 2 active projects, 500 MB database and 1 GB files per project; inactive projects pause |   Pro from $25/month; first Micro project covered, 8 GB database, 100 GB files, 250 GB egress, daily backups |
| Vercel web app    |                                        Hobby $0, but only for personal, non-commercial use |                                                      Pro $20/month with $20 usage credit, then metered usage |
| WorkOS AuthKit    |                                                  $0 through 1 million monthly active users | $2,500/month per additional million; custom domain $99/month; enterprise SSO starts at $125/connection/month |
| Railway worker    |                            Free experimentation with $1/month of resources after its trial |                                     Hobby $5 minimum including $5 usage; Pro $20 minimum including $20 usage |
| OpenAI extraction |                                                  No supported free API tier for GPT-5 mini |                                          GPT-5 mini: $0.25/million input tokens and $2/million output tokens |
| OpenAI embeddings |                                                                                    Metered |                                                         `text-embedding-3-small`: $0.02/million input tokens |

Sources:
[Supabase pricing](https://supabase.com/pricing) and
[billing documentation](https://supabase.com/docs/guides/platform/billing-on-supabase);
[Vercel pricing](https://vercel.com/pricing);
[WorkOS pricing](https://workos.com/pricing) and
[environment documentation](https://workos.com/docs/authkit/environments);
[Railway pricing](https://docs.railway.com/pricing);
[GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini);
[`text-embedding-3-small`](https://developers.openai.com/api/docs/models/text-embedding-3-small).

WorkOS AuthKit is enough for ordinary app login at this stage. Enterprise SSO,
a branded WorkOS domain, and other enterprise add-ons should be deferred.
Public pricing for a distinct WorkOS “Connect” MCP product was not found; do
not assume it is included without confirming the exact product and contract.

## Practical monthly scenarios

These are planning ranges, not quotes.

| Stage                    | Likely monthly cash cost | Assumptions                                                                                                                                                                |
| ------------------------ | -----------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local prototype          |                **$0–$5** | Local app/database/worker; local models can make it $0, or pay only for a small number of API calls                                                                        |
| Small private hosted app |               **$1–$20** | Supabase Free, Vercel Hobby only while genuinely personal/non-commercial, WorkOS free, Railway Free/Hobby, light AI usage                                                  |
| Public production beta   |              **$50–$85** | Vercel Pro $20 + Supabase Pro $25 + Railway $5–$20 + roughly $1–$20 AI; domain commonly adds a small annual charge                                                         |
| Heavy use                |     **$85 to hundreds+** | Larger worker/database compute, storage and egress overages, repeated ingestion/re-indexing, connector polling, backups/observability, and substantially more model output |

At published OpenAI rates, processing one million source tokens once with
GPT-5 mini, producing 100,000 output tokens, and embedding the million source
tokens is approximately **$0.47**: $0.25 input + $0.20 output + $0.02
embeddings. Real bills are higher when documents are reprocessed, prompts
repeat context, extraction output is verbose, failed jobs retry, or user
questions invoke generation. Caching, content hashes, incremental sync, small
outputs, batch work, and spending caps should be designed in from the start.

## What ownership does—and does not—mean for security

Owning the code and canonical Markdown gives meaningful benefits:

- the user can inspect, export, migrate, and delete the authoritative memory;
- the product can send only retrieved excerpts instead of an entire vault;
- connector permissions, retention, model choice, and audit logs are under the
  owner's control;
- the system can run locally or on infrastructure selected by the owner.

It does **not** mean no company can see or process the data if the managed
architecture is used. Supabase stores the database and files, Vercel and
Railway execute application code, WorkOS handles identity data, source
providers supply connected content, and OpenAI processes text sent for
extraction or embeddings. The chosen Claude/Codex/other MCP client will also
receive whatever citations and context the user retrieves. In fact,
self-building with several managed vendors can create more separate trust
relationships than buying one service.

Unabyss itself says its stored context is encrypted in transit and at rest,
that it does not train on customer context, and that SOC 2 Type II is still in
progress. Its terms and privacy material say context may be processed by
OpenAI, Anthropic, and Google and hosted through other subprocessors; once
context is delivered to an external AI tool, that tool's policies apply.
([security](https://unabyss.com/security),
[terms](https://unabyss.com/terms),
[privacy](https://unabyss.com/privacy))

For the proposed OpenAI API integration, OpenAI states that API data is not
used for model training unless the customer opts in. By default, abuse
monitoring logs that may contain prompts and responses can be retained for up
to 30 days. Approved customers can request Modified Abuse Monitoring or Zero
Data Retention; the Responses API can also retain application state for 30
days by default, so calls should use `store: false` and avoid stateful
endpoints unless required. Zero Data Retention is eligibility-based, not a
default promise.
([OpenAI API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint))

## Recommended privacy posture

For an early personal build, offer two clearly labeled modes:

1. **Local/private mode:** local vault, Postgres/search, worker, embeddings,
   and MCP; bind services to localhost or a private network. This minimizes
   exposure and can avoid sending memory to a model provider entirely by using
   local extraction and embedding models.
2. **Convenient hosted mode:** managed services, but data-minimized. Encrypt
   credentials and especially sensitive source objects, enforce tenant
   isolation and least privilege, disable unnecessary analytics, retain raw
   evidence only as long as needed, expose deletion/export controls, and send
   only the minimum excerpt required for each model operation.

Even in local mode, connecting a cloud source or using Claude, Codex, or
another hosted model creates a third-party boundary. “Private” should therefore
be expressed precisely in the UI: show where data is stored, which processor
receives each operation, how long it is retained, and what disconnecting or
deleting actually removes.

## Planning conclusion

Start locally and keep the first tracer below **$5/month**. Do not pay for
production infrastructure until the review-and-citation workflow is useful.
For a public beta, budget **$75/month** as a sensible working allowance and set
vendor spend caps. Choose this path because it delivers auditable ownership,
selective disclosure, optional local operation, and portability—not because it
is certain to beat a $15 hosted subscription on price.
