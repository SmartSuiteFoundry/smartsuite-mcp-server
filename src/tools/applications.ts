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

function normalizeField(f: FieldDefinition) {
  return {
    slug: f.slug,
    label: f.label,
    type: f.field_type,
    required: f.params.required ?? false,
    primary: f.params.primary ?? false,
    hidden: f.params.hidden ?? false,
    ...helpTextOf(f),
    ...(f.params.choices?.length
      ? {
          options: f.params.choices.map((c) => ({
            value: c.value,
            label: c.label,
          })),
        }
      : {}),
    ...(f.params.linked_application ? { linkedApplication: f.params.linked_application } : {}),
    ...(f.params.linked_field_slug  ? { linkedFieldSlug: f.params.linked_field_slug }   : {}),
    ...(f.params.display_format ? { displayFormat: f.params.display_format } : {}),
    ...(f.params.ai_agent ? { isAiField: f.params.ai_agent.enabled ?? false } : {}),
  };
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
      result['fields'] = (app.structure ?? []).map(normalizeField);
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
