import { ToolContext, ToolResult, ok } from './context.js';
import { toErrorResponse } from '../errors.js';

export async function handleListFields(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  try {
    const schema = await ctx.client.getApplicationSchema(applicationId);
    const fields = (schema.structure ?? []).map((f) => ({
      slug: f.slug,
      label: f.label,
      type: f.field_type,
      required: f.params.required ?? false,
      primary: f.params.primary ?? false,
      hidden: f.params.hidden ?? false,
    }));
    return ok({ items: fields, count: fields.length });
  } catch (e) {
    const er = toErrorResponse(e);
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}

export async function handleDescribeField(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const fieldSlug = args['fieldSlug'] as string;
  try {
    const schema = await ctx.client.getApplicationSchema(applicationId);
    const field = (schema.structure ?? []).find((f) => f.slug === fieldSlug);
    if (!field) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: { code: 'SMARTSUITE_NOT_FOUND', message: `Field "${fieldSlug}" not found in application ${applicationId}` } }, null, 2) }],
        isError: true,
      };
    }
    return ok({
      slug: field.slug,
      label: field.label,
      type: field.field_type,
      required: field.params.required ?? false,
      primary: field.params.primary ?? false,
      hidden: field.params.hidden ?? false,
      ...(field.params.choices?.length
        ? { options: field.params.choices.map((c) => ({ value: c.value, label: c.label, color: c.value_color })) }
        : {}),
      ...(field.params.linked_application ? { linkedApplication: field.params.linked_application } : {}),
      ...(field.params.max_length ? { maxLength: field.params.max_length } : {}),
      ...(field.params.help_text ? { helpText: field.params.help_text } : {}),
      ...(field.params.new_choices_allowed !== undefined ? { newChoicesAllowed: field.params.new_choices_allowed } : {}),
    });
  } catch (e) {
    const er = toErrorResponse(e);
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}
