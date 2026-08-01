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
**Concrete values are given below precisely so this phase does not require a
judgment call or a question back to the owner** — implement these, sanity-check
them in the browser, adjust only if something actually looks wrong in context.

1. **Replace the palette in `packages/ui/src/tokens.css`.** Move off
   cream/terracotta to a cooler, working-tool ground with one deliberate
   indigo-blue accent. Every pair below is computed, not eyeballed — each ratio
   is stated so the file's "meets WCAG 2.2 AA" comment stays literally true.

   Light theme:

   ```css
   --cairn-paper: #f4f6f8;
   --cairn-surface: #ffffff;
   --cairn-surface-sunken: #e9edf0;
   --cairn-surface-raised: #ffffff;

   --cairn-ink: #14181c; /* 16.5:1 on paper */
   --cairn-ink-muted: #4b5560; /* 7.0:1 on paper */
   --cairn-ink-subtle: #5f6a75; /* 5.1:1 on paper */

   --cairn-accent: #3454d1; /* 5.8:1 on paper */
   --cairn-accent-hover: #2a44ad;
   --cairn-accent-soft: #e7ecfb;
   --cairn-accent-ink: #24399e; /* 9.0:1 on paper */
   ```

   Dark theme:

   ```css
   --cairn-paper: #10141a;
   --cairn-surface: #171c22;
   --cairn-surface-sunken: #0c0f13;
   --cairn-surface-raised: #1d232b;

   --cairn-ink: #e7ecf2; /* 15.6:1 on paper */
   --cairn-ink-muted: #a9b4bf; /* 8.8:1 on paper */
   --cairn-ink-subtle: #7c8892; /* 5.1:1 on paper */

   --cairn-accent: #7c97f0; /* 6.6:1 on paper */
   --cairn-accent-hover: #94aeff;
   --cairn-accent-soft: #202a47;
   --cairn-accent-ink: #aabbf7; /* 9.8:1 on paper */
   ```

   Leave `--cairn-good/-warn/-danger/-info` and their `-soft` pairs for last —
   re-tune each against the new paper using the same method (compute the ratio,
   don't eyeball it), keeping their existing hue families so status still reads
   as green/amber/red/blue.

2. **Type pairing — use what already exists, unused.** `--cairn-font-serif`
   (`ui-serif, Georgia, Cambria, 'Times New Roman', serif`) is already defined
   in `tokens.css` and nothing references it. Use it for `h1`/`h2`/section
   titles; keep `--cairn-font-sans` for body and controls, `--cairn-font-mono`
   for codes and IDs. This needs no new font, no CDN, no risk to the
   nonce-based CSP — it is a one-line change per heading style.
3. **Build a type scale and stick to it.** Currently sizes are ad hoc per page.
   A five-step scale (e.g. 0.8125 / 0.9375 / 1.125 / 1.5 / 2rem) covers caption
   through page title; apply it consistently rather than picking per page.
4. **Differentiate elevation and radius**, reusing the existing three tokens
   rather than inventing new ones: `--cairn-radius-sm` for chips, badges, and
   inline code; `--cairn-radius` for ordinary cards; `--cairn-radius-lg` for
   emphasis surfaces — empty states, the first-run card, a primary modal.
5. **Design the dark theme deliberately.** The values above are not a
   mechanical inversion of the light ones — the accent is a lighter tint
   because a saturated indigo goes muddy on a dark ground, and surfaces step up
   in three distinct tones rather than one flat dark fill.

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

## Autonomy for this session

The owner has explicitly pre-authorized this, for this task only: once
`pnpm verify` and `pnpm test:e2e` are green, commit and push to `main` without
pausing to ask first. This does not extend to anything outside the phases
above — a scope change, a new external account, or spending money still needs
a check-in as usual.

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
