import { describe, it, expect } from 'vitest';
import { prepareFieldParams, choiceValueFromLabel, parseFieldSpecs, handleCreateField, handleUpdateField } from '../../src/tools/fields.js';

const parse = (r: any) => JSON.parse(r.content[0].text);
const ok = (r: any) => { if ('error' in r) throw new Error(r.error); return r.params; };

const existingLink = {
  slug: 'sl1', label: 'Link', field_type: 'linkedrecordfield',
  params: { linked_application: 'appA', entries_allowed: 'single' },
};

const mkCtx = () => {
  let written: any = null;
  return {
    ctx: {
      config: { mode: 'admin', accountId: 'a', enableSchemaWrite: true, allowedApplications: [], deniedApplications: [] },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
      client: {
        addField: async (_i: string, f: any) => { written = f; },
        changeField: async (_i: string, f: any) => { written = f; },
        getApplication: async () => ({ id: 'app1', structure: [existingLink], structure_layout: {} }),
        getApplicationSchema: async () => ({ structure: [existingLink] }),
      },
    } as any,
    written: () => written,
  };
};

describe('choiceValueFromLabel', () => {
  it('matches how SmartSuite derives its own option keys', () => {
    expect(choiceValueFromLabel('Ready for Review')).toBe('ready_for_review');
    expect(choiceValueFromLabel('In Process')).toBe('in_process');
    expect(choiceValueFromLabel('  High/Urgent! ')).toBe('high_urgent');
    expect(choiceValueFromLabel('!!!')).toBe('option');
  });
});

describe('prepareFieldParams — camelCase aliases', () => {
  // describe_application emits `linkedApplication`; add_field requires `linked_application`.
  // Feeding a read straight back into a write used to create a field with a null target.
  it('converts linkedApplication to linked_application', () => {
    expect(ok(prepareFieldParams('linkedrecordfield', { linkedApplication: 'appX' })))
      .toMatchObject({ linked_application: 'appX' });
  });

  it('converts the other documented camelCase spellings', () => {
    const p = ok(prepareFieldParams('rollupfield', { linkedField: 'l', fieldSelection: 'n', function: 'sum' }));
    expect(p).toMatchObject({ linked_field: 'l', field_selection: 'n' });
    expect(ok(prepareFieldParams('textfield', { maxLength: 40 }))).toMatchObject({ max_length: 40 });
  });

  it('converts aliases inside choice entries', () => {
    const p: any = ok(prepareFieldParams('singleselectfield', { choices: [{ label: 'A', valueHelpText: 'desc' }] }));
    expect(p.choices[0]).toMatchObject({ value_help_text: 'desc' });
  });
});

describe('prepareFieldParams — choice values', () => {
  // A choice with no `value` is not an error to SmartSuite: it stores choices: [] and reports success.
  it('derives a value when the caller omits it', () => {
    const p: any = ok(prepareFieldParams('singleselectfield', { choices: [{ label: 'High' }, { label: 'Ready for Review' }] }));
    expect(p.choices.map((c: any) => c.value)).toEqual(['high', 'ready_for_review']);
  });

  it('preserves an explicit value', () => {
    const p: any = ok(prepareFieldParams('singleselectfield', { choices: [{ label: 'High', value: 'H' }] }));
    expect(p.choices[0].value).toBe('H');
  });

  it('de-duplicates labels that normalize alike', () => {
    const p: any = ok(prepareFieldParams('singleselectfield', { choices: [{ label: 'In Progress' }, { label: 'in-progress' }] }));
    expect(p.choices.map((c: any) => c.value)).toEqual(['in_progress', 'in_progress_2']);
  });

  it('still assigns colors and order', () => {
    const p: any = ok(prepareFieldParams('singleselectfield', { choices: [{ label: 'A' }] }));
    expect(p.choices[0]).toMatchObject({ value_color: '#0C41F3', value_order: 0, weight: 1 });
  });

  it('leaves non-select field types alone', () => {
    expect(ok(prepareFieldParams('textfield', { choices: [{ label: 'A' }] })) as any)
      .toMatchObject({ choices: [{ label: 'A' }] });
  });
});

describe('prepareFieldParams — params whose absence guarantees a broken field', () => {
  it('rejects a linked-record field with no target', () => {
    const r = prepareFieldParams('linkedrecordfield', {}) as any;
    expect(r.error).toContain('linked_application');
    expect(r.error).toContain('error badge');
  });

  it('rejects a rollup or lookup missing its link or selection', () => {
    expect((prepareFieldParams('rollupfield', { field_selection: 'n', function: 'sum' }) as any).error).toContain('linked_field');
    expect((prepareFieldParams('lookupfield', { linked_field: 'l' }) as any).error).toContain('field_selection');
  });

  it('accepts them once supplied, in either spelling', () => {
    expect(prepareFieldParams('linkedrecordfield', { linked_application: 'a' })).toHaveProperty('params');
    expect(prepareFieldParams('linkedrecordfield', { linkedApplication: 'a' })).toHaveProperty('params');
  });
});

describe('write paths', () => {
  it('blocks a targetless linked-record field in create_field, before any write', async () => {
    const { ctx, written } = mkCtx();
    const out = parse(await handleCreateField({ applicationId: 'app1', fieldType: 'linkedrecordfield', label: 'L', params: {}, confirm: true }, ctx));
    expect(out.error.code).toBe('SMARTSUITE_VALIDATION_ERROR');
    expect(written()).toBeNull();
  });

  it('accepts the camelCase spelling and writes snake_case', async () => {
    const { ctx, written } = mkCtx();
    await handleCreateField({ applicationId: 'app1', fieldType: 'linkedrecordfield', label: 'L', params: { linkedApplication: 'appX' }, confirm: true }, ctx);
    expect(written().params).toMatchObject({ linked_application: 'appX' });
    expect(written().params.linkedApplication).toBeUndefined();
  });

  it('reports the offending field by index AND label in a bulk/inline create', () => {
    const out = parseFieldSpecs([
      { fieldType: 'textfield', label: 'A' },
      { fieldType: 'linkedrecordfield', label: 'Owner' },
    ]) as any;
    expect(out.error).toContain('fields[1] (Owner)');
    expect(out.error).toContain('linked_application');
  });

  it('fills choice values through the inline-create path', () => {
    const out = parseFieldSpecs([{ fieldType: 'singleselectfield', label: 'S', params: { choices: [{ label: 'High' }] } }]) as any;
    expect(out.specs[0].params.choices[0].value).toBe('high');
  });

  it('lets a sparse update patch retarget a link without resupplying everything', async () => {
    const { ctx, written } = mkCtx();
    const out = parse(await handleUpdateField({ applicationId: 'app1', slug: 'sl1', params: { linkedApplication: 'appB' }, confirm: true }, ctx));
    expect(out.updated).toBe(true);
    expect(written().params).toMatchObject({ linked_application: 'appB', entries_allowed: 'single' });
  });

  it('lets an unrelated sparse patch through on a field whose required params already exist', async () => {
    const { ctx, written } = mkCtx();
    await handleUpdateField({ applicationId: 'app1', slug: 'sl1', params: { entries_allowed: 'multiple' }, confirm: true }, ctx);
    expect(written().params).toMatchObject({ linked_application: 'appA', entries_allowed: 'multiple' });
  });
});
