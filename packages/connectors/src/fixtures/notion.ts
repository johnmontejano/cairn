/**
 * Sample Notion pages.
 *
 * Used when no Notion credentials are configured, so the ingestion path can be
 * exercised end to end without an external account. The content deliberately
 * looks like real working notes — decisions, preferences, people — because that
 * is what the extractor is meant to find.
 */

export interface NotionFixturePage {
  id: string;
  title: string;
  version: string;
  body: string;
}

export const NOTION_FIXTURE_PAGES: NotionFixturePage[] = [
  {
    id: 'b1f4c2e0-0000-4000-8000-000000000101',
    title: 'Team handbook',
    version: '2026-03-12T09:00:00.000Z',
    body: [
      '# Team handbook',
      '',
      'We write decisions down before we act on them, not after. A decision that',
      'only exists in a meeting did not happen.',
      '',
      '## How we work',
      '',
      'Standups are asynchronous and written. We reserve synchronous time for',
      'disagreements, which are hard to resolve in text.',
      '',
      'We deploy on Tuesdays and Thursdays. Never on a Friday, because the person',
      'who has to roll it back should not be doing it on a weekend.',
      '',
      '## Tools',
      '',
      'Design lives in Figma. Engineering tickets live in Linear. Anything that',
      'needs to outlive a sprint lives here.',
    ].join('\n'),
  },
  {
    id: 'b1f4c2e0-0000-4000-8000-000000000102',
    title: 'Mill Street lease — decision',
    version: '2026-03-12T14:30:00.000Z',
    body: [
      '# Mill Street lease',
      '',
      'We decided to sign the Mill Street lease rather than the unit by the',
      'station. The station unit was cheaper per square foot but had no loading',
      'access, which would have made deliveries a standing problem.',
      '',
      'Signed for three years with a break clause at eighteen months.',
      '',
      'Priya raised that the commute is worse for half the team. We accepted that',
      'tradeoff in exchange for the loading bay.',
    ].join('\n'),
  },
  {
    id: 'b1f4c2e0-0000-4000-8000-000000000103',
    title: 'Writing style',
    version: '2026-03-14T11:15:00.000Z',
    body: [
      '# Writing style',
      '',
      'Plain words. Short sentences. No exclamation marks in anything a customer',
      'reads.',
      '',
      'We never say "simply" or "just" in documentation, because the thing is',
      'rarely simple for the person stuck on it.',
      '',
      'British spelling throughout.',
    ].join('\n'),
  },
];
