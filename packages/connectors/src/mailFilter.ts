/**
 * Deciding which mail is worth remembering, and where a message actually ends.
 *
 * A mailbox is mostly not correspondence. Newsletters, receipts, notifications,
 * and marketing land in the same inbox as the three messages a year in which
 * someone agrees a date or settles a decision, and a memory product that treats
 * those the same produces a review queue nobody will finish and a memory nobody
 * trusts. Worse, marketing prose is written in exactly the register extraction
 * looks for — "we've decided to bring you...", "you should never miss...",
 * "always free shipping" — so bulk mail does not merely add noise, it is
 * actively the most likely thing to be mistaken for a decision or a rule.
 *
 * So bulk mail is excluded here, before it becomes a source item at all, rather
 * than being ingested and filtered later. Nothing is stored, nothing is
 * encrypted and written, and nothing arrives in the review queue to be dismissed
 * one card at a time.
 *
 * Two rules keep this from quietly eating real mail:
 *
 *   - Mail the person sent is always kept. Whatever headers it carries, they
 *     wrote it, and a product that silently discarded a person's own words
 *     would be wrong in a way no filtering benefit could pay for.
 *   - Every exclusion is counted and reported. A sync that read 200 messages
 *     and kept 12 says so.
 */

/** Gmail's own classification of mail it considers bulk rather than personal. */
const BULK_CATEGORY_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']);

/**
 * Headers that only appear on mail sent to a list rather than to a person.
 *
 * `List-Unsubscribe` is the single strongest signal available: it is required
 * of bulk senders by every major mailbox provider, and effectively never
 * present on a message one human typed to another.
 */
const BULK_HEADERS = [
  'list-unsubscribe',
  'list-id',
  'list-post',
  'list-help',
  'list-subscribe',
  // Google's own bulk-sender identifier, and the campaign identifiers the
  // large email service providers stamp on outgoing marketing.
  'feedback-id',
  'x-campaign-id',
  'x-campaignid',
  'x-mailchimp-campaign-id',
  'x-marketo-campaign-id',
  'x-sg-eid',
  'x-sendgrid-campaign',
  'x-klaviyo-message-id',
  'x-customerio-message-id',
  'x-braze-dispatch-id',
  'x-hubspot-campaign-id',
];

/**
 * Sender names that announce the message is not from a person. Anchored to the
 * start of the local part so a real person named, say, "Roberta Newsom" or
 * "Neil Fortin" is not caught by `newsletter` or `info` appearing mid-word.
 */
const BULK_SENDER_LOCALPART =
  /^(no-?reply|do-?not-?reply|donotreply|notification|notifications|newsletter|newsletters|marketing|mailer|mailer-daemon|bounce|bounces|postmaster|announce|announcements|updates|alerts|billing|receipts|noreply)([-._+]|$)/i;

export type MailVerdict = { keep: true } | { keep: false; reason: string };

/**
 * Whether a message is correspondence worth remembering.
 *
 * Takes a header lookup rather than a parsed message so this stays testable
 * without constructing a Gmail API payload, and so a second mail provider can
 * reuse it unchanged.
 */
export function classifyMail(input: {
  labelIds: readonly string[];
  header: (name: string) => string;
}): MailVerdict {
  // The person wrote it. Nothing below may overrule that.
  if (input.labelIds.includes('SENT')) return { keep: true };

  const category = input.labelIds.find((label) => BULK_CATEGORY_LABELS.has(label));
  if (category) {
    return { keep: false, reason: `Gmail classified this as ${categoryName(category)}` };
  }

  for (const name of BULK_HEADERS) {
    if (input.header(name).trim().length > 0) {
      return { keep: false, reason: `sent to a list (${name})` };
    }
  }

  // `Auto-Submitted: no` is the explicit "a human sent this" value, and is the
  // only value that is not a machine announcing itself.
  const autoSubmitted = input.header('auto-submitted').trim().toLowerCase();
  if (autoSubmitted.length > 0 && autoSubmitted !== 'no') {
    return { keep: false, reason: 'generated automatically' };
  }

  const precedence = input.header('precedence').trim().toLowerCase();
  if (['bulk', 'junk', 'list'].includes(precedence)) {
    return { keep: false, reason: `sent as ${precedence} mail` };
  }

  const localPart = senderLocalPart(input.header('from'));
  if (localPart && BULK_SENDER_LOCALPART.test(localPart)) {
    return { keep: false, reason: 'sent from an unattended address' };
  }

  return { keep: true };
}

