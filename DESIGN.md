---
name: Cairn
description: One private memory, shared by the AI tools you choose — a cool working-tool ground with one indigo voice.
colors:
  paper: '#f4f6f8'
  surface: '#ffffff'
  surface-sunken: '#e9edf0'
  surface-raised: '#ffffff'
  ink: '#14181c'
  ink-muted: '#4b5560'
  ink-subtle: '#5f6a75'
  accent: '#3454d1'
  accent-hover: '#2a44ad'
  accent-soft: '#e7ecfb'
  accent-ink: '#24399e'
  good: '#1f6b45'
  good-soft: '#e3f1ea'
  warn: '#7a5410'
  warn-soft: '#f8eed6'
  danger: '#a02222'
  danger-soft: '#fae7e7'
  info: '#245b7d'
  info-soft: '#e2eef5'
  border: '#d7dee4'
  border-strong: '#b9c3cc'
  focus: '#2a44ad'
  night-paper: '#10141a'
  night-accent: '#7c97f0'
typography:
  display:
    fontFamily: "Spectral, ui-serif, Georgia, Cambria, 'Times New Roman', serif"
    fontSize: 'clamp(2.5rem, 1.35rem + 4.2vw, 4.25rem)'
    fontWeight: 600
    lineHeight: 1.04
    letterSpacing: '-0.022em'
  headline:
    fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', serif"
    fontSize: '2rem'
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: '-0.01em'
  title:
    fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', serif"
    fontSize: '1.5rem'
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: '-0.01em'
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: '0.8125rem'
    fontWeight: 550
    lineHeight: 1.4
rounded:
  sm: '6px'
  md: '10px'
  lg: '16px'
  pill: '999px'
spacing:
  xs: '0.5rem'
  sm: '0.75rem'
  md: '1rem'
  lg: '1.25rem'
  xl: '2rem'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '#ffffff'
    rounded: '{rounded.md}'
    padding: '0.625rem 1.125rem'
    height: '44px'
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '0.625rem 1.125rem'
    height: '44px'
  button-secondary-hover:
    backgroundColor: '{colors.surface-sunken}'
  button-quiet:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-muted}'
    rounded: '{rounded.md}'
    padding: '0.625rem 0.75rem'
    height: '44px'
  button-danger:
    backgroundColor: 'transparent'
    textColor: '{colors.danger}'
    rounded: '{rounded.md}'
    padding: '0.625rem 1.125rem'
    height: '44px'
  card:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.md}'
    padding: '1.25rem 1.375rem'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '0.625rem 0.75rem'
    height: '44px'
  badge-neutral:
    backgroundColor: '{colors.surface-sunken}'
    textColor: '{colors.ink-muted}'
    rounded: '{rounded.sm}'
    padding: '0.1875rem 0.5rem'
  nav-link:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-muted}'
    rounded: '{rounded.pill}'
    padding: '0.5rem 0.875rem'
    height: '44px'
---

# Design System: Cairn

## Overview

**Creative North Star: "Small Stones, Deliberately Placed"**

Cairn is a private shared-memory tool: it asks people to read and judge their own words, so the interface recedes. The ground is cool — blue-grey papers and surfaces, never warm cream — with exactly one deliberate voice, an indigo-blue accent. This is an explicit refusal of the warm cream-and-clay pairing that reads as machine-generated default in this category (a standing decision; see memory/DECISIONS.md on originality vs. the category reference). Restraint is not blandness: it is the working-tool posture of a product whose whole argument is trust and receipts.

The system lives in two registers. **The app past sign-in stays quiet**: it follows the person's own theme (light and dark are both first-class, every pair AA-checked in both), uses the system font stacks, and moves almost not at all. **The landing page is the one place with visual ambition**: it commits to the dark ground regardless of system preference, loads Spectral as its display serif, and tells the product's story with one scroll-driven scene — five scattered stones assembling into a cairn. Nothing the landing does leaks into the app; its dark tokens and display face are scoped to `.cairn-landing`.

Everything is built defensively: content is complete without JavaScript, motion is gated behind `prefers-reduced-motion`, heavy libraries (GSAP, three.js) are dynamically imported only where used, and every enhancement has a static fallback already on screen before it loads.

**Key Characteristics:**

- Cool blue-grey ground, single indigo accent, four status hues used only for status
- Every foreground/background pair meets WCAG 2.2 AA in both themes — checked, not assumed
- Serif headings over system-sans body; Spectral display face on the landing only
- Hairline 1px borders carry structure; shadows are small and ambient
- 44px minimum target on every control; focus is always visible, only restyled
- One motion grammar: rise-from-dark, scroll-scrubbed assembly, reduced-motion safe

## Colors

