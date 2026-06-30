import { FieldDefinition, Report } from '../types/smartsuite.js';
import { normalizeField, NormalizedField, normalizeReport } from './normalize.js';
import { DiffSummary, FieldDiff, PropertyDiff, Risk, SolutionDiff, TableDiff, ReportDiff, ReportKind } from './types.js';

/** Stable JSON (sorted keys) for order-insensitive deep comparison. */
function canon(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
const eq = (a: unknown, b: unknown): boolean => canon(a) === canon(b);

/** Per-property diff between two normalized fields (label, fieldType, each param key). */
function propertyDiffs(s: NormalizedField, p: NormalizedField): Record<string, PropertyDiff> {
  const details: Record<string, PropertyDiff> = {};
  if (s.label !== p.label) details['label'] = { source: s.label, prod: p.label };
  if (s.fieldType !== p.fieldType) details['fieldType'] = { source: s.fieldType, prod: p.fieldType };
  const keys = new Set([...Object.keys(s.params), ...Object.keys(p.params)]);
  for (const k of keys) {
    if (!eq(s.params[k], p.params[k])) {
      details[`params.${k}`] = { source: s.params[k] ?? null, prod: p.params[k] ?? null };
    }
  }
  return details;
}

/**
 * Diff a matched table's fields. `source` = lower (desired), `prod` = target. Matched by slug
 * (stable across the cloned workspaces). The source side is remapped via appIdMap; the prod side
 * is already in target ids. Returns one FieldDiff per added/removed/modified field (sorted by slug).
 */
export function diffFields(
  source: FieldDefinition[],
  prod: FieldDefinition[],
  appIdMap: Map<string, string>,
): FieldDiff[] {
  const prodBySlug = new Map(prod.map((f) => [f.slug, f]));
  const sourceBySlug = new Map(source.map((f) => [f.slug, f]));
  const out: FieldDiff[] = [];

  for (const sf of source) {
    const pf = prodBySlug.get(sf.slug);
    if (!pf) {
      out.push({ slug: sf.slug, label: sf.label, fieldType: sf.field_type, changeType: 'added', risk: 'compatible' });
      continue;
    }
    const notes = new Set<string>();
    const sn = normalizeField(sf, appIdMap, notes);
    const pn = normalizeField(pf, new Map(), notes);
    const details = propertyDiffs(sn, pn);
    if (Object.keys(details).length === 0) continue; // unchanged
    const risk: Risk = details['fieldType'] ? 'risky' : 'compatible';
    out.push({
      slug: sf.slug,
      label: sf.label,
      fieldType: sf.field_type,
      changeType: 'modified',
      risk,
      details,
      ...(notes.size ? { notes: [...notes] } : {}),
    });
  }

  for (const pf of prod) {
    if (!sourceBySlug.has(pf.slug)) {
      // Present in prod, absent from lower → removal (data-loss risk on apply).
      out.push({ slug: pf.slug, label: pf.label, fieldType: pf.field_type, changeType: 'removed', risk: 'risky' });
    }
  }

  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Build a TableDiff for a table that exists only on one side (all fields added or removed). */
export function wholeTableDiff(
  name: string,
  status: 'lower-only' | 'prod-only',
  fields: FieldDefinition[],
  ids: { sourceId: string | null; prodId: string | null },
): TableDiff {
  const changeType = status === 'lower-only' ? 'added' : 'removed';
  const risk: Risk = status === 'lower-only' ? 'compatible' : 'risky';
  return {
    name,
    status,
    sourceId: ids.sourceId,
    prodId: ids.prodId,
    fields: fields
      .map((f) => ({ slug: f.slug, label: f.label, fieldType: f.field_type, changeType, risk } as FieldDiff))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}

// ── Reports (views / forms / dashboards) ──────────────────────────────────────

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** null / undefined / missing / {} / [] / "" are all treated as "no value" — defaults serialize inconsistently across workspaces. */
const emptyish = (v: unknown): boolean =>
  v === null || v === undefined || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (isPlainObject(v) && Object.keys(v).length === 0);

/** Walk two normalized values to leaf property-paths, recording differences. Arrays compare atomically. */
export function collectDiffs(a: unknown, b: unknown, path: string, out: Record<string, PropertyDiff>): void {
  if (emptyish(a) && emptyish(b)) return;
  if (eq(a, b)) return;
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      collectDiffs(a[k], b[k], path ? `${path}.${k}` : k, out);
    }
    return;
  }
  out[path || '(root)'] = { source: a ?? null, prod: b ?? null };
}

export function classifyReportKind(viewMode: string): ReportKind {
  if (viewMode === 'form') return 'form';
  if (viewMode === 'dashboard') return 'dashboard';
  return 'view';
}

/**
 * Diff a matched table's reports (views/forms/dashboards), matched by label within each kind.
 * `source` = lower, `prod` = target; the source side is remapped via idMap (app + solution ids).
 * Dashboards are compared at the report-config level only (widget contents are fetched separately
 * and are out of scope for M2).
 */
export function diffReports(source: Report[], prod: Report[], idMap: Map<string, string>): ReportDiff[] {
  const out: ReportDiff[] = [];
  for (const kind of ['view', 'form', 'dashboard'] as ReportKind[]) {
    const s = source.filter((r) => classifyReportKind(r.view_mode) === kind);
    const p = prod.filter((r) => classifyReportKind(r.view_mode) === kind);
    const pByLabel = new Map(p.map((r) => [r.label.toLowerCase(), r]));
    const sLabels = new Set(s.map((r) => r.label.toLowerCase()));

    for (const sr of s) {
      const pr = pByLabel.get(sr.label.toLowerCase());
      if (!pr) {
        out.push({ kind, label: sr.label, viewMode: sr.view_mode, changeType: 'added', risk: 'compatible' });
        continue;
      }
      const notes = new Set<string>();
      const details: Record<string, PropertyDiff> = {};
      // Compare only the config blob relevant to this kind; ignore the others' default-populated blobs.
      const relevant = kind === 'form' ? ['form_state']
        : kind === 'dashboard' ? ['dashboard', 'state']
        : ['state', ...(sr.view_mode === 'map' ? ['map_state'] : [])];
      const extraIgnore = new Set(['state', 'map_state', 'form_state', 'dashboard'].filter((k) => !relevant.includes(k)));
      collectDiffs(
        normalizeReport(sr as Record<string, unknown>, idMap, notes, extraIgnore),
        normalizeReport(pr as Record<string, unknown>, new Map(), notes, extraIgnore),
        '', details,
      );
      if (Object.keys(details).length === 0) continue;
      out.push({ kind, label: sr.label, viewMode: sr.view_mode, changeType: 'modified', risk: 'compatible', details, ...(notes.size ? { notes: [...notes] } : {}) });
    }
    for (const pr of p) {
      if (!sLabels.has(pr.label.toLowerCase())) {
        out.push({ kind, label: pr.label, viewMode: pr.view_mode, changeType: 'removed', risk: 'compatible' });
      }
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
}

export function summarize(solutions: SolutionDiff[]): DiffSummary {
  const s: DiffSummary = {
    solutions: solutions.length,
    tablesAdded: 0, tablesRemoved: 0, tablesMatched: 0,
    fieldsAdded: 0, fieldsModified: 0, fieldsRemoved: 0,
    reportsAdded: 0, reportsModified: 0, reportsRemoved: 0, risky: 0,
  };
  for (const sol of solutions) {
    for (const t of sol.tables) {
      if (t.status === 'lower-only') s.tablesAdded++;
      else if (t.status === 'prod-only') s.tablesRemoved++;
      else s.tablesMatched++;
      for (const f of t.fields) {
        if (f.changeType === 'added') s.fieldsAdded++;
        else if (f.changeType === 'removed') s.fieldsRemoved++;
        else s.fieldsModified++;
        if (f.risk === 'risky') s.risky++;
      }
      for (const r of t.reports ?? []) {
        if (r.changeType === 'added') s.reportsAdded++;
        else if (r.changeType === 'removed') s.reportsRemoved++;
        else s.reportsModified++;
        if (r.risk === 'risky') s.risky++;
      }
    }
  }
  return s;
}
