/**
 * The one illustration in the product.
 *
 * A stack of balanced stones — the thing the product is named after, and a
 * reasonable picture of what it does: small durable markers, deliberately
 * placed, left for whoever comes next. Drawn rather than photographed so it
 * costs nothing to load, scales cleanly, and follows the theme.
 *
 * Split into pieces so the animated hero (`hero-scene.tsx`) can reuse the
 * static drawing as its no-JavaScript, reduced-motion, and no-WebGL fallback
 * without duplicating the proof card.
 */
export function StonesSvg() {
  return (
    <svg
      className="cairn-art__stones"
      viewBox="0 0 320 300"
      role="img"
      aria-label="A stack of five balanced stones"
    >
      <defs>
        <linearGradient id="cairn-stone-a" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="var(--cairn-accent)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--cairn-accent-hover)" stopOpacity="0.8" />
        </linearGradient>
        <linearGradient id="cairn-stone-b" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="var(--cairn-border-strong)" />
          <stop offset="100%" stopColor="var(--cairn-ink-subtle)" stopOpacity="0.65" />
        </linearGradient>
        <linearGradient id="cairn-stone-c" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="var(--cairn-ink-subtle)" stopOpacity="0.8" />
          <stop offset="100%" stopColor="var(--cairn-ink-subtle)" stopOpacity="0.5" />
        </linearGradient>
      </defs>

      {/* Ground shadow, so the stack sits on something. */}
      <ellipse cx="160" cy="272" rx="96" ry="13" fill="var(--cairn-ink)" opacity="0.08" />

      {/* Base — widest, most solid. */}
      <path
        d="M62 268c-10-6-12-20-4-30 9-11 26-18 52-21 33-4 66-3 92 4 20 5 30 14 29 25-1 12-13 20-33 23-30 5-62 6-92 3-24-2-38-3-44-4Z"
        fill="url(#cairn-stone-b)"
      />
      {/* Second stone. */}
      <path
        d="M86 216c-9-6-9-18-1-26 9-9 25-14 45-16 26-3 51-1 70 5 15 5 22 13 20 22-2 10-13 16-30 18-24 4-49 4-72 2-17-2-27-3-32-5Z"
        fill="var(--cairn-surface-raised)"
        stroke="var(--cairn-border-strong)"
        strokeWidth="1.5"
      />
      {/* Third — the accent stone, the visual anchor. */}
      <path
        d="M100 168c-8-5-8-16 0-23 8-8 22-13 39-14 22-2 44-1 60 4 13 4 19 11 17 19-2 9-11 14-26 16-21 3-42 3-62 1-15-1-23-2-28-3Z"
        fill="url(#cairn-stone-a)"
      />
      {/* Fourth. */}
      <path
        d="M116 126c-6-4-6-13 0-19 7-6 18-10 31-11 17-2 34-1 47 3 10 3 15 9 13 15-2 7-9 11-21 13-16 2-33 2-48 1-11-1-18-1-22-2Z"
        fill="url(#cairn-stone-c)"
      />
      {/* Crown — smallest, tilted, the one that makes it feel balanced. */}
      <path
        d="M134 92c-5-3-5-10 0-14 5-5 14-8 23-8 12-1 24 0 32 3 7 2 10 6 9 11-2 5-7 8-15 9-11 2-23 2-33 1-8 0-13-1-16-2Z"
        fill="var(--cairn-surface-raised)"
        stroke="var(--cairn-border-strong)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function ProofCard() {
  return (
    <figure className="cairn-art__proof">
      <span className="cairn-example-tag">Example</span>
      <span className="cairn-art__proof-label">Why do you know this?</span>
      <blockquote className="cairn-art__proof-quote">
        “We decided to sign the Mill Street lease rather than the unit by the station.”
      </blockquote>
      <figcaption className="cairn-art__proof-source">
        Planning notes · characters 512–604 · added 12 March
      </figcaption>
    </figure>
  );
}

export function HeroArt() {
  return (
    <div className="cairn-art">
      <StonesSvg />
      <ProofCard />
    </div>
  );
}