A cool working-tool ground with one indigo voice; the light theme is the normative token set, and a mirrored dark set (near-black blue papers, tinted accent) lives in the same file.

### Primary

- **Indigo** (#3454d1): the single accent. Primary buttons, active states, the pulsing progress dot, citation markers, and the landing's rim light and glow washes. In dark contexts it lightens to **Night Indigo** (#7c97f0) because saturated indigo goes muddy on a dark ground. `accent-ink` (#24399e) is the text-safe variant (9.0:1); `accent-soft` (#e7ecfb) is the tint for selected/hovered surfaces and step markers.

### Neutral

- **Cool Paper** (#f4f6f8): the page ground. Dark counterpart **Night Paper** (#10141a).
- **Surface** (#ffffff) / **Surface Sunken** (#e9edf0) / **Surface Raised** (#ffffff): cards, wells, and floating panels. Depth is mostly tonal — sunken wells for code, nav tracks, and evidence blocks.
- **Ink** (#14181c, 16.5:1) / **Ink Muted** (#4b5560, 7.0:1) / **Ink Subtle** (#5f6a75, 5.1:1): a three-step text hierarchy — content, supporting copy, metadata.
- **Border** (#d7dee4) / **Border Strong** (#b9c3cc): hairlines everywhere; strong for interactive edges (inputs, secondary buttons) and the excerpt rule.

### Status

- **Good** (#1f6b45), **Warn** (#7a5410), **Danger** (#a02222), **Info** (#245b7d), each with a `-soft` tint for badge and callout grounds. Status hues appear only in badges, callouts, and validation — never as decoration.

### Named Rules

**The AA Ledger Rule.** Every foreground/background pair meets WCAG 2.2 AA in both themes, and the contrast ratios are recorded as comments next to the tokens. Do not introduce a colour without checking it in both themes.

**The One Voice Rule.** Indigo is the only accent. If something needs emphasis and it isn't a status, it gets indigo or it gets typography — never a second hue.

**The Mirror Rule.** The landing's committed-dark block on `.cairn-landing` mirrors the dark block in `packages/ui/src/tokens.css` exactly. Change tokens.css first, then the mirror; never invent a colour in the landing scope.

## Typography

**Display Font:** Spectral 500/600, normal + italic (landing only; falls back to the system serif) — exposed as `--cairn-font-display-face`, consumed via `--landing-display`
**Headline Font:** System serif stack (ui-serif, Georgia, Cambria)
**Body Font:** System sans stack (ui-sans-serif, system-ui, Segoe UI, Roboto)
**Mono Font:** System mono stack (ui-monospace, SF Mono, Menlo, Consolas)

**Character:** Serif headings give the reading-your-own-words product a bookish steadiness; the system sans body keeps it a tool, not a magazine. On the landing, Spectral's chiseled, flared terminals read as letters cut into stone — the one face on the page with a point of view. Italic + indigo `em` is the emphasis idiom in display lines.

### Hierarchy

- **Display** (600, clamp(2.5rem → 4.25rem), 1.04, −0.022em): the landing h1 and the big serif close. Balanced wrapping (`text-wrap: balance`). Tightens to clamp(2.25rem → 3.55rem) on short desktops.
- **Landing section title** (600, clamp(1.75rem → 2.5rem), 1.15, −0.015em): display face, one per landing section.
- **Headline** (650, 2rem, serif): app page titles (`.cairn-page-title`).
- **Title** (600, 1.5rem, serif): app section titles; card titles drop to 1.125rem at the same serif weight.
- **Body** (400, 1rem, 1.6): system sans. Ledes run at 1.125rem in muted ink, max-width 60ch (app) / 46rem (landing). Supporting copy at 0.9375rem.
- **Label** (550, 0.8125rem): badges, metadata, hints, eyebrows. The in-between weights (550/650) are deliberate — variable system fonts render them; keep them.

### Named Rules

**The Two-Register Rule.** Spectral exists only inside `.cairn-landing` (scoped via `--cairn-font-display-face`, self-hosted by next/font). The app past sign-in never inherits the display face; its serif is always the system stack.

**The Measure Rule.** Body copy is always width-limited: 60ch ledes, 52ch trail bodies, 46ch empty-state copy. No full-width paragraphs.

## Layout

- **App container:** 68rem max-width, centered, 1.25rem side padding; `.cairn-main--narrow` drops to 44rem for focused flows. Main content padding-block 2rem top / 4rem bottom.
- **Landing container:** 72rem with a fluid gutter `clamp(1.25rem, 4vw, 3rem)`; section padding-block `clamp(3.5rem, 8vw, 6.5rem)`, each section opened by a hairline top border.
- **Grids self-solve:** `repeat(auto-fit, minmax(min(18rem, 100%), 1fr))` (cards), 15rem for choice cards, 17rem for steps — no per-breakpoint column counts in the app.
- **Editorial split (landing):** at ≥62rem, sections become a spread — claim in a sticky left column (0.85fr, `top: 6.5rem`), substance walking down the right (1.15fr). Below 62rem everything stacks copy-first.
- **First viewport (landing):** full-height hero (`min-height: calc(100dvh − 12rem)`), two columns ~1.02fr/0.98fr; the sign-in card is in the fold, not behind a link; a scroll cue closes the fold on wide viewports.
- **Breakpoints in use:** 40rem (small phone: hide nav links, stack dl rows), 58rem (proof and pillars stack), 62rem (hero/split/scroll-cue/scene-trigger flip), and a short-desktop query `(min-width: 62rem) and (max-height: 60rem)` that tightens the hero's vertical rhythm so the sign-in button and scroll cue stay above the fold on ~900px-tall laptops.
- **Spacing rhythm:** a soft 0.25rem-based rhythm — 0.5rem within controls, 0.75–1rem between siblings, 1.25rem card padding, 1.75rem+ between groups (`.cairn-stack--sm/md/lg` = 0.5/1/1.75rem). No formal scale tokens; keep to these observed steps.
- Sticky app header (z-20); anchored landing sections use `scroll-margin-top: 5.5rem` to stop clear of it; smooth in-page scrolling only on the landing and only when motion is welcome.

## Elevation & Depth

Hairlines first, shadows second. Structure is carried by 1px borders and tonal layering (sunken wells, raised panels); shadows are small, ambient, and reserved for things that genuinely float. The landing adds two pure-CSS radial indigo washes (`color-mix` of accent into transparent, ≤17%) — behind the fold and beneath the close — as atmosphere, not elevation.

### Shadow Vocabulary

- **Whisper** (`0 1px 2px rgb(20 24 28 / 0.06)`, `--cairn-shadow-sm`): resting cards, the active nav pill, eyebrows.
- **Lift** (`0 2px 8px rgb(20 24 28 / 0.08)`, `--cairn-shadow`): the proof demo panel.
- **Float** (`0 8px 28px rgb(20 24 28 / 0.12)`, `--cairn-shadow-lg`): the hero sign-in card and the floating proof card. Dark theme swaps all three for deeper black-based values.
- **Glass** (landing header only): once scrolled, `backdrop-filter: blur(14px)` over paper at 82% opacity with a hairline bottom border — legibility over the canvas, not decoration.

### Named Rules

**The Hairline-First Rule.** If a border can do the job, no shadow. Callouts use a full 1px border in the status hue rather than a thick accent bar — the tinted background already carries the tone; don't say it twice.

## Shapes

Soft, workmanlike corners on a three-step radius: 6px (badges, code chips, focus rings), 10px (buttons, cards, inputs, callouts — the default), 16px (feature panels, choice cards, empty states, steps). Full pills (999px) for everything nav-shaped: the nav track and its links, status pills, eyebrows, example tags, trail markers, and the landing CTAs. Empty states are dashed-border wells. Excerpts carry a 3px solid left rule. The product's own mark — five stacked stones — recurs as SVG wordmark, static hero drawing, and 3D scene: rounded, organic ellipsoids, never sharp geometry.

## Components

### Buttons

Confident but quiet; colour changes on hover, not movement.

- **Shape:** gently rounded (10px), min 44×44px, weight 550, 120ms background/border/colour ease.
- **Primary:** indigo fill (#3454d1), white text; dark contexts flip to light-indigo fill with near-black text. Hover deepens to accent-hover.
- **Secondary:** surface fill, strong hairline border; hover sinks to surface-sunken.
- **Quiet:** transparent, muted ink; hover gains the sunken ground.
- **Danger:** transparent with danger text and border; hover tints danger-soft. Destructive actions are outlined, never filled.
- **Large** (`--lg`): 52px min-height, 1.125rem text, for primary flow moments.
- **Disabled:** opacity 0.55, not-allowed cursor.

### Badges

- **Style:** soft-tinted ground with the matching deep hue as text (e.g. good-soft/good), 6px radius, 0.8125rem at weight 550. Tones: neutral, good, warn, danger, info, accent.

### Cards / Containers

- **Corner Style:** 10px; feature panels and choice cards 16px.
- **Background:** surface on paper, 1px hairline border, whisper shadow, 1.25rem × 1.375rem padding.
- **Card title:** serif, 1.125rem, 600.
- **Choice cards:** hover swaps to indigo border + accent-soft ground; the `--accent` variant holds that state permanently for the one recommended choice.

### Inputs / Fields

- **Style:** surface ground, strong hairline border, 10px radius, 44px min-height; label 550, hint and error at 0.9375rem (error in danger at 550).
- **Focus:** the global ring — 3px solid `--cairn-focus`, 2px offset. Never removed, only restyled.
- **Invalid:** `aria-invalid` doubles the border to 2px danger.
- **Textarea:** 9rem min, vertical resize only.

### Navigation

- **App:** links sit in one pill-shaped sunken track; each link is its own pill (44px, weight 550). Hover changes colour only — moving the pill would make the row twitch. Current page: surface pill, accent-ink text, whisper shadow.
- **Landing:** transparent header over the night hero that regains glass on scroll (`.is-scrolled`); text links are quiet pills (hidden ≤40rem), the sign-in CTA an outlined indigo pill that fills accent-soft on hover.
- **Shell status:** a standing pill with the pulsing indigo dot (`cairn-pulse`, 1.6s opacity ease) whenever jobs are running.

### The Trail (landing signature)

Numbered stops on a hairline rail — a walked path, not a card grid. 3rem circular markers in accent-soft with a 40%-transparent indigo ring and display-face numerals; a 1px gradient rail joins stop to stop and fades before the last. The `--pair` variant puts two stops side by side with no rail.

### The Proof Demo (landing signature)

The product's argument, enacted: an italic display-face question, a sans answer with superscript indigo citation markers, and a sunken evidence block quoting the exact source sentence. Hovering a citation lights the receipt (accent-soft ground, indigo hairline, 200ms). Demonstration content always wears the pill-shaped **Example** tag. The same citation idiom (`.cairn-citation-marker`) exists in the app's answers.

### The Stone Scene (landing signature)

Five ellipsoid stones (three.js) scrub from adrift to a balanced cairn with scroll — forwards and backwards with the person, never on its own schedule. Colours are read live from the `--cairn-*` tokens on the scene's own container (so the committed-dark scope answers, not the root), using only tokens that survive both grounds: ink-subtle, border-strong, accent (the one indigo stone), ink-muted. Indigo rim light from below-left, ~90 slow-rising indigo dust motes, a soft blob shadow that darkens as the stack lands, and pointer parallax on fine pointers only (eased at 0.06/frame — weight, not tracking). Renders only while visible; pixel ratio clamped to 1.75; everything disposed on unmount. Assembly completes: wide viewports key progress to the top of the page (done in ~0.35 viewport); narrow viewports key it to the canvas's own arrival so phones still see the story.

### Motion grammar (landing)

One grammar, owned in one place (`landing-motion.tsx`):

- **Hero rise:** `[data-hero-rise]` elements rise once on arrival — opacity 0→1, y 30, blur(6px)→0, 0.9s power3.out, 0.09s stagger.
- **Reveal rise:** every `[data-reveal]` rises the same way as it enters (y 26, blur 5px, 0.8s, trigger at top 88%). One entrance for the whole page, not a different one per section.
- **Header glass:** toggled at 24px of scroll.
- `opacity`, never `autoAlpha` — visibility:hidden would drop elements from accessibility checks while they wait.
- Everything is visible by default; GSAP is dynamically imported; reduced motion, no-JS, and a failed chunk all read the finished page. In the app, motion is limited to 120ms colour transitions and the 1.6s progress pulse.

## Do's and Don'ts

### Do:

- **Do** check every new foreground/background pair against WCAG 2.2 AA in both themes before it lands, and record the ratio beside the token (the AA Ledger Rule).
- **Do** give every interactive control 44px minimum in both dimensions (`--cairn-target`) and the global 3px focus ring.
- **Do** keep the fallback ladder: static SVG rendered on the server, canvas/motion swapped in-place in the same grid cell only after `prefers-reduced-motion` and capability checks pass, no visible error state on failure.
- **Do** name CSS classes after product concepts (`cairn-proof__evidence`, `cairn-trail__marker`) — plain CSS read more often than written, not utility soup.
- **Do** use the rise-from-dark grammar (opacity + y + blur, power3.out) for any new landing entrance; it is the page's only entrance.
- **Do** scope any new landing-only ambition (faces, committed colours, washes) under `.cairn-landing`.

### Don't:

- **Don't** introduce a second accent hue, or use status colours decoratively.
- **Don't** let the app past sign-in commit to a theme, load Spectral, or grow scroll choreography — it follows the person's preference and stays quiet.
- **Don't** move elements on hover in the app nav or button rows; hover is colour-only there. (Landing CTAs may lift 1px — that is the landing's licence, not the app's.)
- **Don't** hide content until JavaScript arrives, or use `autoAlpha`/`visibility: hidden` for pending animations.
- **Don't** invent colours inside the `.cairn-landing` dark scope — it is a verbatim mirror of the tokens.css dark block (the Mirror Rule).
- **Don't** put a thick accent bar on callouts or double-state a tone; the tinted ground plus a 1px hue border already says it.
