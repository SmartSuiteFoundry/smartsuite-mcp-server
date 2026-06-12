import { describe, it, expect } from 'vitest';
import {
  extractReferenceChains,
  extractFunctions,
  maxNestingDepth,
  complexityTier,
  generateFieldSlug,
  buildFormulaFieldDef,
} from '../../src/tools/formulas.js';

describe('extractReferenceChains', () => {
  it('extracts a single same-table reference', () => {
    expect(extractReferenceChains('[s0eacc3691]')).toEqual([['s0eacc3691']]);
  });

  it('extracts multiple references from a function call', () => {
    expect(extractReferenceChains('IF([s274de8073],[s274de8073],[s0eacc3691])')).toEqual([
      ['s274de8073'],
      ['s274de8073'],
      ['s0eacc3691'],
    ]);
  });

  it('extracts a chained reference (linked record / compound sub-field)', () => {
    expect(extractReferenceChains('ROUND(WORKDAYS_DIFF([sc54ef9b0d].[from_date], [sc54ef9b0d].[to_date]), 0)')).toEqual([
      ['sc54ef9b0d', 'from_date'],
      ['sc54ef9b0d', 'to_date'],
    ]);
  });

  it('extracts a three-level cross-table chain', () => {
    expect(extractReferenceChains('FIRST(GET_LIST([s30a50c465].[sx639icf].[s057208850]))')).toEqual([
      ['s30a50c465', 'sx639icf', 's057208850'],
    ]);
  });

  it('returns an empty array for a formula with no references', () => {
    expect(extractReferenceChains('TODAY()')).toEqual([]);
  });
});

describe('extractFunctions', () => {
  it('finds uppercase function tokens', () => {
    expect(extractFunctions('ROUND(WORKDAYS_DIFF([a].[b], [a].[c]), 0)')).toEqual(['ROUND', 'WORKDAYS_DIFF']);
  });

  it('finds none in a bare reference', () => {
    expect(extractFunctions('[s0eacc3691]')).toEqual([]);
  });
});

describe('maxNestingDepth', () => {
  it('counts flat parentheses as depth 1', () => {
    expect(maxNestingDepth('IF([a],[b],[c])')).toBe(1);
  });

  it('counts nested parentheses', () => {
    expect(maxNestingDepth('ROUND(WORKDAYS_DIFF([a].[b], [a].[c]), 0)')).toBe(2);
  });

  it('ignores parentheses inside string literals', () => {
    expect(maxNestingDepth('CONCAT("(not real)", [a])')).toBe(1);
  });
});

describe('complexityTier', () => {
  it.each([
    [0, 'trivial'],
    [13, 'low'],
    [66, 'moderate'],
    [500, 'high'],
    [2751, 'extreme'],
  ])('maps score %i to tier %s', (score, tier) => {
    expect(complexityTier(score)).toBe(tier);
  });
});

describe('generateFieldSlug', () => {
  it('produces the SmartSuite custom-field slug format (s + 9 hex)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateFieldSlug()).toMatch(/^s[0-9a-f]{9}$/);
    }
  });

  it('produces distinct slugs', () => {
    const a = generateFieldSlug();
    const b = generateFieldSlug();
    expect(a).not.toBe(b);
  });
});

describe('buildFormulaFieldDef', () => {
  it('nests the return type in target_field_structure and marks it advanced', () => {
    const def = buildFormulaFieldDef('sabc123def', 'My Formula', 'CONCAT([title])', 'textfield');
    expect(def).toMatchObject({
      slug: 'sabc123def',
      label: 'My Formula',
      field_type: 'formulafield',
      params: {
        formula: 'CONCAT([title])',
        is_advanced: true,
        target_field_structure: { slug: 'sabc123def', field_type: 'textfield' },
      },
    });
  });
});
