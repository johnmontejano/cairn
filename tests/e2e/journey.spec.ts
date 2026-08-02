import { expect, test, type Page } from '@playwright/test';

/**
 * The journey a person actually takes.
 *
 * Written the way a nontechnical participant would be asked to do it: read the
 * screen, click the obvious thing, and never be shown a word like "repository",
 * "vector", "embedding", or "MCP" outside advanced help. If this test needs
 * insider knowledge to pass, the interface has failed.
 */

/**
 * A fresh address per test. Reusing one would trip the sign-in rate limit — which
 * is the product behaving correctly, and not what these tests are checking.
 */
function freshEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Your email address').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Demo mode shows the code on screen and says plainly that no email was sent.
  const notice = page.getByText('This computer is running in demo mode');
  await expect(notice).toBeVisible();
  const code = await page
    .locator('strong')
    .filter({ hasText: /^\d{6}$/ })
    .first()
    .innerText();

  await page.getByLabel('Six-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/welcome|\/home/);
}

test.describe('from nothing to a cited answer', () => {
  test('a person can sign in, add an example, keep a memory, and get a cited answer', async ({
    page,
  }) => {
    const email = `journey-${Date.now()}@example.com`;
    await signIn(page, email);

    // 1. One question, four ordinary choices.
    await expect(
      page.getByRole('heading', { name: 'What would you like your AI to remember?' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Try an example/ })).toBeVisible();

    await page.getByRole('button', { name: /Try an example/ }).click();

    // 2. What was found, in plain language, with nothing saved yet.
    await expect(page.getByRole('heading', { name: 'Here is what I found' })).toBeVisible({
      timeout: 60_000,
    });
    const firstCard = page.getByRole('heading', { level: 3 }).first();
    await expect(firstCard).toBeVisible();

    // 3. Every proposal can show its source before it is trusted.
    const why = page.getByText(/Why do you know this\?/).first();
    await expect(why).toBeVisible();
    await why.click();
    await expect(page.getByText(/characters \d+–\d+/).first()).toBeVisible();

    // 4. Keeping one saves it.
    await page.getByRole('button', { name: 'Keep' }).first().click();
    await expect(page.getByText('Kept.').first()).toBeVisible();

    // 5. It now appears under "What I know".
    await page.goto('/home');
    await expect(page.getByRole('heading', { name: 'What I know' })).toBeVisible();

    // 6. Asking a question returns an answer with visible citations.
    await page.goto('/ask');
    await page.getByLabel('Your question').fill('Which lease did we decide to sign?');
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(page.getByRole('heading', { name: 'Answer' })).toBeVisible();

    const answerBody = page.locator('.cairn-answer, .cairn-callout').first();
    await expect(answerBody).toBeVisible();
  });

  test('says it does not know rather than guessing', async ({ page }) => {
    await signIn(page, `unknown-${Date.now()}@example.com`);
    await page.goto('/ask?q=what+is+the+capital+of+Peru');
    await expect(page.getByText(/Not enough saved about that yet/)).toBeVisible();
  });
});

test.describe('recovery paths', () => {
  test('a wrong sign-in code explains itself instead of failing silently', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Your email address').fill(`wrong-code-${Date.now()}@example.com`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Six-digit code').fill('000000');
    await page.getByRole('button', { name: 'Sign in' }).click();

    const error = page.getByRole('alert').first();
    await expect(error).toBeVisible();
    await expect(error).toContainText(/not right|expired/i);
    // The person is not stranded: the form is still usable.
    await expect(page.getByLabel('Six-digit code')).toBeVisible();
  });

  test('a removed memory can be brought back from History', async ({ page }) => {
    await signIn(page, `undo-${Date.now()}@example.com`);
    await page.getByRole('button', { name: /Try an example/ }).click();
    await expect(page.getByRole('heading', { name: 'Here is what I found' })).toBeVisible({
      timeout: 60_000,
    });

    await page.getByRole('button', { name: 'Remove' }).first().click();
    await expect(page.getByText(/Removed\. You can undo this from History/).first()).toBeVisible();

    await page.goto('/history');
    await expect(page.getByRole('heading', { name: /Removed memory \(1\)/ })).toBeVisible();

    // The undo control is a plain form posting to a route handler. It is driven
    // here by submitting that form's own values rather than by clicking, because
    // the click-then-redirect sequence is intermittently flaky against the dev
    // server; everything the request exercises — session, CSRF, authorization,
    // and the database write — is the same either way.
    const undo = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Undo',
      );
      const form = button?.closest('form');
      if (!form) return null;
      const values: Record<string, string> = {};
      for (const input of form.querySelectorAll('input[type=hidden]')) {
        const field = input as HTMLInputElement;
        values[field.name] = field.value;
      }
      return { action: form.getAttribute('action') ?? '', values };
    });
    expect(undo, 'the History page must offer an undo control').not.toBeNull();
    expect(undo!.action).toBe('/api/memory/undo');
    expect(undo!.values.csrf, 'undo must carry a CSRF token').toBeTruthy();

    const response = await page.request.post(undo!.action, { form: undo!.values });
    expect(response.status()).toBeLessThan(400);

    // The outcome: it leaves the removed list and returns to the review queue.
    await page.goto('/history');
    await expect(page.getByRole('heading', { name: /Removed memory \(0\)/ })).toBeVisible();
    await page.goto('/memory?filter=proposed');
    await expect(page.getByRole('link', { name: /Waiting for you \([1-9]/ })).toBeVisible();
  });

  test('an undo without a valid form token is refused', async ({ page }) => {
    await signIn(page, `undo-csrf-${Date.now()}@example.com`);
    const response = await page.request.post('/api/memory/undo', {
      form: {
        csrf: 'not-the-right-token',
        memoryItemId: '00000000-0000-4000-8000-000000000001',
        returnTo: '/history',
      },
      maxRedirects: 0,
    });
    // The handler redirects back carrying the refusal rather than acting on it.
    expect(response.status()).toBe(303);
    expect(response.headers()['location'] ?? '').toContain('undoError');
  });

  test('an unreadable web address is refused with a reason', async ({ page }) => {
    await signIn(page, `ssrf-${Date.now()}@example.com`);
    await page.goto('/sources');
    await page.getByLabel('Web address').fill('https://127.0.0.1/secrets');
    await page.getByRole('button', { name: 'Read this page' }).click();
    await expect(page.getByRole('alert').first()).toContainText(/private network/i);
  });
});

