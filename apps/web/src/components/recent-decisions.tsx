import { Callout } from '@cairn/ui';
import type { OverviewView } from '@/server/views';

/**
 * Acknowledges what just happened.
 *
 * Keeping or removing a memory takes its card out of the list, so the message
 * attached to that card goes with it. This sits above the list instead, and puts
 * undo directly next to the thing that was removed.
 */
export function RecentDecisions({
  decisions,
  csrf,
  returnTo,
}: {
  decisions: OverviewView['recentlyDecided'];
  csrf: string;
  /** Where to come back to after undoing. */
  returnTo: string;
}) {
  if (decisions.kept.length === 0 && decisions.removed.length === 0) return null;

  return (
    <div className="cairn-stack cairn-stack--sm" style={{ marginBottom: '1.5rem' }}>
      {decisions.kept.length > 0 ? (
        <Callout tone="good" live="polite" title="Kept.">
          <ul style={{ margin: 0, paddingLeft: '1.125rem' }}>
            {decisions.kept.slice(0, 5).map((item) => (
              <li key={item.id}>{item.title}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {decisions.removed.length > 0 ? (
        <Callout tone="info" live="polite" title="Removed. You can undo this from History.">
          <ul style={{ margin: 0, paddingLeft: '1.125rem' }}>
            {decisions.removed.slice(0, 5).map((item) => (
              <li key={item.id} className="cairn-row" style={{ justifyContent: 'space-between' }}>
                <span>{item.title}</span>
                <form method="post" action="/api/memory/undo">
                  <input type="hidden" name="csrf" value={csrf} />
                  <input type="hidden" name="memoryItemId" value={item.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button type="submit" className="cairn-button cairn-button--quiet">
                    Undo
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}
    </div>
  );
}
