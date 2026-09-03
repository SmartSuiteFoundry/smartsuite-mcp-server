import { ApplicationDetail } from '../types/smartsuite.js';
import { extractReferenceChains } from './formulas.js';

/**
 * Static lint pass for SmartSuite formula expressions.
 *
 * SmartSuite's own validate endpoint is a SYNTAX checker: it rejects unknown functions, bad
 * slugs, malformed arguments and most arity violations, but it accepts — with `valid:true` —
 * every one of the semantic traps that produce plausible wrong numbers. Verified against the
 * live API: a reversed DATEDIFF, `FIND(...) > 0`, a percent field divided by 100, a 1-based
 * MID, `LOG(x, 10)` read as precision, and an unsorted TOP all validate clean.
 *
 * This pass runs locally before the API call and reports what the API cannot see. It is
 * ADVISORY — warnings never block a write, because a heuristic that is wrong should cost a
 * line of output, not a correct formula.
 *
 * Rules and the function catalog come from docs/smartsuite-formula-functions.md, with every
 * arity bound and disputed claim re-verified against the live validate endpoint. Where the
 * doc and the engine disagree, the engine wins and the divergence is noted here.
 */

export type LintSeverity = 'error' | 'warning' | 'info';

export interface FormulaLintWarning {
  rule: string;
  severity: LintSeverity;
  message: string;
  hint?: string;
}

interface Signature {
  min: number;
  max: number;
}

/**
 * The 84 callable functions (the other 10 of the documented 94 are infix operators).
 * Arity bounds marked ✓ were confirmed against the live validate endpoint; the rest follow
 * the published signature and are only used for lenient "too few / too many" reporting.
 */
