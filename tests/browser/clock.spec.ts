import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 0, 15, 10, 10) });
});

test('sample clock opens event details by keyboard and restores focus', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#center-time')).toHaveText('10:10');
  const centerTime = (await page.locator('#center-time').boundingBox())!;
  const centerPeriod = (await page.locator('#center-period').boundingBox())!;
  expect(centerPeriod.x).toBeGreaterThanOrEqual(centerTime.x + centerTime.width);
  expect(centerPeriod.height).toBeLessThan(centerTime.height / 2);
  expect(centerPeriod.y + centerPeriod.height).toBeLessThan(centerTime.y + centerTime.height / 2);
  await expect(page.locator('#clock .remaining-label')).toHaveText('0:20');
  await expect(page.locator('.clock-caption')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clock settings', exact: true })).toHaveCount(0);
  await expect(page.locator('#clock [data-event="all-day"]')).toHaveCount(0);
  const event = page.locator('#clock [data-event="design"]');
  const titleLines = await event.locator('.event-label textPath').allTextContents();
  expect(titleLines.join(' ')).toBe('Design catch-up');
  const wrappedTitle = await page.locator('#clock [data-event="lunch"] .event-label textPath').allTextContents();
  expect(wrappedTitle.length).toBeGreaterThan(1);
  expect(wrappedTitle.join(' ')).toBe('Lunch with Alex');
  // Narrow overlap lanes can truncate visually, but keep their complete accessible title.
  await expect(page.locator('#clock [data-event="walk"]')).toHaveAttribute('aria-label', /Get some fresh air/);
  await event.focus();
  await event.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#dialog-title')).toHaveText('Design catch-up');
  await expect(page.getByRole('button', { name: 'Back to the clock' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toContainText('Studio · Video call');
  await page.keyboard.press('Escape');
  await expect(event).toBeFocused();
  expect(errors).toEqual([]);
});

test('dial span and text format are independent and persist', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '24h', exact: true }).click();
  await expect(page.locator('#clock')).toHaveAttribute('data-dial-span', '24');
  await expect(page.locator('#clock .hour-label').first()).toHaveText('12 AM');
  await expect(page.locator('#center-period')).toHaveText('AM');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#setting-format').selectOption('24');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '24h', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#center-period')).toBeEmpty();
  await expect(page.locator('#center-period')).toBeHidden();
});

test('dial numerals follow time format and identify noon, midnight, and the rolling seam', async ({ page }) => {
  await page.goto('/');
  const numerals = page.locator('#clock .hour-label');
  await expect(numerals).toHaveCount(12);
  await expect(numerals.nth(0)).toHaveText('12 PM');
  await expect(numerals.nth(8)).toHaveText('8 AM');
  await expect(numerals.nth(7)).toHaveText('7 PM');
  await expect(page.locator('#clock .hour-period')).toHaveCount(3);
  const numeralSize = await numerals.first().evaluate(element => getComputedStyle(element).fontSize);
  await expect(page.locator('#clock .hour-period').first()).toHaveCSS('font-size', numeralSize);
  await page.getByRole('button', { name: '24h', exact: true }).click();
  await expect(numerals).toHaveCount(12);
  await expect(numerals.nth(0)).toHaveText('12 AM');
  await expect(numerals.nth(6)).toHaveText('12 PM');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#setting-format').selectOption('24');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(numerals).toHaveText(['0', '2', '4', '6', '8', '10', '12', '14', '16', '18', '20', '22']);
  await expect(page.locator('#clock .hour-period')).toHaveCount(0);
  await page.getByRole('button', { name: '12h', exact: true }).click();
  await expect(numerals).toHaveText(['12', '13', '14', '15', '16', '17', '18', '19', '8', '9', '10', '11']);
});

