import { describe, it, expect } from 'vitest';
import { normalizeField } from '../../src/tools/applications.js';
import type { FieldDefinition } from '../../src/types/smartsuite.js';

const field = (over: Partial<FieldDefinition> & { params?: Record<string, any> } = {}): FieldDefinition =>
  ({
    slug: 's1',
    label: 'Title',
    field_type: 'textfield',
    params: {},
    ...over,
  }) as FieldDefinition;

describe('normalizeField token-lean projection', () => {
  it('omits false flags and null help (de-noise) in standard mode', () => {
    const out = normalizeField(field());
    expect(out).toEqual({ slug: 's1', label: 'Title', type: 'textfield' });
    expect(out).not.toHaveProperty('required');
    expect(out).not.toHaveProperty('helpText');
  });

  it('includes flags only when true, help only when present', () => {
    const out = normalizeField(field({ params: { required: true, help_text: 'be brief' } }));
    expect(out.required).toBe(true);
    expect(out.helpText).toBe('be brief');
    expect(out).not.toHaveProperty('primary');
  });

  it('compact keeps options + linked-app but drops flags/help/display hints', () => {
    const out = normalizeField(
      field({
        params: {
          required: true,
          help_text: 'x',
          display_format: 'stars',
          choices: [{ value: 'a', label: 'A', value_color: '#fff' }],
          linked_application: 'app123',
        },
      }),
      'compact',
    );
    expect(out).toEqual({
      slug: 's1',
      label: 'Title',
      type: 'textfield',
      options: [{ value: 'a', label: 'A' }],
      linkedApplication: 'app123',
    });
  });

  it('full appends the raw params blob', () => {
    const out = normalizeField(field({ params: { max_length: 25 } }), 'full');
    expect((out.params as any).max_length).toBe(25);
  });
});
