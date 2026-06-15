import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { writeAudit } from '../utils/audit.js';

function extractPlainText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const v = value as Record<string, unknown>;
  // SmartDoc / richtextarea field: look for preview or html
  if (typeof v['preview'] === 'string') return v['preview'];
  if (typeof v['html'] === 'string') {
    // strip HTML tags for a rough plain text
    return (v['html'] as string).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // data/blocks structure — walk children
  if (Array.isArray(v['data'])) {
    return (v['data'] as unknown[]).map(extractPlainText).join('\n');
  }
  if (typeof v['text'] === 'string') return v['text'];
  return JSON.stringify(value);
}

export async function handleGetSmartdocContent(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const applicationId = args['applicationId'] as string;
  const recordId = args['recordId'] as string;
  const fieldSlug = args['fieldSlug'] as string;

  try {
    const record = await ctx.client.getRecord(applicationId, recordId);
    const rawValue = record[fieldSlug];
    if (rawValue === undefined) {
      return err('SMARTSUITE_NOT_FOUND', `Field "${fieldSlug}" not found on record ${recordId}`);
    }
    return ok({
      fieldSlug,
      plainText: extractPlainText(rawValue),
      raw: rawValue,
    });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleAppendSmartdocContent(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'Appending SmartDoc content is blocked in readonly mode.');
  }

  const applicationId = args['applicationId'] as string;
  const recordId = args['recordId'] as string;
  const fieldSlug = args['fieldSlug'] as string;
  const content = args['content'] as string;
  const confirm = (args['confirm'] as boolean | undefined) ?? false;

  if (!confirm) {
    return err('CONFIRMATION_REQUIRED', 'Set confirm=true to append content to the SmartDoc field.');
  }

  try {
    // Read current value, append plain text, write back
    const record = await ctx.client.getRecord(applicationId, recordId);
    const existing = record[fieldSlug];
    const existingText = extractPlainText(existing);

    // For v1: write as a plain string append. SmartSuite accepts string for richtextarea.
    const newValue = existingText ? `${existingText}\n\n${content}` : content;

    await ctx.client.updateRecord(applicationId, recordId, { [fieldSlug]: newValue });

    writeAudit(ctx.logger, {
      tool: 'smartsuite_append_smartdoc_content',
      accountId: ctx.config.accountId,
      applicationId,
      recordId,
      mode: ctx.config.mode,
      fieldSlugs: [fieldSlug],
      success: true,
      errorCode: null,
    });

    return ok({ appended: true, fieldSlug, recordId });
  } catch (e) {
    const er = toErrorResponse(e);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_append_smartdoc_content',
      accountId: ctx.config.accountId,
      applicationId,
      recordId,
      mode: ctx.config.mode,
      fieldSlugs: [fieldSlug],
      success: false,
      errorCode: er.code,
    });
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}