test('24-hour time omits leading hour zeroes in the center, event rims, and details', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#setting-format').selectOption('24');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('#scenario').selectOption('segments');
  await expect(page.locator('#center-time')).toHaveText('8:40');
  await expect(page.locator('#clock .event-edge-time')).toHaveText(['9:00', '9:45', '9:30', '10:30']);
  await page.locator('#clock [data-event="event-a"]').press('Enter');
  await expect(page.locator('.detail-time')).toHaveText('9:00 — 9:45');
  await page.keyboard.press('Escape');
  await page.locator('#scenario').selectOption('overnight');
  await page.locator('#clock [data-event="late"]').press('Enter');
  await expect(page.locator('.detail-time')).toContainText('23:30 — 0:30');
  await page.keyboard.press('Escape');
  await page.clock.setSystemTime(new Date(2026, 0, 16, 0, 5));
  await page.getByRole('button', { name: 'Use current time', exact: true }).click();
  await expect(page.locator('#center-time')).toHaveText('0:05');
  await expect(page.locator('#center-period')).toBeHidden();
});

for (const font of ['inter', 'open-sans']) {
  test(`AM/PM dial labels fit inside the center with ${font}`, async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 720 });
    await page.addInitScript(font => localStorage.setItem('calendar-pie-settings', JSON.stringify({ font })), font);
    await page.clock.setSystemTime(new Date(2026, 0, 15, 12, 10));
    await page.goto('/?kiosk=1');
    // Activate live sample time through the desktop control hidden in kiosk mode.
    await page.locator('#live-toggle').dispatchEvent('click');
    await expect(page.locator('.clock-center')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    for (const [hour, expectedLabels] of [[12, ['10 AM', '9 PM']], [6, ['4 AM', '3 PM']]] as const) {
      await page.clock.setSystemTime(new Date(2026, 0, 15, hour, 9));
      await page.clock.runFor(60050);
      await expect(page.locator('#center-time')).toHaveText(`${hour}:10`);
      const labels = page.locator('#clock .hour-label');
      await expect(labels).toHaveCount(12);
      for (const label of expectedLabels) await expect(labels.filter({ hasText: label })).toHaveCount(1);
      const geometry = await labels.evaluateAll(elements => elements.map(element => {
        const text = element as SVGGraphicsElement;
        const bounds = text.getBBox();
        const transform = text.ownerSVGElement!.getScreenCTM()!.inverse().multiply(text.getScreenCTM()!);
        return {
          label: text.textContent,
          size: getComputedStyle(text).fontSize,
          periodSize: text.querySelector('.hour-period') ? getComputedStyle(text.querySelector('.hour-period')!).fontSize : null,
          radii: [
            [bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y],
            [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height],
          ].map(([x, y]) => {
            const point = new DOMPoint(x, y).matrixTransform(transform);
            return Math.hypot(point.x - 360, point.y - 360);
          }),
        };
      }));
      for (const label of geometry) {
        expect(Math.max(...label.radii), `${font}: ${label.label}`).toBeLessThanOrEqual(150);
        if (label.periodSize) expect(label.periodSize).toBe(label.size);
      }
    }
  });
}

test('overlap, empty and overnight scenarios remain usable', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scenario').selectOption('overlap');
  await expect(page.locator('#clock [data-event="reminder"]')).toHaveCount(1);
  await page.locator('#clock [data-event="reminder"]').press('Enter');
  await expect(page.locator('#dialog-title')).toHaveText('Take a breath');
  await page.keyboard.press('Escape');
  await page.locator('#scenario').selectOption('empty');
  await expect(page.locator('#clock .event-group')).toHaveCount(0);
  await expect(page.locator('#clock .remaining-arc')).toHaveCount(0);
  await expect(page.locator('#agenda')).toHaveText('No events.');
  await expect(page.locator('#next-card')).toHaveText('No upcoming events.');
  await page.locator('#scenario').selectOption('overnight');
  await expect(page.locator('#center-time')).toHaveText('11:20');
  await expect(page.locator('#clock .remaining-label')).toHaveText('0:10');
  await expect(page.locator('#clock [data-event="late"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Next clock window', exact: true }).click();
  await expect(page.locator('#clock .remaining-arc')).toHaveCount(0);
});

