import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { Report, ReportTab, DashboardWidget, FieldDefinition } from '../types/smartsuite.js';
import { WIDGET_TEMPLATES } from './widget-templates.js';

const DASHBOARD_MODE = 'dashboard';

/** Content widgets (static / presentational). */
export const CONTENT_WIDGET_TYPES = [
  'text-block-widget', 'heading-widget', 'simple-banner-widget', 'hero-widget', 'faq-widget', 'divider-widget',
];
/** Data widgets (bound to a record source). */
export const DATA_WIDGET_TYPES = [
  'list-view-widget', 'card-view-widget', 'kanban-view-widget', 'calendar-view-widget', 'timeline-view-widget',
  'chart-widget', 'pivot-widget', 'summary-card-widget', 'progress-widget', 'comparison-widget',
  'filter-widget', 'record-details-widget', 'data-schema-widget',
];
/** Additional widget types observed in real dashboards (no auto-fill template yet — supply params). */
export const OTHER_WIDGET_TYPES = [
  'spacing-widget', 'button-row-widget', 'webpage-widget', 'record-picker-widget', 'countdown-widget', 'world-clock-widget',
];
/** Every accepted dashboard widget type. The first 19 (content+data) have auto-fill param templates. */
export const KNOWN_WIDGET_TYPES = new Set([...CONTENT_WIDGET_TYPES, ...DATA_WIDGET_TYPES, ...OTHER_WIDGET_TYPES]);

/**
 * Per-type default layout (grid width in columns of 4, height in px), taken from the natural sizes the
 * SmartSuite UI assigns. A single uniform default (the old width:4/height:200) rendered compact widgets
 * like metric/summary cards at the wrong height — and since height is stored explicitly, re-saving in the
 * UI didn't correct it. Callers can still override via position/size.
 */
export const WIDGET_DEFAULT_LAYOUT: Record<string, { width: number; height: number }> = {
  'summary-card-widget': { width: 1, height: 156 }, // 128 clips the card's bottom padding; 156 is the correct height
  'progress-widget':     { width: 1, height: 128 },
  'comparison-widget':   { width: 1, height: 128 },
  'countdown-widget':    { width: 1, height: 192 },
  'world-clock-widget':  { width: 1, height: 320 },
  'webpage-widget':      { width: 1, height: 256 },
  'chart-widget':        { width: 2, height: 448 },
  'pivot-widget':        { width: 2, height: 448 },
  'card-view-widget':    { width: 2, height: 432 },
  'kanban-view-widget':  { width: 2, height: 432 },
  'data-schema-widget':  { width: 2, height: 384 },
  'list-view-widget':    { width: 4, height: 448 },
  'calendar-view-widget':{ width: 4, height: 768 },
  'timeline-view-widget':{ width: 4, height: 256 },
  'record-details-widget': { width: 4, height: 768 },
  'record-picker-widget': { width: 4, height: 128 },
  'filter-widget':       { width: 4, height: 128 },
  'simple-banner-widget':{ width: 4, height: 256 },
  'hero-widget':         { width: 4, height: 256 },
  'heading-widget':      { width: 4, height: 116 },
  'text-block-widget':   { width: 2, height: 256 },
  'faq-widget':          { width: 4, height: 256 },
  'divider-widget':      { width: 4, height: 88 },
  'button-row-widget':   { width: 4, height: 56 },
  'spacing-widget':      { width: 4, height: 40 },
};
const FALLBACK_LAYOUT = { width: 4, height: 256 };
/**
 * Widgets created via the API get `color: null` unless set, but UI-created widgets always carry a hex.
 * The dashboard's "Highlight color" editor writes to `color` and breaks on a null (blanks the dashboard),
 * so we always seed a valid accent color on create.
 */
const DEFAULT_WIDGET_COLOR = '#3A86FF';

/** Resolve the default {width,height} for a widget type. */
export function defaultLayoutFor(widgetType: string): { width: number; height: number } {
  return WIDGET_DEFAULT_LAYOUT[widgetType] ?? FALLBACK_LAYOUT;
}

interface TemplateFill {
  solution: string;
  application: string;
  primaryField: string;
  selectField: string;
  dateField: string;
}

/**
 * Produce a minimal, valid `params` object for a widget type by substituting the target application's
 * ids/field slugs into the discovered template (see widget-templates.ts). Returns null if no template
 * exists for the type. Data widgets default to reading the dashboard's own application.
 */
