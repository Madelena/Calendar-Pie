import type { ClockWindow } from './clock.ts';

export interface DialLabel {
  angle: number;
  hour: string;
  period: string;
  date: Date;
  accessibleLabel: string;
}

export function dialLabels(window: ClockWindow, format: '12' | '24'): DialLabel[] {
  const dates = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(window.start);
    date.setHours(index * window.span / 12, 0, 0, 0);
    while (+date < +window.start) date.setHours(date.getHours() + window.span);
    return date;
  });
  const first = Math.min(...dates.map(Number));
  const last = Math.max(...dates.map(Number));

  return dates.map((date, index) => {
    const hour = date.getHours();
    const period = hour < 12 ? 'AM' : 'PM';
    return {
      angle: index * 30,
      hour: String(format === '24' ? hour : hour % 12 || 12),
      period: format === '12' && (hour % 12 === 0 || +date === first || +date === last) ? period : '',
      date,
      accessibleLabel: format === '24' ? `${hour}:00` : `${hour % 12 || 12} ${period}`,
    };
  });
}
