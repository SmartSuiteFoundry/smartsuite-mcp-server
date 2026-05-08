import { ToolContext, ToolResult, ok } from './context.js';

export async function handleDiagnostics(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  return ok({
    ok: true,
    serverVersion: ctx.config.serverVersion,
    baseUrl: ctx.config.baseUrl,
    accountId: ctx.config.accountId,
    mode: ctx.config.mode,
    maxRecords: ctx.config.maxRecords,
    maxBatchWrites: ctx.config.maxBatchWrites,
    features: {
      delete: ctx.config.enableDelete,
      schemaWrite: ctx.config.enableSchemaWrite,
      smartdocWrite: ctx.config.enableSmartdocWrite,
    },
    restrictions: {
      allowedSolutions: ctx.config.allowedSolutions,
      allowedApplications: ctx.config.allowedApplications,
      deniedApplications: ctx.config.deniedApplications,
    },
  });
}
