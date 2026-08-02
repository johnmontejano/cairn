'use client';

/**
 * The landing page's one motion grammar, owned in one place.
 *
 * Three moves, nothing else:
 * - the hero copy rises out of the dark once, on arrival;
 * - every `[data-reveal]` element rises the same way as it enters the viewport;
 * - the transparent header gains its glass back once the page starts moving.
 *
 * Content is visible by default: nothing is hidden until JavaScript has
 * confirmed motion is welcome, so no-JS, reduced-motion, and a failed chunk
 * load all read the finished page. GSAP is imported on demand for the same
 * reason the 3D scene is — only the landing ever pays for it.
 */
import { useEffect } from 'react';

export function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    Promise.all([import('gsap'), import('gsap/ScrollTrigger')])
      .then(([{ gsap }, { ScrollTrigger }]) => {
        if (cancelled) return;
        gsap.registerPlugin(ScrollTrigger);

        const context = gsap.context(() => {
          // Arrival: the first viewport assembles itself, top to bottom.
          // `opacity`, never `autoAlpha`: visibility:hidden would drop these
          // elements from accessibility checks and visibility assertions while
          // they wait for their trigger; opacity keeps them present.
          const heroRise = gsap.utils.toArray<HTMLElement>('[data-hero-rise]');
          if (heroRise.length) {
            gsap.from(heroRise, {
              opacity: 0,
              y: 30,
              filter: 'blur(6px)',
              duration: 0.9,
              ease: 'power3.out',
              stagger: 0.09,
              clearProps: 'filter',
            });
          }

          // The rest of the page rises the same way, each element as it
          // arrives — one grammar, not a different entrance per section.
          for (const el of gsap.utils.toArray<HTMLElement>('[data-reveal]')) {
            gsap.from(el, {
              opacity: 0,
              y: 26,
              filter: 'blur(5px)',
              duration: 0.8,
              ease: 'power3.out',
              clearProps: 'filter',
              scrollTrigger: { trigger: el, start: 'top 88%' },
            });
          }

          // The header is transparent over the hero and gets its glass back
          // as soon as the page moves.
          const header = document.querySelector('[data-landing-header]');
          if (header) {
            ScrollTrigger.create({
              start: 24,
              end: 'max',
              onToggle: (self) => header.classList.toggle('is-scrolled', self.isActive),
            });
          }
        });

        cleanup = () => context.revert();
      })
      .catch(() => {
        // The page is complete without motion; nothing to recover from.
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return null;
}
