import Link from 'next/link';
import type { McpClient } from '@cairn/domain';

/**
 * "What do I do next", answered above the fold.
 *
 * The home page used to open with a workspace name, a summary, and then
 * several screens of review cards. Nothing on it said what the product was
 * for or how far through setting it up you were, so a person arriving for the
 * second time had no way to tell whether they had finished. This is the
 * answer to both questions, and it is deliberately the first thing on the
 * page.
 *
 * Everything here is derived from data the page already loads. No new query
 * exists for the checklist; `homeChecklist` is a pure function over values
 * `loadOverview` and `loadConnections` were returning anyway.
 */

export interface ChecklistStep {
  /** Short imperative, e.g. "Connect an AI tool". */
  title: string;
  /** One line saying what this gets you, in the product's own terms. */
  body: string;
  done: boolean;
  href: string;
  /** Link text when the step is not yet done. */
  action: string;
}

/**
 * The three steps that actually matter, in the order they pay off.
 *
 * Connecting a tool leads because it is the product's whole point and because
 * it is the step people were failing to find — it used to sit last, several
 * screens down, behind the review queue. Adding something and keeping
 * something follow, because a connected tool with nothing saved answers
 * nothing.
 *
 * Deliberately three. A checklist long enough to feel like a chore gets
 * dismissed, and every extra step past the ones that change what the product
 * can do is a step that only measures compliance.
 */
export function homeChecklist(input: {
  hasWorkingAi: boolean;
  hasAnyAi: boolean;
  sourceCount: number;
  approvedCount: number;
}): ChecklistStep[] {
  return [
    {
      title: 'Connect an AI tool',
      body: input.hasAnyAi
        ? 'Connected. Add another any time — they all read this same memory.'
        : 'Claude, Claude Code, Codex, Gemini and others can read this memory. Set up once.',
      done: input.hasAnyAi,
      href: '/connections',
      action: 'Connect one',
    },
    {
      title: 'Add something worth remembering',
      body:
        input.sourceCount > 0
          ? `Reading from ${input.sourceCount} place${input.sourceCount === 1 ? '' : 's'}.`
          : 'Connect Gmail or Drive, or paste a note. Connect it once here and every AI tool sees it.',
      done: input.sourceCount > 0,
      href: '/sources',
      action: 'Add something',
    },
    {
      title: 'Keep what is right',
      body:
        input.approvedCount > 0
          ? `${input.approvedCount} thing${input.approvedCount === 1 ? '' : 's'} saved and readable by your tools.`
          : 'Nothing reaches an AI tool until you keep it. Review what was found below.',
      done: input.approvedCount > 0,
      href: '/memory',
      action: 'Review what was found',
    },
  ];
}

export function SetupChecklist({ steps }: { steps: ChecklistStep[] }) {
  const remaining = steps.filter((s) => !s.done).length;
  if (remaining === 0) return null;

  return (
    <section className="cairn-setup" aria-labelledby="setup-heading">
      <div className="cairn-setup__head">
        <h2 id="setup-heading" className="cairn-setup__title">
          {remaining === steps.length
            ? 'Three steps to set this up'
            : `${remaining} step${remaining === 1 ? '' : 's'} left`}
        </h2>
        <p className="cairn-setup__lede">
          When this is done, the AI tools you already use answer from the same memory.
        </p>
      </div>
      <ol className="cairn-setup__steps">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className={step.done ? 'cairn-setup__step is-done' : 'cairn-setup__step'}
          >
            <span className="cairn-setup__mark" aria-hidden="true">
              {step.done ? '✓' : index + 1}
            </span>
            <div className="cairn-setup__body">
              <h3 className="cairn-setup__step-title">
                {step.title}
                {step.done ? <span className="cairn-visually-hidden"> — done</span> : null}
              </h3>
              <p className="cairn-setup__step-body">{step.body}</p>
              {step.done ? null : (
                <Link href={step.href} className="cairn-setup__action">
                  {step.action}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Connection status
 * ------------------------------------------------------------------ */

export type ConnectionState = 'working' | 'idle' | 'off';

/**
 * How recently a tool must have read something to count as working.
 *
 * Long enough that a tool used yesterday still reads as healthy, short enough
 * that "working" means something. A tool that has not been used in a fortnight
 * is not broken, so it falls back to the neutral "connected" rather than to
 * anything that reads as a fault.
 */
const WORKING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Three honest states, replacing a badge that said "Active" for everything.
 *
 * "Active" only ever meant `revokedAt === null` — a tool set up months ago and
 * never once used said "Active" exactly as loudly as one answering questions
 * all day. That is the badge the owner of this product could not read, and he
 * was right not to trust it.
 *
 * This can only tell the truth because `lastUsedAt` is now written on the
 * OAuth path (see `authenticateIssued` in packages/mcp/src/auth.ts). Before
 * that fix it was null for every connection made through sign-in, so every
 * tile here would have claimed "set up, not used yet" forever.
 */
export function connectionState(client: McpClient, now: Date): ConnectionState {
  if (client.revokedAt) return 'off';
  if (!client.lastUsedAt) return 'idle';
  return now.getTime() - client.lastUsedAt.getTime() <= WORKING_WINDOW_MS ? 'working' : 'idle';
}

export function connectionStateLabel(state: ConnectionState): string {
  if (state === 'working') return 'Working';
  if (state === 'idle') return 'Set up, not used yet';
  return 'Turned off';
}

/** "2 hours ago", "yesterday", "on 3 March" — never a bare timestamp. */
export function usedAgo(when: Date | null, now: Date): string {
  if (!when) return 'Has not read anything yet';
  const ms = now.getTime() - when.getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return 'Read something just now';
  if (minutes < 60) return `Read something ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Read something ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Read something yesterday';
  if (days < 30) return `Read something ${days} days ago`;
  return `Last read on ${when.toISOString().slice(0, 10)}`;
}

/**
 * The tools, as tiles rather than as a six-column table.
 *
 * A table row is a fine way to hold six facts and a poor way to answer "is
 * this working". The status is what people come here for, so it is the thing
 * with the colour and the position, and the rest is small print underneath.
 */
export function ConnectionTiles({
  clients,
  now,
  emptyHref = '/connections',
}: {
  clients: McpClient[];
  now: Date;
  emptyHref?: string;
}) {
  const live = clients.filter((c) => !c.revokedAt);

  if (live.length === 0) {
    return (
      <div className="cairn-tiles__empty">
        <p style={{ margin: '0 0 0.75rem' }}>
          No AI tool is reading this memory yet. That is the part that makes the rest worth doing.
        </p>
        <Link href={emptyHref} className="cairn-button cairn-button--primary">
          Connect your first tool
        </Link>
      </div>
    );
  }

  return (
    <ul className="cairn-tiles">
      {live.map((client) => {
        const state = connectionState(client, now);
        return (
          <li key={client.id} className="cairn-tile">
            <span className={`cairn-tile__dot cairn-tile__dot--${state}`} aria-hidden="true" />
            <div>
              <h3 className="cairn-tile__name">{client.name}</h3>
              <p className="cairn-tile__state">{connectionStateLabel(state)}</p>
              <p className="cairn-tile__meta">{usedAgo(client.lastUsedAt, now)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