const CATALOG: Record<string, Signature> = {
  // Logical
  AND: { min: 1, max: Infinity }, OR: { min: 1, max: Infinity }, NOT: { min: 1, max: 1 }, // ✓ NOT max 1
  IF: { min: 3, max: 3 },                 // ✓ min 3
  CASE: { min: 3, max: Infinity },        // ✓ min 3
  IFNONE: { min: 2, max: 2 },             // ✓ min 2
  IS_NOT_NULL: { min: 1, max: 1 }, CONTAINS: { min: 2, max: 2 }, LIKE: { min: 2, max: 2 },
  // Text
  CONCAT: { min: 1, max: Infinity }, TEXT: { min: 1, max: 1 }, T: { min: 1, max: 1 },
  NUMBER: { min: 1, max: 2 }, BLANK: { min: 0, max: 0 },
  LEFT: { min: 2, max: 2 }, RIGHT: { min: 2, max: 2 },  // ✓ LEFT max 2
  MID: { min: 3, max: 3 },                // ✓ min 3
  LENGTH: { min: 1, max: 1 },             // ✓ max 1
  LOWER: { min: 1, max: 1 }, UPPER: { min: 1, max: 1 }, TRIM: { min: 1, max: 1 },
  REPLACE: { min: 3, max: 3 }, REPT: { min: 2, max: 2 },
  FIND: { min: 2, max: 4 }, RFIND: { min: 2, max: 4 },
  ARRAYJOIN: { min: 2, max: 3 }, ARRAYUNIQUE: { min: 2, max: 3 },
  ENCODE_URL_COMPONENT: { min: 1, max: 1 }, RECORD_ID: { min: 0, max: 0 },
  LAST_MODIFIED_BY: { min: 0, max: Infinity },
  // Numeric
  ABS: { min: 1, max: 1 },                // ✓ max 1
  SUM: { min: 1, max: Infinity },
  SUMIF: { min: 2, max: 2 },              // ✓ min 2
  AVG: { min: 1, max: Infinity },
  // The published doc calls AVGIF a THREE-argument function with the link and target split
  // (`AVGIF(Criteria, [LR], [Target])`). The engine rejects that: "AVGIF can not have more
  // than 2 arguments". Verified twice, including against a real linked-record field. AVGIF
  // takes the same dotted two-argument shape as SUMIF.
  AVGIF: { min: 2, max: 2 },              // ✓ min 2, max 2
  MIN: { min: 1, max: Infinity }, MAX: { min: 1, max: Infinity },
  MEDIAN: { min: 1, max: Infinity }, STDEV: { min: 1, max: Infinity },
  COUNT: { min: 1, max: 1 },              // ✓ max 1
  COUNT_DISTINCT: { min: 1, max: 1 },
  COUNTIF: { min: 2, max: 2 },            // ✓ min 2
  COUNTIF_DISTINCT: { min: 2, max: 2 },
  COUNTA: { min: 1, max: Infinity }, COUNTALL: { min: 1, max: Infinity },
  CHECKLIST_COUNT: { min: 2, max: 2 }, NUMERICVALUE: { min: 1, max: 1 },
  ROUND: { min: 2, max: 2 }, ROUNDUP: { min: 2, max: 2 }, ROUNDDOWN: { min: 2, max: 2 }, // ✓ min 2 each
  CEILING: { min: 1, max: 2 }, FLOOR: { min: 1, max: 2 },  // ✓ min 1 (significance optional)
  EVEN: { min: 1, max: 1 }, ODD: { min: 1, max: 1 }, MOD: { min: 2, max: 2 },
  POWER: { min: 2, max: 3 }, SQRT: { min: 1, max: 2 }, EXP: { min: 1, max: 2 },
  LOG: { min: 1, max: 3 },
  // Date
  DATE: { min: 1, max: 1 },
  DATETIME: { min: 1, max: 1 },           // ✓ max 1 (the doc's multi-arg example is wrong)
  TODAY: { min: 0, max: 0 }, NOW: { min: 0, max: 0 },   // ✓ TODAY max 0
  DATEADD: { min: 3, max: 3 },            // ✓ min 3
  DATEDIFF: { min: 3, max: 3 },           // ✓ unit required
  DATE_FORMAT: { min: 2, max: 2 },        // ✓ min 2
  DATETIME_FORMAT: { min: 2, max: 2 },
  DAY: { min: 1, max: 1 }, MONTH: { min: 1, max: 1 }, QUARTER: { min: 1, max: 1 },
  YEAR: { min: 1, max: 1 }, HOUR: { min: 1, max: 1 }, MINUTE: { min: 1, max: 1 },
  WEEK: { min: 1, max: 2 }, WEEKDAY: { min: 1, max: 2 },
  WORKDAYS: { min: 2, max: 2 }, WORKDAYS_DIFF: { min: 2, max: 2 },
  LAST_MODIFIED_TIME: { min: 0, max: Infinity }, LAST_MODIFIED_TIME_STATUS: { min: 1, max: 1 },
  // List
  FIRST: { min: 1, max: 1 },              // ✓ max 1
  TOP: { min: 2, max: 2 },                // ✓ min 2
  GET_LIST: { min: 2, max: 4 },
  RELATED_RECORD_SORT: { min: 2, max: 3 }, RELATED_RECORDS_SORT: { min: 2, max: 3 },
};

/** Names people reach for that SmartSuite does not have, with what to use instead. */
const NONEXISTENT: Record<string, string> = {
  ISBLANK: 'Use IFNONE([field], fallback) or IS_NOT_NULL([field]).',
  ISEMPTY: 'Use IFNONE([field], fallback) or IS_NOT_NULL([field]).',
  IS_EMPTY: 'Use IFNONE([field], fallback) or IS_NOT_NULL([field]).',
  EMPTY: 'Use IFNONE([field], fallback) or IS_NOT_NULL([field]).',
  IS_NULL: 'IS_NULL appears in SmartSuite\'s own published examples but the engine rejects it. Use IS_NOT_NULL or IFNONE.',
  IFERROR: 'SmartSuite has no error-trapping function. Guard the input instead, e.g. IF([d] != 0, [n] / [d], BLANK()).',
  COALESCE: 'Use IFNONE([field], fallback).',
  SUBSTITUTE: 'Use REPLACE(Text, Find, ReplaceWith) — it replaces every occurrence.',
  SEARCH: 'Use FIND(Find, Text) — 0-based, returns -1 when not found.',
  LEN: 'Use LENGTH(Text).',
  COUNTIFS: 'Use COUNTIF(Criteria, [LinkedRecord]) — criteria come first.',
  SUMIFS: 'Use SUMIF(Criteria, [LinkedRecord].[Number]) — criteria come first.',
  VLOOKUP: 'Use a Lookup field, or GET_LIST to pull values across a link.',
};

/** Array-returning functions: their result must be consumed by an aggregate (rule 3). */
const ARRAY_RETURNING = new Set(['TOP', 'GET_LIST', 'RELATED_RECORDS_SORT']);