export function fillWidgetTemplate(widgetType: string, fill: TemplateFill): Record<string, unknown> | null {
  const tmpl = WIDGET_TEMPLATES[widgetType];
  if (!tmpl) return null;
  const map: Record<string, string> = {
    __SOLUTION__: fill.solution,
    __APPLICATION__: fill.application,
    __PRIMARY_FIELD__: fill.primaryField,
    __SELECT_FIELD__: fill.selectField || fill.primaryField,
    __DATE_FIELD__: fill.dateField || fill.primaryField,
  };
  let s = JSON.stringify(tmpl);
  for (const [tok, val] of Object.entries(map)) s = s.split(`"${tok}"`).join(JSON.stringify(val ?? ''));
  return JSON.parse(s);
}

const SELECT_TYPES = new Set(['singleselectfield', 'multipleselectfield', 'statusfield']);
const DATE_TYPES = new Set(['datefield', 'duedatefield']);

/** Pick sensible default field slugs from a schema for template substitution. */
export function pickTemplateFields(structure: FieldDefinition[]): { primaryField: string; selectField: string; dateField: string } {
  const primary = structure.find((f) => (f.params as { primary?: boolean } | undefined)?.primary) ?? structure[0];
  const primaryField = primary?.slug ?? 'title';
  return {
    primaryField,
    selectField: structure.find((f) => SELECT_TYPES.has(f.field_type))?.slug ?? primaryField,
    dateField: structure.find((f) => DATE_TYPES.has(f.field_type))?.slug ?? primaryField,
  };
}

function writeGuard(ctx: ToolContext): ToolResult | null {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'Dashboard writes are blocked in readonly mode. Set SMARTSUITE_MCP_MODE=readwrite or admin.');
  }
  if (!ctx.config.enableSchemaWrite) {
    return err('MCP_MODE_BLOCKED', 'Dashboard writes are disabled. Set SMARTSUITE_ENABLE_SCHEMA_WRITE=true to enable creating/updating dashboards.');
  }
  return null;
}

const TAB_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Generate a 6-char tab id in the style SmartSuite uses (e.g. "XcOEKp"). */
export function generateTabId(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += TAB_ID_ALPHABET[Math.floor(Math.random() * TAB_ID_ALPHABET.length)];
  return s;
}

type TabSpec = string | { id?: string; name?: string; order?: number };

/** Build a tabs array from specs (name strings or {id?,name,order?}); ids are preserved or generated. */
export function buildTabs(specs: TabSpec[]): ReportTab[] {
  return specs.map((s, i) => {
    const obj = typeof s === 'string' ? { name: s } : s;
    return {
      id: obj.id && String(obj.id).trim() ? String(obj.id) : generateTabId(),
      name: obj.name?.trim() ? obj.name : `Tab ${i + 1}`,
      order: typeof obj.order === 'number' ? obj.order : i,
    };
  });
}

/** Merge dashboard-config overrides onto the existing config, preserving untouched nested settings. */
export function buildDashboardConfig(
  existing: Report['dashboard'],
  overrides: { tabs?: ReportTab[]; tabsEnabled?: boolean; tabsPosition?: string; footer?: Record<string, unknown>; style?: Record<string, unknown> },
): Record<string, unknown> {
  const base = (existing ?? {}) as Record<string, any>;
  const tabsBlock = { ...(base['tabs'] ?? {}) };
  if (overrides.tabs) tabsBlock['tabs'] = overrides.tabs;
  if (typeof overrides.tabsEnabled === 'boolean') tabsBlock['enabled'] = overrides.tabsEnabled;
  else if (overrides.tabs && overrides.tabs.length > 1) tabsBlock['enabled'] = true;
  if (typeof overrides.tabsPosition === 'string') tabsBlock['position'] = overrides.tabsPosition;
  return {
    ...base,
    tabs: tabsBlock,
    ...(overrides.footer ? { footer: { ...(base['footer'] ?? {}), ...overrides.footer } } : {}),
    ...(overrides.style ? { style: { ...(base['style'] ?? {}), ...overrides.style } } : {}),
  };
}

function tabsOf(report: Report): ReportTab[] {
  return report.dashboard?.tabs?.tabs ?? [];
}

