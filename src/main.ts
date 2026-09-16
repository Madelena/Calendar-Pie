import './style.css';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/open-sans/wght.css';
import { angleAt, angleInWindow, arcPath, clockWindow, hasClockChange, layoutEvents, nextEvent, point, remainingArc, rollingWindow, sectorPath, validTimed } from './clock.ts';
import type { CalendarEvent, Span } from './clock.ts';
import { calendars, sampleEvents, sampleNow } from './sample.ts';
import type { Scenario } from './sample.ts';
import { countdownText, wrapTitle } from './labels.ts';
import { historyMask } from './history.ts';
import { dialLabels } from './dial-labels.ts';
import { timeParts } from './time.ts';
import { durationSegments } from './durations.ts';
import type { DurationSegment } from './durations.ts';
import { fontStack, loadFont, installCustomFont, customFontName } from './fonts.ts';
import type { FontChoice } from './fonts.ts';
import { api, safeColor } from './api.ts';
import type { CalendarSource, EventResponse, SourceCalendar } from './api.ts';

const params = new URLSearchParams(location.search);
const kiosk = params.get('kiosk') === '1';
const diagnostics = params.get('diagnostics') === '1';
document.body.classList.toggle('kiosk', kiosk);
interface Settings { span: Span; format: '12' | '24'; historyHours: number; theme: 'light' | 'dark'; font: FontChoice; accentColor: string; samplePaletteVersion: number; colors: Record<string, string> }
let saved: Partial<Settings> = {};
try { saved = JSON.parse(localStorage.getItem('calendar-pie-settings') || '{}') ?? {}; } catch { /* Storage is optional. */ }
const settings: Settings = {
  samplePaletteVersion: 1,
  span: saved.span === 24 ? 24 : 12,
  format: saved.format === '24' ? '24' : '12',
  theme: saved.theme === 'dark' ? 'dark' : 'light',
  accentColor: /^#[0-9a-f]{6}$/i.test(saved.accentColor ?? '') ? saved.accentColor! : '#C30052',
  font: saved.font && ['inter', 'open-sans', 'system', 'custom'].includes(saved.font) ? saved.font : 'inter',
  historyHours: typeof saved.historyHours === 'number' && Number.isInteger(saved.historyHours) ? Math.max(0, Math.min(saved.span === 24 ? 23 : 11, saved.historyHours)) : 3,
  colors: Object.fromEntries(calendars.map(calendar => {
    const color = saved.colors?.[calendar.id];
    const previousDefaults: Record<string, string> = { work: '#ceddbc', personal: '#e9bb9f', wellbeing: '#c8c3df' };
    const valid = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
    const oldDefault = !saved.samplePaletteVersion && valid && color.toLowerCase() === previousDefaults[calendar.id];
    return [calendar.id, valid && !oldDefault ? color : calendar.color];
  })),
};
let scenario: Scenario = 'everyday';
let live = false;
let offset = 0;
let now = sampleNow(scenario);
let events = sampleEvents(now, scenario);
let sourcePreference: 'sample' | 'real' | null = null;
try { const value = localStorage.getItem('calendar-pie-source'); if (value === 'sample' || value === 'real') sourcePreference = value; } catch { /* Optional storage. */ }
let realMode = sourcePreference === 'real';
let realCalendars: SourceCalendar[] = [];
let realEvents: CalendarEvent[] = [];
let sourceCalendars: CalendarSource[] = [];
let serviceTimezone = '';
let cacheRange: EventResponse['cacheRange'] = null;
let networkError = '';
let loadedRealData = false;
let requestedRange = '';
let requestVersion = 0;
let sourceBusy = false;
let serviceMessage = '';
let ringSegments: DurationSegment[] = [];
let timer: ReturnType<typeof setTimeout>;
let lastFocus: Element | null = null;
let renderCount = 0;
let renderTotal = 0;
let renderMax = 0;
let interactionCount = 0;
let interactionMax = 0;
const started = performance.now();
let fontBusy = false;
let fontStatus = 'Bundled fonts work offline. Custom files stay in this browser.';

