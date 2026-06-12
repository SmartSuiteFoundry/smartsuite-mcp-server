import { randomBytes } from 'node:crypto';
import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { ApplicationDetail, FieldDefinition } from '../types/smartsuite.js';
import { helpTextOf } from './fields.js';

/**
 * Formula analysis for a SmartSuite application.
 *
 * Three layers, matching the docs/formula_analyzer_v1.html reference tool:
 *   1. Identify — every formulafield with its return type, native score, validity.
 *   2. Complexity — native `params.score` plus structural metrics derived here
 *      (function count, nesting depth, reference/chain counts).
 *   3. Dependencies — resolve `[slug].[slug]...` reference chains across linked
 *      tables, rendered as both a Mermaid graph and an ASCII tree.
 *
 * The cross-table Impact Index (record-count × link fan-out sampling) is heavy —
 * it fires extra record-list calls per app/link — so it is opt-in behind `deep`.
 */

/** Field types whose `params.linked_application` lets a reference chain hop into another table. */
const LINK_TYPES = new Set(['linkedrecordfield', 'lookupfield', 'rollupfield', 'countfield']);

/** Extract `[slug]` / `[slug].[slug]...` reference chains from a formula expression.
 *  Mirrors the reference grammar in the analyzer; returns one slug-array per reference. */
export function extractReferenceChains(formula: string): string[][] {
  const out: string[][] = [];
  // Matches a leading [slug] optionally followed by .[slug] / .slug segments.
  const re = /\[([a-z0-9_]+)\]((?:\.\[?[a-z0-9_]+\]?)*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) {
    const chain = [m[1]];
    if (m[2]) {
      for (const seg of m[2].split('.')) {
        const slug = seg.replace(/[[\]]/g, '').trim();
        if (slug) chain.push(slug);
      }
    }
    out.push(chain);
  }
  return out;
}

/** Uppercase function tokens immediately followed by `(`, e.g. IF, DATEDIFF, GET_LIST. */
export function extractFunctions(formula: string): string[] {
  const re = /([A-Z][A-Z0-9_]+)\s*\(/g;
  const fns: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) fns.push(m[1]);
  return fns;
}

/** Maximum parenthesis nesting depth — a structural proxy for how hard the formula is to read. */
export function maxNestingDepth(formula: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (const ch of formula) {
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '(') max = Math.max(max, ++depth);
    else if (ch === ')') depth = Math.max(0, depth - 1);
  }
  return max;
}

interface FormulaMetrics {
  score: number;
  valid: boolean | null;
  returnType: string | null;
  isAdvanced: boolean | null;
  charLength: number;
  functionCount: number;
  distinctFunctions: string[];
  nestingDepth: number;
  referenceCount: number;
  chainedReferenceCount: number;
  maxChainDepth: number;
}

function formulaMetrics(field: FieldDefinition): FormulaMetrics {
  const formula = field.params.formula ?? '';
  const fns = extractFunctions(formula);
  const chains = extractReferenceChains(formula);
  return {
    score: Number(field.params.score ?? 0),
    valid: field.params.valid ?? null,
    returnType: field.params.target_field_structure?.field_type ?? null,
    isAdvanced: field.params.is_advanced ?? null,
    charLength: formula.length,
    functionCount: fns.length,
    distinctFunctions: [...new Set(fns)].sort(),
    nestingDepth: maxNestingDepth(formula),
    referenceCount: chains.length,
    chainedReferenceCount: chains.filter((c) => c.length > 1).length,
    maxChainDepth: chains.reduce((mx, c) => Math.max(mx, c.length), 0),
  };
}

/** Coarse, human-facing tier derived from the native score (which is heavily skewed). */
export function complexityTier(score: number): 'trivial' | 'low' | 'moderate' | 'high' | 'extreme' {
  if (score < 10) return 'trivial';
  if (score < 50) return 'low';
  if (score < 200) return 'moderate';
  if (score < 800) return 'high';
  return 'extreme';
}

// ── Dependency resolution ──────────────────────────────────────────────────

interface DepNode {
  appId: string;
  appName: string;
  fieldSlug: string;
  fieldLabel: string;
  fieldType: string;
  /** Present when this node hops into another table (link-type fields). */
  children?: DepNode[];
  /** Set when a referenced slug can't be found in the (reachable) schema. */
  unresolved?: boolean;
}

