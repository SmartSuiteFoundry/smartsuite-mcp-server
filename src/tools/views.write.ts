import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { Report } from '../types/smartsuite.js';

/** view_modes that have dedicated tooling and are NOT managed as generic "views". */
const NON_VIEW_MODES = new Set(['form', 'dashboard']);
/** Known SmartSuite view modes (for validation + docs). Others are still accepted and passed through. */
export const KNOWN_VIEW_MODES = ['grid', 'card', 'kanban', 'calendar', 'timeline', 'gantt', 'chart', 'map'];

function writeGuard(ctx: ToolContext): ToolResult | null {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'View writes are blocked in readonly mode. Set SMARTSUITE_MCP_MODE=readwrite or admin.');
  }
  if (!ctx.config.enableSchemaWrite) {
    return err('MCP_MODE_BLOCKED', 'View writes are disabled. Set SMARTSUITE_ENABLE_SCHEMA_WRITE=true to enable creating/updating views.');
  }
  return null;
}

/**
 * A complete default report `state` — every view-type window with the same defaults the SmartSuite UI
 * writes — so a programmatically-created view renders correctly in any mode. Returned fresh each call
 * (never share a mutable object across views). Caller config is overlaid via applyViewConfig.
 */
export function defaultViewState(): Record<string, any> {
  return {
    filterWindow: { opened: false, filter: { operator: 'and', fields: [] }, new_filters: { operator: 'and', conditions: [] } },
    fieldsWindow: { visibleFields: ['title'], fixedFieldsCount: 1, columnsWidth: {}, collapsed: [] },
    aggregates: {},
    coverWindow: null,
    sortWindow: { sort: [] },
    groupbyWindow: { collapsed: {}, group: [] },
    spotlightWindow: { spotlights: [], by_field_colors: null },
    cardSizeWindow: { size: 's' },
    rowSizeWindow: { size: 'compact', previousSize: null },
    stackByWindow: { columnFieldSlug: null, swimlaneFieldSlug: null, collapsedColumns: [], collapsedSwimlanes: [], columnsValues: [] },
    locationByWindow: { selectedFieldSlug: null },
    calendarFieldsWindow: { fields: [], showRecordsList: false, viewType: 'dayGridMonth', externalReportsInfo: [], displayWeekends: true },
    timelineFieldsWindow: { fields: [], viewMode: 'day', showRecordsList: false, periods: [] },
    ganttFieldsWindow: { viewPreset: 'weekAndDayLetter', showDependencyArrows: true, showTaskLabels: true, highlightCriticalPath: false, showProjectStartAndEndPoints: false, highlightNonWorkingDays: false, showColumnLines: true, showTodayLine: true },
    isToolbarVisible: true,
  };
}

export interface ViewConfig {
  visibleFields?: string[];
  filters?: unknown[];
  filterOperator?: 'and' | 'or';
  sort?: unknown[];
  groupBy?: unknown[];
}

/** Overlay caller-supplied config windows onto a state object (mutates and returns it). */
export function applyViewConfig(state: Record<string, any>, config: ViewConfig): Record<string, any> {
  if (Array.isArray(config.visibleFields)) {
    state['fieldsWindow'] = { ...(state['fieldsWindow'] ?? {}), visibleFields: config.visibleFields };
    if (state['fieldsWindow']['fixedFieldsCount'] == null) state['fieldsWindow']['fixedFieldsCount'] = 1;
  }
  if (Array.isArray(config.filters)) {
    state['filterWindow'] = {
      ...(state['filterWindow'] ?? {}),
      new_filters: { operator: config.filterOperator ?? 'and', conditions: config.filters },
    };
  }
  if (Array.isArray(config.sort)) state['sortWindow'] = { sort: config.sort };
  if (Array.isArray(config.groupBy)) state['groupbyWindow'] = { ...(state['groupbyWindow'] ?? {}), group: config.groupBy };
  return state;
}

function readConfig(args: Record<string, unknown>): ViewConfig {
  return {
    visibleFields: args['visibleFields'] as string[] | undefined,
    filters: args['filters'] as unknown[] | undefined,
    filterOperator: args['filterOperator'] as 'and' | 'or' | undefined,
    sort: args['sort'] as unknown[] | undefined,
    groupBy: args['groupBy'] as unknown[] | undefined,
  };
}

function hasConfig(c: ViewConfig): boolean {
  return [c.visibleFields, c.filters, c.sort, c.groupBy].some(Array.isArray);
}

/** Collect the field slugs referenced by a config so they can be validated against the schema. */
function referencedSlugs(c: ViewConfig): string[] {
  const out: string[] = [];
  if (Array.isArray(c.visibleFields)) out.push(...c.visibleFields);
  const fieldOf = (x: unknown) => (x && typeof x === 'object' ? ((x as any).field ?? (x as any).slug ?? (x as any).field_slug) : undefined);
  for (const arr of [c.filters, c.sort, c.groupBy]) {
    if (Array.isArray(arr)) for (const item of arr) { const f = fieldOf(item); if (typeof f === 'string') out.push(f); }
  }
  return out;
}

function slimView(r: Report): Record<string, unknown> {
  const state = (r.state ?? {}) as Record<string, any>;
  return {
    id: r.id,
    name: r.label,
    type: r.view_mode,
    description: r.description ?? null,
    order: r.order ?? 0,
    visibleFields: state['fieldsWindow']?.visibleFields ?? null,
    sort: state['sortWindow']?.sort ?? [],
    groupBy: state['groupbyWindow']?.group ?? [],
  };
}

