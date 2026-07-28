#!/usr/bin/env node
/**
 * Builds the static project page published to GitHub Pages.
 *
 * GitHub Pages serves files, not servers, so it cannot run Cairn: there is no
 * database, no session, and no MCP endpoint. What it can host is an honest
 * shop window — the real landing design, with the sign-in card replaced by
 * instructions for running the actual thing.
 *
 * The stylesheet is concatenated from the application's own CSS rather than
 * copied, so the published page cannot drift away from the product's design.
 * Only the two Tailwind-specific constructs are stripped, and the handful of
 * resets Tailwind's preflight would otherwise supply are restated below.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'dist');

/** Strip `@import` lines and Tailwind's `@theme` block; keep everything else. */
function appCss(relativePath) {
  const raw = readFileSync(join(root, relativePath), 'utf8');
  return raw
    .replace(/^@import\s+[^;]+;\s*$/gm, '')
    .replace(/@theme\s*\{[^}]*\}/g, '')
    .trim();
}

// What Tailwind's preflight would have provided. Deliberately minimal: only the
// rules the product's own CSS assumes are already in place.
const RESET = `
*, *::before, *::after { box-sizing: border-box; }
* { margin: 0; }
html { -webkit-text-size-adjust: 100%; }
body { min-height: 100dvh; }
img, svg, video { display: block; max-width: 100%; }
h1, h2, h3, h4 { font-size: inherit; font-weight: inherit; }
ul, ol { list-style: none; padding: 0; }
blockquote, figure { margin: 0; }
a { color: inherit; }
`.trim();

const css = [
  RESET,
  appCss('packages/ui/src/tokens.css'),
  appCss('packages/ui/src/styles.css'),
  appCss('apps/web/src/app/globals.css'),
].join('\n\n');

const html = readFileSync(join(here, 'index.html'), 'utf8');

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'styles.css'), `${css}\n`);
writeFileSync(join(out, 'index.html'), html);
// Tells Pages not to run the output through Jekyll, which would drop dotfiles.
writeFileSync(join(out, '.nojekyll'), '');

console.log(`Built site/dist (${Math.round(css.length / 1024)} kB of CSS)`);
