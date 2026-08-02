'use client';

/**
 * The hero illustration, upgraded in place.
 *
 * Server-renders the static drawing so the page is complete without
 * JavaScript, then — only when motion is welcome and WebGL exists — swaps in
 * the scroll-driven scene from `stone-scene.ts`. Anything short of that
 * (reduced motion, no WebGL, a failed chunk load) simply keeps the drawing;
 * there is no error state a visitor could ever see.
 *
 * The drawing and the canvas occupy the same grid cell, so the swap cannot
 * shift layout, and only one of them carries the image role at a time.
 */
import { useEffect, useRef, useState } from 'react';
import { ProofCard, StonesSvg } from './hero-art';

export function HeroScene() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    import('./stone-scene')
      .then((mod) => {
        if (cancelled || !mountRef.current) return;
        cleanup = mod.mountStoneScene(mountRef.current);
        setActive(true);
      })
      .catch(() => {
        // No WebGL, or the chunk failed to load. The drawing is already up.
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className="cairn-art">
      <div
        ref={mountRef}
        className={active ? 'cairn-art__canvas cairn-art__canvas--active' : 'cairn-art__canvas'}
        role={active ? 'img' : undefined}
        aria-label={active ? 'A stack of five balanced stones' : undefined}
      />
      {active ? null : <StonesSvg />}
      <ProofCard />
    </div>
  );
}
