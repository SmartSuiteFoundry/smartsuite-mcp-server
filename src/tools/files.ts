import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { writeAudit } from '../utils/audit.js';

/**
 * SmartSuite file fields (type: filefield) store an array of file objects.
 * Each object has the shape:
 *   { handle: string, filename: string, size: number, mimetype: string, url?: string }
 * The `handle` is a Filestack handle — pass it to smartsuite_get_file_url to get
 * a signed, time-limited CDN download URL.
 */

export async function handleGetFileUrl(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const fileHandle = args['fileHandle'] as string;

  if (!fileHandle || fileHandle.trim() === '') {
    return err('SMARTSUITE_VALIDATION_ERROR', 'fileHandle is required');
  }

  try {
    const url = await ctx.client.getFileUrl(fileHandle);
    return ok({ handle: fileHandle, url });
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
  }
}

export async function handleUploadFile(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'File upload is blocked in readonly mode.');
  }

  const applicationId = args['applicationId'] as string;
  const recordId = args['recordId'] as string;
  const fieldSlug = args['fieldSlug'] as string;
  const filePath = args['filePath'] as string;
  const filename = args['filename'] as string | undefined;

  if (!filePath) {
    return err('SMARTSUITE_VALIDATION_ERROR', 'filePath is required');
  }

  try {
    const result = await ctx.client.uploadFile(applicationId, recordId, fieldSlug, filePath, filename);

    writeAudit(ctx.logger, {
      tool: 'smartsuite_upload_file',
      accountId: ctx.config.accountId,
      applicationId,
      recordId,
      mode: ctx.config.mode,
      fieldSlugs: [fieldSlug],
      success: true,
      errorCode: null,
    });

    return ok({ uploaded: true, applicationId, recordId, fieldSlug, result });
  } catch (e) {
    const er = toErrorResponse(e);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_upload_file',
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