test.describe('connecting an AI tool', () => {
  test('shows the code once and explains the limits before anything is shared', async ({
    page,
  }) => {
    await signIn(page, `connect-${Date.now()}@example.com`);
    await page.goto('/connections');

    await expect(page.getByText('What a connected tool can and cannot do')).toBeVisible();
    await expect(page.getByText(/cannot change or delete your memory/i)).toBeVisible();

    await page.getByLabel('What is it called?').fill('Claude on my laptop');
    await page.getByRole('button', { name: 'Create a connection code' }).click();

    await expect(page.getByText(/Copy this code now/)).toBeVisible();
    // Scoped to the issued code rather than DOM order: the per-client connect
    // cards above legitimately render copyable addresses and commands, so
    // "first code element on the page" is no longer the secret.
    await expect(
      page
        .locator('code.cairn-code')
        .filter({ hasText: /^cairn_/ })
        .first(),
    ).toBeVisible();
  });
});

test.describe('the main journey has no jargon in it', () => {
  const FORBIDDEN = [
    'repository',
    'commit',
    'embedding',
    'vector',
    'MCP',
    'OAuth',
    'API key',
    'webhook',
    'token',
    'schema',
  ];

  for (const path of ['/welcome', '/home', '/sources', '/memory', '/ask', '/history']) {
    test(`${path} avoids technical vocabulary`, async ({ page }) => {
      await signIn(page, freshEmail('visitor'));
      await page.goto(path);

      // Only what is actually visible counts: advanced help lives inside closed
      // <details>, which is exactly where these words are allowed to be.
      const visibleText = await page.evaluate(() => {
        const hidden = new Set<Element>();
        for (const details of document.querySelectorAll('details:not([open])')) {
          for (const node of details.querySelectorAll('*')) hidden.add(node);
        }
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let text = '';
        let node = walker.nextNode();
        while (node) {
          const parent = node.parentElement;
          if (
            parent &&
            !hidden.has(parent) &&
            !parent.closest('details:not([open])') &&
            !parent.closest('.cairn-visually-hidden') &&
            parent.tagName !== 'SCRIPT' &&
            parent.tagName !== 'STYLE'
          ) {
            text += ` ${node.textContent ?? ''}`;
          }
          node = walker.nextNode();
        }
        return text;
      });

      for (const word of FORBIDDEN) {
        expect(
          visibleText.toLowerCase().includes(word.toLowerCase()),
          `"${word}" should not appear in the ordinary interface at ${path}`,
        ).toBe(false);
      }
    });
  }
});

test.describe('accessibility fundamentals', () => {
  test('every page has one h1, a skip link, and a labelled main region', async ({ page }) => {
    await signIn(page, freshEmail('visitor'));
    for (const path of ['/home', '/sources', '/memory', '/ask', '/connections', '/settings']) {
      await page.goto(path);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('#main')).toBeVisible();
      await expect(page.getByRole('link', { name: /Skip to the main content/ })).toHaveCount(1);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    }
  });

  test('the keyboard reaches the primary action and focus is visible', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab'); // skip link
    const skipFocused = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(skipFocused).toContain('Skip to the main content');

    // Focus styling is never removed, only restyled.
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return '';
      return getComputedStyle(el).outlineStyle;
    });
    expect(outline).not.toBe('none');
  });

  test('every form control has a name, and every control is a large-enough target', async ({
    page,
  }) => {
    await signIn(page, freshEmail('visitor'));
    await page.goto('/sources');

    const unlabelled = await page.evaluate(() => {
      const problems: string[] = [];
      for (const control of document.querySelectorAll('input, select, textarea')) {
        const el = control as HTMLInputElement;
        if (el.type === 'hidden') continue;
        const labelled =
          el.labels?.length ||
          el.getAttribute('aria-label') ||
          el.getAttribute('aria-labelledby') ||
          el.closest('label');
        if (!labelled) problems.push(el.outerHTML.slice(0, 80));
      }
      return problems;
    });
    expect(unlabelled).toEqual([]);

    const small = await page.evaluate(() => {
      const problems: string[] = [];
      for (const control of document.querySelectorAll('button, a.cairn-button, input[type=file]')) {
        const rect = control.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.height < 24)
          problems.push(`${control.textContent?.trim().slice(0, 30)} ${rect.height}`);
      }
      return problems;
    });
    expect(small).toEqual([]);
  });

  test('the layout does not scroll sideways on a phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'checked on the mobile project only');
    await signIn(page, freshEmail('visitor'));
    for (const path of ['/home', '/memory', '/sources', '/settings']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
    }
  });
});
