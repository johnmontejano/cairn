import { MINIMUM_CONNECTED_APPS, type SaveBackMode, type SetupStep, setupSteps } from './types';

/**
 * First-run setup, as a state machine.
 *
 * Setup runs inside whichever AI tool the person connected rather than on a web
 * page, which changes what this has to be. A web wizard can keep its place in a
 * session; this has to answer "where are we, and what is missing" from a cold
 * call with no cookie, in any order, any number of times.
 *
 * It reports rather than instructs. Unabyss drives the equivalent by returning
 * text addressed to the assistant — "call step2 next, do not offer to skip" —
 * which works only for clients that treat tool output as commands. Cairn
 * returns state and lets the client decide, so a client that ignores imperative
 * text still gets setup right, and one that is being manipulated by a hostile
 * tool result is not learning that habit here.
 */

export interface SetupState {
  step: SetupStep;
  /** How many source connections are live right now. */
  connectedApps: number;
  /** False while `connect` cannot be left. */
  canAdvance: boolean;
  /** Plain sentence naming what is missing. Null when nothing is. */
  blockedBecause: string | null;
  saveBackMode: SaveBackMode;
  settled: boolean;
}

export interface SetupInput {
  step: SetupStep | null;
  connectedApps: number;
  saveBackMode: SaveBackMode;
  settledAt: Date | null;
}

/**
 * Where setup stands.
 *
 * Derived on every call rather than trusted from storage. The gate depends on
 * how many apps are connected *now*: a count written down at the moment someone
 * passed it would still read as passed after they disconnected everything.
 */
export function setupState(input: SetupInput): SetupState {
  const step = input.step ?? 'offer';
  const settled = input.settledAt !== null;
  const shortBy = MINIMUM_CONNECTED_APPS - input.connectedApps;
  const blocked = step === 'connect' && shortBy > 0;

  return {
    step,
    connectedApps: input.connectedApps,
    canAdvance: !blocked,
    blockedBecause: blocked
      ? shortBy === 1
        ? 'One more app needs connecting before setup can continue.'
        : `${shortBy} more apps need connecting before setup can continue.`
      : null,
    saveBackMode: input.saveBackMode,
    settled,
  };
}

/**
 * The step that follows, or null at the end.
 *
 * Refuses to leave `connect` while the gate is unmet. Returning the same step
 * rather than throwing would be worse: a caller that retried would loop without
 * ever learning why.
 */
export function nextSetupStep(state: SetupState): SetupStep | null {
  if (!state.canAdvance) return null;
  const index = setupSteps.indexOf(state.step);
  return index >= 0 && index < setupSteps.length - 1 ? setupSteps[index + 1]! : null;
}

/**
 * Whether an assistant may save something back without asking first.
 *
 * `important` is the default and deliberately not `everything`: a person who has
 * not thought about it should end up with the option that writes less, because
 * the cost of missing a note is smaller than the cost of recording something
 * they would not have chosen to keep.
 */
export function mayWriteBack(mode: SaveBackMode, significant: boolean): boolean {
  if (mode === 'nothing') return false;
  if (mode === 'everything') return true;
  return significant;
}
