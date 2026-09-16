export function timeParts(date: Date, format: '12' | '24', timeZoneName?: 'shortOffset'): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit', hourCycle: format === '24' ? 'h23' : 'h12', timeZoneName,
  }).formatToParts(date).map(part => part.type === 'hour' && format === '24'
    ? { ...part, value: String(Number(part.value)) } : part);
}