test('duration boundaries, enlarged slices, and curved rim times coexist with overlap details', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scenario').selectOption('segments');
  await expect(page.locator('#center-time')).toHaveText('8:40');
  await expect(page.locator('#clock')).toHaveAttribute('data-dial-span', '12');
  await expect(page.locator('#clock .duration-label textPath')).toHaveText(['0:30', '0:15', '0:45']);
  await expect(page.locator('#clock .remaining-label')).toHaveText('0:20');
  await expect(page.locator('#clock .event-rim')).toHaveCount(2);
  const edgeTimes = page.locator('#clock .event-edge-time');
  await expect(edgeTimes).toHaveCount(4);
  expect((await edgeTimes.allTextContents()).join(' ')).toMatch(/9:00.*9:45.*9:30.*10:30/);
  await expect(edgeTimes.first()).toHaveCSS('fill', 'rgb(255, 255, 255)');
  const rimFill = await page.locator('#clock .event-rim').first().evaluate(element => getComputedStyle(element).fill);
  const channels = rimFill.match(/\d+/g)?.map(Number) ?? [];
  expect(channels.length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...channels.slice(0, 3))).toBeLessThan(140);
  await expect(page.locator('#clock .event-slice').first()).toHaveAttribute('d', /A 318 318/);
  const numeralRadius = await page.locator('#clock .hour-label').first().evaluate(element =>
    Math.hypot(Number(element.getAttribute('x')) - 360, Number(element.getAttribute('y')) - 360));
  expect(numeralRadius).toBeLessThanOrEqual(141);
  await page.screenshot({ path: 'artifacts/duration-segments.png', fullPage: true });

  const overlap = page.locator('#clock .duration-segment').nth(1);
  await expect(overlap).toHaveAttribute('aria-label', /0:15.*Event A.*Event B/);
  await overlap.click();
  await expect(page.locator('#dialog-title')).toHaveText('Overlapping events');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /Event A/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Event B/ })).toBeVisible();
  await dialog.getByRole('button', { name: /Event B/ }).click();
  await expect(page.locator('#dialog-title')).toHaveText('Event B');
  await page.keyboard.press('Escape');
  await page.locator('#clock .duration-segment').first().press('Enter');
  await expect(page.locator('#dialog-title')).toHaveText('Event A');
});

test('gaps show durations and free-time details while the current gap leaves room for the countdown', async ({ page }) => {
  await page.goto('/');
  const gaps = page.locator('#clock .duration-gap');
  await expect(gaps.locator('.duration-label textPath')).toHaveText(['0:15', '0:15', '1:00', '0:30', '1:30']);
  await expect(gaps.filter({ hasText: /Free time, 10:00 AM to 10:30 AM/ })).toHaveCount(0);
  await expect(page.locator('#clock .remaining-label')).toHaveText('0:20');
  await expect(page.locator('#clock .remaining-arc')).toHaveAttribute('d', /A 336 336/);
  await expect(gaps.nth(2).locator('.duration-arc')).toHaveAttribute('d', /A 336 336/);
  await gaps.nth(2).press('Enter');
  await expect(page.locator('#dialog-title')).toHaveText('Free time');
  await expect(page.locator('.detail-time')).toContainText('1:00 PM');
  await expect(page.locator('.duration-badge')).toHaveText('1 hr');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.clock.setSystemTime(new Date(2026, 0, 15, 10, 30));
  await page.getByRole('button', { name: 'Use current time', exact: true }).click();
  await expect(gaps.locator('.duration-label textPath')).toHaveText(['0:15', '0:30', '0:15', '1:00', '0:30', '1:30']);
  await page.locator('#scenario').selectOption('empty');
  await expect(page.locator('#clock .duration-segment')).toHaveCount(0);
});

