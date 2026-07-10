import { ToolContext, ToolResult, ok } from './context.js';
import { toErrorResponse } from '../errors.js';
import { ApplicationSummary, FieldDefinition, StructureLayout } from '../types/smartsuite.js';
import { helpTextOf } from './fields.js';

function fieldCountOf(app: ApplicationSummary): number {
  return app.fields_count?.total ?? app.structure?.length ?? 0;
}

function slimApplication(app: ApplicationSummary): Record<string, unknown> {
  return {
    id: app.id,
    name: app.name,
    slug: app.slug,
    solution: app.solution,
    fieldCount: fieldCountOf(app),
  };
}

/** A record-view layout body for one mode: field rows plus sections (with collapse/visibility). */
function layoutBody(body: unknown): { rows: unknown; sections: unknown } {
  const b = (body ?? {}) as { rows?: unknown; sections?: unknown };
  return { rows: b.rows ?? [], sections: b.sections ?? [] };
}

/**
 * Pull the record-view layout from structure_layout: the active mode's sections/rows, the
 * tab grouping (each tab carries its own sections/rows, with section-level visibility
 * conditions), and field-level display-logic conditions.
 */
function extractLayout(layout: StructureLayout | undefined): Record<string, unknown> | null {
  if (!layout) return null;
  const mode = layout.mode as string | undefined;
  const active = mode ? layout[mode] : undefined;
  const { rows, sections } = layoutBody(active);

  const tabsCfg = layout['tabs'] as
    | { enabled?: boolean; style?: string; align?: string; tabs?: Array<Record<string, unknown>> }
    | undefined;
  const tabsEnabled = tabsCfg?.enabled ?? false;
  const tabs = (tabsCfg?.tabs ?? []).map((t) => {
    const tabLayout = (t['layout'] as Record<string, unknown> | undefined) ?? {};
    const tabMode = mode && tabLayout[mode] ? mode : Object.keys(tabLayout)[0];
    const body = layoutBody(tabMode ? tabLayout[tabMode] : undefined);
    return {
      id: t['id'],
      name: t['name'],
      description: t['description'] ?? null,
      position: t['position'] ?? null,
      sections: body.sections,
      rows: body.rows,
    };
  });

  return {
    mode: mode ?? null,
    tabsEnabled,
    tabsStyle: tabsCfg?.style ?? null,
    tabs,
    sections,
    rows,
    hiddenFields: (layout['hidden_fields'] as unknown) ?? null,
    fieldVisibilityConditions: (layout['fields_visibility_conditions'] as unknown) ?? [],
  };
}

export type FieldVerbosity = 'compact' | 'standard' | 'full';

/**
 * Project a field to a token-lean summary. Boilerplate is OMITTED rather than emitted as false/null
 * (absence == false/none), which roughly halves the per-field payload for a typical table.
 *  - compact:  slug, label, type + options (choice values) + linked-app — the "column list" a data
 *              task needs. Drops flags, help text, display hints.
 *  - standard: compact + set flags (only when true), help text (only when present), and display/AI hints.
 *  - full:     standard + the raw params blob (large — only when you truly need every setting).
 */
export function normalizeField(f: FieldDefinition, verbosity: FieldVerbosity = 'standard') {
  const out: Record<string, unknown> = { slug: f.slug, label: f.label, type: f.field_type };

  // Enum values and link targets are essential relational info — cheap and kept in every mode.
  if (f.params.choices?.length) {
    out['options'] = f.params.choices.map((c) => ({ value: c.value, label: c.label }));
  }
  if (f.params.linked_application) out['linkedApplication'] = f.params.linked_application;

  if (verbosity === 'compact') return out;

  if (f.params.required) out['required'] = true;
  if (f.params.primary) out['primary'] = true;
  if (f.params.hidden) out['hidden'] = true;
  const help = helpTextOf(f);
  if (help.helpText) {
    out['helpText'] = help.helpText;
    out['helpTextFormat'] = help.helpTextFormat;
  }
  if (f.params.linked_field_slug) out['linkedFieldSlug'] = f.params.linked_field_slug;
  if (f.params.display_format) out['displayFormat'] = f.params.display_format;
  if (f.params.ai_agent) out['isAiField'] = f.params.ai_agent.enabled ?? false;

  if (verbosity === 'full') out['params'] = f.params;

  return out;
}