function categoryName(label: string): string {
  return label.replace('CATEGORY_', '').toLowerCase();
}

/** `"Ada Lovelace" <ada@example.com>` and `ada@example.com` both give `ada`. */
function senderLocalPart(from: string): string | null {
  const address = from.match(/<([^>]+)>/)?.[1] ?? from;
  const at = address.lastIndexOf('@');
  if (at <= 0) return null;
  return address.slice(0, at).trim().replace(/^"|"$/g, '');
}

/* ------------------------------------------------------------------ *
 * Where a message ends
 * ------------------------------------------------------------------ */

/**
 * Lines that mark the start of a quoted reply. Everything from here down is
 * the previous message in the thread, which Gmail already hands over as its
 * own message — so keeping it would extract the same sentence twice, once per
 * reply in the thread, and every one of those copies would need dismissing
 * separately in review.
 */
const QUOTE_BOUNDARIES: RegExp[] = [
  /^On .{4,120}\bwrote:\s*$/im,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  /^_{10,}\s*$/m,
  /^From:\s.+$/im,
  /^Sent from my \w+/im,
  /^Le .{4,120}\ba écrit ?:\s*$/im,
  /^El .{4,120}\bescribió:\s*$/im,
];

/**
 * Footer boilerplate. Present on the bulk mail that gets past the filter above
 * — a newsletter a colleague forwarded, say — and on plenty of ordinary
 * corporate mail whose legal disclaimer is longer than its content.
 */
const FOOTER_BOUNDARIES: RegExp[] = [
  /^.{0,80}\bunsubscribe\b.{0,120}$/im,
  /^.{0,80}\bview (this email |it )?in (your )?browser\b.{0,80}$/im,
  /^.{0,80}\byou (are )?receiv(ed|ing) this (email|message)\b/im,
  /^.{0,80}\bthis (e-?mail|message) (and any attachments? )?(is|are) (intended|confidential)\b/im,
  /^.{0,80}\bmanage (your )?(email )?preferences\b.{0,80}$/im,
  /^.{0,80}\bupdate your preferences\b.{0,80}$/im,
  /^.{0,80}\ball rights reserved\b.{0,80}$/im,
  /^.{0,80}\bsent to you by\b.{0,80}$/im,
];

/** A signature block: a line of exactly `--` or `-- `, by long convention. */
const SIGNATURE_BOUNDARY = /^--\s*$/m;

/**
 * Trims a message body to the part the sender actually wrote this time.
 *
 * Conservative on purpose: it cuts at the earliest boundary it finds, but only
 * if something substantial survives the cut. A message that is *entirely* a
 * quote or a footer keeps its original text rather than becoming empty, because
 * an empty body would fail ingestion loudly for what is really a judgement call
 * about formatting.
 */
export function trimMailBody(body: string): string {
  let cut = body.length;

  for (const pattern of [...QUOTE_BOUNDARIES, ...FOOTER_BOUNDARIES, SIGNATURE_BOUNDARY]) {
    const match = pattern.exec(body);
    if (match && match.index < cut) cut = match.index;
  }

  const trimmed = body
    .slice(0, cut)
    // Any quoted lines that survived above a boundary we did not recognise.
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .trim();

  // Cutting everything away means the boundary was misread, not that the
  // message was empty. Better to keep too much than to drop a real message.
  return trimmed.length >= 30 ? trimmed : body.trim();
}
