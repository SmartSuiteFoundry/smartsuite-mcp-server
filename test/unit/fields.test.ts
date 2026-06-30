import { describe, it, expect } from 'vitest';
import { buildFieldDef, mergeFieldParams } from '../../src/tools/fields.js';
import { generateFieldSlug } from '../../src/tools/formulas.js';

describe('generateFieldSlug', () => {
  it('produces s + 9 hex', () => {
    expect(generateFieldSlug()).toMatch(/^s[0-9a-f]{9}$/);
  });
});

describe('buildFieldDef', () => {
  it('wraps slug/label/type with pass-through params (default empty)', () => {
    expect(buildFieldDef('s1', 'Text', 'textfield')).toEqual({ slug: 's1', label: 'Text', field_type: 'textfield', params: {} });
    expect(buildFieldDef('s2', 'Pick', 'singleselectfield', { choices: [{ label: 'A', value: 'a' }] }).params).toEqual({ choices: [{ label: 'A', value: 'a' }] });
  });
});

describe('mergeFieldParams', () => {
  it('shallow-merges patch onto existing (patch wins, others preserved)', () => {
    expect(mergeFieldParams({ max_length: 10, required: false }, { max_length: 50 })).toEqual({ max_length: 50, required: false });
  });
  it('does not mutate the inputs', () => {
    const existing = { a: 1 };
    mergeFieldParams(existing, { b: 2 });
    expect(existing).toEqual({ a: 1 });
  });
});