/** Functions that consume an array — used to spot the singular sort in a plural position. */
const ARRAY_CONSUMING = new Set([
  'ARRAYJOIN', 'ARRAYUNIQUE', 'TOP', 'SUM', 'AVG', 'MIN', 'MAX', 'MEDIAN', 'STDEV',
  'COUNT', 'COUNT_DISTINCT', 'COUNTA', 'COUNTALL', 'FIRST',
]);

const VALID_DATE_UNITS = new Set(['minutes', 'hours', 'days', 'weeks', 'months', 'years']);
const SINGULAR_DATE_UNITS: Record<string, string> = {
  minute: 'minutes', hour: 'hours', day: 'days', week: 'weeks', month: 'months', year: 'years',
  second: 'seconds', m: 'minutes', h: 'hours', d: 'days', w: 'weeks', y: 'years',
};

interface ParsedCall {
  name: string;
  args: string[];
  /** Character offset of the function name. */
  start: number;
  /** Offset just past the closing paren. */
  end: number;
  /** Name of the nearest enclosing call, or null at the top level. */
  parent: string | null;
}

/**
 * Blank out the contents of string literals so later pattern matching never fires inside a
 * quoted value. Length is preserved so every offset stays valid against the original text.
 */
function maskStrings(formula: string): string {
  const out = formula.split('');
  let inString = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (ch === '"') { inString = !inString; continue; }
    if (inString) out[i] = ' ';
  }
  return out.join('');
}

/** Split an argument list at top-level commas, respecting nested parens. */
function splitArgs(text: string, masked: string): string[] {
  if (!text.trim()) return [];
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args;
}

/** Parse every `NAME(...)` call, with its arguments and its enclosing call. */
export function parseCalls(formula: string): ParsedCall[] {
  const masked = maskStrings(formula);
  const calls: ParsedCall[] = [];
  const re = /([A-Z][A-Z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < masked.length; i++) {
      if (masked[i] === '(') depth++;
      else if (masked[i] === ')' && --depth === 0) { close = i; break; }
    }
    if (close === -1) continue; // unbalanced; the API reports this
    calls.push({
      name: m[1],
      args: splitArgs(formula.slice(open + 1, close), masked.slice(open + 1, close)),
      start: m.index,
      end: close + 1,
      parent: null,
    });
  }
  // The nearest enclosing call is the innermost other call whose span strictly contains this one.
  for (const call of calls) {
    let best: ParsedCall | null = null;
    for (const other of calls) {
      if (other === call) continue;
      if (other.start < call.start && other.end >= call.end) {
        if (!best || other.start > best.start) best = other;
      }
    }
    call.parent = best?.name ?? null;
  }
  return calls;
}

/** slug → field_type for the target application, used by the schema-aware rules. */
function fieldTypes(schema?: ApplicationDetail): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of schema?.structure ?? []) map.set(f.slug, f.field_type);
  return map;
}

/** Field types that carry a creation timestamp (the earlier side of a duration). */
const CREATED_TYPES = new Set(['firstcreatedfield']);
/** Field types and calls that carry a "now"-ish timestamp (the later side of a duration). */
const MODIFIED_TYPES = new Set(['lastupdatedfield']);

function mentionsType(expr: string, types: Set<string>, slugTypes: Map<string, string>): boolean {
  for (const chain of extractReferenceChains(expr)) {
    const t = slugTypes.get(chain[chain.length - 1]) ?? slugTypes.get(chain[0]);
    if (t && types.has(t)) return true;
  }
  return false;
}

/**
 * Lint a formula expression. `schema` is optional — without it the schema-aware rules
 * (percent arithmetic, DATEDIFF ordering) are skipped and everything else still runs.
 */
