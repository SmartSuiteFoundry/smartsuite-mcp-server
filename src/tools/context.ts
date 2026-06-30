import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Config } from '../types/config.js';
import { Logger } from '../logger.js';
import { SmartSuiteClient } from '../smartSuiteClient.js';
import type { WorkspaceResolver } from '../workspaces.js';

export interface ToolContext {
  config: Config;
  logger: Logger;
  client: SmartSuiteClient;
  /** Resolves workspace slug/name and enforces the allowlist. Present when the server wires it. */
  resolver?: WorkspaceResolver;
}

export type ToolResult = CallToolResult;

export function ok(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

export function err(code: string, message: string, details?: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: { code, message, details } }, null, 2) }],
    isError: true,
  };
}
