import { describe, expect, it } from 'vitest';
import { CONNECTOR_DESCRIPTIONS } from '@cairn/connectors';
import { sourceProviders } from '@cairn/domain';

/**
 * connectSource decides whether a provider can be connected by asking the same
 * registry the Sources page renders from. This exists because the two once
 * disagreed: Gmail and Calendar were listed and marked Ready, and the action
 * refused both with "Unknown connection" because it kept its own hand-written
 * list. A provider added to the registry must be connectable the moment it
 * appears, or fail here rather than on a person's screen.
 */
describe('connectable providers', () => {
  it('describes every provider the domain knows', () => {
    for (const provider of sourceProviders) {
      expect(CONNECTOR_DESCRIPTIONS[provider], provider).toBeDefined();
    }
  });

  it('accepts exactly the account-backed providers', () => {
    const connectable = sourceProviders.filter(
      (provider) => CONNECTOR_DESCRIPTIONS[provider].needsAccount,
    );
    expect([...connectable].sort()).toEqual([
      'github',
      'gmail',
      'google_calendar',
      'google_drive',
      'notion',
    ]);
  });

  it('keeps paste, upload and url out of the connect flow', () => {
    for (const provider of ['paste', 'upload', 'url'] as const) {
      expect(CONNECTOR_DESCRIPTIONS[provider].needsAccount).toBe(false);
    }
  });
});
