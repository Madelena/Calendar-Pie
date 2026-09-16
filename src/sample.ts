import type { Calendar, CalendarEvent } from './clock.ts';

export const calendars: Calendar[] = [
  { id: 'work', name: 'Work', color: '#abd884' },
  { id: 'personal', name: 'Personal', color: '#f3a576' },
  { id: 'wellbeing', name: 'Wellbeing', color: '#af9bec' },
];
export type Scenario = 'everyday' | 'overlap' | 'overnight' | 'empty' | 'segments';

export function sampleNow(scenario: Scenario): Date {
  const date = new Date();
  date.setHours(scenario === 'overnight' ? 23 : 10, scenario === 'overnight' ? 20 : 10, 0, 0);
  if (scenario === 'segments') date.setHours(8, 40, 0, 0);
  return date;
}

export function sampleEvents(day: Date, scenario: Scenario): CalendarEvent[] {
  const at = (hour: number, minute = 0) => {
    const date = new Date(day);
    date.setHours(hour, minute, 0, 0);
    return date;
  };
  if (scenario === 'empty') return [];
  if (scenario === 'segments') return [
    { id: 'event-a', calendarId: 'work', title: 'Event A', start: at(9), end: at(9, 45), description: 'The first 30 minutes are on their own, followed by 15 minutes overlapping Event B.' },
    { id: 'event-b', calendarId: 'personal', title: 'Event B', start: at(9, 30), end: at(10, 30), description: 'The first 15 minutes overlap Event A, followed by 45 minutes on their own.' },
  ];
  const events: CalendarEvent[] = [
    { id: 'breakfast', calendarId: 'personal', title: 'A slow morning', start: at(7, 30), end: at(8, 15), location: 'At home', description: 'Breakfast, coffee, and a little time to ease into the day.' },
    { id: 'focus', calendarId: 'work', title: 'Deep work', start: at(8, 30), end: at(10), location: 'Desk', description: 'A little uninterrupted time for the thing that matters. Notifications off, one task at a time.' },
    { id: 'design', calendarId: 'work', title: 'Design catch-up', start: at(10, 30), end: at(11, 30), location: 'Studio · Video call', description: 'Share work in progress and talk through the next steps. Bring a sketch and a question.' },
    { id: 'walk', calendarId: 'wellbeing', title: 'Get some fresh air', start: at(11), end: at(11, 45), location: 'Outside', description: 'A short walk. Leave a little room to take the scenic route.' },
    { id: 'lunch', calendarId: 'personal', title: 'Lunch with Alex', start: at(12), end: at(13), location: 'The corner café', description: 'Something good to eat and a chance to catch up.' },
    { id: 'make', calendarId: 'work', title: 'Make something', start: at(14), end: at(16), location: 'Studio', description: 'An open block for the calendar clock project.' },
    { id: 'stretch', calendarId: 'wellbeing', title: 'Stretch & reset', start: at(16, 30), end: at(17), description: 'Step away from the screen and move a little.' },
    { id: 'dinner', calendarId: 'personal', title: 'Dinner at home', start: at(18, 30), end: at(19, 30), description: 'Time to put the day down.' },
    { id: 'all-day', calendarId: 'personal', title: 'Hidden all-day sample', start: at(0), end: at(24), allDay: true },
  ];
  if (scenario === 'overlap') events.push(
    { id: 'call', calendarId: 'personal', title: 'Quick call', start: at(10, 45), end: at(11, 15), description: 'An overlapping appointment to test the radial lanes.' },
    { id: 'reminder', calendarId: 'wellbeing', title: 'Take a breath', start: at(11, 5), end: at(11, 10), description: 'A five-minute event with a larger touch target.' },
  );
  if (scenario === 'overnight') events.push(
    { id: 'late', calendarId: 'personal', title: 'Late-night reading', start: at(23, 30), end: at(24, 30), description: 'This event continues past midnight into the next day.' },
    { id: 'tomorrow', calendarId: 'wellbeing', title: 'A new day', start: at(31), end: at(31, 30), description: 'An early start tomorrow.' },
  );
  return events;
}
