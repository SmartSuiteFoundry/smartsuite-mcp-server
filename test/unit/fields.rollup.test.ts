import { describe, it, expect } from 'vitest';
import { validateRollupParams, ROLLUP_FUNCTIONS, parseFieldSpecs, handleCreateField, handleUpdateField } from '../../src/tools/fields.js';

const parse = (r: any) => JSON.parse(r.content[0].text);

const existingRollup = {
  slug: 'sr1', label: 'Rollup', field_type: 'rollupfield',
  params: { linked_field: 'slink', field_selection: 'snum', function: 'sum' },
};

const mkCtx = (over: any = {}) => {
  let added: any = null;
  return {
    ctx: {
      config: { mode: 'admin', accountId: 'a', enableSchemaWrite: true, allowedApplications: [], deniedApplications: [] },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
      client: {
        addField: async (_id: string, f: any) => { added = f; },
        changeField: async (_id: string, f: any) => { added = f; },
        getApplication: async () => ({ id: 'app1', structure: [existingRollup], structure_layout: {} }),
        getApplicationSchema: async () => ({ structure: [existingRollup] }),
        ...(over.client ?? {}),
      },
    } as any,
    written: () => added,
  };
};

describe('validateRollupParams', () => {
  it('accepts every function that computes a value', () => {
    for (const fn of ROLLUP_FUNCTIONS) {
      expect(validateRollupParams('rollupfield', { function: fn }), fn).toBeNull();
    }
  });

  // Verified live: over two linked records valued 10 and 4, these all returned null while
  // sum/min/max/average/range computed 14/4/10/7.00/6.
  it('rejects the tokens the old description advertised', () => {
    expect(validateRollupParams('rollupfield', { function: 'count' })).toContain('no "count" aggregate');
    expect(validateRollupParams('rollupfield', { function: 'concatenate' })).toContain('ARRAYJOIN');
  });

  it('rejects an invented token and names what is allowed', () => {
    const msg = validateRollupParams('rollupfield', { function: 'bogus_xyz' })!;
    expect(msg).toContain('does not compute');
    expect(msg).toContain('sum, min, max, average, range');
    expect(msg).toContain('accepts any token here without error');
  });

  it('rejects a non-string function', () => {
    expect(validateRollupParams('rollupfield', { function: 3 })).toContain('does not compute');
  });

  it('leaves sparse params and non-rollup fields alone', () => {
    expect(validateRollupParams('rollupfield', { linked_field: 'x' })).toBeNull();
    expect(validateRollupParams('rollupfield', {})).toBeNull();
    expect(validateRollupParams('numberfield', { function: 'count' })).toBeNull();
    expect(validateRollupParams('lookupfield', { function: 'nonsense' })).toBeNull();
  });
});

describe('create_field / create_fields / update_field gating', () => {
  it('blocks a bad rollup before any write', async () => {
    const { ctx, written } = mkCtx();
    const out = parse(await handleCreateField(
      { applicationId: 'app1', fieldType: 'rollupfield', label: 'R', params: { linked_field: 'l', field_selection: 'n', function: 'count' }, confirm: true },
      ctx,
    ));
    expect(out.error.code).toBe('SMARTSUITE_VALIDATION_ERROR');
    expect(written()).toBeNull();
  });

  it('still creates a valid rollup', async () => {
    const { ctx, written } = mkCtx();
    const out = parse(await handleCreateField(
      { applicationId: 'app1', fieldType: 'rollupfield', label: 'R', params: { linked_field: 'l', field_selection: 'n', function: 'range' }, confirm: true },
      ctx,
    ));
    expect(out.created).toBe(true);
    expect(written().params.function).toBe('range');
  });

  it('reports the offending index in a bulk create', () => {
    const out = parseFieldSpecs([
      { fieldType: 'textfield', label: 'A' },
      { fieldType: 'rollupfield', label: 'B', params: { linked_field: 'l', field_selection: 'n', function: 'concatenate' } },
    ]) as any;
    expect(out.error).toContain('fields[1]');
    expect(parseFieldSpecs([
      { fieldType: 'rollupfield', label: 'B', params: { linked_field: 'l', field_selection: 'n', function: 'sum' } },
    ])).toHaveProperty('specs');
  });

  it('catches a bad function introduced by a sparse update patch', async () => {
    const { ctx, written } = mkCtx();
    const out = parse(await handleUpdateField({ applicationId: 'app1', slug: 'sr1', params: { function: 'median' }, confirm: true }, ctx));
    expect(out.error.code).toBe('SMARTSUITE_VALIDATION_ERROR');
    expect(written()).toBeNull();
  });

  it('allows a patch that changes other rollup params', async () => {
    const { ctx, written } = mkCtx();
    const out = parse(await handleUpdateField({ applicationId: 'app1', slug: 'sr1', params: { field_selection: 'sother' }, confirm: true }, ctx));
    expect(out.updated).toBe(true);
    expect(written().params).toMatchObject({ function: 'sum', field_selection: 'sother' });
  });
});
