# Unabyss onboarding and shared-memory audit

Date: 2026-08-07

## Scope

This audit compared Cairn with the six supplied Unabyss screenshots and the
current public Unabyss landing and registration surfaces. It also traced the
actual Cairn path from first sign-in through AI connection, retrieval, proposal,
review, canonical memory, and the next AI tool's retrieval.

The goal is functional and structural parity where it helps the person:

- one clear promise and one next action;
- a short setup path tailored to the selected AI;
- obvious connected/working status;
- progressive disclosure for protocol details;
- one approved memory available to every authorized tool.

Cairn does not copy Unabyss's name, logo, ridge artwork, exact copy, card
proportions, or proprietary prompts. It keeps Cairn's stone mark, trust language,
citation model, and human approval boundary.

## Baseline result

| Area                  | Baseline | Main issue                                                                      |
| --------------------- | -------: | ------------------------------------------------------------------------------- |
| Accessibility         |      4/4 | Strong labels, focus, landmarks, disclosures, and target tokens                 |
| Performance           |      3/4 | Good server-first pages; full management surfaces still rendered at once        |
| Responsive behavior   |      3/4 | Main layouts adapt, but the mobile nav and connection table were cramped        |
| Theme consistency     |      2/4 | The signed-in app used amber while the landing still mirrored old indigo tokens |
| Product anti-patterns |      2/4 | First setup opened a wall of equally weighted cards and advanced controls       |

**Baseline: 14/20 — good foundations, but the onboarding hierarchy was the
wrong shape.**

## Result after implementation

| Area                  | Result | What changed                                                             |
| --------------------- | -----: | ------------------------------------------------------------------------ |
| Accessibility         |    4/4 | Semantic choices, native disclosures, labelled responsive records        |
| Performance           |    3/4 | Server-first flow retained; advanced controls are quieter but still load |
| Responsive behavior   |    4/4 | 390px QA passes with no horizontal overflow                              |
| Theme consistency     |    4/4 | Landing and app now share one amber system                               |
| Product anti-patterns |    4/4 | Four-tool choice, one focused setup, honest progress and support states  |

**Result: 19/20.** The remaining point is deliberate: the advanced management
surface still ships with the page so an experienced user can open it instantly.

## Highest-impact findings

### 1. Setup was a control panel, not a guided path

`/welcome` offered five equally important starts. Its leading card opened a
large `/connections` management page containing seven clients, policy text, a
connection table, generic addresses, connection codes, scopes, and protocol
details. A first-time visitor still had to decide what mattered.

### 2. The requested four tools were not the product's visible center

Claude, Claude Code, Codex, and ChatGPT were mixed with Gemini, Cursor, and
Antigravity. ChatGPT's real support boundary was accurate but easy to miss.

### 3. The interface over-promised “communication”

The sound model is a shared, approved memory—not private agent-to-agent
messaging. That distinction was implemented in the architecture but not taught
in setup, so a person could reasonably expect automatic transcript sharing.

### 4. Important AI-facing paths did not all enforce the same grant

Normal search enforced project, memory-type, sensitivity, and visibility
limits. The audit found paths around that central rule in canonical resources,
identity assembly, and deep queries. It also found that MCP proposals lacked
approvable evidence and that removed memory could remain in a previous
canonical vault head.

### 5. Visual and responsive details had drifted

The public landing still carried the prior indigo accent while the default app
used amber. Mobile navigation CSS targeted an obsolete wrapper, and the
six-column connection table fell back to horizontal scrolling.

## Implemented response

- `/welcome` now begins with the four primary product choices and a visible
  Choose → Approve → Remember sequence.
- `/connections?tool=…` keeps all four tools visible, opens only the chosen
  instructions, and ends with a copyable connection test prompt.
- Other AI clients, generic addresses, codes, scope controls, and protocol
  details remain available as secondary/advanced setup.
- ChatGPT is labelled plan-dependent. The interface distinguishes ordinary
  ChatGPT chat from the Codex side of the desktop app and supported workspace
  app flows.
- The UI explicitly explains that tools read one approved memory; they do not
  talk behind the person's back.
- MCP instructions now teach every connected tool to identify once, search
  before repeating questions, inspect recent cross-tool changes, and propose
  durable updates for human review.
- Canonical MCP resources and `whoami` now assemble only from items allowed by
  the connection's project, type, sensitivity, and visibility grants.
- Deep queries persist their originating client and re-apply its current grant
  in the worker; another client cannot read the resulting answer.
- AI proposals now carry immutable evidence, remain invisible while pending,
  and become available to other authorized tools only after human approval.
- Removing approved memory now rewrites canonical Markdown in the same
  transaction, so a removed item does not remain in a stale current vault.
- The primary navigation now exposes Home, Memory, Apps, AI tools, and Exports;
  Settings remains available as an account action.
- The mobile nav is a compact horizontal control and the connection history
  becomes labelled stacked cards rather than a squeezed table.
- The landing's committed-dark accent now matches the signed-in default amber
  system.
- The landing uses a local system-serif display stack, removing the production
  build's dependency on reaching Google Fonts.

## Product truth

The practical handoff loop is:

1. Claude, Claude Code, Codex, or ChatGPT authenticates to Cairn with a scoped
   grant.
2. The tool calls `whoami`, `search_memory`, and—when continuing another tool's
   work—`list_recent_changes`.
3. A durable fact or decision becomes a proposal, not an automatic write.
4. The person reviews and keeps it.
5. The next authorized tool can retrieve it with citations.

That is the same-memory experience the product can safely promise today. Direct
LLM-to-LLM messaging and automatic ingestion of every private conversation are
deliberate non-goals.
