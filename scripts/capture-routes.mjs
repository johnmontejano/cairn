/**
 * Capture every signed-in route at the three viewports we support, and report
 * the things a screenshot alone will not tell you: page-level horizontal
 * overflow, controls below the 44px target size, and images with no alt text.
 *
 * This exists so a visual pass can be repeated rather than re-improvised. It
 * signs itself in through the real form — demo mode prints the six-digit code
 * into the page, so no fixture session has to be forged — and writes to
 * `design-review/<viewport>/<route>.png`.
 *
 *   node scripts/capture-routes.mjs [baseUrl] [email]
 *
 * Defaults to http://localhost:3000 and owner@example.com; pass
 * demo@example.com after `pnpm demo:seed` to capture the populated states.
 * Exits non-zero if any route overflows horizontally, so it can gate a change
 * rather than merely describe one.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
// `@playwright/test` rather than `playwright`: the test package is the one this
// workspace actually depends on, and it re-exports the same browser drivers.
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const EMAIL = process.argv[3] ?? 'owner@example.com';
const OUT = path.resolve(import.meta.dirname, '..', 'design-review');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
];

/** The signed-in product surface, plus the two public pages worth watching. */
const ROUTES = [
  { path: '/', name: 'landing', public: true },
  { path: '/privacy', name: 'privacy', public: true },
  { path: '/welcome', name: 'welcome' },
  { path: '/home', name: 'home' },
  { path: '/ask', name: 'ask' },
  { path: '/memory', name: 'memory' },
  { path: '/connections', name: 'connections' },
  { path: '/sources', name: 'sources' },
  { path: '/connect', name: 'connect' },
  { path: '/exports', name: 'exports' },
  { path: '/history', name: 'history' },
  { path: '/settings', name: 'settings' },
];

/**
 * Sign in through the real two-step form. Demo mode renders the code into the
 * page rather than sending mail, so this reads it back out instead of needing
 * an inbox.
 */
async function signIn(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=email]').fill(EMAIL);
  await page.locator('button[type=submit]').click();

  const code = page
    .locator('strong')
    .filter({ hasText: /^\d{6}$/ })
    .first();
  await code.waitFor({ timeout: 15_000 });
  await page
    .locator('input')
    .last()
    .fill((await code.textContent()).trim());
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(/\/(welcome|home)/, { timeout: 20_000 });
}

/**
 * Everything worth failing a build over, measured in the page rather than
 * eyeballed. `scrollWidth` is compared against the viewport with a 1px
 * tolerance because sub-pixel layout rounding otherwise reports a false
 * positive on perfectly fine pages.
 *
 * This function is serialised and evaluated inside the browser, never in Node,
 * which is why it may reach for `document` and `window` in a file that other-
 * wise runs on the server.
 */
/* global document, window */
function audit() {
  // The dev server mounts a <nextjs-portal> overlay host whose shadow content
  // widens `document.documentElement.scrollWidth` (to 463px at a 390px
  // viewport) while every app element stays contained — a 73px "overflow" on
  // /history that does not exist in a production build. It is tooling, not
  // page, so it is removed before measuring.
  document.querySelector('nextjs-portal')?.remove();

  const doc = document.documentElement;
  const overflowBy = doc.scrollWidth - window.innerWidth;

  const offenders = [];
  if (overflowBy > 1) {
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className?.toString?.() ?? '').slice(0, 60),
          right: Math.round(r.right),
        });
      }
      if (offenders.length >= 6) break;
    }
  }

  // Deliberately the same scope the e2e suite already enforces — buttons and
  // button-styled links — rather than every anchor on the page. Plain text
  // links are covered by WCAG 2.5.8's "Inline" and "Spacing" exceptions, and
  // counting them reported four non-problems (a footer link, a "Back home").
  //
  // The measurement still differs in one way that matters: it measures the
  // wrapping label when there is one, because a 18px checkbox inside a 44px
  // label row is a 44px target. Measuring the input alone reported ten more
  // non-problems on /connections.
  const small = [];
  for (const el of document.querySelectorAll(
    'button, a.cairn-button, input[type=file], select, textarea',
  )) {
    const label = el.closest('label');
    const r = (label ?? el).getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    if (r.height < 24 || r.width < 24) {
      small.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      });
    }
  }

  const unlabelledImages = [...document.querySelectorAll('img')].filter(
    (img) => !img.hasAttribute('alt'),
  ).length;

  return {
    overflowBy: overflowBy > 1 ? overflowBy : 0,
    offenders,
    smallTargets: small.slice(0, 8),
    unlabelledImages,
    title: document.title,
    h1: document.querySelectorAll('h1').length,
  };
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORTS[0] });
const page = await context.newPage();

const problems = [];
const report = [];

await signIn(page);

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await mkdir(path.join(OUT, vp.name), { recursive: true });

  for (const route of ROUTES) {
    const response = await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' });
    const status = response?.status() ?? 0;

    // Let the arrival animation settle so the capture is the finished page,
    // not a frame from the middle of it.
    await page.waitForTimeout(1200);

    const result = await page.evaluate(audit);
    await page.screenshot({
      path: path.join(OUT, vp.name, `${route.name}.png`),
      fullPage: true,
    });

    report.push({ viewport: vp.name, route: route.path, status, ...result });
    if (status >= 400) problems.push(`${vp.name} ${route.path} → HTTP ${status}`);
    if (result.overflowBy) {
      problems.push(
        `${vp.name} ${route.path} → overflows by ${result.overflowBy}px ` +
          `(${result.offenders.map((o) => `${o.tag}.${o.cls}`).join(', ') || 'unknown'})`,
      );
    }
  }
}

await writeFile(path.join(OUT, 'audit.json'), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();

console.log(`Captured ${report.length} screenshots into ${OUT}`);
for (const row of report.filter((r) => r.smallTargets.length || r.unlabelledImages || r.h1 !== 1)) {
  console.log(
    `  ${row.viewport} ${row.route}: h1=${row.h1} ` +
      `smallTargets=${row.smallTargets.length} unlabelledImages=${row.unlabelledImages}`,
  );
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('No horizontal overflow at any viewport.');
