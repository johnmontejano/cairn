import { describe, expect, it } from 'vitest';
import { classifyMail, trimMailBody } from '@cairn/connectors';
import { CueMemoryExtractor } from '@cairn/ingestion';

/**
 * Two bugs these cover, from two rounds of the same complaint.
 *
 * The first: a Gmail sync of a real mailbox produced 49 memory candidates,
 * most of them sentences from newsletters and promotional mail ("never miss a
 * deal", "we've decided to bring you free shipping"). Marketing copy is
 * written in the register the extractor looks for, so it does not read as
 * junk in review — it reads as confident, well-formed, useless memory.
 *
 * The second, once the first was fixed: a parish's own attendance reminder
 * still made it through, because it carried no bulk-mail signal at all — no
 * `List-Unsubscribe`, no `Precedence: bulk`, nothing on the deny-list this
 * file used to be. `classifyMail`'s default flipped as a result, from "keep
 * unless it looks like spam" to "drop unless it is a reply" — a message the
 * person sent, or one that answers something they were part of. Most of the
 * cases below now need an `in-reply-to` header added just to reach the checks
 * they are actually testing, since without one they are excluded a step
 * earlier by the new gate; that is deliberate, and the case pinning the gate
 * itself is first.
 */

const headersFrom =
  (headers: Record<string, string>) =>
  (name: string): string =>
    headers[name.toLowerCase()] ?? '';

/** Everything past the reply gate needs this to reach the check it is testing. */
const REPLY = { 'in-reply-to': '<earlier-message@example.com>' };

describe('classifyMail', () => {
  it('drops a message that is not a reply, however ordinary it looks', () => {
    // The gate itself: no bulk signal here at all, nothing Gmail would ever
    // flag — this is what an unanswered first message from a real person looks
    // like from the outside, and it is indistinguishable from cold mail or a
    // one-off automated notice without the header a genuine reply carries.
    const verdict = classifyMail({
      labelIds: ['INBOX'],
      header: headersFrom({
        from: 'Priya Anand <priya@example.com>',
        subject: 'Mill Street lease',
      }),
    });
    expect(verdict).toEqual({ keep: false, reason: 'not part of a reply thread' });
  });

  it('keeps a reply from a real person', () => {
    const verdict = classifyMail({
      labelIds: ['INBOX'],
      header: headersFrom({
        from: 'Priya Anand <priya@example.com>',
        subject: 'Re: Mill Street lease',
        ...REPLY,
      }),
    });
    expect(verdict).toEqual({ keep: true });
  });

  it('drops mail Gmail already filed as promotions, social, or forums, even if it claims to be a reply', () => {
    for (const label of ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']) {
      const verdict = classifyMail({
        labelIds: ['INBOX', label],
        header: headersFrom(REPLY),
      });
      expect(verdict.keep).toBe(false);
    }
  });

  it('drops a newsletter that landed in the primary tab and forged a reply header', () => {
    // Marketing automation occasionally threads a message as a "reply" to keep
    // a drip sequence in one conversation view. The reply gate alone would let
    // this through; the header checks are the layer that still catches it.
    const verdict = classifyMail({
      labelIds: ['INBOX'],
      header: headersFrom({
        from: 'The Weekly <hello@theweekly.example>',
        'list-unsubscribe': '<https://theweekly.example/u/abc>',
        ...REPLY,
      }),
    });
    expect(verdict).toEqual({ keep: false, reason: 'sent to a list (list-unsubscribe)' });
  });

  it('drops automated and unattended senders, even mid-thread', () => {
    const cases: Array<Record<string, string>> = [
      { from: 'no-reply@bank.example', ...REPLY },
      { from: '"Acme Notifications" <notifications@acme.example>', ...REPLY },
      { from: 'a@b.example', 'auto-submitted': 'auto-generated', ...REPLY },
      { from: 'a@b.example', precedence: 'bulk', ...REPLY },
      { from: 'a@b.example', 'feedback-id': '1:2:3:mailer', ...REPLY },
    ];
    for (const headers of cases) {
      expect(classifyMail({ labelIds: ['INBOX'], header: headersFrom(headers) }).keep).toBe(false);
    }
  });

  it('never drops mail the person sent, whatever headers it carries, reply or not', () => {
    // Someone who mails their own newsletter would otherwise lose every message
    // they wrote. Their own words are the last thing this should discard, and
    // unlike everything else here, a sent message needs no reply header at all.
    const verdict = classifyMail({
      labelIds: ['SENT'],
      header: headersFrom({
        from: 'newsletter@mine.example',
        'list-unsubscribe': '<https://mine.example/u>',
        precedence: 'bulk',
      }),
    });
    expect(verdict).toEqual({ keep: true });
  });

  it('does not mistake a person for a robot', () => {
    // `newsletter`, `info` and `alerts` anchored badly would catch these names.
    for (const from of ['Roberta Newsom <newsom@example.com>', 'Neil Fortin <infante@x.example>']) {
      expect(
        classifyMail({ labelIds: ['INBOX'], header: headersFrom({ from, ...REPLY }) }).keep,
      ).toBe(true);
    }
  });
});

