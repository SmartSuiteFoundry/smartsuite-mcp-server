import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { Config } from './types/config.js';
import { Logger } from './logger.js';
import { SmartSuiteClient } from './smartSuiteClient.js';
import { TOOL_DEFINITIONS } from './tools/registry.js';
import { ToolContext, ToolResult, err } from './tools/context.js';
import { toErrorResponse } from './errors.js';
import { WorkspaceResolver } from './workspaces.js';

import { handleDiagnostics } from './tools/diagnostics.js';
import { handleListWorkspaces } from './tools/workspaces.js';
import { handleListSolutions, handleGetSolution } from './tools/solutions.js';
import { handleListApplications, handleDescribeApplication } from './tools/applications.js';
import { handleListFields, handleDescribeField } from './tools/fields.js';
import {
  handleAnalyzeFormulas,
  handleValidateFormula,
  handleCreateFormulaField,
  handleUpdateFormulaField,
} from './tools/formulas.js';
import {
  handleListRecords,
  handleGetRecord,
  handleSearchRecords,
  handleQueryRecords,
} from './tools/records.read.js';
import {
  handleCreateRecord,
  handleUpdateRecord,
  handleUpdateRecords,
  handleDeleteRecords,
} from './tools/records.write.js';
import { handleListComments, handleCreateComment } from './tools/comments.js';
import {
  handleListViews,
  handleDescribeView,
  handleListDashboards,
  handleDescribeDashboard,
} from './tools/views.js';
import {
  handleListAutomations,
  handleDescribeAutomation,
  handleDescribeAutomationStep,
  handleGetAutomationLimits,
  handleListAutomationCredentials,
  handleListSolutionMembers,
  handleCreateAutomation,
  handleUpdateAutomation,
  handleDeleteAutomation,
} from './tools/automations.js';
import {
  handleListForms,
  handleDescribeForm,
  handleCreateForm,
  handleUpdateForm,
  handleSubmitForm,
} from './tools/forms.js';
import { handleListMyWork, handleUpdateMyWork } from './tools/mywork.js';
import { handleGetSmartdocContent, handleAppendSmartdocContent } from './tools/smartdocs.js';
import { handleGetFileUrl, handleUploadFile } from './tools/files.js';

type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

const HANDLERS: Record<string, ToolHandler> = {
  smartsuite_diagnostics:          handleDiagnostics,
  smartsuite_list_workspaces:       handleListWorkspaces,
  smartsuite_list_solutions:        handleListSolutions,
  smartsuite_get_solution:          handleGetSolution,
  smartsuite_list_applications:     handleListApplications,
  smartsuite_describe_application:  handleDescribeApplication,
  smartsuite_list_fields:           handleListFields,
  smartsuite_describe_field:        handleDescribeField,
  smartsuite_analyze_formulas:      handleAnalyzeFormulas,
  smartsuite_validate_formula:      handleValidateFormula,
  smartsuite_create_formula_field:  handleCreateFormulaField,
  smartsuite_update_formula_field:  handleUpdateFormulaField,
  smartsuite_list_records:          handleListRecords,
  smartsuite_get_record:            handleGetRecord,
  smartsuite_search_records:        handleSearchRecords,
  smartsuite_query_records:         handleQueryRecords,
  smartsuite_create_record:         handleCreateRecord,
  smartsuite_update_record:         handleUpdateRecord,
  smartsuite_update_records:        handleUpdateRecords,
  smartsuite_delete_records:        handleDeleteRecords,
  smartsuite_list_comments:         handleListComments,
  smartsuite_create_comment:        handleCreateComment,
  smartsuite_list_views:            handleListViews,
  smartsuite_describe_view:         handleDescribeView,
  smartsuite_list_dashboards:       handleListDashboards,
  smartsuite_describe_dashboard:    handleDescribeDashboard,
  smartsuite_list_automations:      handleListAutomations,
  smartsuite_describe_automation:   handleDescribeAutomation,
  smartsuite_describe_automation_step: handleDescribeAutomationStep,
  smartsuite_get_automation_limits: handleGetAutomationLimits,
  smartsuite_list_automation_credentials: handleListAutomationCredentials,
  smartsuite_list_solution_members: handleListSolutionMembers,
  smartsuite_create_automation:     handleCreateAutomation,
  smartsuite_update_automation:     handleUpdateAutomation,
  smartsuite_delete_automation:     handleDeleteAutomation,
  smartsuite_list_my_work:          handleListMyWork,
  smartsuite_update_my_work:        handleUpdateMyWork,
  smartsuite_list_forms:            handleListForms,
  smartsuite_describe_form:         handleDescribeForm,
  smartsuite_create_form:           handleCreateForm,
  smartsuite_update_form:           handleUpdateForm,
  smartsuite_submit_form:           handleSubmitForm,
  smartsuite_get_smartdoc_content:    handleGetSmartdocContent,
  smartsuite_append_smartdoc_content: handleAppendSmartdocContent,
  smartsuite_get_file_url:            handleGetFileUrl,
  smartsuite_upload_file:             handleUploadFile,
};