export function lintFormula(
  formula: string,
  schema?: ApplicationDetail,
  returnType?: string,
): FormulaLintWarning[] {
  const warnings: FormulaLintWarning[] = [];
  const push = (rule: string, severity: LintSeverity, message: string, hint?: string) =>
    warnings.push(hint ? { rule, severity, message, hint } : { rule, severity, message });

  const masked = maskStrings(formula);
  const calls = parseCalls(formula);
  const slugTypes = fieldTypes(schema);

  // ── Rule 1: typographic quotes are not string delimiters ──────────────────
  const smart = formula.match(/[“”‘’]/g);
  if (smart) {
    push('smart-quotes', 'error',
      `Formula contains ${smart.length} typographic quote character(s) (${[...new Set(smart)].join(' ')}), which are not string delimiters.`,
      'Retype them as straight " quotes. This is the usual result of pasting from documentation or chat.');
  }

  // ── Rule 11: the only inequality form is != ───────────────────────────────
  if (masked.includes('<>')) {
    push('inequality-operator', 'error', 'SmartSuite does not accept `<>` as an inequality operator.', 'Use `!=`.');
  }

  for (const call of calls) {
    const sig = CATALOG[call.name];

    // ── Unknown / nonexistent functions ─────────────────────────────────────
    if (!sig) {
      const replacement = NONEXISTENT[call.name];
      push('unknown-function', 'error',
        `\`${call.name}\` is not a SmartSuite formula function.`,
        replacement ?? 'Check the spelling against the 94 documented functions — an unlisted name will fail validation.');
      continue;
    }

    // ── Arity ───────────────────────────────────────────────────────────────
    const n = call.args.length;
    if (n < sig.min) {
      push('arity', 'error',
        `\`${call.name}\` takes at least ${sig.min} argument${sig.min === 1 ? '' : 's'}; ${n} given.`,
        call.name === 'AVGIF' ? 'AVGIF(Criteria, [Link].[Number]) — criteria first, then the dotted target.' : undefined);
    } else if (n > sig.max) {
      push('arity', 'error',
        `\`${call.name}\` takes at most ${sig.max} argument${sig.max === 1 ? '' : 's'}; ${n} given.`,
        call.name === 'AVGIF'
          ? 'Despite SmartSuite\'s published example, AVGIF takes TWO arguments in the same dotted shape as SUMIF: AVGIF(Criteria, [Link].[Number]).'
          : undefined);
    }

    // ── Rule 3: array-returning functions must be consumed ──────────────────
    if (ARRAY_RETURNING.has(call.name) && call.parent === null) {
      push('array-not-wrapped', 'error',
        `\`${call.name}\` returns an array, not a value, so it cannot be the whole formula.`,
        'Wrap it in an aggregate — ARRAYJOIN(..., "; ") for text, or SUM/COUNT/MIN/MAX for numbers.');
    }

    // ── Singular vs plural sort — one letter, array vs value ────────────────
    if (call.name === 'RELATED_RECORD_SORT' && call.parent && ARRAY_CONSUMING.has(call.parent)) {
      push('singular-sort-wrapped', 'warning',
        `RELATED_RECORD_SORT returns a single value but is wrapped in \`${call.parent}\`, which consumes an array.`,
        'RELATED_RECORDS_SORT (plural) is the array form. Check the S.');
    }

    // ── Sort direction defaults to DESC, which silently inverts "oldest N" ──
    if (call.name === 'GET_LIST' && n < 4) {
      push('sort-order-default', 'info',
        'GET_LIST has no SortOrder argument, so it defaults to "DESC".',
        'Pass "ASC" explicitly if you want oldest/lowest first.');
    }
    if ((call.name === 'RELATED_RECORD_SORT' || call.name === 'RELATED_RECORDS_SORT') && n < 3) {
      push('sort-order-default', 'info',
        `${call.name} has no SortOrder argument, so it defaults to "DESC" (highest/latest first).`,
        'Pass "ASC" for lowest/earliest.');
    }

    // ── Rule 6: date units are plural strings ───────────────────────────────
    if (call.name === 'DATEADD' || call.name === 'DATEDIFF') {
      const unit = call.args[2]?.trim();
      const literal = unit?.match(/^"(.*)"$/)?.[1];
      if (literal !== undefined && !VALID_DATE_UNITS.has(literal)) {
        const plural = SINGULAR_DATE_UNITS[literal.toLowerCase()];
        push('date-unit', 'error',
          `\`"${literal}"\` is not a valid ${call.name} unit.`,
          plural
            ? `Units are plural: use "${plural}".`
            : 'Valid units are "minutes", "hours", "days", "weeks", "months", "years".');
      }
    }

    // ── Rule 7: DATEDIFF takes the earlier date first ───────────────────────
    if (call.name === 'DATEDIFF' && call.args.length >= 2 && slugTypes.size) {
      const [a, b] = call.args;
      const aIsLater = /\b(NOW|TODAY)\s*\(/.test(a) || mentionsType(a, MODIFIED_TYPES, slugTypes);
      const bIsEarlier = mentionsType(b, CREATED_TYPES, slugTypes);
      if (aIsLater && bIsEarlier) {
        push('datediff-order', 'warning',
          'DATEDIFF looks reversed: the first argument is the later moment and the second is the earlier one, which yields negative durations.',
          'DATEDIFF(earlier, later, "days"). This validates clean either way — the API cannot catch it.');
      }
    }

    // ── LOG\'s second argument is Base, not Precision ────────────────────────
    if (call.name === 'LOG' && n === 2) {
      push('log-base-argument', 'info',
        'LOG\'s second argument is the Base, not the precision (unlike SQRT and EXP).',
        `LOG(x, ${call.args[1]}) means "log base ${call.args[1]}". Precision is the third argument.`);
    }

    // ── CEILING/FLOOR take a significance, not a digit count ────────────────
    if ((call.name === 'CEILING' || call.name === 'FLOOR') && n === 2) {
      push('significance-argument', 'info',
        `${call.name}'s second argument is the significance it rounds to a multiple of, not a number of decimal places.`,
        `${call.name}(x, ${call.args[1]}) rounds to the nearest multiple of ${call.args[1]}. Use ROUND for decimal places.`);
    }

    // ── Rule 4: string positions are 0-based ────────────────────────────────
    if (call.name === 'MID' && call.args[1]?.trim() === '1') {
      push('index-base', 'info',
        'MID positions are 0-based, so a start of 1 skips the first character.',
        'MID([text], 0, n) takes the first n characters.');
    }

    // ── CASE with an odd argument count has no trailing default ─────────────
    if (call.name === 'CASE' && n >= 3 && n % 2 === 1) {
      push('case-no-default', 'info',
        'CASE has an odd argument count, so every argument after the first forms a match/result pair and there is no trailing default.',
        'Records matching nothing return blank. Add a final argument as the default if that is not intended.');
    }
  }

  // ── Rule 5: FIND/RFIND return -1 when not found, so the test is >= 0 ──────
  const findCompare = /\b(?:R?FIND)\s*\([^)]*\)\s*>\s*0(?!\s*\.)/.exec(masked);
  if (findCompare) {
    push('find-comparison', 'warning',
      'FIND/RFIND are 0-based and return -1 when not found, so `> 0` silently misses a match at position 0.',
      'Use `>= 0` to test "found".');
  }

  // ── Rule 8: percent fields are already fractions ─────────────────────────
  if (slugTypes.size && /\/\s*100\b/.test(masked)) {
    const percentSlugs = extractReferenceChains(formula)
      .map((c) => c[c.length - 1])
      .filter((s) => slugTypes.get(s) === 'percentfield');
    if (percentSlugs.length) {
      push('percent-arithmetic', 'warning',
        `Formula divides by 100 and references percent field${percentSlugs.length > 1 ? 's' : ''} [${[...new Set(percentSlugs)].join('], [')}], which already evaluate as fractions (0.15 for 15%).`,
        'Drop the / 100 — otherwise every result is 100x too small.');
    }
  }

  // ── Rule 9: booleans are unquoted TRUE/FALSE ─────────────────────────────
  if (/[=!]=?\s*"(TRUE|FALSE)"/i.test(formula)) {
    push('quoted-boolean', 'warning',
      'Booleans are compared unquoted in SmartSuite criteria.',
      'Use `= TRUE` / `= FALSE`, not `= "TRUE"`.');
  }

  // ── Rule 10: one dot hop for related data ────────────────────────────────
  for (const chain of extractReferenceChains(formula)) {
    if (chain.length > 2) {
      push('reference-depth', 'error',
        `[${chain.join('].[')}] hops ${chain.length - 1} levels; SmartSuite formulas allow one.`,
        'Add a formula or lookup field on the linked table and reference that instead.');
      break;
    }
  }

  // ── returnType advisory ──────────────────────────────────────────────────
  const suggested = suggestReturnType(formula);
  if (suggested && returnType === 'textfield' && suggested !== 'textfield') {
    push('return-type', 'info',
      `This formula produces a ${suggested === 'datefield' ? 'date' : suggested === 'yesnofield' ? 'boolean' : 'numeric'} result but returnType is "textfield", which sorts alphabetically and breaks downstream aggregation.`,
      `Consider returnType: "${suggested}".`);
  }

  return warnings;
}