describe('trimMailBody', () => {
  it('cuts the quoted reply chain', () => {
    // Gmail hands over each message in a thread separately, so a quote is
    // content that is already being ingested under its own id. Left in, the
    // same sentence is extracted once per reply in the thread.
    const body = [
      'Confirmed — Mill Street it is. Sending the signed copy back by Friday.',
      '',
      'On Wed, 12 Mar 2026 at 14:41, Priya Anand <priya@example.com> wrote:',
      '> Are we settled on Mill Street? The loading bay decides it for me.',
    ].join('\n');
    expect(trimMailBody(body)).toBe(
      'Confirmed — Mill Street it is. Sending the signed copy back by Friday.',
    );
  });

  it('cuts signatures and unsubscribe footers', () => {
    const body = [
      'Starting this week we deploy Tuesdays and Thursdays only. No Friday deploys.',
      '',
      '--',
      'Sam Okafor, Head of Platform',
    ].join('\n');
    expect(trimMailBody(body)).toBe(
      'Starting this week we deploy Tuesdays and Thursdays only. No Friday deploys.',
    );

    const withFooter = [
      'The venue confirmed 4 September for the opening, and the deposit is paid.',
      '',
      'You are receiving this because you signed up. Unsubscribe here.',
    ].join('\n');
    expect(trimMailBody(withFooter)).toBe(
      'The venue confirmed 4 September for the opening, and the deposit is paid.',
    );
  });

  it('keeps the message when trimming would empty it', () => {
    // A misread boundary must not turn a real message into nothing.
    const body = 'On Tue, someone wrote:\n> the whole message is a quote';
    expect(trimMailBody(body)).toBe(body.trim());
  });
});

describe('CueMemoryExtractor on promotional text', () => {
  const extract = async (text: string) =>
    (
      await new CueMemoryExtractor().extract({
        text,
        sourceTitle: 'Test',
        provider: 'gmail',
        projectName: 'Test',
        contentHash: 'sha256:test',
      })
    ).candidates;

  it('extracts nothing from a promotional email', async () => {
    const promo = [
      'Subject: Never miss a deal again',
      '',
      "We've decided to bring you free shipping on every order this month.",
      '',
      'You should shop now — this limited-time offer ends soon. 30% off everything!',
      '',
      'Always free returns. Never pay for shipping again.',
      '',
      'Click here to view this email in your browser. Unsubscribe at any time.',
      '',
      '© 2026 Acme Retail. All rights reserved. Terms and conditions apply.',
    ].join('\n');
    expect(await extract(promo)).toHaveLength(0);
  });

  it('still extracts the decisions and rules in real correspondence', async () => {
    // The guard above must not be paid for with the product's actual job.
    const real = [
      'Subject: Deploy schedule going forward',
      '',
      'Starting this week we decided to deploy Tuesdays and Thursdays only.',
      '',
      'Never deploy on a Friday — whoever rolls it back should not be doing it on a weekend.',
      '',
      'Priya will send the signed lease back by Friday.',
    ].join('\n');

    const candidates = await extract(real);
    const types = candidates.map((candidate) => candidate.type);
    expect(types).toContain('decision');
    expect(types).toContain('operating_rule');
    expect(types).toContain('next_step');
  });
});
