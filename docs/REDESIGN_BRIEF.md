# Redesign brief and master task list

Date: 2026-08-01. Written as a handoff for a dedicated redesign session.

## The constraint, stated once so it does not get relitigated

The goal is **category-conventional, not experimental** — proven patterns other
products in this space already use, executed well. The owner explicitly does not
want invented interaction models right now. That is a legitimate and common
design brief and this document honours it.

It is **not** a licence to reproduce Unabyss's visual identity, copy, or
backend. That has been declined since 2026-07-27 (`DECISIONS.md`), is restated
in `PROJECT_BRIEF.md` non-goals, and is independently a copyright/ToS line
regardless of who authorises it. Adopting a _convention_ that Unabyss also
follows — a sync-status pill on a source card, an OAuth consent screen — is
ordinary practice. Reproducing their palette, illustrations, wording, or
implementation is not.

Where this brief says "conventional," it means the convention shared across the
whole category, not one company's execution of it.

## Why the current interface reads as generic

This is diagnosable, not a matter of taste. `packages/ui/src/tokens.css` is
built on:

- **Warm cream paper (`#fbf9f6`) + a terracotta/clay accent (`#a3492b`).** This
  exact pairing is the single most recognisable machine-generated design
  signature in circulation. It is not bad craft — the contrast ratios are
  genuinely checked and documented — but it is the default that thousands of
  generated pages land on, so it reads as unconsidered even when it is not.
- **No display typeface.** `--cairn-font-sans` is the system stack, and every
  heading is that same stack at a larger size. Nothing carries personality; type
  is a delivery vehicle rather than part of the design.
- **One radius everywhere** (`10px` on effectively every surface), so nothing is
  visually ranked above anything else.
- **Uniform card density.** Home, Sources, Memory and Connections all render the
  same card at the same weight, so a page has no focal point and scanning it
  costs the same everywhere.

The bones are good: real tokens, real light/dark, WCAG AA pairs checked,
`prefers-reduced-motion` and `prefers-contrast` already handled, a 44px target
size honoured throughout. **Keep the architecture. Replace the surface.**

## Phase 0 — Foundation

Everything else depends on this, so it goes first and lands as one commit.

1. **Replace the palette.** Move off cream/terracotta. The product is a working
   tool people keep open, not stationery — a cooler or more neutral ground with
   one deliberate accent reads correctly for the category. Preserve the existing
   discipline: every foreground/background pair must still meet WCAG 2.2 AA in
   both themes, and the file's comment saying so must stay true.
2. **Introduce a real type pairing.** One characterful face for headings used
   with restraint, one workhorse for body, keep the mono for codes and IDs.
   Self-host or use a system-safe stack — do not add a font CDN, since the CSP
   is nonce-based and strict.
3. **Build a type scale and stick to it.** Currently sizes are ad hoc per page.
4. **Differentiate elevation and radius** so primary surfaces outrank secondary
   ones instead of every card being peers.
5. **Design the dark theme deliberately**, not as an inversion. It is currently
   a mechanical flip of the light values.

Ship Phase 0 before touching any page. A token change lands everywhere at once;
doing it after the page work means redoing the page work.

## Phase 1 — The flows that actually lose people

From `docs/ONBOARDING_BENCHMARK.md`, in the order that costs the most.

6. **Stop telling people to refresh.** `/welcome` renders "Still reading.
   Refresh this page in a moment." Auto-refresh while `runningJobs > 0`, show
   candidates as they land rather than after the whole batch, and state a real
   expectation derived from observed job durations. This is the single worst
   moment in the product: it lands right after someone hands over their email
   and gets nothing back.
7. **Add a bulk review path.** One Gmail sync produced 49 individual keep/remove
   decisions before a first answer was possible. Group the queue by source, add
   "Keep all from this source," and exclude anything conflicted or sensitive
   from bulk so those stay individually reviewed. Per-item review is what makes
   Cairn trustworthy — the fix is a fast path for the ordinary case, not
   removing the review.
8. **Lead `/home` with the identity summary, not a count.** `assembleIdentity()`
   already builds it and Settings already edits it; it simply is not on the page
   people land on. When it is thin, say what is missing — that doubles as the
   most honest "what to add next" prompt in the product.
9. **Promote "connect an AI" once there is something worth connecting.** It is
   currently the third of three equal cards. Make it the single primary action
   once `approvedCount` crosses a threshold, and retire it once a connection
   exists.

## Phase 2 — Conventions worth adopting

From `docs/UX_AUDIT.md`, which already ranked these. All are category-standard.

10. **A standing "still indexing" indicator.** The backend already knows
    (`deep_queries.indexing_pending`); nothing shows it before someone asks.
11. **Per-client connect actions.** One "Connect" verb lies about clients that
    actually need a pasted token or a config file. Name the mechanism per row.
12. **Freshness inline on each source card** — state, last check, and cadence
    together, without opening a detail view.
13. **A recommended source count distinct from the hard gate.** The floor is
    where the product _can_ work; the recommendation is where it gets good.
14. **Suggested questions in the empty Ask state.** An empty box asks someone to
    invent a use case.
15. **A persistent nudge for half-finished setup.** Incomplete setup is
    invisible by nature — the person believes they are done.
16. **Stop offering providers that cannot work on this deployment.** Split
    "available" from "not on this deployment" and drop the demo affordance from
    the latter in cloud mode.

## Phase 3 — Correctness found along the way

17. **Reconcile the memory count.** `/home` reported "1 thing saved" while the
    backup held and restored 2 memories. Not data loss, but the number a person
    reads should match what is there. Found during the 2026-08-01 backup drill.
18. **Fix `docs/PRIVACY_MATRIX.md`.** It lists a Railway-hosted worker as a live
    processor. No worker is deployed; the web process drains its own queue.
    Either correct the document or deploy the worker — a privacy document that
    names a processor that does not exist is the wrong kind of wrong.

## Out of scope for the redesign session

Tracked separately on the punch list and not design work: credential rotation,
Google restricted-scope verification, Terms of Service, scheduled backups,
data-key rotation, team invites, scanned-PDF text recognition, OpenTelemetry,
and the live-service verifications for Drive and GitHub.

## Definition of done

- `pnpm verify` green (format, lint, typecheck, all four Vitest projects, build).
- `pnpm test:e2e` green, both desktop and mobile projects.
- The jargon test still passes: ten technical terms must not appear outside
  advanced disclosures.
- Accessibility fundamentals still pass — one `h1` per page, skip link, labelled
  main region, visible focus, 44px targets, no sideways scroll on a phone.
- `memory/CURRENT_STATE.md` and `memory/NEXT_STEPS.md` updated.
- Nothing added to `memory/DECISIONS.md` that the owner did not explicitly
  approve in that session.