test('active events count down to the earliest end without duplicating duration segments', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scenario').selectOption('segments');
  await page.clock.setSystemTime(new Date(2026, 0, 15, 9, 15));
  await page.getByRole('button', { name: 'Use current time', exact: true }).click();
  await expect(page.locator('#clock .remaining-label')).toHaveText('0:30');
  await expect(page.locator('#clock .remaining-arc')).toHaveAttribute('d', /A 336 336/);
  await expect(page.locator('#clock .duration-label textPath')).toHaveText(['0:45']);
  await page.clock.setSystemTime(new Date(2026, 0, 15, 9, 34));
  await page.clock.runFor(60000);
  await expect(page.locator('#clock .remaining-label')).toHaveText('0:10');
  await expect(page.locator('#clock .duration-segment')).toHaveCount(0);
  await page.clock.setSystemTime(new Date(2026, 0, 15, 9, 44));
  await page.clock.runFor(60000);
  await expect(page.locator('#clock .remaining-label')).toHaveText('0:45');
  await page.clock.setSystemTime(new Date(2026, 0, 15, 10, 29));
  await page.clock.runFor(60000);
  await expect(page.locator('#clock .remaining-label')).toHaveCount(0);
  await expect(page.locator('#clock .duration-label textPath')).toHaveText(['0:30', '0:15', '0:45']);
});

test('720px kiosk fits the round display and supports touch details', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await page.goto('/?kiosk=1');
  await expect(page.locator('.site-header')).toBeHidden();
  await expect(page.locator('body')).toHaveCSS('cursor', 'none');
  await expect(page.locator('#clock .event-group').first()).toHaveCSS('cursor', 'none');
  const bounds = await page.locator('#clock-stage').boundingBox();
  expect(bounds).toMatchObject({ x: 0, y: 0, width: 720, height: 720 });
  // 11 o'clock, radius 285: inside the outer Design catch-up lane.
  await page.mouse.click(217.5, 113.18);
  await expect(page.locator('#dialog-title')).toHaveText('Design catch-up');
  await expect(page.getByRole('dialog')).toHaveCSS('border-radius', '50%');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: 'artifacts/clock-720.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(720);
});

test('narrow slices use readable radial titles within the slice and open their details', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await page.goto('/?kiosk=1');
  const title = page.locator('#clock [data-event="stretch"] .event-label.radial-label');
  await expect(title).toBeVisible();
  expect((await title.locator('tspan').allTextContents()).join(' ')).toBe('Stretch & reset');
  await expect(page.locator('#clock [data-event="make"] .event-label textPath')).toHaveText('Make something');

  const corners = await title.evaluate(element => {
    const text = element as SVGGraphicsElement;
    const svg = text.ownerSVGElement!;
    const transform = svg.getScreenCTM()!.inverse().multiply(text.getScreenCTM()!);
    const bounds = text.getBBox();
    return [
      [bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y],
      [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height],
    ].map(([x, y]) => {
      const point = new DOMPoint(x, y).matrixTransform(transform);
      const dx = point.x - 360;
      const dy = point.y - 360;
      return { radius: Math.hypot(dx, dy), angle: (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360 };
    });
  });
  // Stretch occupies 16:30–17:00: 135–150 degrees, between the center and time rim.
  for (const corner of corners) {
    expect(corner.radius).toBeGreaterThanOrEqual(157);
    expect(corner.radius).toBeLessThanOrEqual(291);
    const angularTolerance = 180 / (Math.PI * corner.radius);
    expect(corner.angle).toBeGreaterThanOrEqual(135 - angularTolerance);
    expect(corner.angle).toBeLessThanOrEqual(150 + angularTolerance);
  }
  await page.screenshot({ path: 'artifacts/radial-title-720.png' });
  const bounds = await title.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await expect(page.locator('#dialog-title')).toHaveText('Stretch & reset');
});

test('desktop and mobile previews fit without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/?diagnostics=1');
  await expect(page.locator('#metrics')).toContainText('renders');
  await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
});

