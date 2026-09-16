import type { CalendarEvent } from './clock.ts';

export interface SourceCalendar {
  id: string; name: string; color: string; enabled: boolean;
  lastSuccess: string | null; lastError: string | null;
}
export interface CalendarSource extends SourceCalendar {
  url: string; username: string; hasPassword: boolean; refreshMinutes: number; lastAttempt: string | null;
}
export interface EventResponse {
  calendars: SourceCalendar[];
  events: (Omit<CalendarEvent, 'start' | 'end'> & { start: string; end: string })[];
  range: { start: string; end: string };
  cacheRange: { start: string; end: string } | null;
  timezone: string;
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || `Calendar service returned ${response.status}.`);
  }
  if (response.status === 204) return undefined as T;
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Calendar service is unavailable. Start the local server and retry.');
  return response.json() as Promise<T>;
}

export const safeColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : '#BFA9DF';
