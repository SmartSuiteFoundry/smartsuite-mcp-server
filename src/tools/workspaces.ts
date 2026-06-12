import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { slimWorkspace } from '../workspaces.js';

export async function handleListWorkspaces(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.config.enableCrossWorkspace) {
    return err(
      'SMARTSUITE_PERMISSION_DENIED',
      'Cross-workspace access is disabled. Set SMARTSUITE_ENABLE_CROSS_WORKSPACE=true to enable it.',
    );
  }

  const query = (args['query'] as string | undefined)?.trim().toLowerCase();
  try {
    const accounts = await ctx.client.listAccounts();
    let items = accounts.map((w) => slimWorkspace(w, ctx.config));
    if (query) {
      items = items.filter(
        (w) => w.name.toLowerCase().includes(query) || w.slug.toLowerCase().includes(query),
      );
    }
    // Sort: primary first, then by name.
    items.sort((a, b) => (a.isPrimary === b.isPrimary ? a.name.localeCompare(b.name) : a.isPrimary ? -1 : 1));
    return ok({ items, count: items.length, primaryWorkspace: ctx.config.accountId });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}
