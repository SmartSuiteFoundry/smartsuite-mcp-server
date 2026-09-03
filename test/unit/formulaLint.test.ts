import { describe, it, expect } from 'vitest';
import { lintFormula, parseCalls, suggestReturnType, explainApiFailure } from '../../src/tools/formulaLint.js';

const schema = {
  id: 'app1',
  structure: [
    { slug: 'title', label: 'Title', field_type: 'recordtitlefield', params: {} },
    { slug: 'created', label: 'Created', field_type: 'firstcreatedfield', params: {} },
    { slug: 'touched', label: 'Updated', field_type: 'lastupdatedfield', params: {} },
    { slug: 'pct', label: 'Percent', field_type: 'percentfield', params: {} },
    { slug: 'amt', label: 'Amount', field_type: 'numberfield', params: {} },
    { slug: 'link', label: 'Invoices', field_type: 'linkedrecordfield', params: {} },
  ],
} as any;

const rules = (f: string, s?: any, rt?: string) => lintFormula(f, s, rt).map((w) => w.rule);
const find = (f: string, rule: string, s?: any, rt?: string) =>
  lintFormula(f, s, rt).find((w) => w.rule === rule);

describe('parseCalls', () => {
  it('splits arguments at top-level commas only', () => {
    const [outer] = parseCalls('ARRAYJOIN(GET_LIST([a].[b] = "x, y", [a].[c]), "; ")');
    expect(outer.name).toBe('ARRAYJOIN');
    expect(outer.args).toHaveLength(2);
    expect(outer.args[1]).toBe('"; "');
  });

  it('records the nearest enclosing call', () => {
    const calls = parseCalls('SUM(TOP(RELATED_RECORDS_SORT([a].[b], [a].[c]), 3))');
    expect(calls.find((c) => c.name === 'SUM')!.parent).toBeNull();
    expect(calls.find((c) => c.name === 'TOP')!.parent).toBe('SUM');
    expect(calls.find((c) => c.name === 'RELATED_RECORDS_SORT')!.parent).toBe('TOP');
  });

  it('does not treat text inside a string literal as syntax', () => {
    expect(parseCalls('CONCAT([title], "SUM(x)")').map((c) => c.name)).toEqual(['CONCAT']);
    expect(rules('CONCAT([title], "a <> b")')).not.toContain('inequality-operator');
  });
});

describe('lintFormula — traps the API accepts as valid', () => {
  it('flags a reversed DATEDIFF', () => {
    expect(find('DATEDIFF([touched], [created], "days")', 'datediff-order', schema)?.severity).toBe('warning');
    expect(rules('DATEDIFF(NOW(), [created], "hours")', schema)).toContain('datediff-order');
    // Correct order stays quiet.
    expect(rules('DATEDIFF([created], [touched], "days")', schema)).not.toContain('datediff-order');
  });

  it('flags FIND(...) > 0 but not >= 0', () => {
    expect(rules('IF(FIND("x", [title]) > 0, "y", "n")')).toContain('find-comparison');
    expect(rules('IF(FIND("x", [title]) >= 0, "y", "n")')).not.toContain('find-comparison');
  });

  it('flags a percent field divided by 100, and only when one is referenced', () => {
    expect(find('[amt] * [pct] / 100', 'percent-arithmetic', schema)?.message).toContain('[pct]');
    expect(rules('[amt] * [pct]', schema)).not.toContain('percent-arithmetic');
    expect(rules('[amt] / 100', schema)).not.toContain('percent-arithmetic');
  });

  it('flags a 1-based MID start', () => {
    expect(rules('MID([title], 1, 5)')).toContain('index-base');
    expect(rules('MID([title], 0, 5)')).not.toContain('index-base');
  });

  it("explains LOG's base argument and CEILING's significance", () => {
    expect(find('LOG([amt], 10)', 'log-base-argument')?.hint).toContain('log base 10');
    expect(find('CEILING([amt], 2)', 'significance-argument')?.message).toContain('significance');
    expect(rules('LOG([amt])')).not.toContain('log-base-argument');
  });

  it('flags an unwrapped array-returning function', () => {
    expect(find('GET_LIST([link].[a] = "x", [link].[b])', 'array-not-wrapped')?.severity).toBe('error');
    expect(rules('ARRAYJOIN(GET_LIST([link].[a] = "x", [link].[b]), "; ")')).not.toContain('array-not-wrapped');
  });

  it('flags the singular sort wrapped in an array consumer', () => {
    expect(rules('ARRAYJOIN(RELATED_RECORD_SORT([link].[a], [link].[b], "ASC"), "; ")')).toContain('singular-sort-wrapped');
    expect(rules('RELATED_RECORD_SORT([link].[a], [link].[b], "ASC")')).not.toContain('singular-sort-wrapped');
  });

  it('notes the DESC default when sort order is omitted', () => {
    expect(rules('ARRAYJOIN(GET_LIST([link].[a] = "x", [link].[b], [link].[c]), "; ")')).toContain('sort-order-default');
    expect(rules('ARRAYJOIN(GET_LIST([link].[a] = "x", [link].[b], [link].[c], "ASC"), "; ")')).not.toContain('sort-order-default');
  });

  it('notes a CASE with no trailing default', () => {
    expect(rules('CASE([title], "a", "A", "b", "B")')).toContain('case-no-default');
    expect(rules('CASE([title], "a", "A", "fallback")')).not.toContain('case-no-default');
  });
});

