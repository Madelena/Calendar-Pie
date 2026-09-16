import { point, sectorPath } from './clock.ts';

// Approximate a conic opacity gradient with small, continuous SVG linear gradients.
// This keeps rendering native to SVG without filters, images, or a frame loop.
export function historyMask(start: number, end: number): string {
  if (end <= start) return '';
  const count = Math.ceil((end - start) / 6);
  const gradients: string[] = [];
  const wedges: string[] = [];
  const gray = (fraction: number) => {
    const value = Math.round(fraction * 255);
    return `rgb(${value},${value},${value})`;
  };
  for (let index = 0; index < count; index++) {
    const from = start + (end - start) * index / count;
    const to = start + (end - start) * (index + 1) / count;
    const [x1, y1] = point(from, 250);
    const [x2, y2] = point(to, 250);
    gradients.push(`<linearGradient id="history-${index}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop stop-color="${gray(index / count)}"/><stop offset="1" stop-color="${gray((index + 1) / count)}"/></linearGradient>`);
    // Overpaint shared edges so antialiasing cannot expose the white mask base as spokes.
    wedges.push(`<path d="${sectorPath(from, to, 1, 360)}" fill="url(#history-${index})" stroke="url(#history-${index})" stroke-width="1.5"/>`);
  }
  return `<defs>${gradients.join('')}<mask id="event-history" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="720" style="mask-type:luminance"><rect width="720" height="720" fill="white"/>${wedges.join('')}</mask></defs>`;
}
