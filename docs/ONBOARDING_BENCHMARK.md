# Onboarding and Connection Benchmark

Date: 2026-08-01

A step-by-step functional comparison of Cairn's first-run journey against the
same journey in Unabyss, the closest public product in this category.

## Method, and its deliberate limit

Everything attributed to Unabyss below comes from their **public** surface:
their marketing site, their public blog and changelog, and third-party
write-ups. No authenticated session was used, and no implementation detail was
extracted from the product itself.

That limit is not only the project's originality decision (2026-07-27 in
`DECISIONS.md`); it is also a copyright and terms-of-service line that account
access does not license anyone to cross. It costs this comparison very little,
because onboarding order, connection method, and scope model are all things a
product markets publicly.

This document compares **function only** — the order of steps, what a person
must know, where they wait, where they can get stuck. Cairn's palette,
illustrations, copy, and components stay Cairn's own. Every proposal below is
written to be built from the existing design system (`Card`, `Callout`,
`Badge`, `Disclosure`, `EmptyState`, `ProgressSteps`, `cairn-choice-grid`).

## The two flows, side by side

| Step                    | Unabyss (public surface)                                                              | Cairn (verified in code, 2026-08-01)                                                       |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Sign up              | "Start now" → hosted sign-up                                                          | WorkOS AuthKit, live and confirmed                                                         |
| 2. Connect a source     | OAuth per app: pick account, authorize, done                                          | `/sources` → Connect → Google OAuth. Same shape.                                           |
| 3. Wait for extraction  | Stated commitment: structured context **in under 90 seconds**; self-updating          | `Callout`: "Still reading. **Refresh this page in a moment.**" No estimate, manual refresh |
| 4. See what was learned | Four named layers — Identity, Profile, Mind, Environment — plus human-readable files  | `/home`: counts, then type groups, then a per-item review queue                            |
| 5. Correct it           | Correct after the fact; structure is generated first                                  | Per-item keep/remove **before** anything is saved, each with verified evidence             |
| 6. Connect an AI client | Point the client at their MCP server URL; token for the MCP host                      | Create a connection code, then run a `npx tsx <path-to-this-project>/…` command            |
| 7. Scope what it sees   | Per-layer: "a coding assistant gets Identity and Profile, not Mind"; revoke instantly | Two checkboxes: allow proposals, include sensitive. Revoke instantly                       |
| 8. Ask something        | Context loads automatically at client session start                                   | `/ask` in the website, with citations; over MCP via `search_memory` / `ask_deeply`         |

Where Cairn is already ahead, and should not "fix" itself into parity:
evidence-backed review before anything is saved, exact character offsets
verified against the source document, contradiction flagging rather than
last-write-wins, and no write scope reachable over MCP. Those are the product.

## Functional gaps, most severe first

### A. The connect-an-AI step cannot serve the two clients people actually use

This is the largest gap and it is not a polish item.

`apps/web/src/app/connections/page.tsx` instructs a person to run:

```
claude mcp add cairn --env CAIRN_CONNECTION_CODE=… -- npx -y tsx <path-to-this-project>/packages/mcp/src/bin/stdio.ts
```

`<path-to-this-project>` means the person must have **cloned the repository**.
For a hosted product whose stated primary audience is "people with no coding,
GitHub, Git, or MCP experience" (`PROJECT_BRIEF.md`), the final step of the
core promise currently requires a local checkout, Node, and a terminal.

The page is honest that ChatGPT is "Not yet." The modern path for Claude is
Settings → Connectors → Add custom connector → paste an HTTPS URL → sign in.
Cairn cannot serve that today. See `REMOTE_MCP_OAUTH.md` for why the existing
`MCP_AUTH_MODE=oauth` code cannot close it as written, and what does.

**Proposal:** remote MCP OAuth, so the instruction becomes one URL plus a
Cairn-hosted consent screen. Connection codes stay as the advanced path.

### B. Waiting is unbounded and requires a manual refresh