describe('lintFormula — catchable before the round trip', () => {
  it('flags typographic quotes and counts them', () => {
    const w = find('CONCAT([title], “;”)', 'smart-quotes')!;
    expect(w.severity).toBe('error');
    expect(w.message).toContain('2 typographic quote');
  });

  it('flags <> and quoted booleans', () => {
    expect(rules('IF([title] <> "x", "a", "b")')).toContain('inequality-operator');
    expect(rules('IF([link].[done] = "TRUE", "y", "n")')).toContain('quoted-boolean');
  });

  it('flags singular date units with the plural to use', () => {
    expect(find('DATEADD([created], 1, "day")', 'date-unit')?.hint).toContain('"days"');
    expect(rules('DATEADD([created], 1, "days")')).not.toContain('date-unit');
  });

  it('flags reference chains deeper than one hop', () => {
    expect(rules('CONCAT([link].[cust].[name])')).toContain('reference-depth');
    expect(rules('CONCAT([link].[name])')).not.toContain('reference-depth');
  });

  it('names functions that do not exist and suggests the real one', () => {
    expect(find('IF(ISBLANK([title]), "a", "b")', 'unknown-function')?.hint).toContain('IFNONE');
    expect(find('IFERROR([amt], 0)', 'unknown-function')?.hint).toContain('no error-trapping');
    expect(find('IS_NULL([title])', 'unknown-function')?.hint).toContain('engine rejects it');
  });
});

describe('lintFormula — arity', () => {
  it('reports too few and too many arguments', () => {
    expect(find('IF([amt] > 1, "a")', 'arity')?.message).toContain('at least 3');
    expect(find('LEFT([title], 3, 4)', 'arity')?.message).toContain('at most 2');
    expect(rules('IF([amt] > 1, "a", "b")')).not.toContain('arity');
  });

  // The published doc says AVGIF takes three arguments with the link and target split.
  // The engine rejects that ("can not have more than 2 arguments"); AVGIF is dotted like SUMIF.
  it('treats AVGIF as two-argument, per the engine rather than the docs', () => {
    expect(find('AVGIF([link].[tax] > 0, [link], [tax])', 'arity')?.hint).toContain('TWO arguments');
    expect(rules('AVGIF([link].[tax] > 0, [link].[tax])')).not.toContain('arity');
  });
});

describe('suggestReturnType', () => {
  it('maps the outermost call to a field type', () => {
    expect(suggestReturnType('SUM([link].[amt])')).toBe('numberfield');
    expect(suggestReturnType('DATEADD([created], 1, "days")')).toBe('datefield');
    expect(suggestReturnType('AND([amt] > 1, [amt] < 9)')).toBe('yesnofield');
    expect(suggestReturnType('[amt] > 1')).toBe('yesnofield');
    expect(suggestReturnType('CONCAT([title], "x")')).toBeNull();
  });

  it('advises only when a numeric result is left as the textfield default', () => {
    expect(rules('SUM([link].[amt])', schema, 'textfield')).toContain('return-type');
    expect(rules('SUM([link].[amt])', schema, 'numberfield')).not.toContain('return-type');
    expect(rules('CONCAT([title], "x")', schema, 'textfield')).not.toContain('return-type');
  });
});

describe('explainApiFailure', () => {
  it('translates the terse rejections', () => {
    expect(explainApiFailure('Invalid syntax', 'CONCAT([t], “;”)')).toContain('typographic quotes');
    expect(explainApiFailure('Invalid syntax', 'IF([t] <> "x", 1, 2)')).toContain('`!=`');
    expect(explainApiFailure('Invalid syntax', 'IF([t] > 1, "a", "b"')).toContain('Unbalanced parentheses');
    expect(explainApiFailure('Invalid Syntax', 'TOP([a].[b], 3)')).toContain('must be wrapped');
    expect(explainApiFailure(
      'DATEADD: duedatefield and constant 1 and constant day cannot participate in an expression together.',
      'DATEADD([d], 1, "day")',
    )).toContain('"days"');
    expect(explainApiFailure('Invalid function: ISBLANK', 'ISBLANK([t])')).toContain('IFNONE');
  });

  it('returns null when it has nothing to add', () => {
    expect(explainApiFailure('Field nope not found in application Epics', 'CONCAT([nope])')).toBeNull();
    expect(explainApiFailure('Invalid syntax', 'CONCAT([t], "ok")')).toBeNull();
  });
});

describe('lintFormula — quiet on clean input', () => {
  it('returns nothing for well-formed formulas', () => {
    const clean: Array<[string, string]> = [
      ['CONCAT([title], " - ", [amt])', 'textfield'],
      ['IFNONE([title], "Unassigned")', 'textfield'],
      ['SUMIF([link].[status] = "Final", [link].[amt])', 'currencyfield'],
      ['ARRAYJOIN(TOP(RELATED_RECORDS_SORT([link].[a], [link].[b], "DESC"), 3), "; ")', 'textfield'],
      ['IF(FIND("urgent", LOWER([title])) >= 0, "Flagged", "")', 'textfield'],
      ['DATEDIFF([created], NOW(), "hours")', 'durationfield'],
    ];
    for (const [f, rt] of clean) {
      expect(lintFormula(f, schema, rt), f).toEqual([]);
    }
  });

  it('runs without a schema, skipping only the schema-aware rules', () => {
    expect(rules('DATEDIFF([touched], [created], "days")')).toEqual([]);
    expect(rules('MID([title], 1, 5)')).toContain('index-base');
  });
});
