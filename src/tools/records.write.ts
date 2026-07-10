import { ToolContext, ToolResult, ok, err } from './context.js';
import { toErrorResponse } from '../errors.js';
import { writeAudit } from '../utils/audit.js';

function requireWriteMode(ctx: ToolContext): ToolResult | null {
  if (ctx.config.mode === 'readonly') {
    return err('MCP_MODE_BLOCKED', 'This operation is blocked in readonly mode. Set SMARTSUITE_MCP_MODE=readwrite or admin.');
  }
  return null;
}

function checkApplicationAccess(applicationId: string, ctx: ToolContext): ToolResult | null {
  if (ctx.config.deniedApplications.includes(applicationId)) {
    return err('APPLICATION_DENIED', `Application ${applicationId} is not accessible`);
  }
  if (ctx.config.allowedApplications.length > 0 && !ctx.config.allowedApplications.includes(applicationId)) {
    return err('APPLICATION_DENIED', `Application ${applicationId} is not in the allowed applications list`);
  }
  return null;
}

export async function handleCreateRecord(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const blocked = requireWriteMode(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const fields = args['fields'] as Record<string, unknown>;

  const denied = checkApplicationAccess(applicationId, ctx);
  if (denied) return denied;

  try {
    const record = await ctx.client.createRecord(applicationId, fields);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_create_record',
      accountId: ctx.config.accountId,
      applicationId,
      recordId: record.id,
      mode: ctx.config.mode,
      fieldSlugs: Object.keys(fields),
      success: true,
      errorCode: null,
    });
    return ok({ created: true, record: { id: record.id, title: record.title } });
  } catch (e) {
    const er = toErrorResponse(e);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_create_record',
      accountId: ctx.config.accountId,
      applicationId,
      mode: ctx.config.mode,
      fieldSlugs: Object.keys(fields),
      success: false,
      errorCode: er.code,
    });
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}

export async function handleUpdateRecord(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const blocked = requireWriteMode(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const recordId = args['recordId'] as string;
  const fields = args['fields'] as Record<string, unknown>;

  const denied = checkApplicationAccess(applicationId, ctx);
  if (denied) return denied;

  try {
    const record = await ctx.client.updateRecord(applicationId, recordId, fields);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_update_record',
      accountId: ctx.config.accountId,
      applicationId,
      recordId,
      mode: ctx.config.mode,
      fieldSlugs: Object.keys(fields),
      success: true,
      errorCode: null,
    });
    return ok({ updated: true, record: { id: record.id, title: record.title } });
  } catch (e) {
    const er = toErrorResponse(e);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_update_record',
      accountId: ctx.config.accountId,
      applicationId,
      recordId,
      mode: ctx.config.mode,
      fieldSlugs: Object.keys(fields),
      success: false,
      errorCode: er.code,
    });
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}

interface BatchRecordInput {
  recordId: string;
  fields: Record<string, unknown>;
}

export async function handleUpdateRecords(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const blocked = requireWriteMode(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const records = args['records'] as BatchRecordInput[];
  const dryRun = (args['dryRun'] as boolean | undefined) ?? true;
  const confirm = (args['confirm'] as boolean | undefined) ?? false;

  const denied = checkApplicationAccess(applicationId, ctx);
  if (denied) return denied;

  if (records.length > ctx.config.maxBatchWrites) {
    return err('LIMIT_EXCEEDED', `Batch size ${records.length} exceeds maximum of ${ctx.config.maxBatchWrites}`);
  }

  if (dryRun) {
    return ok({
      dryRun: true,
      wouldUpdate: records.length,
      blocked: 0,
      records: records.map((r) => ({ recordId: r.recordId, valid: true })),
    });
  }

  if (!confirm) {
    return err('CONFIRMATION_REQUIRED', 'Set confirm=true to execute batch update. Use dryRun=true first to preview.');
  }

  try {
    const items = records.map((r) => ({ id: r.recordId, ...r.fields }));
    const res = await ctx.client.bulkUpdateRecords(applicationId, items);

    writeAudit(ctx.logger, {
      tool: 'smartsuite_update_records',
      accountId: ctx.config.accountId,
      applicationId,
      recordIds: records.map((r) => r.recordId),
      mode: ctx.config.mode,
      success: true,
      errorCode: null,
    });

    return ok({
      dryRun: false,
      updated: res.successful_items.length,
      failed: res.failed_items.length,
      failures: res.failed_items,
    });
  } catch (e) {
    const er = toErrorResponse(e);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_update_records',
      accountId: ctx.config.accountId,
      applicationId,
      mode: ctx.config.mode,
      success: false,
      errorCode: er.code,
    });
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}

