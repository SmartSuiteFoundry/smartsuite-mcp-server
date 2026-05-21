import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { Config } from './types/config.js';
import { Logger } from './logger.js';
import { SmartSuiteClient } from './smartSuiteClient.js';
import { TOOL_DEFINITIONS } from './tools/registry.js';
import { ToolContext, ToolResult } from './tools/context.js';
import { toErrorResponse } from './errors.js';

import { handleDiagnostics } from './tools/diagnostics.js';
import { handleListSolutions, handleGetSolution } from './tools/solutions.js';
import { handleListApplications, handleDescribeApplication } from './tools/applications.js';
import { handleListFields, handleDescribeField } from './tools/fields.js';
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
import { handleListViews, handleDescribeView } from './tools/views.js';
import { handleGetSmartdocContent, handleAppendSmartdocContent } from './tools/smartdocs.js';
import { handleGetFileUrl, handleUploadFile } from './tools/files.js';

type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

const HANDLERS: Record<string, ToolHandler> = {
  smartsuite_diagnostics:          handleDiagnostics,
  smartsuite_list_solutions:        handleListSolutions,
  smartsuite_get_solution:          handleGetSolution,
  smartsuite_list_applications:     handleListApplications,
  smartsuite_describe_application:  handleDescribeApplication,
  smartsuite_list_fields:           handleListFields,
  smartsuite_describe_field:        handleDescribeField,
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
  smartsuite_get_smartdoc_content:    handleGetSmartdocContent,
  smartsuite_append_smartdoc_content: handleAppendSmartdocContent,
  smartsuite_get_file_url:            handleGetFileUrl,
  smartsuite_upload_file:             handleUploadFile,
};

interface ServerDeps {
  config: Config;
  logger: Logger;
  client: SmartSuiteClient;
}

export function createServer(deps: ServerDeps) {
  const { config, logger, client } = deps;
  const ctx: ToolContext = { config, logger, client };

  const server = new Server(
    { name: 'smartsuite-mcp', version: config.serverVersion },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({ ...t })),
  }));

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

    try {
      return await handler(args as Record<string, unknown>, ctx);
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
