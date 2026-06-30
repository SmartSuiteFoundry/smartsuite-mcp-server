import { describe, it, expect } from 'vitest';
import { matchByName, applyConfirmations } from '../../src/migration/match.js';
import { normalizeField } from '../../src/migration/normalize.js';
import { diffFields, wholeTableDiff, summarize, collectDiffs, classifyReportKind, diffReports } from '../../src/migration/diff.js';
import { buildXlsx } from '../../src/migration/xlsx.js';
import { FieldDefinition } from '../../src/types/smartsuite.js';

const f = (slug: string, label: string, field_type: string, params: Record<string, unknown> = {}): FieldDefinition =>
  ({ slug, label, field_type, params } as FieldDefinition);

describe('matchByName', () => {
  it('classifies 1:1 / ambiguous / unmatched and finds prod-only', () => {
    const source = [{ id: 'lo1', name: 'CRM' }, { id: 'lo2', name: 'Ops' }, { id: 'lo3', name: 'New' }];
    const prod = [{ id: 'pr1', name: 'crm' }, { id: 'pr2', name: 'Ops' }, { id: 'pr3', name: 'Ops' }, { id: 'pr4', name: 'Gone' }];
    const { matches, prodOnly } = matchByName(source, prod);
    expect(matches.find((m) => m.name === 'CRM')).toMatchObject({ status: 'proposed', prodId: 'pr1' }); // case-insensitive
    expect(matches.find((m) => m.name === 'Ops')).toMatchObject({ status: 'ambiguous', prodId: null, candidates: ['pr2', 'pr3'] });
    expect(matches.find((m) => m.name === 'New')).toMatchObject({ status: 'unmatched', prodId: null });
    expect(prodOnly.map((p) => p.id)).toEqual(['pr4']);
  });
});

describe('applyConfirmations', () => {
  const matches = [
    { name: 'A', sourceId: 'a', prodId: 'pa', status: 'proposed' as const },
    { name: 'B', sourceId: 'b', prodId: null, status: 'ambiguous' as const, candidates: ['pb1', 'pb2'] },
  ];
  it('confirm promotes proposed but leaves ambiguous untouched', () => {
    const out = applyConfirmations(matches, { confirm: true });
    expect(out[0].status).toBe('confirmed');
    expect(out[1].status).toBe('ambiguous');
  });
  it('override pins a prodId and confirms it, clearing candidates', () => {
    const out = applyConfirmations(matches, { overrides: [{ sourceId: 'b', prodId: 'pb2' }] });
    expect(out[1]).toMatchObject({ status: 'confirmed', prodId: 'pb2', candidates: undefined });
  });
  it('does not mutate the input', () => {
    applyConfirmations(matches, { confirm: true });
    expect(matches[0].status).toBe('proposed');
  });
});

describe('normalizeField', () => {
  it('strips derived params and remaps linked_application', () => {
    const notes = new Set<string>();
    const map = new Map([['srcApp', 'prodApp']]);
    const n = normalizeField(f('s1', 'L', 'formulafield', { formula: 'x', score: 99, valid: true, linked_application: 'srcApp' }), map, notes);
    expect(n.params).toEqual({ formula: 'x', linked_application: 'prodApp' });
    expect(notes.size).toBe(0);
  });
  it('notes an app reference outside the mapping', () => {
    const notes = new Set<string>();
    normalizeField(f('s1', 'L', 'linkedrecordfield', { linked_application: 'a'.repeat(24) }), new Map(), notes);
    expect([...notes][0]).toMatch(/outside the mapping/);
  });
  it('reduces a rich-text help_doc to its authored data', () => {
    const notes = new Set<string>();
    const n = normalizeField(f('s1', 'L', 'textfield', { help_doc: { data: { type: 'doc', content: [] }, html: '', preview: '' } }), new Map(), notes);
    expect(n.params['help_doc']).toEqual({ type: 'doc', content: [] });
  });
});

describe('diffFields', () => {
  it('detects added, removed, and a same-target link as unchanged after remap', () => {
    const map = new Map([['srcApp', 'prodApp']]);
    const source = [f('keep', 'Keep', 'linkedrecordfield', { linked_application: 'srcApp' }), f('new', 'New', 'textfield')];
    const prod = [f('keep', 'Keep', 'linkedrecordfield', { linked_application: 'prodApp' }), f('old', 'Old', 'textfield')];
    const diffs = diffFields(source, prod, map);
    expect(diffs.find((d) => d.slug === 'keep')).toBeUndefined(); // remapped → identical
    expect(diffs.find((d) => d.slug === 'new')).toMatchObject({ changeType: 'added', risk: 'compatible' });
    expect(diffs.find((d) => d.slug === 'old')).toMatchObject({ changeType: 'removed', risk: 'risky' });
  });
  it('treats a same-slug label change as a modify (rename), not add+remove', () => {
    const diffs = diffFields([f('s1', 'New Name', 'textfield')], [f('s1', 'Old Name', 'textfield')], new Map());
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ changeType: 'modified', risk: 'compatible' });
    expect(diffs[0].details).toHaveProperty('label');
  });
  it('flags a field-type change as risky', () => {
    const diffs = diffFields([f('s1', 'L', 'numberfield')], [f('s1', 'L', 'textfield')], new Map());
    expect(diffs[0]).toMatchObject({ changeType: 'modified', risk: 'risky' });
    expect(diffs[0].details).toHaveProperty('fieldType');
  });
});

