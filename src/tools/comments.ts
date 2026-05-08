import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { writeAudit } from '../utils/audit.js';

export async function handleListComments(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const recordId = args['recordId'] as string;

  try {
    const comments = await ctx.client.listComments(applicationId, recordId);
    const items = comments.map((c) => ({
      id: c.id,
      author: c.author ?? c.created_by,
      text: c.message ?? c.text,
      createdAt: c.created_at,
    }));
    return ok({ items, count: items.length });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleCreateComment(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'Creating comments is blocked in readonly mode.');
  }

  const applicationId = args['applicationId'] as string;
  const recordId = args['recordId'] as string;
  const text = args['text'] as string;

  if (!text || text.trim() === '') {
    return err('SMARTSUITE_VALIDATION_ERROR', 'text is required');
  }

  try {
    const comment = await ctx.client.createComment(applicationId, recordId, text);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_create_comment',
      accountId: ctx.config.accountId,
      applicationId,
      recordId,
      mode: ctx.config.mode,
      success: true,
      errorCode: null,
    });
    return ok({ created: true, comment: { id: comment.id } });
  } catch (e) {
    const er = toErrorResponse(e);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_create_comment',
      accountId: ctx.config.accountId,
      applicationId,
      recordId,
      mode: ctx.config.mode,
      success: false,
      errorCode: er.code,
    });
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}