const NUMERIC_FNS = new Set([
  'ABS', 'SUM', 'SUMIF', 'AVG', 'AVGIF', 'MIN', 'MAX', 'MEDIAN', 'STDEV', 'COUNT',
  'COUNT_DISTINCT', 'COUNTIF', 'COUNTIF_DISTINCT', 'COUNTA', 'COUNTALL', 'CHECKLIST_COUNT',
  'NUMERICVALUE', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'CEILING', 'FLOOR', 'EVEN', 'ODD', 'MOD',
  'POWER', 'SQRT', 'EXP', 'LOG', 'LENGTH', 'DATEDIFF', 'WORKDAYS_DIFF', 'DAY', 'MONTH',
  'QUARTER', 'YEAR', 'HOUR', 'MINUTE', 'WEEK', 'WEEKDAY', 'FIND', 'RFIND', 'NUMBER',
]);
const DATE_FNS = new Set(['DATE', 'DATETIME', 'TODAY', 'NOW', 'DATEADD', 'WORKDAYS', 'LAST_MODIFIED_TIME', 'LAST_MODIFIED_TIME_STATUS']);
const BOOLEAN_FNS = new Set(['AND', 'OR', 'NOT', 'CONTAINS', 'LIKE', 'IS_NOT_NULL']);

/**
 * Infer the field type a formula's result belongs in, from its outermost call.
 * Returns null when the shape does not imply one (e.g. IF returning either branch).
 */
