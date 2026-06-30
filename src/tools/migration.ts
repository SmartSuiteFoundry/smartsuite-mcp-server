import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { ApplicationSummary, Solution } from '../types/smartsuite.js';
import { matchByName, applyConfirmations, NamedItem, Override } from '../migration/match.js';
import { diffFields, wholeTableDiff, summarize, diffReports } from '../migration/diff.js';
import { loadMappings, saveMappings, saveDiff, loadDiff, diffPath, projectDir } from '../migration/project.js';
import { MigrationMappings, SolutionMapping, AppMapping, SolutionDiff, TableDiff, SchemaDiff } from '../migration/types.js';
import { buildXlsx, Sheet } from '../migration/xlsx.js';
import fs from 'node:fs';
import path from 'node:path';

/** Migration reads target two workspaces; the source (lower env) is always cross-workspace. */
function crossWorkspaceGuard(ctx: ToolContext): ToolResult | null {
  if (!ctx.config.enableCrossWorkspace) {
    return err('MCP_MODE_BLOCKED', 'The migration tools read a lower-environment (non-primary) workspace. Set SMARTSUITE_ENABLE_CROSS_WORKSPACE=true to enable.');
  }
  if (!ctx.resolver) {
    return err('SMARTSUITE_API_ERROR', 'Workspace resolver unavailable.');
  }
  return null;
}

const named = (x: { id: string; name: string }): NamedItem => ({ id: x.id, name: x.name });

function parseOverrides(raw: unknown): Override[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Override => !!o && typeof (o as Override).sourceId === 'string' && typeof (o as Override).prodId === 'string')
    .map((o) => ({ sourceId: o.sourceId, prodId: o.prodId }));
}

// ── match_solutions ─────────────────────────────────────────────────────────

