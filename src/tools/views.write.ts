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
  /** Calendar: the date field records are placed on. Without it a calendar opens blank. */
  dateField?: string;
  /** Kanban: the field whose values become the columns. Without it a board has no columns. */
  stackBy?: string;
  /** Kanban: optional second axis (rows). */
  swimlaneBy?: string;
}

/** Default colour SmartSuite gives a calendar's date field; matches UI-created calendars. */
const CALENDAR_FIELD_COLOR = { background: '#B7E3FB', font: '#2E3538' };

/** View modes whose usable configuration lives in a window no other parameter reaches. */
export const VIEW_MODE_BINDINGS: Record<string, { param: string; what: string }> = {
  calendar: { param: 'dateField', what: 'the date field records are placed on' },
  kanban: { param: 'stackBy', what: 'the field whose values become the columns' },
};

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

  // A calendar renders from calendarFieldsWindow.fields, NOT from groupBy/sort. Without this a
  // calendar is created, reports success, and opens with nothing on it.
  if (typeof config.dateField === 'string' && config.dateField) {
    state['calendarFieldsWindow'] = {
      ...(state['calendarFieldsWindow'] ?? {}),
      fields: [{ slug: config.dateField, color: CALENDAR_FIELD_COLOR }],
    };
  }
  // A kanban stacks on stackByWindow.columnFieldSlug. groupBy writes groupbyWindow, which is a
  // different axis — passing a field there leaves the board with no columns at all.
  if (typeof config.stackBy === 'string' && config.stackBy) {
    state['stackByWindow'] = { ...(state['stackByWindow'] ?? {}), columnFieldSlug: config.stackBy };
  }
  if (typeof config.swimlaneBy === 'string' && config.swimlaneBy) {
    state['stackByWindow'] = { ...(state['stackByWindow'] ?? {}), swimlaneFieldSlug: config.swimlaneBy };
  }
  return state;
}

/**
 * A calendar with no date field and a kanban with no stack field both create cleanly and open
 * unusable, so warn at the point of creation rather than leaving it to be discovered in the UI.
 */
export function viewBindingWarning(viewMode: string, state: Record<string, any>): string | null {
  if (viewMode === 'calendar' && !(state['calendarFieldsWindow']?.fields ?? []).length) {
    return 'This calendar has no date field bound, so it will open empty. Pass dateField (a date-type field slug) to place records on the calendar.';
  }
  if (viewMode === 'kanban' && !state['stackByWindow']?.columnFieldSlug) {
    return 'This board has no stack-by field, so it will render without columns. Pass stackBy (a status or single-select field slug) to create the columns.';
  }
  return null;
}

function readConfig(args: Record<string, unknown>): ViewConfig {
  return {
    visibleFields: args['visibleFields'] as string[] | undefined,
    filters: args['filters'] as unknown[] | undefined,
    filterOperator: args['filterOperator'] as 'and' | 'or' | undefined,
    sort: args['sort'] as unknown[] | undefined,
    groupBy: args['groupBy'] as unknown[] | undefined,
    dateField: args['dateField'] as string | undefined,
    stackBy: args['stackBy'] as string | undefined,
    swimlaneBy: args['swimlaneBy'] as string | undefined,
  };
}

function hasConfig(c: ViewConfig): boolean {
  return [c.visibleFields, c.filters, c.sort, c.groupBy].some(Array.isArray)
    || [c.dateField, c.stackBy, c.swimlaneBy].some((v) => typeof v === 'string' && v);
}

/** Collect the field slugs referenced by a config so they can be validated against the schema. */
function referencedSlugs(c: ViewConfig): string[] {
  const out: string[] = [];
  if (Array.isArray(c.visibleFields)) out.push(...c.visibleFields);
  const fieldOf = (x: unknown) => (x && typeof x === 'object' ? ((x as any).field ?? (x as any).slug ?? (x as any).field_slug) : undefined);
  for (const arr of [c.filters, c.sort, c.groupBy]) {
    if (Array.isArray(arr)) for (const item of arr) { const f = fieldOf(item); if (typeof f === 'string') out.push(f); }
  }
  for (const one of [c.dateField, c.stackBy, c.swimlaneBy]) if (typeof one === 'string' && one) out.push(one);
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
    // Surfaced so a reader can tell a working calendar/board from a blank one.
    ...(r.view_mode === 'calendar' ? { dateField: state['calendarFieldsWindow']?.fields?.[0]?.slug ?? null } : {}),
    ...(r.view_mode === 'kanban' ? { stackBy: state['stackByWindow']?.columnFieldSlug ?? null } : {}),
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

    const previewWarning = viewBindingWarning(viewMode, applyViewConfig(defaultViewState(), config));
    if (!confirm) {
      return ok({
        dryRun: true,
        wouldCreate: { applicationId, solution, label, viewMode, description: description ?? '', config: hasConfig(config) ? config : null },
        ...(previewWarning ? { warning: previewWarning } : {}),
        hint: 'Label is available. Set confirm=true to create the view.',
      });
    }

    const body: Record<string, unknown> = { application: applicationId, solution, label, view_mode: viewMode };
    if (typeof description === 'string') body['description'] = description;
    const created = await ctx.client.createReport(body);

    // Always write the state for a mode that needs a binding, so the warning below reflects what
    // was actually saved rather than what the caller happened to pass.
    if (hasConfig(config) || VIEW_MODE_BINDINGS[viewMode]) {
      await ctx.client.updateReport(created.id, { state: applyViewConfig(defaultViewState(), config) });
    }
    const final = await ctx.client.getReport(created.id).catch(() => created);
    const warning = viewBindingWarning(viewMode, (final.state ?? {}) as Record<string, any>);
    return ok({ created: true, mode: ctx.config.mode, view: slimView(final), ...(warning ? { warning } : {}) });
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
      return err('SMARTSUITE_VALIDATION_ERROR', 'Nothing to update. Provide label, description, and/or view config (visibleFields, filters, sort, groupBy, dateField for a calendar, stackBy/swimlaneBy for a kanban).');
    }

    await ctx.client.updateReport(viewId, patch);
    const final = await ctx.client.getReport(viewId).catch(() => report);
    const warning = viewBindingWarning(final.view_mode ?? '', (final.state ?? {}) as Record<string, any>);
    return ok({ updated: true, view: slimView(final), ...(warning ? { warning } : {}) });
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
