# UX audit of the category reference

Observed 2026-07-31 in a live signed-in account, across Chat, Connections and
MCP.

What follows is **structure and interaction**: where things sit, what order a
flow runs in, what is disclosed when, and which states are given a name. Those
are design decisions, and adopting them is ordinary competitive practice.

What is deliberately **not** recorded here is their visual identity — palette,
type, spacing, illustration, and the wording of their copy. Cairn's non-goals
have forbidden copying those since 2026-07-27, and nothing here changes that.
The bar to meet is "as considered as this", not "indistinguishable from this".

---

## 1. Indexing is disclosed, not hidden

A banner sits above the conversation:

> Indexing memory… (4 apps) · 670 remaining · Still indexing your import —
> answers may miss new data until this finishes.

Three separate facts: how many sources are affected, how much work is left, and
what it means for the answer quality right now.

**Why it matters.** The failure this avoids is someone asking a question during
their first ten minutes, getting a thin answer, and concluding the product does
not work. The banner reframes a thin answer as a temporary state.

**Cairn already has the backend for this.** `deep_queries.indexing_pending` and
the sentence in `formatDeepAnswer()` do the same job for a single answer. What
is missing is the standing indicator — the thing you see before you ask.

## 2. The minimum and the recommendation are different numbers

Setup over MCP hard-gates at **two** connected apps. The web empty state asks
for **three**, with a reason attached: richer context, better answers.

Two is the floor below which the product cannot demonstrate itself. Three is
where it starts being good. Conflating them would either block people
unnecessarily or let them arrive at a disappointing first answer.

Cairn's `MINIMUM_CONNECTED_APPS` is the floor. A separate recommended count
belongs in the interface, not in the gate.

## 3. Connect actions differ by what the client actually needs

The MCP page does not offer one "Connect" button. Each row names the mechanism:

| Action             | Used for                                       |
| ------------------ | ---------------------------------------------- |
| Connect            | Hosted OAuth                                   |
| Copy command       | CLI tools                                      |
| Get Token & Prompt | Clients needing a bearer token pasted in       |
| Open settings      | Clients where the user adds a custom connector |
| Coming soon        | Not built yet, said plainly                    |

**Why it matters.** A single verb would lie about four of the five. Someone
clicking "Connect" on a CLI tool and getting a shell command has been misled,
even harmlessly.

## 4. Unavailable states are named rather than hidden

Discord shows _Temporarily unavailable_. A tier-gated client shows _Coming
soon_. Neither is removed from the list.

Absence reads as "this product cannot do that". A named unavailable state reads
as "not today", which is both truer and less damaging.

This matches what Cairn already does with `setup-required`.

## 5. Every connected source states its freshness inline

Each connected card carries a status dot, a live phase (`Indexing memory…`) and
a cadence (`Syncs every 24 hours`) on the card itself — not behind a detail
view.

The question "is this current?" is the one people actually have about a
connected source, and it is asked constantly. Answering it inline costs one line
and removes a whole navigation.

## 6. Unconnected sources say what they would contribute

Not just a name — a short phrase naming the kind of context that app holds
(`Notes, ideas, knowledge` for Obsidian; `Issues, roadmap, priorities` for
Linear).

**Why it matters.** Someone choosing their second and third app is deciding what
kind of memory they want, not which logos they recognise. Cairn's
`CONNECTOR_DESCRIPTIONS.summary` already holds exactly this, and the Sources
page already shows it.

## 7. Upload sits among the integrations, not apart from them

"Add your files" is the first card in the same grid as Gmail and Notion, not a
separate section.

Files and connected apps are the same job — get context in. Splitting them makes
the manual path feel like a lesser one.

## 8. The empty state proposes questions

Three example prompts under "TRY ASKING", each phrased as a real task rather
than a feature demo.

An empty conversation box asks the person to invent a use case. Examples turn
that into recognition.

## 9. Incomplete setup follows you

A persistent card — _ChatGPT is connected but not fully set up yet_ — with a
single action, shown outside the setup flow itself.

Half-finished setup is invisible by nature: the person believes they are done.

---

## What to take, in order of value to Cairn

1. **Standing indexing indicator.** Backend exists; the interface does not show
   it. Highest value, smallest change.
2. **Per-client connect verbs** on Connected AIs. Cairn has one path today and
   will soon have several.
3. **Freshness on the source card** — status, phase and cadence inline.
4. **A recommended count** distinct from the gate.
5. **Suggested questions** in the empty Ask state.
6. **Persistent incomplete-setup nudge**, once `setup_status` has a surface.

## What not to take

Their visual identity, their copy, and their skills library, which is written
prose. Where Cairn needs equivalents, they get written from scratch.

Cairn also keeps two things this reference does not have, and should not trade
away for resemblance: every citation verified against its source before display,
and nothing reachable over MCP writing without the person present.
