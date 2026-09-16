import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const customFont = fileURLToPath(new URL('../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', import.meta.url));
const customFontName = 'inter-latin-wght-normal.woff2';

test('accent defaults to Madelena pink and custom colors persist in both themes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hour-hand')).toHaveCSS('stroke', 'rgb(195, 0, 82)');
  await expect(page.locator('.remaining-label')).toHaveCSS('fill', 'rgb(195, 0, 82)');
  const selectedSpan = page.locator('.segmented button[aria-pressed="true"]');
  await expect(selectedSpan).toHaveCSS('background-color', 'rgb(195, 0, 82)');
  await expect(selectedSpan).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const hex = page.getByRole('textbox', { name: 'Accent hex color', exact: true });
  await expect(hex).toHaveValue('#C30052');
  await hex.fill('#00ccff');
  await hex.press('Tab');
  await expect(page.getByLabel('Accent color', { exact: true })).toHaveValue('#00ccff');
  await expect(selectedSpan).toHaveCSS('color', 'rgb(0, 0, 0)');
  await page.locator('#setting-theme').selectOption('dark');
  await expect(page.locator('.hour-hand')).toHaveCSS('stroke', 'rgb(0, 204, 255)');
  await expect(page.locator('.remaining-label')).toHaveCSS('fill', 'rgb(0, 204, 255)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await page.reload();
  await expect(page.locator('.hour-hand')).toHaveCSS('stroke', 'rgb(0, 204, 255)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(hex).toHaveValue('#00CCFF');
  await hex.fill('invalid');
  await hex.press('Tab');
  await expect(hex).toHaveValue('#00CCFF');
  await page.getByLabel('Accent color', { exact: true }).fill('#c30052');
  await page.getByLabel('Accent color', { exact: true }).dispatchEvent('change');
  await expect(hex).toHaveValue('#C30052');
  await page.locator('#setting-theme').selectOption('light');
  await expect(page.locator('.hour-hand')).toHaveCSS('stroke', 'rgb(195, 0, 82)');
});

test('invalid saved accent falls back to Madelena pink', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('calendar-pie-settings', JSON.stringify({ accentColor: 'invalid' })));
  await page.goto('/');
  await expect(page.locator('.hour-hand')).toHaveCSS('stroke', 'rgb(195, 0, 82)');
});

test('interface grays stay neutral across accent colors and themes', async ({ page }) => {
  await page.goto('/');
  const originalSlice = await page.locator('[data-event="design"] .event-slice').getAttribute('fill');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const hex = page.getByRole('textbox', { name: 'Accent hex color', exact: true });
  for (const theme of ['light', 'dark']) {
    await page.locator('#setting-theme').selectOption(theme);
    const ink = theme === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)';
    const paper = theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    for (const selector of ['body', '#center-time', '#center-date', '.sample-badge', '.next-card']) {
      await expect(page.locator(selector)).toHaveCSS('color', ink);
    }
    for (const selector of ['body', '.clock-stage', '.clock-center', '.next-card', 'dialog']) {
      await expect(page.locator(selector)).toHaveCSS('background-color', paper);
    }
    for (const color of ['#ff0000', '#00ff00', '#0000ff', '#808080']) {
      await hex.fill(color);
      await hex.press('Tab');
      const shades = await page.evaluate(() => [
        getComputedStyle(document.body).color,
        getComputedStyle(document.querySelector('.next-card')!).backgroundColor,
        getComputedStyle(document.querySelector('.grid-hour')!).stroke,
        getComputedStyle(document.querySelector('.grid-half')!).stroke,
        getComputedStyle(document.querySelector('.event-label')!).fill,
        getComputedStyle(document.querySelector('#center-date')!).color,
        getComputedStyle(document.querySelector('.duration-label')!).fill,
        getComputedStyle(document.querySelector('.icon-button')!).borderTopColor,
      ].map(color => color.match(/[\d.]+/g)!.slice(0, 3).map(Number)));
      for (const channels of shades) expect(new Set(channels).size).toBe(1);
      await expect(page.locator('[data-event="design"] .event-slice')).toHaveAttribute('fill', originalSlice!);
      if (theme === 'dark') await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    }
  }
});

test('sample palette refreshes old defaults while retaining custom calendar colors', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('calendar-pie-settings')) localStorage.setItem('calendar-pie-settings', JSON.stringify({
      colors: { work: '#CEDDBC', personal: '#123456', wellbeing: '#c8c3df' },
    }));
  });
  await page.goto('/');
  await expect(page.locator('[data-event="design"] .event-slice')).toHaveAttribute('fill', '#abd884');
  await expect(page.locator('[data-event="lunch"] .event-slice')).toHaveAttribute('fill', '#123456');
  await expect(page.locator('[data-event="stretch"] .event-slice')).toHaveAttribute('fill', '#af9bec');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Work color').fill('#ceddbc');
  await page.getByLabel('Work color').dispatchEvent('change');
  await page.reload();
  await expect(page.locator('[data-event="design"] .event-slice')).toHaveAttribute('fill', '#ceddbc');
});