`/welcome` renders "Still reading. Refresh this page in a moment." A person who
has just handed over their email has no idea whether that means three seconds
or three minutes, and telling them to refresh puts the burden of discovering
completion on them. This is a classic abandonment point, and it lands at
precisely the moment the product has taken something and given nothing back.

**Proposal:** keep the honest wording, remove the manual instruction.

- Auto-refresh the section while `runningJobs > 0` (poll the existing
  `loadOverview`; `ProgressSteps` already models Reading → Organizing → Ready).
- Replace "Refresh this page in a moment" with progress that moves on its own,
  and state a real expectation derived from observed job durations rather than
  a marketing number.
- Show the first candidates as they land instead of waiting for the whole
  batch, so something appears within seconds.

### C. Forty-nine decisions stand between a first sync and a first answer

The live Gmail sync recorded in `CURRENT_STATE.md` produced **49 candidates**.
`/home` renders every proposal as an individual `MemoryCard` needing a
keep/remove decision. Reviewing 49 items one at a time before the product
becomes useful is a wall, and the per-item review is the very thing that makes
Cairn trustworthy — so the answer is not to remove it.

**Proposal:** keep per-item review as the default for anything conflicted,
sensitive, or low-confidence; add a bulk path for the rest.

- Group the review queue by source ("From Gmail — 49 found").
- "Keep all from this source" as one action, with the per-item list still
  expandable underneath via `Disclosure`.
- Anything flagged conflicted or sensitive is excluded from bulk and stays
  individually reviewed, labelled as to why.
- History already supports undo, so bulk-keep is reversible; say so inline.

### D. First run leads with counts, not with what it knows about you

`/home` opens with "12 things saved, from 3 sources" and groups by memory type.
A count is a measure of the product's activity, not of the person's benefit.
Unabyss leads with a named identity summary and layers, which demonstrates
value in one sentence.

Cairn already builds exactly this: `assembleIdentity()` in
`packages/search/src/identity.ts`, surfaced over MCP as `whoami` and editable
in Settings. It is simply not on the page a person lands on.

**Proposal:** surface the assembled identity summary at the top of `/home`, in
a `Card`, with an edit affordance pointing at the existing Settings editor.
Keep the counts, demoted beneath it. When the summary is thin, say what is
missing — `assembleIdentity()` already names its empty sections, and that
doubles as the most honest "what to add next" prompt in the product.

### E. Scope is per-connection, not per-content

`/connections` offers two checkboxes: allow proposals, include sensitive.
Unabyss scopes by content layer — a coding assistant gets Identity and Profile
but not Mind. That difference matters to anyone connecting a work tool to a
memory that also holds personal context.

Cairn already groups approved memory by type (`overview.approvedByType`), and
`mcp_clients.projectIds` exists and is threaded through `ActorContext` but is
always written `null`.

**Proposal:** let a connection choose which memory types it may read, using the
same labels `/home` already shows. This is a filter at retrieval time, not a
new concept for the user to learn, and it reuses a column that already exists.

### F. Providers that cannot work here are still offered

An unconfigured provider renders a "Setup required" `Badge` and a Connect
button labelled "Add in demo form". On a hosted deployment, where the person
reading has no ability to configure anything, this offers a door that only
leads to sample documents.

**Proposal:** on a cloud deployment, split the grid into "Available" and
"Not yet on this deployment", and drop the demo affordance from the latter.
Keep today's behaviour in local/demo mode, where it is genuinely useful.

### G. Nothing invites the person to connect an AI once there is something to connect

Deferring the AI-connection step until there is memory worth connecting to is a
good decision and `welcome/page.tsx` documents it deliberately. But the invitation
never becomes prominent afterwards — `/home` lists "Use this in an AI tool" as
the third of three equal cards under "What next".

**Proposal:** once `approvedCount` crosses a small threshold, promote the
connect-an-AI step to a single primary call to action on `/home`, and retire it
once a connection exists. The step is the product's whole promise; it should be
the loudest thing on the page exactly once.

## Sequencing

A and B are the two that lose people. A is the architectural one and is being
built now. B, D, and F are small and self-contained. C and E are a day each.
G is an hour.
