import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';

/**
 * The backup and restore drill, done by hand through the real interface.
 *
 * The restore deliberately targets a *different* signed-in account, so what is
 * proven is recovery into a workspace that has never seen this data and holds a
 * different encryption key — not merely reading a file back into the place it
 * came from.
 */

const PASSPHRASE = 'drill-passphrase-not-a-real-secret-2026';

function freshEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Your email address').fill(email);

  // Clicking before React has hydrated the form lets the native submit win
  // the race: the server processes the action but the client never renders
  // the code stage, and the old single click then waited forever. Under a
  // loaded machine this happened on every run. Re-clicking is safe — each
  // click makes a fresh challenge, and the code shown always belongs to the
  // challenge in the form's hidden field.
  const codeLocator = page
    .locator('strong')
    .filter({ hasText: /^\d{6}$/ })
    .first();
  await expect(async () => {
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(codeLocator).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  const code = await codeLocator.innerText();
  await page.getByLabel('Six-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/welcome|\/home/);
}

test('back up a real workspace and restore it into a different one', async ({ page }) => {
  test.setTimeout(300_000);
  const dir = mkdtempSync(join(tmpdir(), 'cairn-drill-'));

  // ---------------------------------------------------------------- source
  await signIn(page, freshEmail('drill-source'));

  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.getByRole('heading', { name: 'Here is what I found' })).toBeVisible({
    timeout: 60_000,
  });

  // Each click revalidates the page, so the previous locator detaches. Re-query
  // every iteration and wait for the count to actually drop, rather than
  // sleeping and hoping.
  for (let i = 0; i < 4; i += 1) {
    const keep = page.getByRole('button', { name: 'Keep', exact: true });
    const before = await keep.count();
    if (before === 0) break;
    await keep.first().click();
    await expect.poll(async () => keep.count(), { timeout: 20_000 }).toBeLessThan(before);
  }

  await page.goto('/home');
  const homeText = await page.locator('body').innerText();
  const savedLine = homeText.split('\n').find((l) => /\d+ things? saved/.test(l));

  // A backup of an empty workspace would prove nothing, so stop here if the
  // approvals did not land.
  expect(savedLine, 'the source workspace has approved memory to back up').toBeTruthy();

  await page.goto('/memory');
  const sourceMemory = await page.locator('body').innerText();
  const sourceFacts = sourceMemory
    .split('\n')
    .filter((l) => /opening date|Mill Street|September/i.test(l));
  expect(sourceFacts.length, 'the example produced recognisable memory').toBeGreaterThan(0);

  // ---------------------------------------------------------------- backup
  await page.goto('/exports');
  await page.getByLabel('Backup passphrase').fill(PASSPHRASE);

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Download backup' }).click();
  const file = await download;

  const savedAt = join(dir, file.suggestedFilename());
  await file.saveAs(savedAt);
  const bytes = statSync(savedAt).size;
  expect(bytes, 'the backup is not an empty shell').toBeGreaterThan(800);

  // The file must not be readable as plain text — the passphrase is the whole
  // promise made on the Your copies page.
  const raw = readFileSync(savedAt).toString('utf8');
  expect(raw).not.toContain('Mill Street');
  expect(raw).not.toContain('September');

  // ------------------------------------------------- scratch workspace
  await page.goto('/settings');
  await page.getByRole('button', { name: /Sign out/i }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);

  const scratchEmail = freshEmail('drill-scratch');
  await signIn(page, scratchEmail);

  // The scratch workspace must start genuinely empty, or the restore proves nothing.
  await page.goto('/home');
  await expect(page.getByText(/Nothing is saved yet|What would you like/)).toBeVisible();

  // --------------------------------------------------------- dry run first
  await page.goto('/exports');
  await page.setInputFiles('input[type="file"][name="backup"]', savedAt);
  await page.getByLabel('Its passphrase').fill(PASSPHRASE);
  await expect(page.getByLabel(/Just check it/)).toBeChecked();
  await page.getByRole('button', { name: 'Continue' }).click();

  const dryResult = page.getByText(/Checked:|fingerprints match|could not/i).first();
  await expect(dryResult).toBeVisible({ timeout: 60_000 });
  await expect(dryResult).toContainText('fingerprints match');

  // A dry run must not have changed anything. This is the check that would
  // catch "just check it" quietly writing, which is the worst possible bug in
  // a restore screen: it looks reassuring and is destructive.
  await page.goto('/home');
  await expect(page.getByText(/Nothing is saved yet|What would you like/)).toBeVisible();

  // ------------------------------------------------------------ real restore
  await page.goto('/exports');
  await page.setInputFiles('input[type="file"][name="backup"]', savedAt);
  await page.getByLabel('Its passphrase').fill(PASSPHRASE);
  await page.getByLabel(/Just check it/).uncheck();
  await page.getByRole('button', { name: 'Continue' }).click();

  const realResult = page.getByText(/Restored|Checked:|could not/i).first();
  await expect(realResult).toBeVisible({ timeout: 60_000 });
  await expect(realResult).toContainText(/Restored \d+ memories/);

  // --------------------------------------------------- did the memory land
  await page.goto('/home');
  await expect(page.getByText(/\d+ things? saved, from \d+ sources?/)).toBeVisible();

  await page.goto('/memory');
  const restoredMemory = await page.locator('body').innerText();
  const restoredFacts = restoredMemory
    .split('\n')
    .filter((l) => /opening date|Mill Street|September/i.test(l));
  // The same sentences, in a workspace that never saw the original.
  expect(restoredFacts.length, 'the original memory came back').toBeGreaterThan(0);

  // ------------------------------------------------- a wrong passphrase fails
  await page.goto('/exports');
  await page.setInputFiles('input[type="file"][name="backup"]', savedAt);
  await page.getByLabel('Its passphrase').fill('the-wrong-passphrase');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/did not open the backup/i)).toBeVisible({ timeout: 60_000 });
});
