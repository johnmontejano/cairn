import { expect, test } from '@playwright/test';

/**
 * The landing page.
 *
 * The only page a stranger sees, so it has to say what the product is, offer the
 * one action, and stay accessible while doing it. These assertions cover the
 * things a redesign is most likely to break.
 */
test.describe('the page a stranger lands on', () => {
  test('leads with what the product is and offers exactly one way in', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/AI tool/i);

    // The sign-in form is on the first screen, not behind a link.
    await expect(page.getByLabel('Your email address')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();

    // The three things the product actually promises.
    await expect(
      page.getByRole('heading', { name: /Every answer shows its receipts/i }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /You keep hold of it/i })).toBeVisible();
    await expect(page.getByText(/tell you when it does not know/i)).toBeVisible();
  });

  test('says plainly that it is running locally', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/nothing leaves this machine/i)).toBeVisible();
  });

  test('the illustration is described, not just decorative noise', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('img', { name: /stack of five balanced stones/i })).toBeVisible();
  });

  test('does not scroll sideways at any width', async ({ page }) => {
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflows at ${width}px`).toBeLessThanOrEqual(1);
    }
  });
});

test('signing out actually signs you out', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your email address').fill(`signout-${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Continue' }).click();
  const code = await page
    .locator('strong')
    .filter({ hasText: /^\d{6}$/ })
    .first()
    .innerText();
  await page.getByLabel('Six-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/welcome|home/);

  await page.getByRole('button', { name: /Sign out/ }).click();
  await page.waitForURL(/127\.0\.0\.1:\d+\/$/);

  // Back at the landing page, and the session is genuinely gone.
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await page.goto('/home');
  await expect(page).toHaveURL(/\/$/);
});
