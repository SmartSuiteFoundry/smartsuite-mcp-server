import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { Report, DashboardWidget } from '../types/smartsuite.js';

const DASHBOARD_MODE = 'dashboard';

/**
 * Mark the lowest-`order` view as the default/base view. SmartSuite has no
 * explicit default flag on a report, so this is inferred from ordering.
 */
function computeDefaultId(reports: Report[]): string | undefined {
  let best: Report | undefined;
  for (const r of reports) {
    if (!best || (r.order ?? 0) < (best.order ?? 0)) best = r;
  }
  return best?.id;
}

/** Extract the common, view-type-agnostic config from a report's `state`. */
function extractViewConfig(report: Report): Record<string, unknown> {
  const state = (report.state ?? {}) as Record<string, any>;
  const filterWindow = state['filterWindow'] ?? {};
  const filters =
    filterWindow?.new_filters?.conditions ??
    filterWindow?.filter?.fields ??
    [];
  return {
    filters,
    sort: state['sortWindow']?.sort ?? [],
    groupBy: state['groupbyWindow']?.group ?? [],
    visibleFields: state['fieldsWindow']?.visibleFields ?? [],
    collapsedFields: state['fieldsWindow']?.collapsed ?? [],
  };
}

/** Form-view config (form_state): submission settings, branding, and per-field prefill/help. */
function extractFormConfig(report: Report): Record<string, unknown> {
  const fs = (report.form_state ?? {}) as Record<string, any>;
  const items = Array.isArray(fs['items']) ? fs['items'] : [];
  return {
    title: fs['title'] ?? null,
    description: fs['description'] ?? null,
    submitLabel: fs['submit_label'] ?? null,
    displayMessage: fs['display_message'] ?? null,
    redirectToUrl: fs['redirect_to_url'] ?? null,
    displaySmartSuiteBranding: fs['display_smartsuite_branding'] ?? null,
    hasProgressRestore: fs['has_progress_restore'] ?? null,
    logoHandle: fs['logo_handle'] ?? null,
    fieldCount: items.length,
    items,
  };
}

function slimSharing(report: Report): Record<string, unknown> {
  return {
    isPrivate: report.is_private ?? false,
    owner: report.owner,
    sharingEnabled: report.sharing_enabled ?? false,
    sharingHash: report.sharing_hash,
    isPasswordProtected: report.is_password_protected ?? false,
    sharingAllowCopy: report.sharing_allow_copy ?? false,
    sharingAllowExport: report.sharing_allow_export ?? false,
    sharingAllowOpenRecord: report.sharing_allow_open_record ?? false,
  };
}

function slimView(report: Report, defaultId: string | undefined, includeConfig: boolean): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: report.id,
    name: report.label,
    type: report.view_mode,
    description: report.description ?? null,
    order: report.order ?? 0,
    isDefault: report.id === defaultId,
  };
  if (includeConfig) base['config'] = extractViewConfig(report);
  return base;
}

function dashboardTabs(report: Report): Array<{ id: string; name: string; order: number }> {
  return report.dashboard?.tabs?.tabs ?? [];
}

// ── Views ──────────────────────────────────────────────────────────────────

export async function handleListViews(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const includeConfig = (args['includeConfig'] as boolean | undefined) ?? false;
  try {
    const reports = await ctx.client.listReports(applicationId);
    const views = reports.filter((r) => r.view_mode !== DASHBOARD_MODE);
    const defaultId = computeDefaultId(views);
    const items = views.map((v) => slimView(v, defaultId, includeConfig));
    return ok({ items, count: items.length });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleDescribeView(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const viewId = args['viewId'] as string;
  try {
    const reports = await ctx.client.listReports(applicationId);
    const views = reports.filter((r) => r.view_mode !== DASHBOARD_MODE);
    const view = views.find((r) => r.id === viewId);
    if (!view) {
      return err('SMARTSUITE_NOT_FOUND', `View "${viewId}" not found in application ${applicationId}`);
    }
    const defaultId = computeDefaultId(views);
    const isForm = view.view_mode === 'form';
    return ok({
      id: view.id,
      name: view.label,
      type: view.view_mode,
      description: view.description ?? null,
      order: view.order ?? 0,
      isDefault: view.id === defaultId,
      ...slimSharing(view),
      ...(isForm
        ? { form: extractFormConfig(view) }
        : { config: extractViewConfig(view), state: view.state ?? {} }),
    });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

// ── Dashboards ───────────────────────────────────────────────────────────────

export async function handleListDashboards(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  try {
    const reports = await ctx.client.listReports(applicationId);
    const dashboards = reports.filter((r) => r.view_mode === DASHBOARD_MODE);
    const items = dashboards.map((d) => {
      const tabs = dashboardTabs(d);
      return {
        id: d.id,
        name: d.label,
        description: d.description ?? null,
        order: d.order ?? 0,
        tabCount: tabs.length,
        tabs,
      };
    });
    return ok({ items, count: items.length });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

function slimWidget(w: DashboardWidget): Record<string, unknown> {
  return {
    id: w.id,
    type: w.widget_type,
    name: w.name,
    showName: w.show_name ?? false,
    position: { x: w.position_x ?? 0, y: w.position_y ?? 0 },
    size: { width: w.width ?? 0, height: w.height ?? 0 },
    collapsedByDefault: w.collapsed_by_default ?? false,
    params: w.params,
  };
}

export async function handleDescribeDashboard(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const dashboardId = args['dashboardId'] as string;
  const includeWidgets = (args['includeWidgets'] as boolean | undefined) ?? false;
  try {
    const reports = await ctx.client.listReports(applicationId);
    const dashboard = reports.find((r) => r.id === dashboardId && r.view_mode === DASHBOARD_MODE);
    if (!dashboard) {
      return err('SMARTSUITE_NOT_FOUND', `Dashboard "${dashboardId}" not found in application ${applicationId}`);
    }
    const tabs = dashboardTabs(dashboard);
    const result: Record<string, unknown> = {
      id: dashboard.id,
      name: dashboard.label,
      description: dashboard.description ?? null,
      order: dashboard.order ?? 0,
      ...slimSharing(dashboard),
      tabs,
      footer: dashboard.dashboard?.footer ?? null,
      style: dashboard.dashboard?.style ?? null,
      tabsConfig: {
        enabled: dashboard.dashboard?.tabs?.enabled ?? false,
        position: dashboard.dashboard?.tabs?.position ?? null,
        logo: dashboard.dashboard?.tabs?.logo ?? null,
      },
    };

    if (includeWidgets) {
      const perTab = await Promise.all(
        tabs.map(async (tab) => {
          const widgets = await ctx.client.listDashboardWidgets(dashboard.id, tab.id);
          return { tabId: tab.id, tabName: tab.name, widgets: widgets.map(slimWidget) };
        }),
      );
      result['widgetsByTab'] = perTab;
      result['widgetCount'] = perTab.reduce((n, t) => n + t.widgets.length, 0);
    }

    return ok(result);
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