test('bundled fonts load locally and font selection survives reload', async ({ page }) => {
  const fontRequests: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'font') fontRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#clock .hour-label')).toHaveCount(12);
  await expect(page.locator('html')).toHaveAttribute('data-font', 'inter');
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family.includes('Inter Variable') && font.status === 'loaded'))).toBe(true);
  await expect(page.locator('#center-time')).toHaveCSS('font-family', /Inter Variable/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#setting-font').selectOption('open-sans');
  await expect(page.locator('html')).toHaveAttribute('data-font', 'open-sans');
  await expect(page.locator('#center-time')).toHaveCSS('font-family', /Open Sans Variable/);
  await page.reload();
  await expect(page.locator('#clock .hour-label')).toHaveCount(12);
  await expect(page.locator('html')).toHaveAttribute('data-font', 'open-sans');
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family.includes('Open Sans Variable') && font.status === 'loaded'))).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#setting-font')).toHaveValue('open-sans');
  expect(fontRequests.length).toBeGreaterThan(0);
  expect(fontRequests.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
});

test('custom font persists in browser storage and bad replacements preserve it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#custom-font-file').setInputFiles(customFont);
  await expect(page.locator('#font-status')).toHaveText(`Saved locally: ${customFontName}`);
  await expect(page.locator('#setting-font')).toHaveValue('custom');
  await expect(page.locator('#center-time')).toHaveCSS('font-family', /Calendar Pie Custom/);
  await page.reload();
  await expect(page.locator('#clock .hour-label')).toHaveCount(12);
  await expect(page.locator('html')).toHaveAttribute('data-font', 'custom');
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family.includes('Calendar Pie Custom') && font.status === 'loaded'))).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#font-status')).toHaveText(`Saved locally: ${customFontName}`);
  await page.locator('#custom-font-file').setInputFiles({ name: 'broken.woff2', mimeType: 'font/woff2', buffer: Buffer.from('invalid font bytes') });
  await expect(page.locator('#font-status')).toContainText('could not be read as a font');
  await expect(page.locator('#setting-font')).toHaveValue('custom');
  await expect(page.locator('#center-time')).toHaveCSS('font-family', /Calendar Pie Custom/);
  await page.reload();
  await expect(page.locator('#clock .hour-label')).toHaveCount(12);
  await expect(page.locator('html')).toHaveAttribute('data-font', 'custom');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#font-status')).toHaveText(`Saved locally: ${customFontName}`);
});

test('hour and half-hour grid follows the dial span', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#clock .grid-hour-stub')).toHaveCount(12);
  await expect(page.locator('#clock .grid-hour')).toHaveCount(12);
  await expect(page.locator('#clock .grid-half')).toHaveCount(12);
  await expect(page.locator('#clock .grid-hour').first()).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('#clock .grid-half').first()).toHaveCSS('pointer-events', 'none');
  const contrasts = await page.evaluate(() => {
    const luminance = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3)
      .map(Number).map(channel => channel / 255)
      .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const background = luminance(getComputedStyle(document.querySelector('.dial-background')!).fill);
    return ['.grid-hour', '.grid-half'].map(selector => {
      const line = luminance(getComputedStyle(document.querySelector(selector)!).stroke);
      return (Math.max(background, line) + .05) / (Math.min(background, line) + .05);
    });
  });
  expect(contrasts[1]).toBeLessThan(contrasts[0]);
  await page.getByRole('button', { name: '24h', exact: true }).click();
  await expect(page.locator('#clock .grid-hour')).toHaveCount(24);
  await expect(page.locator('#clock .grid-hour-stub')).toHaveCount(24);
  await expect(page.locator('#clock .grid-half')).toHaveCount(24);
  await page.getByRole('button', { name: '12h', exact: true }).click();
  await expect(page.locator('#clock .grid-hour')).toHaveCount(12);
  await expect(page.locator('#clock .grid-half')).toHaveCount(12);
});

test('true-black theme covers the clock and dialog and persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#setting-theme').selectOption('dark');
  for (const selector of ['body', '.clock-stage', '.clock-center', 'dialog']) {
    await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  }
  await expect(page.locator('.dial-background')).toHaveCSS('fill', 'rgb(0, 0, 0)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#setting-theme')).toHaveValue('dark');
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await page.screenshot({ path: 'artifacts/dark-settings.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'artifacts/dark-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 720, height: 720 });
  await page.goto('/?kiosk=1');
  await expect(page.locator('#clock .hour-label')).toHaveCount(12);
  await expect(page.locator('.dial-background')).toHaveCSS('fill', 'rgb(0, 0, 0)');
  await page.screenshot({ path: 'artifacts/dark-720.png' });
});
