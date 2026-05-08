export type ErrorCode =
  | 'SMARTSUITE_AUTH_ERROR'
  | 'SMARTSUITE_PERMISSION_DENIED'
  | 'SMARTSUITE_NOT_FOUND'
  | 'SMARTSUITE_RATE_LIMITED'
  | 'SMARTSUITE_VALIDATION_ERROR'
  | 'SMARTSUITE_TIMEOUT'
  | 'SMARTSUITE_API_ERROR'
  | 'MCP_MODE_BLOCKED'
  | 'CONFIRMATION_REQUIRED'
  | 'LIMIT_EXCEEDED'
  | 'CONFIG_ERROR'
  | 'APPLICATION_DENIED';

export interface ErrorDetails {
  field?: string;
  allowedValues?: string[];
  required?: string;
  [key: string]: unknown;
}

export class SmartSuiteError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetails,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'SmartSuiteError';
  }
}

export class McpToolError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}

export function httpStatusToCode(status: number): ErrorCode {
  switch (status) {
    case 401: return 'SMARTSUITE_AUTH_ERROR';
    case 403: return 'SMARTSUITE_PERMISSION_DENIED';
    case 404: return 'SMARTSUITE_NOT_FOUND';
    case 429: return 'SMARTSUITE_RATE_LIMITED';
    case 400: case 422: return 'SMARTSUITE_VALIDATION_ERROR';
    default:  return 'SMARTSUITE_API_ERROR';
  }
}

export function toErrorResponse(err: unknown): { code: string; message: string; details?: unknown } {
  if (err instanceof SmartSuiteError || err instanceof McpToolError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof Error) {
    return { code: 'SMARTSUITE_API_ERROR', message: err.message };
  }
  return { code: 'SMARTSUITE_API_ERROR', message: String(err) };
}
