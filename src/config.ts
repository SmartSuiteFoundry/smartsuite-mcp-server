import { Config, LogLevel, McpMode } from './types/config.js';

const SERVER_VERSION = '0.8.0';

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const val = env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optionalString(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return env[key] || fallback;
}

function optionalInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const val = env[key];
  if (!val) return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new Error(`${key} must be an integer, got: ${val}`);
  return n;
}

function optionalBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const val = env[key];
  if (!val) return fallback;
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0') return false;
  throw new Error(`${key} must be true or false, got: ${val}`);
}

function parseList(val: string | undefined): string[] {
  if (!val) return [];
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseMode(val: string): McpMode {
  if (val === 'readonly' || val === 'readwrite' || val === 'admin') return val;
  throw new Error(`SMARTSUITE_MCP_MODE must be readonly, readwrite, or admin, got: ${val}`);
}

function parseLogLevel(val: string): LogLevel {
  if (val === 'debug' || val === 'info' || val === 'warn' || val === 'error') return val;
  throw new Error(`SMARTSUITE_LOG_LEVEL must be debug, info, warn, or error, got: ${val}`);
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    accountId: requireEnv(env, 'SMARTSUITE_ACCOUNT_ID'),
    apiKey: requireEnv(env, 'SMARTSUITE_API_KEY'),
    baseUrl: optionalString(env, 'SMARTSUITE_BASE_URL', 'https://app.smartsuite.com/api/v1'),
    mode: parseMode(optionalString(env, 'SMARTSUITE_MCP_MODE', 'readonly')),
    allowedSolutions: parseList(env['SMARTSUITE_ALLOWED_SOLUTIONS']),
    allowedApplications: parseList(env['SMARTSUITE_ALLOWED_APPLICATIONS']),
    deniedApplications: parseList(env['SMARTSUITE_DENIED_APPLICATIONS']),
    enableCrossWorkspace: optionalBool(env, 'SMARTSUITE_ENABLE_CROSS_WORKSPACE', false),
    allowedWorkspaces: parseList(env['SMARTSUITE_ALLOWED_WORKSPACES']),
    maxRecords: optionalInt(env, 'SMARTSUITE_MAX_RECORDS', 100),
    maxBatchWrites: optionalInt(env, 'SMARTSUITE_MAX_BATCH_WRITES', 25),
    enableDelete: optionalBool(env, 'SMARTSUITE_ENABLE_DELETE', false),
    enableSchemaWrite: optionalBool(env, 'SMARTSUITE_ENABLE_SCHEMA_WRITE', false),
    logLevel: parseLogLevel(optionalString(env, 'SMARTSUITE_LOG_LEVEL', 'info')),
    logFile: env['SMARTSUITE_LOG_FILE'] || null,
    requestTimeoutMs: optionalInt(env, 'SMARTSUITE_REQUEST_TIMEOUT_MS', 30000),
    retryCount: optionalInt(env, 'SMARTSUITE_RETRY_COUNT', 2),
    schemaCacheTtlMs: optionalInt(env, 'SCHEMA_CACHE_TTL_MS', 300000),
    auditIncludeValues: optionalBool(env, 'SMARTSUITE_AUDIT_INCLUDE_VALUES', false),
    aiEnrichedRecords: optionalBool(env, 'SMARTSUITE_AI_ENRICHED_RECORDS', false),
    serverVersion: SERVER_VERSION,
  };
}