test('settings use a rectangular scrollable dialog on desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCSS('border-radius', '12px');
  expect((await dialog.boundingBox())!.width).toBe(720);
  await page.screenshot({ path: 'artifacts/settings-rectangular.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toHaveCSS('border-radius', '12px');
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(358);
  expect(bounds.height).toBeLessThanOrEqual(844 * 0.9 + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(await page.locator('#dialog-content').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.locator('#setting-history').scrollIntoViewIfNeeded();
  await expect(page.locator('#setting-history')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('settings Back is at the top left and preserves the browsed clock window', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sample-badge')).toHaveText('Sample calendars');
  await expect(page.locator('.hero, .prototype-label, footer')).toHaveCount(0);
  await expect(page.locator('#scenario option')).toHaveText(['Everyday', 'Overlapping events', 'Overnight', 'No events', 'Overlap duration example']);
  await page.getByRole('button', { name: 'Next clock window', exact: true }).click();
  const windowLabel = await page.locator('#window-label').innerText();
  const clockMarkup = await page.locator('#clock').innerHTML();
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await settings.click();
  await expect(page.locator('#dialog-title')).toHaveText('Settings');
  const back = page.getByRole('button', { name: 'Back', exact: true });
  await expect(back).toBeVisible();
  const backBounds = (await back.boundingBox())!;
  const dialogBounds = (await page.getByRole('dialog').boundingBox())!;
  expect(backBounds.x - dialogBounds.x).toBeLessThan(60);
  expect(backBounds.y - dialogBounds.y).toBeLessThan(60);
  await back.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(settings).toBeFocused();
  await expect(page.locator('#window-label')).toHaveText(windowLabel);
  expect(await page.locator('#clock').innerHTML()).toBe(clockMarkup);
});

test('paused previews stay idle and live time advances at minute boundaries', async ({ page }) => {
  await page.goto('/?diagnostics=1');
  const initial = JSON.parse(await page.locator('#metrics').innerText()).renders;
  await page.clock.fastForward(70000);
  expect(JSON.parse(await page.locator('#metrics').innerText()).renders).toBe(initial);
  await page.getByRole('button', { name: 'Use current time', exact: true }).click();
  const previous = await page.locator('#center-time').innerText();
  await page.clock.fastForward(60000);
  await expect(page.locator('#center-time')).not.toHaveText(previous);
});

test('round display keeps window identity while configuration and diagnostics stay in the desktop preview', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await page.goto('/?kiosk=1&diagnostics=1');
  await page.mouse.move(520, 600);
  await page.mouse.down();
  await page.mouse.move(390, 600);
  await page.mouse.up();
  await expect(page.locator('#dial-sample-label')).toContainText('VIEWING');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  await expect(page.locator('#metrics')).toBeHidden();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/?diagnostics=1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Rendering diagnostics', { exact: true }).last().click();
  await expect(page.locator('#dialog-metrics')).toBeVisible();
  await expect(page.getByRole('button', { name: /View this day.*agenda/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Return to current clock window', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('#agenda').getByRole('button', { name: /Design catch-up/ }).click();
  await expect(page.locator('#dialog-title')).toHaveText('Design catch-up');
});

test('history fades whole past numerals without clipping the future label at the seam', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await page.clock.setSystemTime(new Date(2026, 0, 15, 10, 1));
  await page.goto('/?kiosk=1');
  await page.locator('#live-toggle').dispatchEvent('click');
  await expect(page.locator('#center-time')).toHaveText('10:01');
  const numerals = page.locator('#clock .clock-numerals .hour-label');
  await expect(numerals).toHaveCount(12);
  expect(await numerals.evaluateAll(elements => elements.every(element => !element.closest('[mask]')))).toBe(true);
  const future = numerals.filter({ hasText: /^7 PM$/ });
  const past = numerals.filter({ hasText: /^8 AM$/ });
  await expect(future).toHaveCSS('opacity', '1');
  const initialOpacity = await past.evaluate(element => Number(getComputedStyle(element).opacity));
  expect(initialOpacity).toBeCloseTo(59 / 180, 3);
  await page.clock.runFor(60050);
  await expect(page.locator('#center-time')).toHaveText('10:02');
  const advancedOpacity = await past.evaluate(element => Number(getComputedStyle(element).opacity));
  expect(advancedOpacity).toBeCloseTo(58 / 180, 3);
  expect(advancedOpacity).toBeLessThan(initialOpacity);
  await expect(future).toHaveCSS('opacity', '1');
});

test('future boundary marks the rolling window seam without fading', async ({ page }) => {
  await page.goto('/');
  const boundary = page.locator('#clock .window-boundary');
  await expect(boundary).toHaveCount(1);
  await expect(boundary).toHaveCSS('stroke-width', '1px');
  await expect(boundary).toHaveCSS('pointer-events', 'none');
  expect(await boundary.evaluate(element => element.closest('[mask]'))).toBeNull();
  const checkAngle = async (degrees: number) => {
    const values = (await boundary.getAttribute('d'))!.match(/-?[0-9]+(?:\.[0-9]+)?/g)!.map(Number);
    for (const [index, radius] of [[0, 153], [2, 352]]) {
      expect(values[index]).toBeCloseTo(360 + Math.sin(degrees * Math.PI / 180) * radius);
      expect(values[index + 1]).toBeCloseTo(360 - Math.cos(degrees * Math.PI / 180) * radius);
    }
  };
  await checkAngle(215);
  await page.getByRole('button', { name: '24h', exact: true }).click();
  await checkAngle(107.5);
});

test('fading history defaults to three hours, persists, and can be disabled', async ({ page }) => {
  await page.goto('/');
  const layers = ['.event-layer', '.radial-grid', '.radial-stubs', '.clock-markings'];
  await expect(page.locator('.clock-numerals .hour-label')).toHaveCount(12);
  await expect(page.locator('.clock-markings .event-boundary')).toHaveCount(2);
  await expect(page.locator('.clock-markings .dial-outline')).toHaveCSS('fill', 'none');
  await expect(page.locator('.dial-background')).not.toHaveAttribute('mask');
  for (const layer of layers) await expect(page.locator(`#clock ${layer}`)).toHaveAttribute('mask', 'url(#event-history)');
  await page.getByRole('button', { name: 'Next clock window', exact: true }).click();
  for (const layer of layers) await expect(page.locator(`#clock ${layer}`)).not.toHaveAttribute('mask');
  await page.getByRole('button', { name: 'Previous clock window', exact: true }).click();
  for (const layer of layers) await expect(page.locator(`#clock ${layer}`)).toHaveAttribute('mask', 'url(#event-history)');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#setting-history')).toHaveValue('3');
  await page.locator('#setting-history').fill('2');
  await page.locator('#setting-history').press('Tab');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#setting-history')).toHaveValue('2');
  await page.locator('#setting-history').fill('0');
  await page.locator('#setting-history').press('Tab');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  for (const layer of layers) await expect(page.locator(`#clock ${layer}`)).not.toHaveAttribute('mask');
  expect(await page.locator('#clock .hour-label').evaluateAll(elements => elements.every(element => getComputedStyle(element).opacity === '1'))).toBe(true);
  await page.reload();
  for (const layer of layers) await expect(page.locator(`#clock ${layer}`)).not.toHaveAttribute('mask');
});

test('kiosk center taps, holds and keyboard input cannot open settings', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await page.goto('/?kiosk=1');
  const center = page.locator('.clock-center');
  await expect(center).not.toHaveAttribute('tabindex');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Clock settings', exact: true })).toHaveCount(0);
  await center.click();
  await page.clock.fastForward(700);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.mouse.move(360, 360);
  await page.mouse.down();
  await page.clock.fastForward(700);
  await page.mouse.up();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await center.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
  await center.dispatchEvent('keydown', { key: ' ', code: 'Space', bubbles: true });
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.locator('#clock [data-event="design"]').press('Enter');
  await expect(page.locator('#dialog-title')).toHaveText('Design catch-up');
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeHidden();
});