export async function handleMatchSolutions(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = crossWorkspaceGuard(ctx);
  if (blocked) return blocked;

  const project = args['project'] as string;
  const sourceWorkspace = args['sourceWorkspace'] as string;
  const nameFilter = (args['nameFilter'] as string | undefined)?.trim().toLowerCase();
  const confirm = args['confirm'] === true;
  const overrides = parseOverrides(args['overrides']);
  if (!project) return err('SMARTSUITE_VALIDATION_ERROR', 'project is required.');
  if (!sourceWorkspace) return err('SMARTSUITE_VALIDATION_ERROR', 'sourceWorkspace is required (the lower-environment workspace slug or name).');

  try {
    const sourceSlug = await ctx.resolver!.resolveSlug(sourceWorkspace);
    const targetSlug = ctx.client.accountId;
    if (sourceSlug === targetSlug) {
      return err('SMARTSUITE_VALIDATION_ERROR', 'sourceWorkspace must differ from the primary (production) workspace. Set your primary to production and point sourceWorkspace at the lower environment.');
    }
    const sourceClient = ctx.client.withAccount(sourceSlug);

    let sourceSolutions = await sourceClient.listSolutions();
    const prodSolutions = await ctx.client.listSolutions();
    if (nameFilter) sourceSolutions = sourceSolutions.filter((s) => s.name.toLowerCase().includes(nameFilter));

    const { matches, prodOnly } = matchByName(sourceSolutions.map(named), prodSolutions.map(named));
    let resolved = applyConfirmations(matches, { confirm, overrides });

    // Merge with any prior confirmations so re-runs don't drop confirmed pairs.
    const prior = loadMappings(ctx.config.migrationDir, project);
    if (prior) {
      const priorByName = new Map(prior.solutions.map((s) => [s.name.toLowerCase(), s]));
      const overridden = new Set(overrides.map((o) => o.sourceId));
      resolved = resolved.map((m) => {
        const p = priorByName.get(m.name.toLowerCase());
        if (p && p.status === 'confirmed' && m.sourceId && !overridden.has(m.sourceId)) {
          return { ...m, prodId: p.prodId, status: 'confirmed' as const };
        }
        return m;
      });
    }

    const solutions: SolutionMapping[] = resolved.map((m) => ({
      name: m.name, sourceId: m.sourceId, prodId: m.prodId, status: m.status,
      ...(m.candidates ? { candidates: m.candidates } : {}),
    }));

    const mappings: MigrationMappings = {
      version: 1,
      source: { workspace: sourceSlug },
      target: { workspace: targetSlug },
      solutions,
      apps: prior?.apps ?? [],
    };
    const savedPath = saveMappings(ctx.config.migrationDir, project, mappings);

    const byStatus = (st: string) => solutions.filter((s) => s.status === st);
    return ok({
      project,
      source: sourceSlug,
      target: targetSlug,
      counts: { confirmed: byStatus('confirmed').length, proposed: byStatus('proposed').length, ambiguous: byStatus('ambiguous').length, unmatched: byStatus('unmatched').length },
      solutions,
      prodOnlySolutions: prodOnly.map((p) => ({ name: p.name, prodId: p.id })),
      mappingsPath: savedPath,
      next: confirm ? 'Run smartsuite_match_applications for each confirmed solution.' : 'Review matches, then re-call with confirm:true (and overrides for any ambiguous/unmatched) to confirm.',
    });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

// ── match_applications ────────────────────────────────────────────────────────

export async function handleMatchApplications(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = crossWorkspaceGuard(ctx);
  if (blocked) return blocked;

  const project = args['project'] as string;
  const solutionName = args['solution'] as string;
  const confirm = args['confirm'] === true;
  const overrides = parseOverrides(args['overrides']);
  if (!project) return err('SMARTSUITE_VALIDATION_ERROR', 'project is required.');
  if (!solutionName) return err('SMARTSUITE_VALIDATION_ERROR', 'solution is required (the solution name from a confirmed solution mapping).');

  try {
    const mappings = loadMappings(ctx.config.migrationDir, project);
    if (!mappings) return err('SMARTSUITE_NOT_FOUND', `No mappings for project "${project}". Run smartsuite_match_solutions first.`);
    const sol = mappings.solutions.find((s) => s.name.toLowerCase() === solutionName.toLowerCase());
    if (!sol) return err('SMARTSUITE_NOT_FOUND', `Solution "${solutionName}" not found in project. Match solutions first.`);
    if (sol.status !== 'confirmed' || !sol.sourceId || !sol.prodId) {
      return err('SMARTSUITE_VALIDATION_ERROR', `Solution "${solutionName}" is not a confirmed pair (status: ${sol.status}). Confirm it in smartsuite_match_solutions first.`);
    }

    const sourceSlug = await ctx.resolver!.resolveSlug(mappings.source.workspace);
    const sourceClient = ctx.client.withAccount(sourceSlug);
    const sourceApps = await sourceClient.listApplications(sol.sourceId);
    const prodApps = await ctx.client.listApplications(sol.prodId);

    const { matches, prodOnly } = matchByName(sourceApps.map(named), prodApps.map(named));
    let resolved = applyConfirmations(matches, { confirm, overrides });

    // Preserve prior confirmations for this solution.
    const priorApps = mappings.apps.filter((a) => a.solution.toLowerCase() === sol.name.toLowerCase());
    const priorByName = new Map(priorApps.map((a) => [a.name.toLowerCase(), a]));
    const overridden = new Set(overrides.map((o) => o.sourceId));
    resolved = resolved.map((m) => {
      const p = priorByName.get(m.name.toLowerCase());
      if (p && p.status === 'confirmed' && m.sourceId && !overridden.has(m.sourceId)) {
        return { ...m, prodId: p.prodId, status: 'confirmed' as const };
      }
      return m;
    });

    const appsForSolution: AppMapping[] = resolved.map((m) => ({
      solution: sol.name, name: m.name, sourceId: m.sourceId, prodId: m.prodId, status: m.status,
      ...(m.candidates ? { candidates: m.candidates } : {}),
    }));

    // Replace this solution's apps; keep other solutions' apps.
    mappings.apps = [...mappings.apps.filter((a) => a.solution.toLowerCase() !== sol.name.toLowerCase()), ...appsForSolution];
    const savedPath = saveMappings(ctx.config.migrationDir, project, mappings);

    const byStatus = (st: string) => appsForSolution.filter((a) => a.status === st);
    return ok({
      project,
      solution: sol.name,
      counts: { confirmed: byStatus('confirmed').length, proposed: byStatus('proposed').length, ambiguous: byStatus('ambiguous').length, unmatched: byStatus('unmatched').length },
      apps: appsForSolution,
      prodOnlyTables: prodOnly.map((p) => ({ name: p.name, prodId: p.id })),
      mappingsPath: savedPath,
      next: confirm ? 'Run smartsuite_diff_schemas for this project.' : 'Review, then re-call with confirm:true (+ overrides) to confirm table matches.',
    });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

// ── diff_schemas ──────────────────────────────────────────────────────────────

export async function handleDiffSchemas(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = crossWorkspaceGuard(ctx);
  if (blocked) return blocked;

  const project = args['project'] as string;
  const onlySolution = (args['solution'] as string | undefined)?.toLowerCase();
  const scope = (args['scope'] as string | undefined) === 'schema' ? 'schema' : 'all';
  if (!project) return err('SMARTSUITE_VALIDATION_ERROR', 'project is required.');

  try {
    const mappings = loadMappings(ctx.config.migrationDir, project);
    if (!mappings) return err('SMARTSUITE_NOT_FOUND', `No mappings for project "${project}". Run the match tools first.`);

    const sourceSlug = await ctx.resolver!.resolveSlug(mappings.source.workspace);
    const sourceClient = ctx.client.withAccount(sourceSlug);

    // Reference remap (source→prod), spanning all confirmed apps AND solutions so cross-table links
    // and report application/solution references all normalize.
    const idMap = new Map<string, string>([
      ...mappings.apps.filter((a) => a.status === 'confirmed' && a.sourceId && a.prodId).map((a) => [a.sourceId!, a.prodId!] as [string, string]),
      ...mappings.solutions.filter((s) => s.status === 'confirmed' && s.sourceId && s.prodId).map((s) => [s.sourceId!, s.prodId!] as [string, string]),
    ]);

    const targetSolutions = mappings.solutions.filter(
      (s) => s.status === 'confirmed' && s.sourceId && s.prodId && (!onlySolution || s.name.toLowerCase() === onlySolution),
    );
    if (targetSolutions.length === 0) {
      return err('SMARTSUITE_VALIDATION_ERROR', 'No confirmed solution pairs to diff. Confirm solutions and tables first.');
    }

    const solutionDiffs: SolutionDiff[] = [];
    for (const sol of targetSolutions) {
      const sourceApps = await sourceClient.listApplications(sol.sourceId!);
      const prodApps = await ctx.client.listApplications(sol.prodId!);
      const confirmedApps = mappings.apps.filter((a) => a.solution.toLowerCase() === sol.name.toLowerCase() && a.status === 'confirmed' && a.sourceId && a.prodId);

      const matchedSourceIds = new Set(confirmedApps.map((a) => a.sourceId!));
      const matchedProdIds = new Set(confirmedApps.map((a) => a.prodId!));
      const tables: TableDiff[] = [];

      for (const a of confirmedApps) {
        const src = await sourceClient.getApplication(a.sourceId!);
        const prod = await ctx.client.getApplication(a.prodId!);
        const table: TableDiff = { name: a.name, status: 'matched', sourceId: a.sourceId, prodId: a.prodId, fields: diffFields(src.structure ?? [], prod.structure ?? [], idMap) };
        if (scope !== 'schema') {
          const [srcReports, prodReports] = await Promise.all([sourceClient.listReports(a.sourceId!), ctx.client.listReports(a.prodId!)]);
          table.reports = diffReports(srcReports, prodReports, idMap);
        }
        tables.push(table);
      }
      for (const sa of sourceApps as ApplicationSummary[]) {
        if (!matchedSourceIds.has(sa.id)) {
          const src = await sourceClient.getApplication(sa.id);
          tables.push(wholeTableDiff(sa.name, 'lower-only', src.structure ?? [], { sourceId: sa.id, prodId: null }));
        }
      }
      for (const pa of prodApps as ApplicationSummary[]) {
        if (!matchedProdIds.has(pa.id)) {
          const prod = await ctx.client.getApplication(pa.id);
          tables.push(wholeTableDiff(pa.name, 'prod-only', prod.structure ?? [], { sourceId: null, prodId: pa.id }));
        }
      }

      solutionDiffs.push({ name: sol.name, sourceId: sol.sourceId, prodId: sol.prodId, tables });
    }

    const diff: SchemaDiff = {
      version: 1,
      generatedAt: new Date().toISOString(),
      source: mappings.source,
      target: mappings.target,
      summary: summarize(solutionDiffs),
      solutions: solutionDiffs,
    };
    const savedPath = saveDiff(ctx.config.migrationDir, project, diff);

    return ok({
      project,
      scope,
      summary: diff.summary,
      diffPath: savedPath,
      solutions: solutionDiffs.map((s) => ({
        name: s.name,
        tables: s.tables.map((t) => ({ name: t.name, status: t.status, fieldChanges: t.fields.length, reportChanges: t.reports?.length ?? 0 })),
      })),
      ...(scope !== 'schema' ? { note: 'Views and forms are diffed in full; dashboards are compared at the report-config level only (per-widget contents are not diffed in M2).' } : {}),
      next: 'Run smartsuite_export_diff to produce the XLSX + JSON package.',
    });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

// ── export_diff ───────────────────────────────────────────────────────────────

const cell = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  return JSON.stringify(v);
};

/** Build the Summary + Detail sheets from a diff (fields + reports). */
export function diffToSheets(diff: SchemaDiff): Sheet[] {
  const summaryRows: Sheet['rows'] = [['Solution', 'Table', 'Status', 'Fields +', 'Fields ~', 'Fields -', 'Reports +', 'Reports ~', 'Reports -', 'Risky']];
  const detailRows: Sheet['rows'] = [['Solution', 'Table', 'Element', 'Name', 'Identifier', 'Change', 'Type', 'Property', 'Source', 'Prod', 'Risk']];

  for (const sol of diff.solutions) {
    for (const t of sol.tables) {
      const c = { fa: 0, fm: 0, fr: 0, ra: 0, rm: 0, rr: 0, risky: 0 };
      for (const f of t.fields) {
        if (f.changeType === 'added') c.fa++; else if (f.changeType === 'removed') c.fr++; else c.fm++;
        if (f.risk === 'risky') c.risky++;
      }
      for (const r of t.reports ?? []) {
        if (r.changeType === 'added') c.ra++; else if (r.changeType === 'removed') c.rr++; else c.rm++;
        if (r.risk === 'risky') c.risky++;
      }
      summaryRows.push([sol.name, t.name, t.status, c.fa, c.fm, c.fr, c.ra, c.rm, c.rr, c.risky]);

      for (const f of t.fields) {
        const base = [sol.name, t.name, 'field', f.label, f.slug, f.changeType, f.fieldType];
        if (f.changeType === 'modified' && f.details && Object.keys(f.details).length) {
          for (const [prop, d] of Object.entries(f.details)) detailRows.push([...base, prop, cell(d.source), cell(d.prod), f.risk]);
        } else {
          detailRows.push([...base, '', '', '', f.risk]);
        }
      }
      for (const r of t.reports ?? []) {
        const base = [sol.name, t.name, r.kind, r.label, '', r.changeType, r.viewMode];
        if (r.changeType === 'modified' && r.details && Object.keys(r.details).length) {
          for (const [prop, d] of Object.entries(r.details)) detailRows.push([...base, prop, cell(d.source), cell(d.prod), r.risk]);
        } else {
          detailRows.push([...base, '', '', '', r.risk]);
        }
      }
    }
  }
  return [{ name: 'Summary', rows: summaryRows }, { name: 'Detail', rows: detailRows }];
}

export async function handleExportDiff(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const project = args['project'] as string;
  const format = (args['format'] as string | undefined) ?? 'both';
  if (!project) return err('SMARTSUITE_VALIDATION_ERROR', 'project is required.');

  try {
    const diff = loadDiff(ctx.config.migrationDir, project);
    if (!diff) return err('SMARTSUITE_NOT_FOUND', `No diff for project "${project}". Run smartsuite_diff_schemas first.`);

    const written: string[] = [];
    if (format === 'json' || format === 'both') written.push(diffPath(ctx.config.migrationDir, project));
    if (format === 'xlsx' || format === 'both') {
      const xlsx = buildXlsx(diffToSheets(diff));
      const xlsxPath = path.join(projectDir(ctx.config.migrationDir, project), 'diff.xlsx');
      fs.writeFileSync(xlsxPath, xlsx);
      written.push(xlsxPath);
    }
    return ok({ project, summary: diff.summary, written });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
