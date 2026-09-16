export function wrapTitle(title: string, capacity: number, maxLines: number): string[] {
  const width = Math.floor(capacity);
  const limit = Math.floor(maxLines);
  if (!Number.isFinite(width) || !Number.isFinite(limit) || width < 1 || limit < 1) return [];

  let remaining = Array.from(title.trim().replace(/\s+/g, ' '));
  const lines: string[] = [];
  while (remaining.length && lines.length < limit) {
    if (remaining.length <= width) {
      lines.push(remaining.join(''));
      break;
    }
    if (lines.length === limit - 1) {
      lines.push(remaining.slice(0, width - 1).join('').trimEnd() + '…');
      break;
    }
    // Prefer whole words; split a word only when it cannot fit on a line.
    const space = remaining.slice(0, width + 1).lastIndexOf(' ');
    const end = space > 0 ? space : width;
    lines.push(remaining.slice(0, end).join(''));
    remaining = remaining.slice(end);
    if (remaining[0] === ' ') remaining.shift();
  }
  return lines;
}

export function countdownText(milliseconds: number): string {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
