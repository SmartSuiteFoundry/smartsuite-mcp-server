import { ToolContext, ToolResult, ok } from './context.js';
import { toErrorResponse } from '../errors.js';
import { FieldDefinition } from '../types/smartsuite.js';

function normalizeField(f: FieldDefinition) {
  return {
    slug: f.slug,
    label: f.label,
    type: f.field_type,
    required: f.params.required ?? false,
    primary: f.params.primary ?? false,
    hidden: f.params.hidden ?? false,
    ...(f.params.help_text ? { helpText: f.params.help_text } : {}),
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
  };
}

export async function handleListApplications(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const solutionId = args['solutionId'] as string | undefined;
  try {
    const apps = await ctx.client.listApplications(solutionId);

    // Apply allowlist/denylist
    const filtered = apps.filter((app) => {
      if (ctx.config.deniedApplications.includes(app.id)) return false;
      if (ctx.config.allowedApplications.length > 0 && !ctx.config.allowedApplications.includes(app.id)) return false;
      return true;
    });

    return ok({ items: filtered, count: filtered.length });
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
  const forceRefresh = (args['forceRefresh'] as boolean | undefined) ?? false;

  if (ctx.config.deniedApplications.includes(applicationId)) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: { code: 'APPLICATION_DENIED', message: `Application ${applicationId} is not accessible` } }, null, 2) }],
      isError: true,
    };
  }

  try {
    const app = await ctx.client.getApplication(applicationId);
    const result: Record<string, unknown> = {
      id: app.id,
      name: app.name,
      slug: app.slug,
      solution: app.solution,
      description: app.description,
    };

    if (includeFields) {
      result['fields'] = (app.structure ?? []).map(normalizeField);
      result['fieldCount'] = (app.structure ?? []).length;
    }

    // Suppress forceRefresh warning — already handled by client
    void forceRefresh;

    return ok(result);
  } catch (e) {
    const er = toErrorResponse(e);
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}