function applyAppearance() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.font = settings.font;
  document.documentElement.style.setProperty('--app-font', fontStack(settings.font));
  const [red, green, blue] = settings.accentColor.slice(1).match(/../g)!.map(channel => parseInt(channel, 16) / 255);
  const luminance = [red, green, blue]
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  document.documentElement.style.setProperty('--green', settings.accentColor);
  document.documentElement.style.setProperty('--strong-background', settings.accentColor);
  document.documentElement.style.setProperty('--strong-ink', luminance > .179 ? '#000000' : '#ffffff');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.body).backgroundColor);
}
applyAppearance();

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const icon = (name: 'settings' | 'left' | 'right' | 'close' | 'arrow') => {
  const paths = {
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>', arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
};
const time = (date: Date) => timeParts(date, settings.format, hasClockChange(clockWindow(date, 24)) ? 'shortOffset' : undefined).map(part => part.value).join('');
const dateText = (date: Date) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
const calendarFor = (event: CalendarEvent) => (realMode ? realCalendars : calendars).find(calendar => calendar.id === event.calendarId) ?? { id: event.calendarId, name: 'Calendar', color: '#BFA9DF' };
const colorFor = (event: CalendarEvent) => realMode ? safeColor(calendarFor(event).color) : settings.colors[event.calendarId];
const darkColor = (color: string) => `#${color.slice(1).match(/../g)!.map(channel => Math.round(parseInt(channel, 16) * .4).toString(16).padStart(2, '0')).join('')}`;
const edgeTime = (date: Date) => timeParts(date, settings.format).filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim();
const duration = (minutes: number) => minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
const titleMeasure = document.createElement('canvas').getContext('2d');

function fitTitle(title: string, availableLength: number, maxLines: number): string[] {
  for (let capacity = Math.min(Array.from(title).length, Math.floor(availableLength / 4)); capacity > 0; capacity--) {
    const lines = wrapTitle(title, capacity, maxLines);
    if (lines.every(line => (titleMeasure?.measureText(line).width ?? line.length * 8) <= availableLength)) return lines;
  }
  return [];
}

function eventRim(event: CalendarEvent, start: number, end: number, outer: number, band: number, id: number, before: boolean, after: boolean): string {
  const radius = outer - band / 2;
  const length = (end - start) * Math.PI / 180 * radius;
  const reverse = (start + end) / 2 % 360 > 90 && (start + end) / 2 % 360 < 270;
  const times = [`${before ? '←' : ''}${edgeTime(event.start)}`, `${edgeTime(event.end)}${after ? '→' : ''}`];
  const pieces = [`<path class="event-rim" fill="${darkColor(colorFor(event))}" d="${sectorPath(start, end, outer - band, outer - 1)}"/>`];
  if (length >= times.join('').length * 6.5 + 14 && band >= 16) {
    const labels = reverse ? [...times].reverse() : times;
    const inset = 5 / length * 100;
    pieces.push(`<path id="rim-${id}" d="${arcPath(start, end, radius, reverse)}" fill="none"/>`);
    labels.forEach((label, index) => pieces.push(`<text class="event-edge-time" dy="4" text-anchor="${index ? 'end' : 'start'}"><textPath href="#rim-${id}" startOffset="${index ? 100 - inset : inset}%">${escape(label)}</textPath></text>`));
  } else if (length >= Math.max(...times.map(value => value.length)) * 5.8 + 6 && band >= 23) {
    times.forEach((label, index) => {
      const lineRadius = radius + (index === 0 ? 5.5 : -5.5) * (reverse ? -1 : 1);
      pieces.push(`<path id="rim-${id}-${index}" d="${arcPath(start, end, lineRadius, reverse)}" fill="none"/><text class="event-edge-time" style="font-size:10px" dy="3" text-anchor="middle"><textPath href="#rim-${id}-${index}" startOffset="50%">${escape(label)}</textPath></text>`);
    });
  }
  return pieces.join('');
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="Calendar Pie home"><svg class="brand-icon" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="20" fill="var(--strong-background)"/><path d="M32 12a20 20 0 1 0 20 20H32Z" fill="var(--strong-ink)"/><path d="M38 10v16h16A20 20 0 0 0 38 10" fill="var(--strong-ink)" opacity=".55"/></svg>calendar pie<span class="brand-dot">.</span></a>
    <div class="header-right"><span class="sample-badge">Sample calendars</span><button class="icon-button" data-action="settings" aria-label="Settings">${icon('settings')}</button></div>
  </header>
  <main>
    <div class="workspace">
      <section class="clock-column" aria-label="Calendar clock">
        <div class="clock-toolbar"><div class="window-navigation"><button class="icon-button" data-action="previous" aria-label="Previous clock window">${icon('left')}</button><button id="window-label" data-action="today" title="Return to current clock window"></button><button class="icon-button" data-action="next" aria-label="Next clock window">${icon('right')}</button></div><div class="segmented" aria-label="Dial span"><button data-span="12">12h</button><button data-span="24">24h</button></div></div>
        <div class="clock-stage" id="clock-stage">
          <svg id="clock" viewBox="0 0 720 720" role="group" tabindex="-1" aria-label="Clock with calendar events"></svg>
          <div class="clock-center" aria-label="Current time and date"><div class="center-clock"><span id="center-time"></span><sup id="center-period" class="center-period"></sup></div><span id="center-date"></span></div>
          <span class="dial-sample-label" id="dial-sample-label"></span>
        </div>
        <div class="calendar-legend">${calendars.map(calendar => `<span><i data-color="${calendar.id}"></i>${calendar.name}</span>`).join('')}</div>
      </section>
      <aside class="day-panel" aria-label="Daily agenda">
        <div class="day-heading"><p class="eyebrow" id="agenda-date"></p></div>
        <div class="next-card" id="next-card"></div>
        <div class="agenda-heading"><h3>On the calendar</h3><span id="event-count"></span></div>
        <div id="agenda" class="agenda"></div>
      </aside>
    </div>
    <section class="preview-tools" aria-label="Preview controls"><div class="preview-inputs"><label>Sample day<select id="scenario"><option value="everyday">Everyday</option><option value="overlap">Overlapping events</option><option value="overnight">Overnight</option><option value="empty">No events</option></select></label><button id="live-toggle" class="text-button" data-action="live"></button><a class="text-button" href="?kiosk=1">Round display ${icon('arrow')}</a></div></section>
    <details id="diagnostics" class="diagnostics" ${diagnostics ? 'open' : 'hidden'}><summary>Rendering diagnostics</summary><pre id="metrics"></pre><p>Browser measurements only. Device RAM and end-to-end touch latency need the hardware test.</p></details>
  </main>
  <dialog id="dialog" aria-labelledby="dialog-title"><button class="dialog-back text-button" data-action="back" hidden>${icon('left')}Back</button><div class="dialog-content" id="dialog-content"></div><button class="dialog-close icon-button" data-action="close" aria-label="Close">${icon('close')}</button></dialog>
`;

const svg = document.querySelector<SVGSVGElement>('#clock')!;
const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
const content = document.querySelector<HTMLDivElement>('#dialog-content')!;
const backButton = dialog.querySelector<HTMLButtonElement>('.dialog-back')!;
let configurationBack: 'close' | 'settings' | 'sources' = 'close';
document.getElementById('scenario')!.insertAdjacentHTML('beforeend', '<option value="segments">Overlap duration example</option>');
const text = (id: string, value: string) => { document.getElementById(id)!.textContent = value; };

function save() {
  try { localStorage.setItem('calendar-pie-settings', JSON.stringify(settings)); } catch { /* Private/kiosk browsing may disable storage. */ }
}

function render() {
  const start = performance.now();
  if (titleMeasure) titleMeasure.font = `500 15px ${fontStack(settings.font)}`;
  const focusedEvent = document.activeElement?.getAttribute('data-event');
  now = realMode || live ? new Date() : sampleNow(scenario);
  events = realMode ? realEvents : sampleEvents(now, scenario);
  const window = rollingWindow(now, settings.span, settings.historyHours, offset);
  const changedClock = hasClockChange(window);
  svg.dataset.dialSpan = String(settings.span);
  const activeIds = new Set(events.filter(event => validTimed(event) && +event.start <= +now && +event.end > +now).map(event => event.id));
  ringSegments = changedClock ? [] : durationSegments(events, window).filter(segment =>
    !segment.eventIds.some(id => activeIds.has(id))
    && (segment.eventIds.length > 0 || +now < +segment.start || +now >= +segment.end));
  const parts: string[] = ['<circle cx="360" cy="360" r="354" class="dial-background"/>'];
  const fade = !changedClock && offset === 0 && settings.historyHours > 0;
  if (fade) parts.push(historyMask(angleInWindow(window.start, window), angleInWindow(now, window)));
  const historyAttribute = fade ? ' mask="url(#event-history)"' : '';
  parts.push(`<g class="radial-grid" aria-hidden="true"${historyAttribute}>`);
  for (let index = 0; index < settings.span * 2; index++) {
    const angle = index * 180 / settings.span;
    parts.push(`<path class="${index % 2 ? 'grid-half' : 'grid-hour'}" d="M ${point(angle, 153)} L ${point(angle, 321)}"/>`);
  }
  parts.push('</g>');
  const markings: string[] = [];
  markings.push(`<g class="clock-markings"${historyAttribute}><circle cx="360" cy="360" r="354" class="dial-outline"/>`);
  for (let index = 0; index < 60; index++) {
    const major = index % 5 === 0;
    markings.push(`<path d="M ${point(index * 6, major ? 347 : 350)} L ${point(index * 6, 352)}" class="${major ? 'tick-major' : 'tick'}"/>`);
  }
  const numerals = dialLabels(window, settings.format);
  const hourLabels: string[] = [];
  if (titleMeasure) titleMeasure.font = `450 14px ${fontStack(settings.font)}`;
  for (const numeral of numerals) {
    const label = `${numeral.hour}${numeral.period ? ` ${numeral.period}` : ''}`;
    const metrics = titleMeasure?.measureText(label);
    const halfWidth = (metrics?.width ?? label.length * 9) / 2 + 1;
    const halfHeight = Math.max(9, ((metrics?.fontBoundingBoxAscent ?? 9) + (metrics?.fontBoundingBoxDescent ?? 3)) / 2 + 2);
    const radians = numeral.angle * Math.PI / 180;
    const projection = Math.abs(Math.sin(radians)) * halfWidth + Math.abs(Math.cos(radians)) * halfHeight;
    // Keep the complete label inside the event ring, including wide AM/PM suffixes.
    const radius = Math.min(141, Math.sqrt(projection ** 2 + 149 ** 2 - halfWidth ** 2 - halfHeight ** 2) - projection);
    const [x, y] = point(numeral.angle, radius);
    // Fade each label as a whole: the angular mask can bisect a future label at the seam.
    const opacity = fade && +numeral.date < +now ? Math.max(0, (+numeral.date - +window.start) / (+now - +window.start)) : 1;
    hourLabels.push(`<text x="${x}" y="${y}" class="hour-label" opacity="${opacity}" dominant-baseline="central" aria-label="${numeral.accessibleLabel}">${numeral.hour}${numeral.period ? `<tspan class="hour-period"> ${numeral.period}</tspan>` : ''}</text>`);
  }
  if (titleMeasure) titleMeasure.font = `500 15px ${fontStack(settings.font)}`;
  markings.push('<circle cx="360" cy="360" r="321" class="event-boundary"/><circle cx="360" cy="360" r="153" class="event-boundary"/>');
  markings.push('</g>');
  parts.push(`<g class="event-layer"${historyAttribute}>`);
  if (!changedClock) {
    layoutEvents(events, window).forEach((segment, index) => {
      const width = 163 / segment.lanes;
      const outer = 318 - segment.lane * width;
      const inner = outer - width + 3;
      const band = Math.min(24, (outer - inner) * .4);
      const titleOuter = outer - band - 4;
      const mid = (segment.start + segment.end) / 2;
      const radius = (inner + titleOuter) / 2;
      const accessibleName = `${segment.event.title}, ${time(segment.event.start)} to ${time(segment.event.end)}, ${calendarFor(segment.event).name}${segment.continuesBefore || segment.continuesAfter ? ', continues outside this view' : ''}`;
      parts.push(`<g class="event-group" role="button" tabindex="0" data-event="${escape(segment.event.id)}" aria-label="${escape(accessibleName)}"><title>${escape(accessibleName)}</title><path class="event-slice" fill="${colorFor(segment.event)}" d="${sectorPath(segment.start, segment.end, inner, outer)}"/>`);
      parts.push(eventRim(segment.event, segment.start, segment.end, outer, band, index, segment.continuesBefore, segment.continuesAfter));
      const hitWidth = Math.max(0, 44 / radius * 180 / Math.PI - (segment.end - segment.start)) / 2;
      parts.push(`<path class="event-hit" d="${sectorPath(Math.max(angleInWindow(window.start, window), segment.start - hitWidth), Math.min(angleInWindow(window.end, window), segment.end + hitWidth), inner, outer)}"/>`);
      const maxLines = Math.min(4, Math.floor((titleOuter - inner - 2) / 16));
      const availableLength = (segment.end - segment.start - 2) * Math.PI / 180 * (radius - Math.max(0, maxLines - 1) * 8) - 6;
      const lines = maxLines > 0 && availableLength >= 20 ? fitTitle(segment.event.title, availableLength, maxLines) : [];
      // Fit an upright rectangle along the radius, inside both the wedge sides and curved edges.
      const halfAngle = Math.max(0, (segment.end - segment.start) / 2 - .8) * Math.PI / 180;
      const radialInner = inner + 6;
      const radialLineCount = Math.min(4, Math.floor((2 * radialInner * Math.tan(halfAngle) - 4) / 16));
      const radialOuter = Math.sqrt(Math.max(0, (titleOuter - 4) ** 2 - (radialLineCount * 8) ** 2));
      const radialWidth = radialOuter - radialInner;
      const radialLines = segment.end - segment.start <= 22.5 && radialLineCount > 0 && radialWidth > availableLength * 1.15
        ? fitTitle(segment.event.title, radialWidth, radialLineCount) : [];
      const characters = (value: string[]) => Array.from(value.join('').replace(/[\s…]/g, '')).length;
      const useRadial = radialLines.length > 0 && (characters(radialLines) > characters(lines)
        || characters(radialLines) === characters(lines) && radialLines.length < lines.length);
      if (useRadial) {
        const [x, y] = point(mid, (radialInner + radialOuter) / 2);
        // Equivalent radial directions differ by 180 degrees; choose the upright one on either side.
        const rotation = mid % 180 - 90;
        parts.push(`<g class="radial-title" transform="translate(${x} ${y}) rotate(${rotation})"><text class="event-label radial-label">${radialLines.map((line, lineIndex) => `<tspan x="0" y="${(lineIndex - (radialLines.length - 1) / 2) * 16 + 5}">${escape(line)}</tspan>`).join('')}</text></g>`);
      } else if (lines.length) {
        const reverse = mid % 360 > 90 && mid % 360 < 270;
        lines.forEach((line, lineIndex) => {
          const lineRadius = radius + ((lines.length - 1) / 2 - lineIndex) * 16 * (reverse ? -1 : 1);
          parts.push(`<path id="label-${index}-${lineIndex}" d="${arcPath(segment.start + 1, segment.end - 1, lineRadius, reverse)}" fill="none"/><text class="event-label" dy="5"><textPath href="#label-${index}-${lineIndex}" startOffset="50%">${escape(line)}</textPath></text>`);
        });
      }
      for (const [continues, angle] of [[segment.continuesBefore, segment.start + 2], [segment.continuesAfter, segment.end - 2]] as const) {
        if (continues) parts.push(`<circle cx="${point(angle, radius)[0]}" cy="${point(angle, radius)[1]}" r="3" class="continuation"/>`);
      }
      parts.push('</g>');
    });
  }
  parts.push('</g>');
  parts.push(`<g class="radial-stubs"${historyAttribute}>`);
  for (let hour = 0; hour < settings.span; hour++) {
    const angle = hour * 360 / settings.span;
    parts.push(`<path class="grid-hour-stub" aria-hidden="true" d="M ${point(angle, 151)} L ${point(angle, 162)}"/>`);
  }
  parts.push('</g>');
  const arc = remainingArc(events, now, window);
  const sharesRing = arc && ringSegments.some(segment => segment.startAngle < arc.end && segment.endAngle > arc.start);
  const eventDurationRadius = sharesRing ? 343 : 336;
  const countdownRadius = sharesRing ? 329 : 336;
  parts.push(`<g class="duration-layer"${fade ? ' mask="url(#event-history)"' : ''}>`);
  ringSegments.forEach((segment, index) => {
    const label = countdownText(+segment.end - +segment.start);
    const gap = segment.eventIds.length === 0;
    const titles = gap ? `Free time, ${time(segment.start)} to ${time(segment.end)}` : segment.eventIds.map(id => events.find(event => event.id === id)!.title).join(', ');
    const middle = (segment.startAngle + segment.endAngle) / 2;
    const length = (segment.endAngle - segment.startAngle) * Math.PI / 180 * eventDurationRadius;
    const path = arcPath(segment.startAngle, segment.endAngle, eventDurationRadius);
    parts.push(`<g class="duration-segment${gap ? ' duration-gap' : ''}" role="button" tabindex="0" data-duration="${index}" aria-label="${label} · ${escape(titles)}"><title>${label} · ${escape(titles)}</title><path class="duration-hit" d="${path}"/><path class="duration-arc" d="${path}"/>`);
    for (const angle of [segment.startAngle, segment.endAngle]) parts.push(`<path class="duration-boundary" d="M ${point(angle, eventDurationRadius - 3)} L ${point(angle, eventDurationRadius + 3)}"/>`);
    if (length >= label.length * 7 + 6) {
      parts.push(`<path id="duration-${index}" d="${arcPath(segment.startAngle, segment.endAngle, eventDurationRadius, middle % 360 > 90 && middle % 360 < 270)}" fill="none"/><text class="duration-label" dy="4"><textPath href="#duration-${index}" startOffset="50%">${label}</textPath></text>`);
    } else {
      const [x, y] = point(middle, eventDurationRadius);
      parts.push(`<circle class="duration-compact" cx="${x}" cy="${y}" r="2"/>`);
    }
    parts.push('</g>');
  });
  parts.push('</g>');
  if (arc) {
    parts.push(`<path class="remaining-arc" d="${arcPath(arc.start, arc.end, countdownRadius)}"/><circle cx="${point(arc.end, countdownRadius)[0]}" cy="${point(arc.end, countdownRadius)[1]}" r="3" class="remaining-dot"/>`);
  }
  if (+now >= +window.start && +now < +window.end) {
    parts.push(`<path class="hour-hand-shadow" d="M ${point(angleAt(now, settings.span), 128)} L ${point(angleAt(now, settings.span), countdownRadius + 3)}"/><path class="hour-hand" d="M ${point(angleAt(now, settings.span), 128)} L ${point(angleAt(now, settings.span), countdownRadius + 3)}"/><circle cx="${point(angleAt(now, settings.span), countdownRadius + 3)[0]}" cy="${point(angleAt(now, settings.span), countdownRadius + 3)[1]}" r="4" class="hand-dot"/>`);
  }
  parts.push(markings.join(''));
  if (!changedClock) {
    const boundary = angleInWindow(window.end, window);
    parts.push(`<path class="window-boundary" aria-hidden="true" d="M ${point(boundary, 153)} L ${point(boundary, 352)}"/>`);
  }
  parts.push(`<g class="clock-numerals">${hourLabels.join('')}</g>`);
  if (arc) {
    const label = countdownText(+arc.target - +now);
    const middle = (arc.start + arc.end) / 2;
    // Extend only the invisible label guide for short gaps; the arc still encodes the exact duration.
    const half = Math.max((arc.end - arc.start) / 2, label.length * 8 / countdownRadius * 180 / Math.PI / 2 + 1);
    parts.push(`<path id="remaining-label-guide" d="${arcPath(middle - half, middle + half, countdownRadius, middle % 360 > 90 && middle % 360 < 270)}" fill="none"/><text class="remaining-label" dy="4" aria-label="${label} until ${escape(arc.event.title)} ${+arc.event.start <= +now ? 'ends' : 'starts'}"><textPath href="#remaining-label-guide" startOffset="50%">${label}</textPath></text>`);
  }
  svg.innerHTML = parts.join('');
  if (focusedEvent && !dialog.open) svg.querySelector<SVGGElement>(`[data-event="${CSS.escape(focusedEvent)}"]`)?.focus();
  const currentTimeParts = timeParts(now, settings.format);
  text('center-time', currentTimeParts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim());
  text('center-period', settings.format === '12' ? currentTimeParts.find(part => part.type === 'dayPeriod')?.value ?? '' : '');
  text('center-date', dateText(now));
  const period = `${time(window.start)} — ${time(window.end)}`;
  text('dial-sample-label', changedClock ? 'Clock change · view desktop agenda' : offset !== 0 ? `VIEWING ${dateText(window.start)} · ${period}` : live ? 'SAMPLE CALENDARS · LIVE TIME' : 'SAMPLE DAY · PAUSED');
  text('window-label', `${offset === 0 ? '' : `${dateText(window.start)} · `}${period}`);
  document.querySelectorAll<HTMLButtonElement>('[data-span]').forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.span) === settings.span));
  });
  document.querySelectorAll<HTMLElement>('[data-color]').forEach(dot => { dot.style.backgroundColor = settings.colors[dot.dataset.color!]; });
  renderAgenda(offset === 0 ? now : window.start);
  text('live-toggle', live ? 'Use sample time' : 'Use current time');
  renderServiceStatus();
  if (realMode) void loadRealEvents();
  const elapsed = performance.now() - start;
  renderCount++;
  renderTotal += elapsed;
  renderMax = Math.max(renderMax, elapsed);
  renderMetrics();
  clearTimeout(timer);
  // A paused sample has no recurring work. Live mode wakes once per minute.
  if (realMode || live) timer = setTimeout(render, 60000 - Date.now() % 60000 + 20);
}

function renderAgenda(day: Date) {
  const next = nextEvent(events, now);
  text('agenda-date', dateText(day).toUpperCase());
  document.getElementById('next-card')!.innerHTML = next ? `<p class="eyebrow">UP NEXT <span>IN ${duration(Math.ceil((+next.start - +now) / 60000)).toUpperCase()}</span></p><button data-event="${escape(next.id)}"><span><strong>${escape(next.title)}</strong><span class="next-time">${escape(time(next.start))} <span>—</span> ${escape(time(next.end))}</span></span>${icon('arrow')}</button>` : '<p class="next-time">No upcoming events.</p>';
  const window = clockWindow(day, 24);
  const today = events.filter(event => validTimed(event) && +event.start < +window.end && +event.end > +window.start).sort((a, b) => +a.start - +b.start);
  text('event-count', `${today.length} plans`);
  document.getElementById('agenda')!.innerHTML = today.length ? today.map(event => {
    const status = +event.end <= +now ? 'past' : +event.start <= +now ? 'active' : '';
    return `<button class="agenda-item ${status}" data-event="${escape(event.id)}"><span class="agenda-time">${escape(time(event.start))}</span><span class="agenda-dot" style="background:${colorFor(event)}"></span><span class="agenda-info"><strong>${escape(event.title)}</strong><span>${escape(calendarFor(event).name)} <span>·</span> ${duration(Math.round((+event.end - +event.start) / 60000))}${status === 'active' ? ' · Now' : ''}</span></span>${icon('right')}</button>`;
  }).join('') : '<p class="empty-agenda">No events.</p>';
}

function renderMetrics() {
  if (!diagnostics) return;
  const metrics = JSON.stringify({ renders: renderCount, meanRenderMs: +(renderTotal / renderCount).toFixed(2), maxRenderMs: +renderMax.toFixed(2), interactions: interactionCount, maxInteractionFrameMs: +interactionMax.toFixed(2), uptimeSeconds: Math.round((performance.now() - started) / 1000), svgElements: svg.querySelectorAll('*').length, mode: live ? 'live' : 'paused sample' }, null, 2);
  text('metrics', metrics);
  const dialogMetrics = document.getElementById('dialog-metrics');
  if (dialogMetrics) dialogMetrics.textContent = metrics;
}

function openDialog(html: string, eventDetails = false, configuration = false) {
  if (!dialog.open) lastFocus = document.activeElement;
  dialog.classList.toggle('configuration-dialog', configuration);
  backButton.hidden = !configuration;
  content.classList.toggle('event-details', eventDetails);
  content.innerHTML = html;
  if (!dialog.open) dialog.showModal();
  content.scrollTop = 0;
}

function openConfiguration(html: string, back: typeof configurationBack = 'settings') {
  if (kiosk) return;
  configurationBack = back;
  openDialog(html, false, true);
}

function openEvent(id: string) {
  const event = events.find(item => item.id === id);
  if (!event) return;
  const calendar = calendarFor(event);
  openDialog(`<p class="eyebrow event-calendar"><i style="background:${colorFor(event)}"></i>${escape(calendar.name)}</p><h2 id="dialog-title">${escape(event.title)}</h2><p class="detail-date">${escape(dateText(event.start))}</p><p class="detail-time">${escape(time(event.start))} — ${escape(time(event.end))}${event.start.toDateString() !== event.end.toDateString() ? `<br><small>Ends ${escape(dateText(event.end))}</small>` : ''}</p><span class="duration-badge">${duration(Math.round((+event.end - +event.start) / 60000))}</span>${event.location ? `<p class="detail-location">${escape(event.location)}</p>` : ''}${event.description ? `<p class="detail-description">${escape(event.description)}</p>` : ''}`, true);
}

function openDuration(index: number) {
  const segment = ringSegments[index];
  if (!segment) return;
  if (!segment.eventIds.length) {
    openDialog(`<p class="eyebrow">Between events</p><h2 id="dialog-title">Free time</h2><p class="detail-date">${escape(dateText(segment.start))}</p><p class="detail-time">${escape(time(segment.start))} — ${escape(time(segment.end))}${segment.start.toDateString() !== segment.end.toDateString() ? `<br><small>Ends ${escape(dateText(segment.end))}</small>` : ''}</p><span class="duration-badge">${duration(Math.round((+segment.end - +segment.start) / 60000))}</span><p class="detail-description">No events scheduled in this interval.</p>`, true);
    return;
  }
  if (segment.eventIds.length === 1) { openEvent(segment.eventIds[0]); return; }
  const items = segment.eventIds.map(id => events.find(event => event.id === id)!);
  openDialog(`<p class="eyebrow">${escape(time(segment.start))} — ${escape(time(segment.end))} · ${countdownText(+segment.end - +segment.start)}</p><h2 id="dialog-title">Overlapping events</h2><div class="dialog-agenda">${items.map(event => `<button data-event="${escape(event.id)}"><strong>${escape(event.title)}</strong><span>${escape(time(event.start))} — ${escape(time(event.end))}</span></button>`).join('')}</div>`);
}

function openSettings() {
  if (kiosk) return;
  openConfiguration(`<h2 id="dialog-title">Settings</h2><div class="settings-fields"><label>Hours around the dial<select id="setting-span"><option value="12" ${settings.span === 12 ? 'selected' : ''}>12 hours</option><option value="24" ${settings.span === 24 ? 'selected' : ''}>24 hours</option></select></label><label>Time format<select id="setting-format"><option value="12" ${settings.format === '12' ? 'selected' : ''}>12-hour · 2:30 PM</option><option value="24" ${settings.format === '24' ? 'selected' : ''}>24-hour · 14:30</option></select></label><fieldset><legend>Calendar colors</legend>${calendars.map(calendar => `<label class="color-setting">${calendar.name}<input type="color" data-calendar="${calendar.id}" value="${settings.colors[calendar.id]}" aria-label="${calendar.name} color"/></label>`).join('')}</fieldset><button class="text-button" data-action="live">${live ? 'Use sample time' : 'Use current time'}</button><p class="settings-note">Clock preferences stay in this browser.</p></div>`, 'close');
  const fields = content.querySelector('.settings-fields')!;
  if (realMode) {
    fields.querySelector('fieldset')?.remove();
    fields.querySelector('[data-action="live"]')?.remove();
  }
  fields.querySelector('.settings-note')!.textContent = 'Clock preferences stay in this browser. Calendar sources are saved on the local server.';
  fields.insertAdjacentHTML('afterbegin', `<label>Calendar view<select id="calendar-view"><option value="real" ${realMode ? 'selected' : ''}>My calendars</option><option value="sample" ${!realMode ? 'selected' : ''}>Sample preview</option></select></label><button class="text-button" data-action="sources">Manage calendar sources</button><p class="settings-note service-status" role="status"></p>`);
  fields.insertAdjacentHTML('afterbegin', `<fieldset><legend>Accent color</legend><label class="color-setting">Choose a color<input id="setting-accent" type="color" value="${settings.accentColor}" aria-label="Accent color"/></label><label>Hex color<input id="setting-accent-hex" type="text" value="${settings.accentColor}" pattern="#[0-9a-fA-F]{6}" maxlength="7" spellcheck="false" aria-label="Accent hex color"/></label></fieldset>`);
  fields.insertAdjacentHTML('afterbegin', `<label>Theme<select id="setting-theme"><option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Dark · true black</option></select></label><label>Clock font<select id="setting-font"><option value="inter" ${settings.font === 'inter' ? 'selected' : ''}>Inter</option><option value="open-sans" ${settings.font === 'open-sans' ? 'selected' : ''}>Open Sans</option><option value="system" ${settings.font === 'system' ? 'selected' : ''}>System</option><option value="custom" ${settings.font === 'custom' ? 'selected' : ''}>Custom font</option></select></label><label>Import a custom font<input id="custom-font-file" type="file" accept=".ttf,.otf,.woff,.woff2"/><span class="settings-note">TTF, OTF, WOFF or WOFF2 · up to 5 MB</span></label><p id="font-status" class="settings-note" role="status">${escape(fontStatus)}</p>`);
  fields.insertAdjacentHTML('afterbegin', `<label>Hours of fading history<input id="setting-history" type="number" min="0" max="${settings.span - 1}" step="1" value="${settings.historyHours}"/><span class="settings-note">Past hours fade backward from now; the rest of the dial shows upcoming events.</span></label>`);
  fields.insertAdjacentHTML('beforeend', `${diagnostics ? '<details class="dialog-diagnostics"><summary>Rendering diagnostics</summary><pre id="dialog-metrics"></pre><p>Render time is synchronous JavaScript work; interaction timing ends at the next animation-frame callback. Neither measures physical touch-to-display delay.</p></details>' : ''}`);
  renderMetrics();
  updateFontControls();
  renderServiceStatus();
}

function updateFontControls() {
  for (const input of content.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#setting-font, #custom-font-file')) input.disabled = fontBusy;
  const status = document.getElementById('font-status');
  if (status) status.textContent = fontStatus;
}

async function changeFont(choice: FontChoice, file?: File) {
  if (fontBusy) return;
  fontBusy = true;
  fontStatus = 'Loading font…';
  updateFontControls();
  try {
    if (file) await installCustomFont(file);
    await loadFont(choice);
    fontStatus = choice === 'custom' ? `Saved locally: ${file?.name ?? await customFontName() ?? 'Custom font'}` : 'Bundled fonts work offline. Custom files stay in this browser.';
    settings.font = choice;
    applyAppearance();
    save();
    render();
  } catch (error) {
    fontStatus = error instanceof Error ? error.message : 'The font could not be loaded.';
  } finally {
    fontBusy = false;
    const select = content.querySelector<HTMLSelectElement>('#setting-font');
    if (select) select.value = settings.font;
    const fileInput = content.querySelector<HTMLInputElement>('#custom-font-file');
    if (fileInput) fileInput.value = '';
    updateFontControls();
  }
}

dialog.addEventListener('close', () => {
  if (lastFocus instanceof HTMLElement || lastFocus instanceof SVGElement) {
    if (lastFocus.isConnected) lastFocus.focus();
    else svg.focus();
  }
});
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

let suppressClickUntil = 0;
document.addEventListener('click', event => {
  const target = (event.target as Element).closest<HTMLElement>('[data-action], [data-event], [data-span], [data-duration]');
  if (!target || performance.now() < suppressClickUntil) return;
  const start = performance.now();
  if (target.dataset.event) openEvent(target.dataset.event);
  else if (target.dataset.duration !== undefined) openDuration(Number(target.dataset.duration));
  else if (target.dataset.span) {
    settings.span = Number(target.dataset.span) as Span;
    settings.historyHours = Math.min(settings.historyHours, settings.span - 1);
    offset = 0;
    save(); render();
  } else switch (target.dataset.action) {
    case 'settings': openSettings(); break;
    case 'sources': void openSources(); break;
    case 'source-add': editSource(); break;
    case 'source-edit': editSource(target.dataset.id); break;
    case 'source-delete': confirmDelete(target.dataset.id!); break;
    case 'source-delete-confirm': void mutateSource(`/calendars/${encodeURIComponent(target.dataset.id!)}`, 'DELETE'); break;
    case 'source-refresh': void mutateSource(target.dataset.id ? `/calendars/${encodeURIComponent(target.dataset.id)}/refresh` : '/refresh', 'POST', {}); break;
    case 'service-retry': requestedRange = ''; void loadRealEvents(true); break;
    case 'back':
      if (sourceBusy) break;
      if (configurationBack === 'settings') openSettings();
      else if (configurationBack === 'sources') void openSources();
      else dialog.close();
      break;
    case 'close': dialog.close(); break;
    case 'previous': offset--; render(); break;
    case 'next': offset++; render(); break;
    case 'today': offset = 0; render(); if (dialog.open) dialog.close(); break;
    case 'live': live = !live; offset = 0; render(); if (dialog.open) openSettings(); break;
  }
  if (diagnostics) requestAnimationFrame(() => {
    interactionCount++;
    interactionMax = Math.max(interactionMax, performance.now() - start);
    renderMetrics();
  });
});
svg.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = (event.target as Element).closest<SVGElement>('[data-event], [data-duration]');
  if (!target) return;
  event.preventDefault();
  if (target.dataset.event) openEvent(target.dataset.event);
  else openDuration(Number(target.dataset.duration));
});
document.getElementById('scenario')!.addEventListener('change', event => {
  scenario = (event.target as HTMLSelectElement).value as Scenario;
  live = false; offset = 0; render();
});
content.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (input.id === 'calendar-view') { setSourceMode(input.value === 'real'); openSettings(); return; }
  if (input.closest('#source-form')) return;
  if (input.id === 'setting-font') { void changeFont(input.value as FontChoice); return; }
  if (input.id === 'custom-font-file') {
    const file = input.files?.[0];
    if (file) void changeFont('custom', file);
    return;
  }
  if (input.id === 'setting-theme') { settings.theme = input.value === 'dark' ? 'dark' : 'light'; applyAppearance(); }
  if (input.id === 'setting-accent' || input.id === 'setting-accent-hex') {
    if (!/^#[0-9a-f]{6}$/i.test(input.value)) { input.value = settings.accentColor; return; }
    settings.accentColor = input.value.toUpperCase();
    content.querySelector<HTMLInputElement>('#setting-accent')!.value = settings.accentColor;
    content.querySelector<HTMLInputElement>('#setting-accent-hex')!.value = settings.accentColor;
    applyAppearance();
  }
  if (input.id === 'setting-span') { settings.span = Number(input.value) as Span; offset = 0; }
  if (input.id === 'setting-span') {
    settings.historyHours = Math.min(settings.historyHours, settings.span - 1);
    const historyInput = content.querySelector<HTMLInputElement>('#setting-history')!;
    historyInput.max = String(settings.span - 1);
    historyInput.value = String(settings.historyHours);
  }
  if (input.id === 'setting-history') {
    const hours = Number(input.value);
    if (!input.value || !Number.isInteger(hours) || hours < 0 || hours >= settings.span) {
      input.value = String(settings.historyHours);
      return;
    }
    settings.historyHours = hours;
    offset = 0;
  }
  if (input.id === 'setting-format') settings.format = input.value as '12' | '24';
  if (input.dataset.calendar && /^#[0-9a-f]{6}$/i.test(input.value)) settings.colors[input.dataset.calendar] = input.value;
  save(); render();
});
let pointerStart: { x: number; y: number } | undefined;
const stage = document.getElementById('clock-stage')!;
const center = document.querySelector<HTMLElement>('.clock-center')!;
center.addEventListener('contextmenu', event => event.preventDefault());
stage.addEventListener('pointerdown', event => { pointerStart = { x: event.clientX, y: event.clientY }; });
stage.addEventListener('pointercancel', () => { pointerStart = undefined; });
stage.addEventListener('pointerup', event => {
  if (pointerStart) {
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      offset += dx < 0 ? 1 : -1;
      suppressClickUntil = performance.now() + 250;
      render();
    }
  }
  pointerStart = undefined;
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && (realMode || live)) render(); });
window.addEventListener('pageshow', () => { if (realMode || live) render(); });

function setSourceMode(real: boolean) {
  realMode = real;
  sourcePreference = real ? 'real' : 'sample';
  try { localStorage.setItem('calendar-pie-source', sourcePreference); } catch { /* Optional storage. */ }
  offset = 0;
  requestedRange = '';
  render();
}

function serviceStatus() {
  if (!realMode) return 'Sample preview. Choose My calendars to use your local calendar service.';
  const messages: string[] = [];
  if (networkError) messages.push(`${loadedRealData ? 'Showing previously loaded events. ' : ''}Calendar service unavailable: ${networkError}`);
  else if (!loadedRealData) messages.push('Loading your calendars…');
  else if (!realCalendars.length) messages.push('No calendar sources yet. Add a source in Settings.');
  else if (!realCalendars.some(calendar => calendar.enabled)) messages.push('All calendar sources are disabled. Enable a source in Settings.');
  else messages.push('My calendars');
  const failures = realCalendars.filter(calendar => calendar.enabled && calendar.lastError);
  failures.forEach(calendar => messages.push(`${calendar.name}: ${calendar.lastError}`));
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (serviceTimezone && serviceTimezone !== deviceTimezone) messages.push(`Timezone mismatch: server uses ${serviceTimezone}; this browser uses ${deviceTimezone}. Set the device timezone to match the server. The dial uses the browser timezone.`);
  const window = rollingWindow(now, settings.span, settings.historyHours, offset);
  if (loadedRealData && (!cacheRange || +window.start < +new Date(cacheRange.start) || +window.end > +new Date(cacheRange.end))) messages.push('This clock window is outside the cached calendar range; some events may be missing.');
  return messages.join(' ');
}

function renderServiceStatus() {
  let status = document.getElementById('calendar-service-status');
  if (!status) {
    document.querySelector('.workspace')!.insertAdjacentHTML('beforebegin', '<div id="calendar-service-status" class="calendar-service-status"><p class="service-status" role="status"></p><button class="text-button" data-action="service-retry">Retry calendar service</button></div>');
    status = document.getElementById('calendar-service-status')!;
  }
  status.hidden = !realMode;
  status.querySelector<HTMLElement>('button')!.hidden = !networkError;
  document.querySelectorAll('.service-status').forEach(element => { element.textContent = serviceStatus(); });
  document.querySelector<HTMLElement>('.preview-tools')!.hidden = realMode;
  document.querySelector('.sample-badge')!.innerHTML = `<span></span>${realMode ? 'My calendars' : 'Sample calendars'}`;
  if (realMode && offset === 0 && !hasClockChange(rollingWindow(now, settings.span, settings.historyHours, offset))) text('dial-sample-label', networkError ? 'MY CALENDARS · OFFLINE' : realCalendars.some(calendar => calendar.enabled && calendar.lastError) ? 'MY CALENDARS · SYNC ERROR' : 'MY CALENDARS · LIVE');
  const list = realMode ? realCalendars.filter(calendar => calendar.enabled) : calendars;
  document.querySelector('.calendar-legend')!.innerHTML = list.map(calendar => `<span><i style="background:${realMode ? safeColor(calendar.color) : settings.colors[calendar.id]}"></i>${escape(calendar.name)}</span>`).join('');
}

async function loadRealEvents(force = false) {
  if (!realMode) return;
  const window = rollingWindow(new Date(), settings.span, settings.historyHours, offset);
  // Include the visible dial and its agenda day, without fetching an unbounded feed.
  const day = clockWindow(offset === 0 ? new Date() : window.start, 24);
  const start = new Date(Math.min(+day.start, +window.start));
  const end = new Date(Math.ceil(Math.max(+day.end, +window.end) / 60000) * 60000);
  start.setSeconds(0, 0);
  const query = `?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
  if (!force && requestedRange === query) return;
  requestedRange = query;
  const version = ++requestVersion;
  try {
    const response = await api<EventResponse>(`/events${query}`);
    if (version !== requestVersion) return;
    realCalendars = response.calendars;
    const enabled = new Set(realCalendars.filter(calendar => calendar.enabled).map(calendar => calendar.id));
    realEvents = response.events.filter(event => enabled.has(event.calendarId)).map(event => ({ ...event, start: new Date(event.start), end: new Date(event.end) })).filter(validTimed);
    cacheRange = response.cacheRange;
    serviceTimezone = response.timezone;
    loadedRealData = true;
    networkError = '';
  } catch (error) {
    if (version !== requestVersion) return;
    networkError = error instanceof Error ? error.message : 'Unable to connect.';
  }
  if (realMode) render();
}

function sourceStatus(calendar: CalendarSource) {
  return calendar.lastError ? `Sync error: ${calendar.lastError}` : calendar.lastSuccess ? `Last synced ${new Date(calendar.lastSuccess).toLocaleString()}` : 'Waiting for first sync';
}

async function openSources() {
  if (kiosk) return;
  openConfiguration('<h2 id="dialog-title">Calendar sources</h2><p role="status">Loading sources…</p>');
  try {
    const response = await api<{ calendars: CalendarSource[] }>('/calendars');
    sourceCalendars = response.calendars;
    if (!dialog.open || document.getElementById('dialog-title')?.textContent !== 'Calendar sources') return;
    showSources();
  } catch (error) {
    if (!dialog.open || document.getElementById('dialog-title')?.textContent !== 'Calendar sources') return;
    openConfiguration(`<h2 id="dialog-title">Calendar sources</h2><p class="settings-note" role="alert">${escape(error instanceof Error ? error.message : 'Unable to connect to the local service.')}</p><button class="text-button" data-action="sources">Retry sources</button>`);
  }
}

function showSources() {
  openConfiguration(`<h2 id="dialog-title">Calendar sources</h2><p class="settings-note">Subscribe to an ICS URL. Sources and credentials are saved on this device's server.</p><p class="settings-note" role="status">${escape(serviceMessage)}</p><div class="source-list">${sourceCalendars.map(calendar => `<article class="source-card"><strong><i style="background:${safeColor(calendar.color)}"></i>${escape(calendar.name)}</strong><p>${calendar.enabled ? 'Enabled' : 'Disabled'} · Every ${calendar.refreshMinutes} minutes</p><p>${escape(sourceStatus(calendar))}</p><div class="source-actions"><button class="text-button" data-action="source-edit" data-id="${escape(calendar.id)}">Edit ${escape(calendar.name)}</button><button class="text-button" data-action="source-refresh" data-id="${escape(calendar.id)}">Refresh ${escape(calendar.name)}</button><button class="text-button" data-action="source-delete" data-id="${escape(calendar.id)}">Delete ${escape(calendar.name)}</button></div></article>`).join('') || '<p class="settings-note">No sources yet.</p>'}</div><div class="source-actions"><button class="text-button" data-action="source-add">Add calendar source</button><button class="text-button" data-action="source-refresh">Refresh all calendars</button><button class="text-button" data-action="sources">Check sync status</button></div>`);
}

function editSource(id?: string) {
  const calendar = sourceCalendars.find(item => item.id === id);
  openConfiguration(`<h2 id="dialog-title">${calendar ? 'Edit calendar source' : 'Add calendar source'}</h2><form id="source-form" class="settings-fields" data-id="${escape(calendar?.id ?? '')}"><label>Name<input name="name" required maxlength="200" value="${escape(calendar?.name ?? '')}"/></label><label>ICS URL<input name="url" type="url" required placeholder="https://example.com/calendar.ics" value="${escape(calendar?.url ?? '')}"/></label><label>Username (optional)<input name="username" autocomplete="off" value="${escape(calendar?.username ?? '')}"/></label><label>Password (optional)<input name="password" type="password" autocomplete="new-password" value=""/><span class="settings-note">${calendar?.hasPassword ? 'A password is saved. Leave blank to keep it.' : 'Only needed for feeds using basic authentication.'}</span></label>${calendar?.hasPassword ? '<label class="checkbox-setting"><input name="clearPassword" type="checkbox"/>Remove saved password</label>' : ''}<label class="color-setting">Calendar color<input name="color" type="color" value="${safeColor(calendar?.color ?? '#BFA9DF')}"/></label><label>Refresh every (minutes)<input name="refreshMinutes" type="number" min="1" max="1440" required value="${calendar?.refreshMinutes ?? 5}"/></label><label class="checkbox-setting"><input name="enabled" type="checkbox" ${calendar?.enabled !== false ? 'checked' : ''}/>Enabled</label><p id="source-error" class="settings-note" role="alert"></p><button class="source-save" type="submit">Save calendar source</button></form>`, 'sources');
}

function confirmDelete(id: string) {
  const calendar = sourceCalendars.find(item => item.id === id);
  if (!calendar) return;
  openConfiguration(`<h2 id="dialog-title">Delete calendar source?</h2><p class="settings-note">Remove ${escape(calendar.name)} and its cached events from this device?</p><p id="source-error" class="settings-note" role="alert"></p><button class="text-button" data-action="source-delete-confirm" data-id="${escape(id)}">Confirm delete</button>`, 'sources');
}

async function mutateSource(path: string, method: string, body?: unknown) {
  if (sourceBusy) return;
  sourceBusy = true;
  const buttons = [backButton, ...content.querySelectorAll<HTMLButtonElement>('button')];
  buttons.forEach(button => { button.disabled = true; });
  try {
    await api(path, method, body);
    serviceMessage = path.endsWith('/refresh') ? 'Refresh queued. Check sync status shortly.' : 'Calendar sources updated.';
    await openSources();
    if (realMode) await loadRealEvents(true);
  } catch (error) {
    let status = document.getElementById('source-error');
    if (!status) { content.insertAdjacentHTML('beforeend', '<p id="source-error" class="settings-note" role="alert"></p>'); status = document.getElementById('source-error'); }
    if (status) status.textContent = error instanceof Error ? error.message : 'Unable to save calendar source.';
  } finally {
    sourceBusy = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}

content.addEventListener('submit', event => {
  const form = event.target as HTMLFormElement;
  if (form.id !== 'source-form') return;
  event.preventDefault();
  const data = new FormData(form);
  const body: Record<string, unknown> = { name: data.get('name'), url: data.get('url'), username: data.get('username'), color: data.get('color'), refreshMinutes: Number(data.get('refreshMinutes')), enabled: data.has('enabled') };
  if (data.has('clearPassword')) body.password = '';
  else if (data.get('password')) body.password = data.get('password');
  const id = form.dataset.id;
  void mutateSource(id ? `/calendars/${encodeURIComponent(id)}` : '/calendars', id ? 'PATCH' : 'POST', body);
});

async function discoverService() {
  try {
    const health = await api<{ status: string; timezone: string }>('/health');
    if (health.status !== 'ok') return;
    serviceTimezone = health.timezone;
    if (sourcePreference !== 'sample') setSourceMode(true);
  } catch { /* A static preview is usable without the local server. Explicit real mode reports its event fetch failure. */ }
}
setInterval(() => { if (realMode && !document.hidden) void loadRealEvents(true); }, 30000);
async function initialize() {
  try {
    await loadFont(settings.font);
    if (settings.font === 'custom') fontStatus = `Saved locally: ${await customFontName() ?? 'Custom font'}`;
  } catch (error) {
    settings.font = 'system';
    fontStatus = error instanceof Error ? error.message : 'The saved font could not be loaded. Using the system font.';
    save();
  }
  applyAppearance();
  render();
  void discoverService();
}
void initialize();
