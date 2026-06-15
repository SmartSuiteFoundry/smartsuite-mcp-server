import { describe, it, expect } from 'vitest';
import { summarizeLimits, flattenActions, normalizeActionGroups, injectCredential } from '../../src/tools/automations.js';

describe('summarizeLimits', () => {
  it('derives remaining and percent used', () => {
    expect(summarizeLimits({ plan_category: 'enterprise', limit: 500000, usage: 9412, enforceLimit: true })).toEqual({
      planCategory: 'enterprise',
      automationRunLimit: 500000,
      automationRunsUsed: 9412,
      remaining: 490588,
      percentUsed: 1.9,
      enforced: true,
    });
  });

  it('clamps remaining at zero when over limit', () => {
    expect(summarizeLimits({ limit: 100, usage: 150 }).remaining).toBe(0);
  });

  it('handles missing fields without throwing', () => {
    expect(summarizeLimits({})).toEqual({
      planCategory: null,
      automationRunLimit: null,
      automationRunsUsed: null,
      remaining: null,
      percentUsed: null,
      enforced: null,
    });
  });
});

describe('flattenActions', () => {
  it('flattens nested action_groups[].actions.actions[] in order', () => {
    const automation = {
      automation_id: 'a',
      action_groups: [
        { actions: { actions: [{ action_reference: { action_id: 'x', instance_id: 1 } }, { action_reference: { action_id: 'y', instance_id: 2 } }] } },
        { actions: { actions: [{ action_reference: { action_id: 'z', instance_id: 3 } }] } },
      ],
    } as any;
    expect(flattenActions(automation).map((a) => a.action_reference.action_id)).toEqual(['x', 'y', 'z']);
  });

  it('returns [] when there are no action groups', () => {
    expect(flattenActions({ automation_id: 'a' } as any)).toEqual([]);
  });
});

describe('normalizeActionGroups', () => {
  it('passes through native actionGroups unchanged', () => {
    const groups = [{ actions: { actions: [{ action_reference: { action_id: 'x' } }] } }];
    expect(normalizeActionGroups({ actionGroups: groups })).toBe(groups);
  });

  it('wraps a flat actions array into a single group', () => {
    const actions = [{ action_reference: { action_id: 'x' } }, { action_reference: { action_id: 'y' } }];
    expect(normalizeActionGroups({ actions })).toEqual([{ actions: { actions } }]);
  });

  it('returns [] for an empty flat actions array', () => {
    expect(normalizeActionGroups({ actions: [] })).toEqual([]);
  });

  it('returns [] when neither actionGroups nor actions is provided', () => {
    expect(normalizeActionGroups({})).toEqual([]);
  });
});

describe('injectCredential', () => {
  it('fills credential onto trigger and actions that lack one, leaving existing ids', () => {
    const automation = {
      trigger: { trigger_reference: { trigger_id: 't' } },
      action_groups: [
        { actions: { actions: [{ action_reference: { action_id: 'a' } }, { action_reference: { action_id: 'b' }, credential_id: 'keep' }] } },
      ],
    };
    const out = injectCredential(automation, 'cred-1');
    expect(out.trigger.credential_id).toBe('cred-1');
    expect(out.action_groups[0].actions.actions[0].credential_id).toBe('cred-1');
    expect(out.action_groups[0].actions.actions[1].credential_id).toBe('keep');
  });

  it('does not mutate the input and is a no-op without a credentialId', () => {
    const automation = { trigger: { trigger_reference: { trigger_id: 't' } }, action_groups: [] };
    const out = injectCredential(automation, undefined);
    expect(out).toEqual(automation);
    expect(out).not.toBe(automation);
    expect(automation.trigger).not.toHaveProperty('credential_id');
  });
});
