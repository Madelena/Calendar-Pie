import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function mockService(page: Page) {
  const state = {
    offline: false,
    mutations: [] as { method: string; path: string; body: Record<string, unknown> | null }[],
    queries: [] as URL[],
    calendars: [{ id: 'feed', name: 'Real <Calendar>', url: 'https://example.com/feed.ics', username: 'reader', hasPassword: true, color: '#AABBCC', enabled: true, refreshMinutes: 15, lastSuccess: '2026-01-15T10:00:00Z', lastAttempt: '2026-01-15T10:00:00Z', lastError: null as string | null }],
  };
  await page.clock.install({ time: new Date(2026, 0, 15, 10, 10) });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const timezone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (state.offline) { await route.fulfill({ status: 503, json: { error: 'Network disconnected' } }); return; }
    if (path === '/api/health') { await route.fulfill({ json: { status: 'ok', timezone } }); return; }
    if (path === '/api/events') {
      state.queries.push(url);
      const start = new Date(2026, 0, 15, 10, 30).toISOString();
      const end = new Date(2026, 0, 15, 11, 30).toISOString();
      const events = state.calendars.some(calendar => calendar.enabled) ? [
        { id: 'real-event', calendarId: state.calendars[0].id, title: 'Plan <img src=x onerror=alert(1)>', start, end, allDay: false, location: '<script>bad()</script>', description: 'Literal <b>feed text</b>' },
        { id: 'real-all-day', calendarId: state.calendars[0].id, title: 'Hidden all-day birthday', start: new Date(2026, 0, 15).toISOString(), end: new Date(2026, 0, 16).toISOString(), allDay: true },
      ] : [];
      await route.fulfill({ json: { calendars: state.calendars, events, range: { start: url.searchParams.get('start'), end: url.searchParams.get('end') }, cacheRange: { start: new Date(2026, 0, 1).toISOString(), end: new Date(2026, 1, 1).toISOString() }, timezone } });
      return;
    }
    if (request.method() === 'GET') { await route.fulfill({ json: { calendars: state.calendars } }); return; }
    const body = request.postDataJSON() as Record<string, unknown> | null;
    state.mutations.push({ method: request.method(), path, body });
    if (path.endsWith('/refresh')) { await route.fulfill({ status: 202, json: { queued: true } }); return; }
    if (request.method() === 'DELETE') { state.calendars = []; await route.fulfill({ status: 204 }); return; }
    const changes = { ...body };
    const hasPassword = changes.password === undefined ? state.calendars[0]?.hasPassword ?? false : !!changes.password;
    delete changes.password;
    const calendar = { ...state.calendars[0], ...changes, id: 'feed', hasPassword } as typeof state.calendars[number];
    state.calendars = [calendar];
    await route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: { calendar } });
  });
  return state;
}

async function sources(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Manage calendar sources', exact: true }).click();
  await expect(page.locator('#dialog-title')).toHaveText('Calendar sources');
  await expect(page.getByRole('button', { name: 'Add calendar source', exact: true })).toBeVisible();
}