/** Tools that mutate data — never allowed to target a non-primary workspace. */
const WRITE_TOOLS = new Set<string>(
  TOOL_DEFINITIONS
    .filter((t) => !(t.annotations as { readOnlyHint?: boolean }).readOnlyHint)
    .map((t) => t.name),
);

const WORKSPACE_PARAM = {
  type: 'string',
  description:
    'Optional: target a non-primary workspace by slug or name. Requires SMARTSUITE_ENABLE_CROSS_WORKSPACE. Cross-workspace access is read-only; omit to use the configured workspace.',
} as const;

interface ServerDeps {
  config: Config;
  logger: Logger;
  client: SmartSuiteClient;
}

export function createServer(deps: ServerDeps) {
  const { config, logger, client } = deps;
  const ctx: ToolContext = { config, logger, client };
  const resolver = new WorkspaceResolver(client, config, config.schemaCacheTtlMs);

  const server = new Server(
    { name: 'smartsuite-mcp', version: config.serverVersion },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const xws = config.enableCrossWorkspace;
    const tools = TOOL_DEFINITIONS
      // Only expose the workspace tool when cross-workspace access is enabled.
      .filter((t) => xws || t.name !== 'smartsuite_list_workspaces')
      .map((t) => {
        const readOnly = (t.annotations as { readOnlyHint?: boolean }).readOnlyHint;
        // Advertise the `workspace` override only where it's usable: read-only tools, when enabled.
        if (xws && readOnly && t.name !== 'smartsuite_list_workspaces') {
          return {
            ...t,
            inputSchema: {
              ...t.inputSchema,
              properties: { ...t.inputSchema.properties, workspace: WORKSPACE_PARAM },
            },
          };
        }
        return { ...t };
      });
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    logger.debug('tool call', { tool: name });

    const handler = HANDLERS[name];
    if (!handler) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: { code: 'SMARTSUITE_NOT_FOUND', message: `Unknown tool: ${name}` } }, null, 2) }],
        isError: true,
      };
    }

    // Resolve an optional per-call workspace override into a workspace-scoped client.
    const callArgs = { ...(args as Record<string, unknown>) };
    let callCtx = ctx;
    const workspaceArg = callArgs['workspace'];
    delete callArgs['workspace'];

    if (workspaceArg !== undefined && workspaceArg !== null && workspaceArg !== '') {
      if (!config.enableCrossWorkspace) {
        return err('SMARTSUITE_PERMISSION_DENIED', 'Cross-workspace access is disabled. Set SMARTSUITE_ENABLE_CROSS_WORKSPACE=true to enable it.');
      }
      if (typeof workspaceArg !== 'string') {
        return err('SMARTSUITE_VALIDATION_ERROR', 'workspace must be a string (slug or name)');
      }
      if (WRITE_TOOLS.has(name)) {
        return err('MCP_MODE_BLOCKED', `Cross-workspace access is read-only; "${name}" is a write operation and can only target the configured workspace.`);
      }
      try {
        const slug = await resolver.resolveSlug(workspaceArg);
        callCtx = { ...ctx, client: client.withAccount(slug) };
      } catch (e) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: toErrorResponse(e) }, null, 2) }], isError: true };
      }
    }

    try {
      return await handler(callArgs, callCtx);
    } catch (e) {
      const er = toErrorResponse(e);
      logger.error('tool error', { tool: name, error: er });
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: er }, null, 2) }],
        isError: true,
      };
    }
  });

  return {
    async startStdio(): Promise<void> {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      logger.info('smartsuite-mcp server started', { mode: config.mode, version: config.serverVersion });
    },
  };
}
