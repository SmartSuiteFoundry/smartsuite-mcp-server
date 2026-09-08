import { describe, it, expect } from 'vitest';
import { prepareFieldParams, findFieldReferences, handleDeleteField } from '../../src/tools/fields.js';

const parse = (r: any) => JSON.parse(r.content[0].text);

describe('countfield — the native way to count linked records', () => {
  it('accepts a link slug and nothing else', () => {
    expect(prepareFieldParams('countfield', { linked_field: 'slink' })).toHaveProperty('params');
  });

  it('accepts the camelCase spelling the read tools emit', () => {
    const r = prepareFieldParams('countfield', { linkedField: 'slink' }) as any;
    expect(r.params).toMatchObject({ linked_field: 'slink' });
  });

  it('rejects one with no link, naming what it needs', () => {
    const r = prepareFieldParams('countfield', {}) as any;
    expect(r.error).toContain('linked_field');
    expect(r.error).toContain('THIS table');
  });
});

describe('findFieldReferences', () => {
  const app = {
    structure: [
      { slug: 'target', label: 'Target', field_type: 'numberfield', params: {} },
      { slug: 'f1', label: 'Calc', field_type: 'formulafield', params: { formula: 'SUM([target]) + 1' } },
      { slug: 'f2', label: 'Other Calc', field_type: 'formulafield', params: { formula: 'SUM([untouched])' } },
      { slug: 'ai', label: 'Summary', field_type: 'textfield', params: { ai_agent: { instructions: { pill: 'target' } } } },
      { slug: 'r1', label: 'Roll', field_type: 'rollupfield', params: { linked_field: 'slink', field_selection: 'target' } },
      { slug: 'c1', label: 'Cnt', field_type: 'countfield', params: { linked_field: 'slink', field_filter: { fields: [{ field: 'target' }] } } },
    ],
    structure_layout: { fields_visibility_conditions: { fields: [{ field: 'target' }] } },
  } as any;

  it('finds every referent and says what each one is', () => {
    const refs = findFieldReferences(app, 'target');
    expect(refs.map((r) => r.kind).sort()).toEqual(
      ['ai-prompt', 'display-logic', 'field-filter', 'formula', 'rollupfield'].sort(),
    );
    expect(refs.find((r) => r.kind === 'formula')!.where).toContain('Calc');
  });

  it('does not match a field that merely looks similar', () => {
    expect(findFieldReferences(app, 'untouched').map((r) => r.kind)).toEqual(['formula']);
    expect(findFieldReferences(app, 'nothing_references_me')).toEqual([]);
  });

  it('never reports the field as referencing itself', () => {
    const self = { structure: [{ slug: 'x', label: 'X', field_type: 'formulafield', params: { formula: '[x]' } }] } as any;
    expect(findFieldReferences(self, 'x')).toEqual([]);
  });

  it('scans view configs when supplied', () => {
    const views = [
      { id: 'v1', label: 'Grid', state: { filter: { fields: [{ field: 'target' }] } } },
      { id: 'v2', label: 'Other', state: { filter: { fields: [] } } },
    ];
    const refs = findFieldReferences(app, 'target', views);
    expect(refs.filter((r) => r.kind === 'view').map((r) => r.where)).toEqual(['Grid']);
  });
});

describe('handleDeleteField reference reporting', () => {
  const app = {
    id: 'app1',
    structure: [
      { slug: 'target', label: 'Target', field_type: 'numberfield', params: {} },
      { slug: 'f1', label: 'Calc', field_type: 'formulafield', params: { formula: 'SUM([target])' } },
    ],
    structure_layout: {},
  };
  const mkCtx = (over: any = {}) => ({
    config: { mode: 'admin', accountId: 'a', enableSchemaWrite: true, enableDelete: true },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    client: {
      getApplicationSchema: async () => app,
      getApplication: async () => app,
      listReports: async () => [],
      deleteField: async () => undefined,
      ...(over.client ?? {}),
    },
  }) as any;

  it('warns about referents in the dry run', async () => {
    const out = parse(await handleDeleteField({ applicationId: 'app1', slug: 'target' }, mkCtx()));
    expect(out.dryRun).toBe(true);
    expect(out.references).toHaveLength(1);
    expect(out.warning).toContain('SmartSuite will NOT update them');
  });

  it('repeats them on the actual delete, so they are not lost', async () => {
    const out = parse(await handleDeleteField({ applicationId: 'app1', slug: 'target', confirm: true }, mkCtx()));
    expect(out.deleted).toBe(true);
    expect(out.references[0]).toMatchObject({ kind: 'formula' });
  });

  it('says so when views could not be read, rather than implying they were clean', async () => {
    const ctx = mkCtx({ client: { listReports: async () => { throw new Error('500'); } } });
    const out = parse(await handleDeleteField({ applicationId: 'app1', slug: 'target' }, ctx));
    expect(out.scope).toContain('views could not be read');
  });

  it('stays quiet when nothing references the field', async () => {
    const out = parse(await handleDeleteField({ applicationId: 'app1', slug: 'f1' }, mkCtx()));
    expect(out.references).toEqual([]);
    expect(out.warning).toBeUndefined();
  });
});
