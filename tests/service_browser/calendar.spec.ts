import { expect, test } from '@playwright/test';

test('configure an ICS source in the browser, display its SQLite events, and remove it', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#calendar-service-status')).toContainText('No calendar sources yet');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Manage calendar sources', exact: true }).click();
  await page.getByRole('button', { name: 'Add calendar source', exact: true }).click();
  await page.locator('#source-form [name="name"]').fill('Local integration calendar');
  await page.locator('#source-form [name="url"]').fill('http://127.0.0.1:8767/sample.ics');
  await page.getByRole('button', { name: 'Save calendar source', exact: true }).click();
  await expect(page.locator('.source-list')).toContainText('Local integration calendar');
  await expect.poll(async () => {
    const response = await request.get('/api/events');
    const payload = await response.json();
    return payload.events.map((event: { title: string }) => event.title);
  }, { timeout: 30_000 }).toContain('Real ICS appointment');
  await page.reload();
  const event = page.locator('#clock .event-group').filter({ hasText: 'Real ICS appointment' });
  await expect(event).toHaveCount(1);
  await expect(page.locator('#clock [data-event="design"]')).toHaveCount(0);
  await event.press('Enter');
  await expect(page.locator('#dialog-title')).toHaveText('Real ICS appointment');
  await expect(page.locator('.detail-description')).toHaveText('Fetched by Python and stored in SQLite.');
  await page.screenshot({ path: 'artifacts/real-calendar-details.png', fullPage: true });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Manage calendar sources', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Local integration calendar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.locator('.source-list')).toContainText('No sources yet');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#clock .event-group')).toHaveCount(0);
  expect(errors).toEqual([]);
});
