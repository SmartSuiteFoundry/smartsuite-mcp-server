import { ToolContext, ToolResult, ok } from './context.js';
import { toErrorResponse } from '../errors.js';

export async function handleListViews(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  try {
    const views = await ctx.client.listViews(applicationId);
    return ok({ items: views, count: views.length });
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
    const view = await ctx.client.getView(applicationId, viewId);
    return ok(view);
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