/** Extract widget layout fields (position/size) from args into an API patch. */
export function widgetLayoutPatch(args: Record<string, unknown>): Record<string, number> {
  const patch: Record<string, number> = {};
  const pos = args['position'] as { x?: number; y?: number } | undefined;
  const size = args['size'] as { width?: number; height?: number } | undefined;
  if (pos && typeof pos.x === 'number') patch['position_x'] = pos.x;
  if (pos && typeof pos.y === 'number') patch['position_y'] = pos.y;
  if (size && typeof size.width === 'number') patch['width'] = size.width;
  if (size && typeof size.height === 'number') patch['height'] = size.height;
  return patch;
}

function slimWidget(w: DashboardWidget): Record<string, unknown> {
  return {
    id: w.id,
    type: w.widget_type,
    name: w.name,
    tabId: w.tab ?? null,
    showName: w.show_name ?? false,
    position: { x: w.position_x ?? 0, y: w.position_y ?? 0 },
    size: { width: w.width ?? 0, height: w.height ?? 0 },
    collapsedByDefault: w.collapsed_by_default ?? false,
    params: w.params,
  };
}

function slimDashboard(r: Report): Record<string, unknown> {
  const t = r.dashboard?.tabs;
  return {
    id: r.id,
    name: r.label,
    description: r.description ?? null,
    tabsEnabled: t?.enabled ?? false,
    tabsPosition: t?.position ?? null,
    tabs: t?.tabs ?? [],
  };
}

// ── Dashboards ───────────────────────────────────────────────────────────────