async function expectConfigurationDialog(page: Page) {
  await expect(page.getByRole('dialog')).toHaveCSS('border-radius', '12px');
  expect(await page.locator('#dialog-content').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
}

test('real service discovers calendars and renders feed text safely; sample switch persists', async ({ page }) => {
  const state = await mockService(page);
  await page.goto('/');
  const event = page.locator('#clock [data-event="real-event"]');
  await expect(event).toHaveCount(1);
  await expect(event.locator('.event-slice')).toHaveAttribute('fill', '#AABBCC');
  await expect(page.locator('.preview-tools')).toBeHidden();
  await event.press('Enter');
  await expect(page.locator('#dialog-title')).toHaveText('Plan <img src=x onerror=alert(1)>');
  await expect(page.locator('.detail-location')).toHaveText('<script>bad()</script>');
  await expect(page.locator('#dialog-content img, #dialog-content script')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const firstRange = state.queries[0].search;
  await page.getByRole('button', { name: 'Next clock window', exact: true }).click();
  await expect.poll(() => state.queries.length).toBeGreaterThan(1);
  expect(state.queries.at(-1)!.search).not.toBe(firstRange);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('[data-calendar]')).toHaveCount(0);
  await page.locator('#calendar-view').selectOption('sample');
  await page.keyboard.press('Escape');
  await expect(page.locator('#clock [data-event="design"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#clock [data-event="design"]')).toHaveCount(1);
  await expect(page.locator('#calendar-service-status')).toBeHidden();
});

test('source settings support password retention, add, refresh and delete', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockService(page);
  await page.goto('/');
  await expect(page.locator('#clock [data-event="real-event"]')).toHaveCount(1);
  await sources(page);
  await expectConfigurationDialog(page);
  await page.getByRole('button', { name: 'Edit Real <Calendar>', exact: true }).click();
  await expectConfigurationDialog(page);
  await expect(page.locator('[name=password]')).toHaveValue('');
  await page.locator('[name=name]').fill('Updated calendar');
  await page.locator('[name=color]').fill('#112233');
  await page.locator('[name=refreshMinutes]').fill('30');
  await page.getByRole('button', { name: 'Save calendar source', exact: true }).click();
  await expect(page.locator('.source-card')).toContainText('Updated calendar');
  expect(state.mutations[0].method).toBe('PATCH');
  expect(state.mutations[0].body).not.toHaveProperty('password');
  await page.getByRole('button', { name: 'Refresh Updated calendar', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Refresh queued');
  await page.getByRole('button', { name: 'Edit Updated calendar', exact: true }).click();
  await page.locator('[name=clearPassword]').check();
  await page.locator('[name=enabled]').uncheck();
  await page.getByRole('button', { name: 'Save calendar source', exact: true }).click();
  await expect(page.locator('.source-card')).toContainText('Disabled');
  expect(state.mutations.at(-1)!.body!.password).toBe('');
  await page.getByRole('button', { name: 'Delete Updated calendar', exact: true }).click();
  await expectConfigurationDialog(page);
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('No sources yet');
  await page.getByRole('button', { name: 'Add calendar source', exact: true }).click();
  await expectConfigurationDialog(page);
  await page.locator('[name=name]').fill('New feed');
  await page.locator('[name=url]').fill('https://example.com/new.ics');
  await page.locator('[name=username]').fill('me');
  await page.locator('[name=password]').fill('private-value');
  await page.getByRole('button', { name: 'Save calendar source', exact: true }).click();
  await expect(page.locator('.source-card')).toContainText('New feed');
  expect(state.mutations.at(-1)!.method).toBe('POST');
  expect(state.mutations.at(-1)!.body!.password).toBe('private-value');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('private-value');
  await expect(page.getByRole('dialog')).not.toContainText('private-value');
});

test('configuration Back follows the source hierarchy without saving or deleting', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockService(page);
  await page.goto('/');
  await expect(page.locator('#clock [data-event="real-event"]')).toHaveCount(1);
  await sources(page);
  const back = page.getByRole('button', { name: 'Back', exact: true });
  for (const [button, title] of [
    ['Add calendar source', 'Add calendar source'],
    ['Edit Real <Calendar>', 'Edit calendar source'],
    ['Delete Real <Calendar>', 'Delete calendar source?'],
  ]) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.locator('#dialog-title')).toHaveText(title);
    await expect(back).toBeVisible();
    const backBounds = (await back.boundingBox())!;
    const dialogBounds = (await page.getByRole('dialog').boundingBox())!;
    expect(backBounds.x - dialogBounds.x).toBeLessThan(60);
    expect(backBounds.y - dialogBounds.y).toBeLessThan(60);
    if (title !== 'Delete calendar source?') await page.locator('[name=name]').fill('Unsaved edit');
    await back.click();
    await expect(page.locator('#dialog-title')).toHaveText('Calendar sources');
    await expect(page.locator('.source-card')).toContainText('Real <Calendar>');
    await expect(page.locator('.source-card')).not.toContainText('Unsaved edit');
  }
  expect(state.mutations).toEqual([]);
  await back.click();
  await expect(page.locator('#dialog-title')).toHaveText('Settings');
  await back.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  state.offline = true;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Manage calendar sources', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Network disconnected');
  await back.click();
  await expect(page.locator('#dialog-title')).toHaveText('Settings');
});

test('failed polling retains loaded events across minute render and retries without sample fallback', async ({ page }) => {
  const state = await mockService(page);
  await page.goto('/');
  await expect(page.locator('#clock [data-event="real-event"]')).toHaveCount(1);
  state.offline = true;
  await page.clock.runFor(61000);
  await expect(page.locator('#calendar-service-status')).toContainText('Showing previously loaded events');
  await expect(page.locator('#clock [data-event="real-event"]')).toHaveCount(1);
  await expect(page.locator('#clock [data-event="design"]')).toHaveCount(0);
  state.offline = false;
  await page.getByRole('button', { name: 'Retry calendar service', exact: true }).click();
  await expect(page.locator('#calendar-service-status')).not.toContainText('unavailable');
  await expect(page.locator('#clock [data-event="real-event"]')).toHaveCount(1);
});

test('an explicitly selected real service stays real when unavailable after reload', async ({ page }) => {
  const state = await mockService(page);
  state.offline = true;
  await page.addInitScript(() => localStorage.setItem('calendar-pie-source', 'real'));
  await page.goto('/');
  await expect(page.locator('#calendar-service-status')).toContainText('Calendar service unavailable');
  await expect(page.locator('#clock .event-group')).toHaveCount(0);
  await expect(page.locator('.preview-tools')).toBeHidden();
  await expect(page.locator('#dial-sample-label')).toHaveText('MY CALENDARS · OFFLINE');
  state.offline = false;
  await page.getByRole('button', { name: 'Retry calendar service', exact: true }).click();
  await expect(page.locator('#clock [data-event="real-event"]')).toHaveCount(1);
});

test('all-day feed events stay hidden on the dial and desktop agenda', async ({ page }) => {
  await mockService(page);
  await page.goto('/');
  await expect(page.locator('#clock [data-event="real-event"]')).toHaveCount(1);
  await expect(page.locator('#clock [data-event="real-all-day"]')).toHaveCount(0);
  await expect(page.locator('#agenda [data-event="real-all-day"]')).toHaveCount(0);
  await expect(page.locator('#event-count')).toHaveText('1 plans');
  await expect(page.locator('#next-card')).not.toContainText('Hidden all-day birthday');
  await expect(page.locator('#agenda [data-event="real-event"]')).toHaveCount(1);
  await page.locator('#agenda [data-event="real-event"]').click();
  await expect(page.locator('#dialog-title')).toHaveText('Plan <img src=x onerror=alert(1)>');
  await expect(page.getByRole('dialog')).not.toContainText('Hidden all-day birthday');
});