export async function handleListApplications(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const solutionId = args['solutionId'] as string | undefined;
  const slim = (args['slim'] as boolean | undefined) ?? false;
  const limitArg = args['limit'] as number | undefined;
  try {
    const apps = await ctx.client.listApplications(solutionId);

    // Apply allowlist/denylist
    const filtered = apps.filter((app) => {
      if (ctx.config.deniedApplications.includes(app.id)) return false;
      if (ctx.config.allowedApplications.length > 0 && !ctx.config.allowedApplications.includes(app.id)) return false;
      return true;
    });

    // The SmartSuite list endpoint ignores `limit`, so we bound the result here.
    const total = filtered.length;
    const limited = typeof limitArg === 'number' && limitArg >= 0 ? filtered.slice(0, limitArg) : filtered;
    const items = slim ? limited.map(slimApplication) : limited;

    return ok({ items, count: items.length, total });
  } catch (e) {
    const er = toErrorResponse(e);
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}

export async function handleDescribeApplication(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const includeFields = (args['includeFields'] as boolean | undefined) ?? true;
  const includeLayout = (args['includeLayout'] as boolean | undefined) ?? false;
  const forceRefresh = (args['forceRefresh'] as boolean | undefined) ?? false;
  const verbosity = (args['verbosity'] as FieldVerbosity | undefined) ?? 'standard';

  if (ctx.config.deniedApplications.includes(applicationId)) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: { code: 'APPLICATION_DENIED', message: `Application ${applicationId} is not accessible` } }, null, 2) }],
      isError: true,
    };
  }

  try {
    const app = await ctx.client.getApplication(applicationId, { forceRefresh });
    const result: Record<string, unknown> = {
      id: app.id,
      name: app.name,
      slug: app.slug,
      solution: app.solution,
      description: app.description ?? null,
      recordTerm: app.record_term ?? null,
    };

    if (includeFields) {
      result['fields'] = (app.structure ?? []).map((f) => normalizeField(f, verbosity));
      result['fieldCount'] = (app.structure ?? []).length;
    }

    if (includeLayout) {
      result['layout'] = extractLayout(app.structure_layout);
    }

    return ok(result);
  } catch (e) {
    const er = toErrorResponse(e);
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}

import { err } from './context.js';

/**
 * Update application-level attributes — currently the table name and/or record term.
 * Requires readwrite/admin + SMARTSUITE_ENABLE_SCHEMA_WRITE. Dry-run preview unless confirm:true.
 */
export async function handleUpdateApplication(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'Renaming a table is blocked in readonly mode. Set SMARTSUITE_MCP_MODE=readwrite or admin.');
  }
  if (!ctx.config.enableSchemaWrite) {
    return err('MCP_MODE_BLOCKED', 'Table updates are disabled. Set SMARTSUITE_ENABLE_SCHEMA_WRITE=true to rename tables.');
  }

  const applicationId = args['applicationId'] as string;
  const name = args['name'] as string | undefined;
  const recordTerm = args['recordTerm'] as string | undefined;
  const confirm = args['confirm'] === true;
  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if ((name === undefined || name === '') && recordTerm === undefined) {
    return err('SMARTSUITE_VALIDATION_ERROR', 'Provide name (new table name) and/or recordTerm.');
  }

  const patch: Record<string, unknown> = {};
  if (typeof name === 'string' && name.trim()) patch['name'] = name;
  if (typeof recordTerm === 'string') patch['record_term'] = recordTerm;

  try {
    const before = await ctx.client.getApplicationSchema(applicationId);
    if (!confirm) {
      return ok({ dryRun: true, applicationId, from: { name: before.name, recordTerm: before.record_term ?? null }, to: { name: patch['name'] ?? before.name, recordTerm: patch['record_term'] ?? before.record_term ?? null }, note: 'Re-call with confirm:true to apply.' });
    }
    const updated = await ctx.client.updateApplication(applicationId, patch);
    return ok({ updated: true, applicationId, name: updated.name, recordTerm: (updated as { record_term?: string }).record_term ?? null });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

/**
 * List soft-deleted applications (tables) in a solution's trash (read-only). Solution-scoped bare array.
 * SmartSuite exposes no public restore-application endpoint, so this is listing only.
 */
export async function handleListDeletedApplications(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const solutionId = args['solutionId'] as string;
  if (!solutionId) return err('SMARTSUITE_VALIDATION_ERROR', 'solutionId is required.');
  try {
    const res = await ctx.client.listDeletedApplications(solutionId);
    const items = res
      .filter((a) => !ctx.config.deniedApplications.includes(a['id'] as string))
      .map((a) => ({ id: a['id'], name: a['name'] ?? null, recordTerm: (a['record_term'] as string) ?? null }));
    return ok({ items, count: items.length });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