/** Resolve one reference chain into a linked node path, fetching linked-app schemas as needed. */
async function resolveChain(
  ctx: ToolContext,
  appId: string,
  chain: string[],
  schemaOf: (id: string) => Promise<ApplicationDetail | null>,
): Promise<DepNode | null> {
  if (!chain.length) return null;
  const schema = await schemaOf(appId);
  const field = schema?.structure?.find((f) => f.slug === chain[0]);
  if (!field) {
    return { appId, appName: schema?.name ?? appId, fieldSlug: chain[0], fieldLabel: chain[0], fieldType: 'unknown', unresolved: true };
  }
  const node: DepNode = {
    appId,
    appName: schema?.name ?? appId,
    fieldSlug: field.slug,
    fieldLabel: field.label,
    fieldType: field.field_type,
  };
  const rest = chain.slice(1);
  if (rest.length) {
    const linkedApp = field.params.linked_application;
    if (LINK_TYPES.has(field.field_type) && linkedApp) {
      // Cross-table hop: remaining segments resolve in the linked application's schema.
      const child = await resolveChain(ctx, linkedApp, rest, schemaOf);
      if (child) node.children = [child];
    } else {
      // Compound field (date range, due date, address, checklist, full name, …):
      // the remaining segments are sub-fields of THIS field, not separate records.
      // They are not present as top-level fields in the schema, so resolve them
      // as sub-field accessors rather than flagging them unresolved.
      let cursor = node;
      for (const sub of rest) {
        const subNode: DepNode = { appId, appName: node.appName, fieldSlug: sub, fieldLabel: sub, fieldType: 'subfield' };
        cursor.children = [subNode];
        cursor = subNode;
      }
    }
  }
  return node;
}

/** Flatten a node tree into "App:Field → App:Field" path strings for the ASCII tree. */
function nodePaths(node: DepNode, prefix: string[] = []): string[] {
  const here = [...prefix, `${node.appName}:${node.fieldLabel}`];
  if (!node.children?.length) return [here.join(' → ')];
  return node.children.flatMap((c) => nodePaths(c, here));
}

/** Build a Mermaid flowchart of the dependency graph rooted at the analyzed formula. */
function mermaidGraph(rootLabel: string, rootSlug: string, trees: DepNode[]): string {
  const lines = ['flowchart LR'];
  const idOf = new Map<string, string>();
  let counter = 0;
  const id = (key: string) => {
    if (!idOf.has(key)) idOf.set(key, `n${counter++}`);
    return idOf.get(key)!;
  };
  const rootId = id(`root:${rootSlug}`);
  lines.push(`  ${rootId}["${escapeMermaid(rootLabel)} (formula)"]`);
  const walk = (parentId: string, node: DepNode) => {
    const key = `${node.appId}:${node.fieldSlug}`;
    const nid = id(key);
    const shape = node.unresolved
      ? `${nid}["${escapeMermaid(node.fieldLabel)} ⚠ unresolved"]`
      : `${nid}["${escapeMermaid(node.appName)}.${escapeMermaid(node.fieldLabel)}<br/>(${node.fieldType})"]`;
    lines.push(`  ${shape}`);
    lines.push(`  ${parentId} --> ${nid}`);
    for (const c of node.children ?? []) walk(nid, c);
  };
  for (const t of trees) walk(rootId, t);
  return lines.join('\n');
}

