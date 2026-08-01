'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps a page current while background work is still running.
 *
 * There is no "job finished" push from the server, so this polls by asking
 * Next to re-render the server component on an interval. Each refresh re-runs
 * the page's data load; once that load reports nothing is still running, the
 * caller passes `stillWorking={false}` and the interval clears itself. No
 * separate "done" signal is needed, and nothing renders here -- the visual
 * state (progress steps, callouts) stays owned by the server component.
 */
export function LiveProgress({ stillWorking }: { stillWorking: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!stillWorking) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [stillWorking, router]);

  return null;
}