export function suggestReturnType(formula: string): string | null {
  const calls = parseCalls(formula);
  const outer = calls.find((c) => c.parent === null);
  if (!outer) {
    // No call at all — a bare comparison is a boolean, anything else we leave alone.
    return /[<>]=?|!=|==/.test(maskStrings(formula)) ? 'yesnofield' : null;
  }
  if (NUMERIC_FNS.has(outer.name)) return 'numberfield';
  if (DATE_FNS.has(outer.name)) return 'datefield';
  if (BOOLEAN_FNS.has(outer.name)) return 'yesnofield';
  return null;
}

/**
 * Translate the terser validate-endpoint rejections into the rule that was broken.
 * SmartSuite answers a typographic quote with a bare "Invalid syntax" and a singular date
 * unit with a sentence about field types; neither points at the actual mistake.
 */
export function explainApiFailure(message: string, formula: string): string | null {
  const m = message.toLowerCase();
  if (m.includes('invalid syntax') || m.includes('invalid_syntax')) {
    if (/[“”‘’]/.test(formula)) {
      return 'The formula contains typographic quotes (" ") which are not string delimiters — retype them as straight " quotes.';
    }
    if (formula.includes('<>')) return 'SmartSuite has no `<>` operator; use `!=`.';
    const opens = (maskStrings(formula).match(/\(/g) ?? []).length;
    const closes = (maskStrings(formula).match(/\)/g) ?? []).length;
    if (opens !== closes) return `Unbalanced parentheses: ${opens} open, ${closes} closed.`;
    for (const call of parseCalls(formula)) {
      if (ARRAY_RETURNING.has(call.name) && call.parent === null) {
        return `${call.name} returns an array and must be wrapped in an aggregate such as ARRAYJOIN or SUM.`;
      }
    }
  }
  if (m.includes('cannot participate in an expression together')) {
    for (const call of parseCalls(formula)) {
      if (call.name === 'DATEADD' || call.name === 'DATEDIFF') {
        const literal = call.args[2]?.trim().match(/^"(.*)"$/)?.[1];
        if (literal && !VALID_DATE_UNITS.has(literal)) {
          const plural = SINGULAR_DATE_UNITS[literal.toLowerCase()];
          return `${call.name} units are plural strings${plural ? ` — use "${plural}", not "${literal}"` : ': "minutes", "hours", "days", "weeks", "months", "years"'}.`;
        }
      }
    }
  }
  const unknown = message.match(/Invalid function:\s*([A-Z_0-9]+)/i);
  if (unknown && NONEXISTENT[unknown[1].toUpperCase()]) return NONEXISTENT[unknown[1].toUpperCase()];
  return null;
}