export async function handleCreateView(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const label = args['label'] as string;
  const viewMode = args['viewMode'] as string;
  const description = args['description'] as string | undefined;
  const confirm = args['confirm'] === true;
  const config = readConfig(args);

  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if (!label?.trim()) return err('SMARTSUITE_VALIDATION_ERROR', 'label is required.');
  if (!viewMode?.trim()) return err('SMARTSUITE_VALIDATION_ERROR', `viewMode is required (one of: ${KNOWN_VIEW_MODES.join(', ')}).`);
  if (NON_VIEW_MODES.has(viewMode)) return err('SMARTSUITE_VALIDATION_ERROR', `viewMode "${viewMode}" is not a view. Use the form tools for forms and the dashboard tools for dashboards.`);

  try {
    const schema = await ctx.client.getApplicationSchema(applicationId);
    const solution = (schema as { solution?: string }).solution;
    if (!solution) return err('SMARTSUITE_VALIDATION_ERROR', `Could not resolve the solution for application ${applicationId}.`);

    const known = new Set((schema.structure ?? []).map((f) => f.slug));
    const unknown = referencedSlugs(config).filter((s) => !known.has(s));
    if (unknown.length) return err('SMARTSUITE_VALIDATION_ERROR', `Unknown field slug(s): ${[...new Set(unknown)].join(', ')}. Use smartsuite_describe_application to find valid slugs.`);

    const isUnique = await ctx.client.validateReportLabel(applicationId, label);
    if (!isUnique) {
      const suggestion = await ctx.client.generateReportLabel(applicationId, label);
      return err('SMARTSUITE_VALIDATION_ERROR', `A view named "${label}" already exists in this application. Try "${suggestion}".`);
    }

    if (!confirm) {
      return ok({
        dryRun: true,
        wouldCreate: { applicationId, solution, label, viewMode, description: description ?? '', config: hasConfig(config) ? config : null },
        hint: 'Label is available. Set confirm=true to create the view.',
      });
    }

    const body: Record<string, unknown> = { application: applicationId, solution, label, view_mode: viewMode };
    if (typeof description === 'string') body['description'] = description;
    const created = await ctx.client.createReport(body);

    if (hasConfig(config)) {
      await ctx.client.updateReport(created.id, { state: applyViewConfig(defaultViewState(), config) });
    }
    const final = await ctx.client.getReport(created.id).catch(() => created);
    return ok({ created: true, mode: ctx.config.mode, view: slimView(final) });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleUpdateView(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const viewId = args['viewId'] as string;
  const label = args['label'] as string | undefined;
  const description = args['description'] as string | undefined;
  const config = readConfig(args);
  if (!viewId) return err('SMARTSUITE_VALIDATION_ERROR', 'viewId is required.');

  try {
    const report = await ctx.client.getReport(viewId);
    if (NON_VIEW_MODES.has(report.view_mode)) {
      return err('SMARTSUITE_VALIDATION_ERROR', `"${viewId}" is a ${report.view_mode}, not a view. Use the ${report.view_mode === 'form' ? 'form' : 'dashboard'} tools.`);
    }

    const patch: Record<string, unknown> = {};

    if (typeof label === 'string' && label.trim() && label !== report.label) {
      const isUnique = await ctx.client.validateReportLabel(report.application, label);
      if (!isUnique) {
        const suggestion = await ctx.client.generateReportLabel(report.application, label);
        return err('SMARTSUITE_VALIDATION_ERROR', `A view named "${label}" already exists. Try "${suggestion}".`);
      }
      patch['label'] = label;
    }
    if (typeof description === 'string') patch['description'] = description;

    if (hasConfig(config)) {
      const schema = await ctx.client.getApplicationSchema(report.application);
      const known = new Set((schema.structure ?? []).map((f) => f.slug));
      const unknown = referencedSlugs(config).filter((s) => !known.has(s));
      if (unknown.length) return err('SMARTSUITE_VALIDATION_ERROR', `Unknown field slug(s): ${[...new Set(unknown)].join(', ')}.`);
      const state = (report.state as Record<string, any> | null) ?? defaultViewState();
      patch['state'] = applyViewConfig(state, config);
    }

    if (Object.keys(patch).length === 0) {
      return err('SMARTSUITE_VALIDATION_ERROR', 'Nothing to update. Provide label, description, and/or view config (visibleFields, filters, sort, groupBy).');
    }

    await ctx.client.updateReport(viewId, patch);
    const final = await ctx.client.getReport(viewId).catch(() => report);
    return ok({ updated: true, view: slimView(final) });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleDeleteView(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;
  if (!ctx.config.enableDelete) {
    return err('MCP_MODE_BLOCKED', 'View delete is disabled. Set SMARTSUITE_ENABLE_DELETE=true to enable deleting views.');
  }

  const viewId = args['viewId'] as string;
  const confirm = args['confirm'] === true;
  if (!viewId) return err('SMARTSUITE_VALIDATION_ERROR', 'viewId is required.');

  try {
    const report = await ctx.client.getReport(viewId);
    if (NON_VIEW_MODES.has(report.view_mode)) {
      return err('SMARTSUITE_VALIDATION_ERROR', `"${viewId}" is a ${report.view_mode}, not a view. Use the ${report.view_mode === 'form' ? 'form' : 'dashboard'} tools.`);
    }

    // Refuse to delete the last remaining view — an application must keep at least one.
    const reports = await ctx.client.listReports(report.application);
    const views = reports.filter((r) => !NON_VIEW_MODES.has(r.view_mode));
    if (views.length <= 1) {
      return err('SMARTSUITE_VALIDATION_ERROR', 'Cannot delete the only view — an application must have at least one view.');
    }

    if (!confirm) {
      return ok({ dryRun: true, wouldDelete: { id: report.id, name: report.label, type: report.view_mode }, hint: 'Set confirm=true to permanently delete this view.' });
    }

    await ctx.client.deleteReport(viewId);
    return ok({ deleted: true, id: viewId, name: report.label });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
