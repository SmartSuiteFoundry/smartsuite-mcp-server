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
      restore: ctx.config.enableRestore,
      schemaWrite: ctx.config.enableSchemaWrite,
      smartdocWrite: ctx.config.mode !== 'readonly',
      crossWorkspace: ctx.config.enableCrossWorkspace,
    },
    restrictions: {
      allowedSolutions: ctx.config.allowedSolutions,
      allowedApplications: ctx.config.allowedApplications,
      deniedApplications: ctx.config.deniedApplications,
      allowedWorkspaces: ctx.config.allowedWorkspaces,
    },
  });
}
