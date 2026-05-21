export type McpMode = 'readonly' | 'readwrite' | 'admin';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  accountId: string;
  apiKey: string;
  baseUrl: string;
  mode: McpMode;
  allowedSolutions: string[];
  allowedApplications: string[];
  deniedApplications: string[];
  maxRecords: number;
  maxBatchWrites: number;
  enableDelete: boolean;
  enableSchemaWrite: boolean;
  enableSmartdocWrite: boolean;
  logLevel: LogLevel;
  logFile: string | null;
  requestTimeoutMs: number;
  retryCount: number;
  schemaCacheTtlMs: number;
  auditIncludeValues: boolean;
  aiEnrichedRecords: boolean;
  serverVersion: string;
}
