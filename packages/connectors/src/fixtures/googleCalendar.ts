/**
 * Sample calendar events, used when no Google credentials are configured.
 */

export interface CalendarFixtureEvent {
  id: string;
  title: string;
  body: string;
}

export const CALENDAR_FIXTURE_EVENTS: CalendarFixtureEvent[] = [
  {
    id: 'calendar-fixture-0001',
    title: 'Mill Street lease — decision call',
    body: [
      '# Mill Street lease — decision call',
      '',
      'When: 2026-03-12T13:00:00-07:00 to 2026-03-12T13:30:00-07:00',
      'Where: Conference line',
      'Organiser: you@example.com',
      'Attendees: Priya (accepted), you@example.com (accepted)',
      '',
      'Decided to sign Mill Street over the station unit. Loading bay access',
      'settled it.',
    ].join('\n'),
  },
  {
    id: 'calendar-fixture-0002',
    title: 'Weekly planning',
    body: [
      '# Weekly planning',
      '',
      'When: 2026-03-16T09:00:00-07:00 to 2026-03-16T09:30:00-07:00',
      'Organiser: you@example.com',
      'Attendees: you@example.com (accepted)',
      '',
      'Confirmed deploy windows move to Tuesday and Thursday only.',
    ].join('\n'),
  },
];
