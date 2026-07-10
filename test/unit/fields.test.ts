import { describe, it, expect } from 'vitest';
import { buildFieldDef, mergeFieldParams, normalizeChoices } from '../../src/tools/fields.js';
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

describe('normalizeChoices', () => {
  it('assigns value_color + value_order to select choices that omit them', () => {
    const out = normalizeChoices('singleselectfield', { choices: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] });
    expect((out.choices as any)[0].value_color).toBe('#0C41F3');
    expect((out.choices as any)[0].value_order).toBe(0);
    expect((out.choices as any)[1].value_color).toBe('#00B3FA');
    expect((out.choices as any)[1].value_order).toBe(1);
  });
  it('preserves an explicit value_color', () => {
    const out = normalizeChoices('statusfield', { choices: [{ label: 'X', value: 'x', value_color: '#123456' }] });
    expect((out.choices as any)[0].value_color).toBe('#123456');
  });
  it('defaults value_help_text + weight on single/multi choices that omit them', () => {
    const out = normalizeChoices('multipleselectfield', { choices: [{ label: 'A', value: 'a' }] });
    expect((out.choices as any)[0].value_help_text).toBe('');
    expect((out.choices as any)[0].weight).toBe(1);
  });
  it('preserves an explicit description (value_help_text) and numeric value (weight)', () => {
    const out = normalizeChoices('singleselectfield', {
      choices: [{ label: 'A', value: 'a', value_help_text: 'first option', weight: 5 }],
    });
    expect((out.choices as any)[0].value_help_text).toBe('first option');
    expect((out.choices as any)[0].weight).toBe(5);
  });
  it('does not add weight/description to status choices', () => {
    const out = normalizeChoices('statusfield', { choices: [{ label: 'X', value: 'x' }] });
    expect((out.choices as any)[0]).not.toHaveProperty('weight');
    expect((out.choices as any)[0]).not.toHaveProperty('value_help_text');
  });
  it('is a no-op for non-select field types', () => {
    const params = { choices: [{ label: 'A', value: 'a' }] };
    expect(normalizeChoices('textfield', params)).toBe(params);
  });
});