function escapeMermaid(s: string): string {
  return s.replace(/"/g, "'").replace(/[\[\]{}]/g, '');
}

// ── Impact Index (deep) ──────────────────────────────────────────────────────

/** Compress the heavily-skewed native score to a gentle multiplier (0 → 1, 2751 → ~4.4). */
function complexityWeight(score: number): number {
  return 1 + Math.log10(1 + Math.max(0, score));
}

const BASE_LINK_WEIGHT = 0.35;
const BASE_OTHER_WEIGHT = 0.2;

interface ImpactDetail {
  path: string;
  impact: number;
}

/**
 * Chain-aware impact index. Ported from the analyzer's computeImpactRating with fixes:
 *   - Uses each table's ACTUAL record count (cached) at every level instead of reusing
 *     the leaf count for upper levels — the original assumed leafCount*fanout everywhere,
 *     which conflated cardinality direction. We still fold in link fan-out as a multiplier.
 *   - Scores are looked up per (appId, slug), not by slug alone, avoiding cross-table
 *     slug collisions.
 *   - Fan-out sampling bias (offset 0, first N records) is reported, not hidden.
 */
async function computeImpact(
  ctx: ToolContext,
  trees: DepNode[],
  scoreByKey: Map<string, number>,
): Promise<{ totalIndex: number; details: ImpactDetail[]; notes: string[] }> {
  const recordCount = new Map<string, number>();
  const fanOut = new Map<string, number>();
  const notes: string[] = [];

  const getCount = async (appId: string): Promise<number> => {
    if (recordCount.has(appId)) return recordCount.get(appId)!;
    let count = 0;
    try {
      const res = await ctx.client.listRecords(appId, { limit: 1 });
      count = res.total ?? 0;
    } catch {
      count = 0;
    }
    recordCount.set(appId, count);
    return count;
  };

  const SAMPLE = 50;
  const getFanOut = async (appId: string, slug: string): Promise<number> => {
    const key = `${appId}:${slug}`;
    if (fanOut.has(key)) return fanOut.get(key)!;
    let avg = 0;
    try {
      const res = await ctx.client.listRecords(appId, { limit: SAMPLE });
      const rows = res.items ?? [];
      let total = 0;
      let n = 0;
      for (const rec of rows) {
        const v = (rec as Record<string, unknown>)[slug];
        const len = Array.isArray(v) ? v.length : 0;
        total += len;
        n++;
      }
      avg = n ? total / n : 0;
    } catch {
      avg = 0;
    }
    fanOut.set(key, avg);
    return avg;
  };

  // Flatten trees into linear chains of nodes for the propagation calc.
  const chains: DepNode[][] = [];
  const flatten = (node: DepNode, acc: DepNode[]) => {
    const path = [...acc, node];
    if (!node.children?.length) chains.push(path);
    else node.children.forEach((c) => flatten(c, path));
  };
  trees.forEach((t) => flatten(t, []));

  const details: ImpactDetail[] = [];
  let totalIndex = 0;
  for (const chain of chains) {
    if (!chain.length) continue;
    const stepWeight = (node: DepNode): number => {
      if (node.fieldType === 'formulafield') return complexityWeight(scoreByKey.get(`${node.appId}:${node.fieldSlug}`) ?? 0);
      return LINK_TYPES.has(node.fieldType) ? BASE_LINK_WEIGHT : BASE_OTHER_WEIGHT;
    };

    let chainImpact = 0;
    let cumulativeFan = 1;
    for (let i = 0; i < chain.length; i++) {
      const node = chain[i];
      const realCount = await getCount(node.appId);
      // Fold the fan-out of link steps traversed so far into the effective row count.
      if (i > 0 && LINK_TYPES.has(chain[i - 1].fieldType)) {
        const f = await getFanOut(chain[i - 1].appId, chain[i - 1].fieldSlug);
        if (Number.isFinite(f) && f > 0) cumulativeFan *= f;
      }
      chainImpact += realCount * cumulativeFan * stepWeight(node);
    }
    totalIndex += chainImpact;
    details.push({ path: chain.map((n) => `${n.appName}:${n.fieldLabel}`).join(' → '), impact: Math.round(chainImpact) });
  }

  notes.push(`Fan-out sampled from the first ${SAMPLE} records per link field (offset 0) — biased toward the oldest records; treat as an estimate.`);
  details.sort((a, b) => b.impact - a.impact);
  return { totalIndex: Math.round(totalIndex), details, notes };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleAnalyzeFormulas(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const fieldSlug = args['fieldSlug'] as string | undefined;
  const deep = args['deep'] === true;
  const sortBy = (args['sortBy'] as string) === 'score' ? 'score' : 'name';

  try {
    const schema = await ctx.client.getApplicationSchema(applicationId);
    const formulaFields = (schema.structure ?? []).filter((f) => f.field_type === 'formulafield');

    if (!formulaFields.length) {
      return ok({ applicationId, applicationName: schema.name, formulaFieldCount: 0, items: [], message: 'No formula fields in this application.' });
    }

    // Schema fetcher with a tiny per-call memo so a deep dependency walk reuses linked-app schemas.
    const schemaMemo = new Map<string, ApplicationDetail | null>([[applicationId, schema]]);
    const schemaOf = async (id: string): Promise<ApplicationDetail | null> => {
      if (schemaMemo.has(id)) return schemaMemo.get(id)!;
      let s: ApplicationDetail | null = null;
      try {
        s = await ctx.client.getApplicationSchema(id);
      } catch {
        s = null;
      }
      schemaMemo.set(id, s);
      return s;
    };

    // ── Summary mode: every formula field, identify + complexity, no dependency walk. ──
    if (!fieldSlug) {
      const items = formulaFields.map((f) => {
        const m = formulaMetrics(f);
        return {
          slug: f.slug,
          label: f.label,
          returnType: m.returnType,
          valid: m.valid,
          score: m.score,
          complexityTier: complexityTier(m.score),
          functionCount: m.functionCount,
          nestingDepth: m.nestingDepth,
          referenceCount: m.referenceCount,
          chainedReferenceCount: m.chainedReferenceCount,
          formula: f.params.formula ?? '',
        };
      });
      items.sort((a, b) =>
        sortBy === 'score' ? b.score - a.score : a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
      );
      const invalid = items.filter((i) => i.valid === false);
      return ok({
        applicationId,
        applicationName: schema.name,
        formulaFieldCount: items.length,
        invalidCount: invalid.length,
        invalidFields: invalid.map((i) => ({ slug: i.slug, label: i.label })),
        totalScore: items.reduce((s, i) => s + i.score, 0),
        items,
        hint: 'Pass fieldSlug to get the dependency graph for one formula; add deep:true for the cross-table impact index.',
      });
    }

    // ── Single-field mode: full detail + dependency graph (+ optional impact). ──
    const field = formulaFields.find((f) => f.slug === fieldSlug);
    if (!field) {
      return err('SMARTSUITE_NOT_FOUND', `Formula field "${fieldSlug}" not found in application ${applicationId}`);
    }
    const m = formulaMetrics(field);
    const chains = extractReferenceChains(field.params.formula ?? '');
    const trees: DepNode[] = [];
    for (const chain of chains) {
      const node = await resolveChain(ctx, applicationId, chain, schemaOf);
      if (node) trees.push(node);
    }

    const linkedTables = new Set<string>();
    const collectTables = (n: DepNode) => {
      if (n.appId !== applicationId) linkedTables.add(n.appName);
      n.children?.forEach(collectTables);
    };
    trees.forEach(collectTables);

    const result: Record<string, unknown> = {
      applicationId,
      applicationName: schema.name,
      slug: field.slug,
      label: field.label,
      formula: field.params.formula ?? '',
      ...helpTextOf(field),
      returnType: m.returnType,
      valid: m.valid,
      isAdvanced: m.isAdvanced,
      score: m.score,
      complexityTier: complexityTier(m.score),
      metrics: {
        charLength: m.charLength,
        functionCount: m.functionCount,
        distinctFunctions: m.distinctFunctions,
        nestingDepth: m.nestingDepth,
        referenceCount: m.referenceCount,
        chainedReferenceCount: m.chainedReferenceCount,
        maxChainDepth: m.maxChainDepth,
      },
      dependencies: {
        linkedTableCount: linkedTables.size,
        linkedTables: [...linkedTables],
        tree: trees.flatMap((t) => nodePaths(t)),
        mermaid: mermaidGraph(field.label, field.slug, trees),
      },
    };

    if (deep) {
      // Build a per-(app,slug) score map across all reachable formula fields for accurate weighting.
      const scoreByKey = new Map<string, number>();
      for (const s of schemaMemo.values()) {
        if (!s) continue;
        for (const f of s.structure ?? []) {
          if (f.field_type === 'formulafield') scoreByKey.set(`${s.id}:${f.slug}`, Number(f.params.score ?? 0));
        }
      }
      const impact = await computeImpact(ctx, trees, scoreByKey);
      result['impact'] = impact;
    }

    return ok(result);
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

// ── Formula field validation & writes ────────────────────────────────────────

/** Field types a formula can compute into (what `target_field_structure.field_type` accepts). */
const ALLOWED_RETURN_TYPES = new Set([
  'textfield', 'numberfield', 'datefield', 'currencyfield', 'percentfield',
  'singleselectfield', 'statusfield', 'yesnofield', 'emailfield', 'phonefield',
  'durationfield', 'timefield', 'daterangefield', 'duedatefield',
]);

/** SmartSuite custom field slugs are `s` + 9 hex chars (e.g. `s2f8ac17a0`). */
export function generateFieldSlug(): string {
  return 's' + randomBytes(5).toString('hex').slice(0, 9);
}

/** Build a formula field definition with the nested target structure that sets the return type. */
export function buildFormulaFieldDef(slug: string, label: string, formula: string, returnType: string): FieldDefinition {
  return {
    slug,
    label,
    field_type: 'formulafield',
    params: {
      formula,
      is_advanced: true,
      target_field_structure: { slug, label, field_type: returnType, params: {} },
    } as FieldDefinition['params'],
  };
}

function schemaWriteGuard(ctx: ToolContext): ToolResult | null {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'Schema writes are blocked in readonly mode. Set SMARTSUITE_MCP_MODE=readwrite or admin.');
  }
  if (!ctx.config.enableSchemaWrite) {
    return err('MCP_MODE_BLOCKED', 'Schema writes are disabled. Set SMARTSUITE_ENABLE_SCHEMA_WRITE=true to enable creating/updating fields.');
  }
  return null;
}

/**
 * Validate a formula expression without writing anything. Safe in any mode.
 * Returns SmartSuite's verdict ({valid, safe, warnings}) or the validation error message.
 */
export async function handleValidateFormula(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const formula = args['formula'] as string;
  const returnType = args['returnType'] as string | undefined;
  if (!formula?.trim()) return err('SMARTSUITE_VALIDATION_ERROR', 'formula is required and cannot be empty.');
  if (returnType && !ALLOWED_RETURN_TYPES.has(returnType)) {
    return err('SMARTSUITE_VALIDATION_ERROR', `returnType "${returnType}" is not a supported formula output type. Allowed: ${[...ALLOWED_RETURN_TYPES].join(', ')}`);
  }
  try {
    const slug = (args['fieldSlug'] as string) || generateFieldSlug();
    const label = (args['label'] as string) || 'Formula';
    const field = returnType
      ? buildFormulaFieldDef(slug, label, formula, returnType)
      : ({ slug, label, field_type: 'formulafield', params: { formula } } as FieldDefinition);
    const result = await ctx.client.validateFormula(applicationId, field);
    return ok({ applicationId, formula, returnType: returnType ?? null, ...result });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

/** Summarize a formula field for the response after a create/update. */
function createdFieldSummary(schema: ApplicationDetail, slug: string): Record<string, unknown> | null {
  const f = (schema.structure ?? []).find((x) => x.slug === slug);
  if (!f) return null;
  return {
    slug: f.slug,
    label: f.label,
    formula: f.params.formula ?? '',
    returnType: f.params.target_field_structure?.field_type ?? null,
    score: f.params.score ?? null,
    valid: f.params.valid ?? null,
  };
}

/**
 * Create a new formula field. Validates the expression first (no write on failure),
 * previews on a non-confirmed call, and creates on confirm. Schema-write gated.
 */
export async function handleCreateFormulaField(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const blocked = schemaWriteGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const label = args['label'] as string;
  const formula = args['formula'] as string;
  const returnType = (args['returnType'] as string) || 'textfield';
  const afterFieldSlug = args['afterFieldSlug'] as string | undefined;
  const confirm = args['confirm'] === true;

  if (!label?.trim()) return err('SMARTSUITE_VALIDATION_ERROR', 'label is required.');
  if (!formula?.trim()) return err('SMARTSUITE_VALIDATION_ERROR', 'formula is required.');
  if (!ALLOWED_RETURN_TYPES.has(returnType)) {
    return err('SMARTSUITE_VALIDATION_ERROR', `returnType "${returnType}" is not supported. Allowed: ${[...ALLOWED_RETURN_TYPES].join(', ')}`);
  }

  try {
    const slug = generateFieldSlug();
    const field = buildFormulaFieldDef(slug, label, formula, returnType);

    // Pre-flight validation — never create an invalid formula.
    const verdict = await ctx.client.validateFormula(applicationId, field);
    if (!verdict.valid) {
      return err('SMARTSUITE_VALIDATION_ERROR', `Formula is invalid: ${verdict.message ?? 'unknown error'}`, { code: verdict.code });
    }

    if (!confirm) {
      return ok({
        dryRun: true,
        validation: verdict,
        wouldCreate: { applicationId, label, formula, returnType, slug },
        hint: 'Formula validates. Set confirm=true to create the field.',
      });
    }

    // Position after the named field, or default to the last field in the schema.
    const schema = await ctx.client.getApplicationSchema(applicationId);
    const fields = schema.structure ?? [];
    const prevSiblingSlug = afterFieldSlug && fields.some((f) => f.slug === afterFieldSlug)
      ? afterFieldSlug
      : fields[fields.length - 1]?.slug;
    if (!prevSiblingSlug) return err('SMARTSUITE_VALIDATION_ERROR', 'Could not determine a position; the application has no fields.');

    await ctx.client.addField(applicationId, field, prevSiblingSlug);
    const fresh = await ctx.client.getApplicationSchema(applicationId, { forceRefresh: true });
    return ok({ created: true, mode: ctx.config.mode, field: createdFieldSummary(fresh, slug) ?? { slug, label, formula, returnType } });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

/**
 * Update an existing formula field's expression, label, and/or return type.
 * Fetches the current definition and mutates it in place (preserving other params),
 * validates, then writes on confirm. Schema-write gated.
 */
export async function handleUpdateFormulaField(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const blocked = schemaWriteGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const fieldSlug = args['fieldSlug'] as string;
  const formula = args['formula'] as string | undefined;
  const label = args['label'] as string | undefined;
  const returnType = args['returnType'] as string | undefined;
  const confirm = args['confirm'] === true;

  if (formula === undefined && label === undefined && returnType === undefined) {
    return err('SMARTSUITE_VALIDATION_ERROR', 'Provide at least one of formula, label, or returnType to update.');
  }
  if (returnType && !ALLOWED_RETURN_TYPES.has(returnType)) {
    return err('SMARTSUITE_VALIDATION_ERROR', `returnType "${returnType}" is not supported. Allowed: ${[...ALLOWED_RETURN_TYPES].join(', ')}`);
  }

  try {
    const schema = await ctx.client.getApplicationSchema(applicationId);
    const existing = (schema.structure ?? []).find((f) => f.slug === fieldSlug);
    if (!existing) return err('SMARTSUITE_NOT_FOUND', `Field "${fieldSlug}" not found in application ${applicationId}`);
    if (existing.field_type !== 'formulafield') {
      return err('SMARTSUITE_VALIDATION_ERROR', `Field "${fieldSlug}" is a ${existing.field_type}, not a formula field.`);
    }

    // Deep-clone the existing definition and apply only the requested changes.
    const updated = JSON.parse(JSON.stringify(existing)) as FieldDefinition;
    if (label !== undefined) updated.label = label;
    if (formula !== undefined) updated.params.formula = formula;
    if (returnType !== undefined && updated.params.target_field_structure) {
      updated.params.target_field_structure.field_type = returnType;
    }

    const verdict = await ctx.client.validateFormula(applicationId, updated);
    if (!verdict.valid) {
      return err('SMARTSUITE_VALIDATION_ERROR', `Updated formula is invalid: ${verdict.message ?? 'unknown error'}`, { code: verdict.code });
    }

    if (!confirm) {
      return ok({
        dryRun: true,
        validation: verdict,
        wouldUpdate: {
          applicationId,
          fieldSlug,
          formula: updated.params.formula,
          label: updated.label,
          returnType: updated.params.target_field_structure?.field_type ?? null,
        },
        previous: { formula: existing.params.formula, label: existing.label, returnType: existing.params.target_field_structure?.field_type ?? null },
        hint: 'Formula validates. Set confirm=true to apply the change.',
      });
    }

    await ctx.client.changeField(applicationId, updated);
    // change_field (set_is_migrating=1) applies asynchronously via a background
    // migration — an immediate re-read returns the OLD value, so report what was
    // submitted rather than a misleading stale read-back.
    return ok({
      updated: true,
      mode: ctx.config.mode,
      note: 'Change submitted. SmartSuite applies formula edits via a background migration, so it may take a few seconds to take effect; re-run smartsuite_analyze_formulas to confirm.',
      field: {
        slug: fieldSlug,
        label: updated.label,
        formula: updated.params.formula,
        returnType: updated.params.target_field_structure?.field_type ?? null,
      },
      previous: { formula: existing.params.formula, label: existing.label, returnType: existing.params.target_field_structure?.field_type ?? null },
    });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