describe('summarize + wholeTableDiff', () => {
  it('lower-only adds compatibly, prod-only removes riskily, counts roll up', () => {
    const lowerOnly = wholeTableDiff('T1', 'lower-only', [f('a', 'A', 'textfield')], { sourceId: 's', prodId: null });
    const prodOnly = wholeTableDiff('T2', 'prod-only', [f('b', 'B', 'textfield')], { sourceId: null, prodId: 'p' });
    expect(lowerOnly.fields[0]).toMatchObject({ changeType: 'added', risk: 'compatible' });
    expect(prodOnly.fields[0]).toMatchObject({ changeType: 'removed', risk: 'risky' });
    const sum = summarize([{ name: 'S', sourceId: 's', prodId: 'p', tables: [lowerOnly, prodOnly] }]);
    expect(sum).toMatchObject({ tablesAdded: 1, tablesRemoved: 1, fieldsAdded: 1, fieldsRemoved: 1, risky: 1 });
  });
});

describe('collectDiffs', () => {
  it('treats null / undefined / {} / [] / "" as equivalent (default-blob noise)', () => {
    const out: Record<string, any> = {};
    collectDiffs({ a: null, b: {}, c: [] }, { a: undefined, d: '' }, '', out);
    expect(out).toEqual({});
  });
  it('records leaf paths for real differences and treats arrays atomically', () => {
    const out: Record<string, any> = {};
    collectDiffs({ a: { b: 1 }, list: [1] }, { a: { b: 2 }, list: [2] }, '', out);
    expect(out['a.b']).toEqual({ source: 1, prod: 2 });
    expect(out['list']).toEqual({ source: [1], prod: [2] });
  });
});

describe('classifyReportKind', () => {
  it('maps view_mode to kind', () => {
    expect(classifyReportKind('form')).toBe('form');
    expect(classifyReportKind('dashboard')).toBe('dashboard');
    expect(classifyReportKind('grid')).toBe('view');
    expect(classifyReportKind('calendar')).toBe('view');
  });
});

describe('diffReports', () => {
  const rep = (id: string, label: string, view_mode: string, extra: Record<string, unknown> = {}) =>
    ({ id, label, view_mode, application: 'a', solution: 's', owner: 'owner-' + id, sharing_hash: 'h-' + id, ...extra }) as any;

  it('matches by label per kind: added / removed / modified, ignoring system + irrelevant blobs', () => {
    const source = [
      rep('s1', 'Keep', 'grid', { state: { visibleFields: ['x'] }, dashboard: { tabs: { enabled: false } } }),
      rep('s2', 'NewView', 'grid'),
    ];
    const prod = [
      rep('p1', 'Keep', 'grid', { state: { visibleFields: ['y'] }, dashboard: { tabs: { enabled: true } } }),
      rep('p3', 'OldView', 'grid'),
    ];
    const diffs = diffReports(source, prod, new Map());
    const keep = diffs.find((d) => d.label === 'Keep')!;
    expect(keep.changeType).toBe('modified');
    expect(Object.keys(keep.details!)).toEqual(['state.visibleFields']); // dashboard ignored for views; owner/sharing_hash ignored
    expect(diffs.find((d) => d.label === 'NewView')).toMatchObject({ changeType: 'added', kind: 'view' });
    expect(diffs.find((d) => d.label === 'OldView')).toMatchObject({ changeType: 'removed' });
  });

  it('remaps application references so a same-target view reads as unchanged', () => {
    const source = [rep('s1', 'V', 'grid', { application: 'srcApp', state: { visibleFields: ['x'] } })];
    const prod = [rep('p1', 'V', 'grid', { application: 'prodApp', state: { visibleFields: ['x'] } })];
    expect(diffReports(source, prod, new Map([['srcApp', 'prodApp']]))).toEqual([]);
  });
});

describe('buildXlsx', () => {
  it('produces a valid, cleanly-framed zip with the expected parts', () => {
    const buf = buildXlsx([{ name: 'Summary', rows: [['a', 1], ['b', 2]] }, { name: 'Detail', rows: [['x']] }]);
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04])); // local file header PK\x03\x04
    const i = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); // EOCD
    expect(i).toBeGreaterThan(0);
    const commentLen = buf.readUInt16LE(i + 20);
    expect(commentLen).toBe(0);
    expect(buf.length - (i + 22)).toBe(0); // no trailing bytes
    const entries = buf.readUInt16LE(i + 10);
    expect(entries).toBe(6); // 4 package parts + 2 sheets
  });
});
