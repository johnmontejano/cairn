/**
 * Sample Gmail messages, used when no Google credentials are configured.
 */

export interface GmailFixtureMessage {
  id: string;
  subject: string;
  body: string;
}

export const GMAIL_FIXTURE_MESSAGES: GmailFixtureMessage[] = [
  {
    id: 'gmail-fixture-0001',
    subject: 'Re: Mill Street lease',
    body: [
      'Subject: Re: Mill Street lease',
      'From: priya@example.com',
      'To: you@example.com',
      'Date: Wed, 12 Mar 2026 14:41:00 -0700',
      '',
      'Confirmed — Mill Street it is. I still think the commute is worse for half',
      'the team, but the loading bay settles it for me too. Sending the signed',
      'copy back by Friday.',
    ].join('\n'),
  },
  {
    id: 'gmail-fixture-0002',
    subject: 'Deploy schedule going forward',
    body: [
      'Subject: Deploy schedule going forward',
      'From: you@example.com',
      'To: team@example.com',
      'Date: Thu, 13 Mar 2026 09:02:00 -0700',
      '',
      'Starting this week we deploy Tuesdays and Thursdays only. No Friday',
      'deploys — whoever has to roll one back should not be doing it on a',
      'weekend.',
    ].join('\n'),
  },
];
