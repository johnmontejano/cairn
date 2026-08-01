import { describe, expect, it } from 'vitest';
import {
  MINIMUM_CONNECTED_APPS,
  mayWriteBack,
  nextSetupStep,
  setupState,
  type SetupInput,
} from '@cairn/domain';

const at = (over: Partial<SetupInput> = {}): SetupInput => ({
  step: 'connect',
  connectedApps: MINIMUM_CONNECTED_APPS,
  saveBackMode: 'important',
  settledAt: null,
  ...over,
});

describe('setupState', () => {
  it('starts at the offer when nothing has been recorded', () => {
    expect(setupState(at({ step: null })).step).toBe('offer');
  });

  it('will not leave the connect step while apps are missing', () => {
    const state = setupState(at({ connectedApps: 1 }));

    expect(state.canAdvance).toBe(false);
    expect(state.blockedBecause).toBe('One more app needs connecting before setup can continue.');
    // Refusing to advance has to be visible as null, not as the same step
    // returned again — a caller retrying that would loop without learning why.
    expect(nextSetupStep(state)).toBeNull();
  });

  it('counts down in plain language when more than one is missing', () => {
    const state = setupState(at({ connectedApps: 0 }));
    expect(state.blockedBecause).toBe('2 more apps need connecting before setup can continue.');
  });

  it('advances once enough apps are connected', () => {
    const state = setupState(at({ connectedApps: MINIMUM_CONNECTED_APPS }));

    expect(state.canAdvance).toBe(true);
    expect(state.blockedBecause).toBeNull();
    expect(nextSetupStep(state)).toBe('save_back');
  });

  it('re-derives the gate, so disconnecting everything closes it again', () => {
    // The reason the count is not stored: this person passed the gate, then
    // removed their connections. A remembered tally would still say passed.
    const after = setupState(at({ step: 'connect', connectedApps: 0 }));
    expect(after.canAdvance).toBe(false);
  });

  it('gates only the connect step', () => {
    const state = setupState(at({ step: 'save_back', connectedApps: 0 }));
    expect(state.canAdvance).toBe(true);
  });

  it('has no step after the last one', () => {
    expect(nextSetupStep(setupState(at({ step: 'ready' })))).toBeNull();
  });

  it('reports settled once a decision has been recorded', () => {
    expect(setupState(at({ settledAt: new Date('2026-07-31') })).settled).toBe(true);
  });
});

describe('mayWriteBack', () => {
  it('writes nothing when that is what was chosen', () => {
    expect(mayWriteBack('nothing', true)).toBe(false);
  });

  it('writes everything when that is what was chosen', () => {
    expect(mayWriteBack('everything', false)).toBe(true);
  });

  it('defaults to keeping only what matters', () => {
    // The default writes less on purpose: missing a note costs less than
    // recording something the person would not have chosen to keep.
    expect(mayWriteBack('important', true)).toBe(true);
    expect(mayWriteBack('important', false)).toBe(false);
  });
});