export async function handleCreateDashboard(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const label = args['label'] as string;
  const description = args['description'] as string | undefined;
  const tabSpecs = args['tabs'] as TabSpec[] | undefined;
  const confirm = args['confirm'] === true;
  if (!applicationId) return err('SMARTSUITE_VALIDATION_ERROR', 'applicationId is required.');
  if (!label?.trim()) return err('SMARTSUITE_VALIDATION_ERROR', 'label is required.');

  try {
    const schema = await ctx.client.getApplicationSchema(applicationId);
    const solution = (schema as { solution?: string }).solution;
    if (!solution) return err('SMARTSUITE_VALIDATION_ERROR', `Could not resolve the solution for application ${applicationId}.`);

    const isUnique = await ctx.client.validateReportLabel(applicationId, label);
    if (!isUnique) {
      const suggestion = await ctx.client.generateReportLabel(applicationId, label);
      return err('SMARTSUITE_VALIDATION_ERROR', `A report named "${label}" already exists in this application. Try "${suggestion}".`);
    }

    if (!confirm) {
      return ok({
        dryRun: true,
        wouldCreate: { applicationId, solution, label, viewMode: DASHBOARD_MODE, tabs: Array.isArray(tabSpecs) ? buildTabs(tabSpecs).map((t) => t.name) : ['(default tab)'] },
        hint: 'Label is available. Set confirm=true to create the dashboard.',
      });
    }

    const body: Record<string, unknown> = { application: applicationId, solution, label, view_mode: DASHBOARD_MODE };
    if (typeof description === 'string') body['description'] = description;
    const created = await ctx.client.createReport(body);

    // The server auto-creates one "Tab"; if the caller named tabs, replace the tab set.
    if (Array.isArray(tabSpecs) && tabSpecs.length) {
      const config = buildDashboardConfig(created.dashboard, { tabs: buildTabs(tabSpecs) });
      await ctx.client.updateReport(created.id, { dashboard: config });
    }
    const final = await ctx.client.getReport(created.id).catch(() => created);
    return ok({ created: true, mode: ctx.config.mode, dashboard: slimDashboard(final) });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleUpdateDashboard(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const dashboardId = args['dashboardId'] as string;
  const label = args['label'] as string | undefined;
  const description = args['description'] as string | undefined;
  const tabSpecs = args['tabs'] as TabSpec[] | undefined;
  const tabsEnabled = args['tabsEnabled'] as boolean | undefined;
  const tabsPosition = args['tabsPosition'] as string | undefined;
  const footer = args['footer'] as Record<string, unknown> | undefined;
  const style = args['style'] as Record<string, unknown> | undefined;
  if (!dashboardId) return err('SMARTSUITE_VALIDATION_ERROR', 'dashboardId is required.');

  try {
    const report = await ctx.client.getReport(dashboardId);
    if (report.view_mode !== DASHBOARD_MODE) {
      return err('SMARTSUITE_VALIDATION_ERROR', `"${dashboardId}" is a ${report.view_mode}, not a dashboard. Use the view tools.`);
    }

    const patch: Record<string, unknown> = {};
    if (typeof label === 'string' && label.trim() && label !== report.label) {
      const isUnique = await ctx.client.validateReportLabel(report.application, label);
      if (!isUnique) {
        const suggestion = await ctx.client.generateReportLabel(report.application, label);
        return err('SMARTSUITE_VALIDATION_ERROR', `A report named "${label}" already exists. Try "${suggestion}".`);
      }
      patch['label'] = label;
    }
    if (typeof description === 'string') patch['description'] = description;

    const touchesConfig = tabSpecs !== undefined || tabsEnabled !== undefined || tabsPosition !== undefined || footer !== undefined || style !== undefined;
    if (touchesConfig) {
      patch['dashboard'] = buildDashboardConfig(report.dashboard, {
        tabs: Array.isArray(tabSpecs) ? buildTabs(tabSpecs) : undefined,
        tabsEnabled,
        tabsPosition,
        footer,
        style,
      });
    }

    if (Object.keys(patch).length === 0) {
      return err('SMARTSUITE_VALIDATION_ERROR', 'Nothing to update. Provide label, description, tabs, tabsEnabled, tabsPosition, footer, and/or style.');
    }

    await ctx.client.updateReport(dashboardId, patch);
    const final = await ctx.client.getReport(dashboardId).catch(() => report);
    return ok({ updated: true, dashboard: slimDashboard(final) });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleDeleteDashboard(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;
  if (!ctx.config.enableDelete) {
    return err('MCP_MODE_BLOCKED', 'Dashboard delete is disabled. Set SMARTSUITE_ENABLE_DELETE=true to enable deleting dashboards.');
  }

  const dashboardId = args['dashboardId'] as string;
  const confirm = args['confirm'] === true;
  if (!dashboardId) return err('SMARTSUITE_VALIDATION_ERROR', 'dashboardId is required.');

  try {
    const report = await ctx.client.getReport(dashboardId);
    if (report.view_mode !== DASHBOARD_MODE) {
      return err('SMARTSUITE_VALIDATION_ERROR', `"${dashboardId}" is a ${report.view_mode}, not a dashboard. Use the view tools.`);
    }
    if (!confirm) {
      return ok({ dryRun: true, wouldDelete: { id: report.id, name: report.label, tabCount: tabsOf(report).length }, hint: 'Set confirm=true to permanently delete this dashboard and all its widgets.' });
    }
    await ctx.client.deleteReport(dashboardId);
    return ok({ deleted: true, id: dashboardId, name: report.label });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

// ── Widgets ──────────────────────────────────────────────────────────────────

export async function handleAddDashboardWidget(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const dashboardId = args['dashboardId'] as string;
  let tabId = args['tabId'] as string | undefined;
  const widgetType = args['widgetType'] as string;
  const name = args['name'] as string | undefined;
  let params = (args['params'] as Record<string, unknown> | undefined) ?? {};
  if (!dashboardId) return err('SMARTSUITE_VALIDATION_ERROR', 'dashboardId is required.');
  if (!widgetType?.trim()) return err('SMARTSUITE_VALIDATION_ERROR', 'widgetType is required.');
  if (!KNOWN_WIDGET_TYPES.has(widgetType)) {
    return err('SMARTSUITE_VALIDATION_ERROR', `Unknown widgetType "${widgetType}". Valid types are — content: ${CONTENT_WIDGET_TYPES.join(', ')}; data: ${DATA_WIDGET_TYPES.join(', ')}.`);
  }

  try {
    const report = await ctx.client.getReport(dashboardId);
    if (report.view_mode !== DASHBOARD_MODE) {
      return err('SMARTSUITE_VALIDATION_ERROR', `"${dashboardId}" is a ${report.view_mode}, not a dashboard.`);
    }
    const tabs = tabsOf(report);
    if (!tabId) tabId = tabs[0]?.id;
    if (!tabId) return err('SMARTSUITE_VALIDATION_ERROR', 'Dashboard has no tab to place the widget on.');
    if (!tabs.some((t) => t.id === tabId)) {
      return err('SMARTSUITE_VALIDATION_ERROR', `Tab "${tabId}" not found on this dashboard. Available: ${tabs.map((t) => `${t.id} (${t.name})`).join(', ') || '(none)'}.`);
    }

    // No params supplied → fill a minimal valid template for this widget type, pointed at the
    // dashboard's own application (data widgets) with sensible default field slugs.
    let filledFromTemplate = false;
    if (Object.keys(params).length === 0) {
      const schema = await ctx.client.getApplicationSchema(report.application);
      const fields = pickTemplateFields(schema.structure ?? []);
      const template = fillWidgetTemplate(widgetType, { solution: (schema as { solution?: string }).solution ?? '', application: report.application, ...fields });
      if (template) { params = template; filledFromTemplate = true; }
    }

    const layout = widgetLayoutPatch(args);
    const def = defaultLayoutFor(widgetType);
    // When position_y isn't given, append below the lowest existing widget on the tab rather than
    // stacking everything at y=0 (which makes widgets overlap and hides thin ones like dividers).
    let positionY = layout['position_y'];
    if (positionY === undefined) {
      const existing = await ctx.client.listDashboardWidgets(dashboardId, tabId);
      positionY = existing.reduce((max, w) => Math.max(max, (w.position_y ?? 0) + (w.height ?? 0)), 0);
    }
    const body: Record<string, unknown> = {
      report: dashboardId,
      tab: tabId,
      widget_type: widgetType,
      name: name ?? widgetType.replace(/-widget$/, '').replace(/-/g, ' '),
      position_x: layout['position_x'] ?? 0,
      position_y: positionY,
      width: layout['width'] ?? def.width,
      height: layout['height'] ?? def.height,
      // Non-null defaults matching UI-created widgets, so the UI's color/description editors don't choke.
      color: typeof args['color'] === 'string' ? args['color'] : DEFAULT_WIDGET_COLOR,
      description: typeof args['description'] === 'string' ? args['description'] : '',
      collapsed_by_default: false,
      params,
    };
    const created = await ctx.client.createWidget(body);
    return ok({ created: true, filledFromTemplate, widget: slimWidget(created) });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleUpdateDashboardWidget(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const widgetId = args['widgetId'] as string;
  if (!widgetId) return err('SMARTSUITE_VALIDATION_ERROR', 'widgetId is required.');

  try {
    const patch: Record<string, unknown> = { ...widgetLayoutPatch(args) };
    if (typeof args['name'] === 'string') patch['name'] = args['name'];
    if (typeof args['tabId'] === 'string') patch['tab'] = args['tabId'];
    if (args['params'] !== undefined) patch['params'] = args['params'];
    if (typeof args['showName'] === 'boolean') patch['show_name'] = args['showName'];
    if (typeof args['color'] === 'string') patch['color'] = args['color'];
    if (typeof args['description'] === 'string') patch['description'] = args['description'];
    if (typeof args['collapsedByDefault'] === 'boolean') patch['collapsed_by_default'] = args['collapsedByDefault'];

    if (Object.keys(patch).length === 0) {
      return err('SMARTSUITE_VALIDATION_ERROR', 'Nothing to update. Provide position, size, name, params, showName, color, description, collapsedByDefault, and/or tabId.');
    }

    const updated = await ctx.client.updateWidget(widgetId, patch);
    return ok({ updated: true, widget: slimWidget(updated) });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleRemoveDashboardWidget(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;
  if (!ctx.config.enableDelete) {
    return err('MCP_MODE_BLOCKED', 'Widget delete is disabled. Set SMARTSUITE_ENABLE_DELETE=true to enable removing widgets.');
  }

  const widgetId = args['widgetId'] as string;
  const confirm = args['confirm'] === true;
  if (!widgetId) return err('SMARTSUITE_VALIDATION_ERROR', 'widgetId is required.');

  try {
    const widget = await ctx.client.getWidget(widgetId).catch(() => null);
    if (!confirm) {
      return ok({ dryRun: true, wouldDelete: widget ? { id: widget.id, type: widget.widget_type, name: widget.name } : { id: widgetId }, hint: 'Set confirm=true to permanently delete this widget.' });
    }
    await ctx.client.deleteWidget(widgetId);
    return ok({ deleted: true, id: widgetId, name: widget?.name ?? null });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

/**
 * Reset existing widgets to their natural per-type size (see WIDGET_DEFAULT_LAYOUT). Fixes dashboards
 * whose widgets were created with the old uniform default (notably metric/summary cards stuck too tall).
 * Preview-first: dry-run unless confirm:true. By default normalizes HEIGHT only (the reported problem) and
 * leaves width/position untouched so row layouts aren't reflowed; pass dimension:"both" to also fix width.
 * Optional widgetTypes restricts which types are touched (e.g. ["summary-card-widget"]).
 */
export async function handleNormalizeDashboardWidgets(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const dashboardId = args['dashboardId'] as string;
  const tabId = args['tabId'] as string | undefined;
  const widgetTypes = args['widgetTypes'] as string[] | undefined;
  const dimension = args['dimension'] === 'both' ? 'both' : 'height';
  const reflow = args['reflow'] === true;
  const confirm = args['confirm'] === true;
  if (!dashboardId) return err('SMARTSUITE_VALIDATION_ERROR', 'dashboardId is required.');

  try {
    const report = await ctx.client.getReport(dashboardId);
    if (report.view_mode !== DASHBOARD_MODE) {
      return err('SMARTSUITE_VALIDATION_ERROR', `"${dashboardId}" is a ${report.view_mode}, not a dashboard.`);
    }
    const typeFilter = Array.isArray(widgetTypes) && widgetTypes.length ? new Set(widgetTypes) : null;
    const inScope = (t: string) => !typeFilter || typeFilter.has(t);
    const tabs = tabsOf(report).filter((t) => !tabId || t.id === tabId);

    interface Change { id: string; type: string; name: string; tabId: string; from: { width: number; height: number; y: number }; to: { width: number; height: number; y: number }; patch: Record<string, unknown> }
    const changes: Change[] = [];

    for (const tab of tabs) {
      const widgets = await ctx.client.listDashboardWidgets(dashboardId, tab.id);
      // Target size per widget (natural per-type for in-scope widgets; unchanged otherwise).
      const meta = widgets.map((w) => {
        const def = defaultLayoutFor(w.widget_type);
        const curW = w.width ?? 0, curH = w.height ?? 0, curY = w.position_y ?? 0;
        return {
          w, curW, curH, curY,
          targetW: dimension === 'both' && inScope(w.widget_type) ? def.width : curW,
          targetH: inScope(w.widget_type) ? def.height : curH,
          targetY: curY,
        };
      });
      // Reflow: group widgets by their current row (identical position_y), order rows top→bottom, and
      // stack them using each row's tallest target height. Preserves columns (position_x) and rows.
      if (reflow) {
        const byRow = new Map<number, typeof meta>();
        for (const m of meta) { const g = byRow.get(m.curY) ?? []; g.push(m); byRow.set(m.curY, g); }
        let cursor = 0;
        for (const y of [...byRow.keys()].sort((a, b) => a - b)) {
          const grp = byRow.get(y)!;
          for (const m of grp) m.targetY = cursor;
          cursor += Math.max(...grp.map((m) => m.targetH));
        }
      }
      for (const m of meta) {
        const sizeChanged = inScope(m.w.widget_type) && (m.targetW !== m.curW || m.targetH !== m.curH);
        const posChanged = reflow && m.targetY !== m.curY;
        if (!sizeChanged && !posChanged) continue;
        const patch: Record<string, unknown> = {};
        if (sizeChanged) { patch['height'] = m.targetH; if (dimension === 'both') patch['width'] = m.targetW; }
        if (posChanged) patch['position_y'] = m.targetY;
        changes.push({
          id: m.w.id, type: m.w.widget_type, name: m.w.name, tabId: tab.id,
          from: { width: m.curW, height: m.curH, y: m.curY }, to: { width: m.targetW, height: m.targetH, y: m.targetY }, patch,
        });
      }
    }

    if (!confirm) {
      return ok({ dryRun: true, dimension, reflow, wouldNormalize: changes.length, changes: changes.map(({ patch, ...c }) => c), hint: 'Set confirm:true to apply. dimension:"both" also fixes width; reflow:true re-stacks widgets to remove overlaps.' });
    }

    const fixed: string[] = [];
    const failures: Array<{ id: string; reason: string }> = [];
    for (const c of changes) {
      try { await ctx.client.updateWidget(c.id, c.patch); fixed.push(c.id); }
      catch (e) { failures.push({ id: c.id, reason: toErrorResponse(e).message }); }
    }
    return ok({ normalized: fixed.length, failed: failures.length, dimension, reflow, failures });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