export async function handleCreateRecords(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const blocked = requireWriteMode(ctx);
  if (blocked) return blocked;

  const applicationId = args['applicationId'] as string;
  const records = (args['records'] as Array<Record<string, unknown>>) ?? [];
  const dryRun = (args['dryRun'] as boolean | undefined) ?? true;
  const confirm = (args['confirm'] as boolean | undefined) ?? false;

  const denied = checkApplicationAccess(applicationId, ctx);
  if (denied) return denied;

  if (!Array.isArray(records) || records.length === 0) {
    return err('SMARTSUITE_VALIDATION_ERROR', 'records must be a non-empty array of field objects.');
  }
  if (records.length > ctx.config.maxBatchWrites) {
    return err('LIMIT_EXCEEDED', `Batch size ${records.length} exceeds maximum of ${ctx.config.maxBatchWrites}`);
  }

  if (dryRun) {
    return ok({
      dryRun: true,
      wouldCreate: records.length,
      sampleFieldSlugs: [...new Set(records.flatMap((r) => Object.keys(r)))].slice(0, 25),
    });
  }

  if (!confirm) {
    return err('CONFIRMATION_REQUIRED', 'Set confirm=true to execute batch create. Use dryRun=true first to preview.');
  }

  try {
    const res = await ctx.client.bulkCreateRecords(applicationId, records);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_create_records',
      accountId: ctx.config.accountId,
      applicationId,
      recordIds: res.successful_items.map((r) => r.id),
      mode: ctx.config.mode,
      success: true,
      errorCode: null,
    });
    return ok({
      dryRun: false,
      created: res.successful_items.length,
      failed: res.failed_items.length,
      recordIds: res.successful_items.map((r) => r.id),
      failures: res.failed_items,
    });
  } catch (e) {
    const er = toErrorResponse(e);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_create_records',
      accountId: ctx.config.accountId,
      applicationId,
      mode: ctx.config.mode,
      success: false,
      errorCode: er.code,
    });
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}

export async function handleRestoreRecords(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const blocked = requireWriteMode(ctx);
  if (blocked) return blocked;

  if (!ctx.config.enableRestore) {
    return err('MCP_MODE_BLOCKED', 'Record restore is disabled. Set SMARTSUITE_ENABLE_RESTORE=true to enable.');
  }

  const applicationId = args['applicationId'] as string;
  const recordIds = (args['recordIds'] as string[]) ?? [];
  const confirm = (args['confirm'] as boolean | undefined) ?? false;

  const denied = checkApplicationAccess(applicationId, ctx);
  if (denied) return denied;

  if (!Array.isArray(recordIds) || recordIds.length === 0) {
    return err('SMARTSUITE_VALIDATION_ERROR', 'recordIds must be a non-empty array. Get IDs from the delete_records response or the audit log.');
  }
  if (recordIds.length > ctx.config.maxBatchWrites) {
    return err('LIMIT_EXCEEDED', `Batch size ${recordIds.length} exceeds maximum of ${ctx.config.maxBatchWrites}`);
  }

  if (!confirm) {
    return ok({
      dryRun: true,
      wouldRestore: recordIds.length,
      recordIds,
      hint: 'Set confirm=true to restore these records from the trash.',
    });
  }

  // The API restores one record at a time; loop and collect per-record outcomes.
  const restored: string[] = [];
  const failures: Array<{ recordId: string; reason: string }> = [];
  for (const recordId of recordIds) {
    try {
      await ctx.client.restoreRecord(applicationId, recordId);
      restored.push(recordId);
    } catch (e) {
      failures.push({ recordId, reason: toErrorResponse(e).message });
    }
  }

  writeAudit(ctx.logger, {
    tool: 'smartsuite_restore_records',
    accountId: ctx.config.accountId,
    applicationId,
    recordIds: restored,
    mode: ctx.config.mode,
    success: failures.length === 0,
    errorCode: failures.length ? 'PARTIAL_FAILURE' : null,
  });

  return ok({ restored: restored.length, failed: failures.length, recordIds: restored, failures });
}

export async function handleDeleteRecords(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const blocked = requireWriteMode(ctx);
  if (blocked) return blocked;

  if (!ctx.config.enableDelete) {
    return err('MCP_MODE_BLOCKED', 'Delete is disabled. Set SMARTSUITE_ENABLE_DELETE=true to enable.');
  }

  const applicationId = args['applicationId'] as string;
  const recordIds = args['recordIds'] as string[];
  const dryRun = (args['dryRun'] as boolean | undefined) ?? true;
  const confirm = (args['confirm'] as boolean | undefined) ?? false;
  const confirmationText = args['confirmationText'] as string | undefined;

  const denied = checkApplicationAccess(applicationId, ctx);
  if (denied) return denied;

  const expectedConfirmationText = `DELETE ${recordIds.length} RECORD${recordIds.length !== 1 ? 'S' : ''}`;

  if (dryRun) {
    return ok({
      dryRun: true,
      wouldDelete: recordIds.length,
      recordIds,
      confirmationTextRequired: expectedConfirmationText,
    });
  }

  if (!confirm) {
    return err('CONFIRMATION_REQUIRED', 'Set confirm=true and provide confirmationText to execute deletion.');
  }

  if (confirmationText !== expectedConfirmationText) {
    return err('CONFIRMATION_REQUIRED', `confirmationText must be exactly: "${expectedConfirmationText}"`);
  }

  try {
    await ctx.client.bulkDeleteRecords(applicationId, recordIds);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_delete_records',
      accountId: ctx.config.accountId,
      applicationId,
      recordIds,
      mode: ctx.config.mode,
      success: true,
      errorCode: null,
    });
    return ok({
      deleted: true,
      count: recordIds.length,
      recordIds,
      ...(ctx.config.enableRestore ? { restoreHint: 'These IDs can be restored with smartsuite_restore_records.' } : {}),
    });
  } catch (e) {
    const er = toErrorResponse(e);
    writeAudit(ctx.logger, {
      tool: 'smartsuite_delete_records',
      accountId: ctx.config.accountId,
      applicationId,
      recordIds,
      mode: ctx.config.mode,
      success: false,
      errorCode: er.code,
    });
    return { content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }], isError: true };
  }
}
